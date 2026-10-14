/**
 * 功耗计算（PRD M4 / 3.4.2）
 *
 * 纯函数模块，不接触 DOM，可在 Node 中单测。
 *
 * 计算模型（PRD 3.4.2）：
 *   整机峰值 = CPU + 显卡 + 主板 + 内存 + 硬盘 + 水冷泵 + 机箱风扇
 *   建议电源 = 向上取整到 50W 档位(峰值 × 1.4)
 *   电源余量 = (电源瓦数 − 峰值) / 电源瓦数 × 100%
 *
 * 关键要求：
 *   - CPU 取 maxPower（峰值/PPT/PL2），而非 tdp —— 否则会低估
 *   - 每个部件的取值依据要能回传（供 M4-5「点击展开看计算依据」）
 */

import { POWER_MODEL, THRESHOLDS } from './enums.js';

/**
 * 计算单个部件的功耗，并返回依据说明
 * @returns {{ key:string, label:string, watts:number, basis:string } | null}
 */
function cpuPower(cpu) {
  if (!cpu) return null;
  if (typeof cpu.maxPower === 'number') {
    return {
      key: 'cpu',
      label: `CPU ${cpu.name}`,
      watts: cpu.maxPower,
      basis: `取 maxPower（峰值功耗/PPT/PL2）= ${cpu.maxPower}W，而非标称 TDP ${cpu.tdp ?? '?'}W`,
    };
  }
  // 兜底：tdp × 1.2
  const tdp = typeof cpu.tdp === 'number' ? cpu.tdp : 0;
  const watts = Math.round(tdp * POWER_MODEL.CPU_TDP_FALLBACK_FACTOR);
  return {
    key: 'cpu',
    label: `CPU ${cpu.name}`,
    watts,
    basis: `数据缺 maxPower，按 tdp ${tdp}W × ${POWER_MODEL.CPU_TDP_FALLBACK_FACTOR} 估算 = ${watts}W`,
  };
}

function gpuPower(gpu) {
  if (!gpu) return null;
  const watts = typeof gpu.tdp === 'number' ? gpu.tdp : 0;
  return {
    key: 'gpu',
    label: `显卡 ${gpu.name}`,
    watts,
    basis: `取型号标称功耗 tdp = ${watts}W`,
  };
}

function motherboardPower(mb) {
  if (!mb) return null;
  const watts = POWER_MODEL.MOTHERBOARD_W;
  return {
    key: 'motherboard',
    label: `主板 ${mb.name}`,
    watts,
    basis: `固定经验值 ${watts}W（芯片组+供电+网卡等）`,
  };
}

function memoryPower(mem) {
  if (!mem) return null;
  const modules = typeof mem.modules === 'number' ? mem.modules : 1;
  const watts = modules * POWER_MODEL.MEMORY_PER_MODULE_W;
  return {
    key: 'memory',
    label: `内存 ${mem.name}`,
    watts,
    basis: `${modules} 条 × ${POWER_MODEL.MEMORY_PER_MODULE_W}W = ${watts}W`,
  };
}

function storagePower(list) {
  const arr = Array.isArray(list) ? list.filter(Boolean) : list ? [list] : [];
  if (arr.length === 0) return null;

  const parts = [];
  let total = 0;
  for (const s of arr) {
    let w;
    if (s.interface === 'NVMe') w = POWER_MODEL.STORAGE_W.NVMe;
    else if (s.formFactor === '3.5"') w = POWER_MODEL.STORAGE_W.HDD_35;
    else w = POWER_MODEL.STORAGE_W.SATA_SSD;
    total += w;
    parts.push(`${s.name} ${w}W`);
  }
  return {
    key: 'storage',
    label: `硬盘 ×${arr.length}`,
    watts: total,
    basis: parts.join(' + '),
  };
}

function coolerPower(cooler) {
  if (!cooler) return null;
  if (cooler.type !== 'aio') return null; // 风冷无独立供电（风扇计入机箱风扇估算）
  const watts = POWER_MODEL.AIO_PUMP_W;
  return {
    key: 'cooler',
    label: `水冷泵 ${cooler.name}`,
    watts,
    basis: `一体式水冷泵固定 ${watts}W`,
  };
}

function caseFanPower(kase) {
  const watts = POWER_MODEL.CASE_FANS_W;
  return {
    key: 'caseFans',
    label: '机箱风扇（估）',
    watts,
    basis: kase
      ? `按典型 3 个风扇估算 ${watts}W（未选风扇品类）`
      : `未选机箱，仍按典型配置估算 ${watts}W`,
  };
}

/**
 * 计算整机功耗
 * @param {object} config 已解析为对象的配置 { cpu, motherboard, gpu, memory, psu, cooler, case, storage }
 * @returns {{
 *   breakdown: Array<{key,label,watts,basis}>,
 *   peak: number,
 *   recommendedPsu: number,
 *   psuWattage: number|null,
 *   margin: number|null,
 *   level: 'error'|'warn'|'ok'|'info',
 *   incomplete: boolean
 * }}
 */
export function computePower(config = {}) {
  const { cpu, motherboard, gpu, memory, psu, cooler, case: kase, storage } = config;

  const breakdown = [
    cpuPower(cpu),
    gpuPower(gpu),
    motherboardPower(motherboard),
    memoryPower(memory),
    storagePower(storage),
    coolerPower(cooler),
    caseFanPower(kase),
  ].filter(Boolean);

  // 只有选了 CPU 或显卡才算有意义；否则视为配置不完整
  const incomplete = !cpu && !gpu;

  const peak = breakdown.reduce((sum, b) => sum + b.watts, 0);

  const step = POWER_MODEL.PSU_ROUNDING_STEP;
  const recommendedPsu = Math.ceil((peak * POWER_MODEL.PSU_HEADROOM_FACTOR) / step) * step;

  const psuWattage = psu && typeof psu.wattage === 'number' ? psu.wattage : null;

  let margin = null;
  if (psuWattage !== null && psuWattage > 0) {
    margin = ((psuWattage - peak) / psuWattage) * 100;
  }

  // 等级判定（PRD 3.4.2 阈值表 + M4-4）
  let level = 'ok';
  if (psuWattage !== null) {
    if (psuWattage < peak) level = 'error';
    else if (margin < THRESHOLDS.PSU_LOW_MARGIN_PCT) level = 'warn';
    else if (margin > THRESHOLDS.PSU_HIGH_MARGIN_PCT) level = 'info';
  }

  return {
    breakdown,
    peak,
    recommendedPsu,
    psuWattage,
    margin: margin === null ? null : Math.round(margin * 10) / 10,
    level,
    incomplete,
  };
}

/**
 * 供 W1（余量<20%）、I1（余量>50%）规则复用
 */
export function powerFlags(power) {
  const flags = { lowMargin: false, highMargin: false, insufficient: false };
  if (!power || power.psuWattage === null) return flags;
  if (power.psuWattage < power.peak) flags.insufficient = true;
  else if (power.margin < THRESHOLDS.PSU_LOW_MARGIN_PCT) flags.lowMargin = true;
  if (power.margin !== null && power.margin > THRESHOLDS.PSU_HIGH_MARGIN_PCT) {
    flags.highMargin = true;
  }
  return flags;
}
