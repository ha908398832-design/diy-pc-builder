/**
 * 32 条兼容性规则元数据（PRD 第四部分）
 *
 * 声明式描述，一处定义、三处消费：
 *   1. rules.js 引擎      —— 按注册表执行 check
 *   2. status.js 状态灯   —— 用 categories 汇总（PRD 4.4）
 *   3. 规则说明弹窗       —— 用 fields / good / bad 展示（PRD M3-8）
 *
 * 字段说明：
 *   id         规则编号 E1~E17 / W1~W11 / I1~I4
 *   level      error | warn | info
 *   title      一句话标题（界面卡片标题）
 *   categories 涉及品类 → 状态灯同时点亮（PRD 4.4）
 *   required   必须已选的品类；缺失则跳过本规则并计入 skipped（PRD M3-6）
 *   fields     涉及的数据字段（规则说明弹窗展示）
 *   good/bad   正确示例 / 错误示例（规则说明弹窗展示）
 *   check(ctx) 返回 null（通过）或 { reason, advice, refs }
 *              ctx 已把 ID 解析为对象：{ cpu, motherboard, ... , power, config }
 *              reason 必须具体到双方型号与数值（PRD M3-3）
 *              advice 以可执行动作表述（PRD 3.3.2）
 */

import { THRESHOLDS } from './enums.js';

// ── 小工具 ──────────────────────────────────────────────────────────
const n = (v) => (typeof v === 'number' ? v : null);
const fmtW = (v) => `${v}W`;
const fmtMm = (v) => `${v}mm`;

/** 生成 refs：用于界面「查看XX」跳转按钮 */
const ref = (...cats) => cats.map((c) => ({ category: c }));

/**
 * BIOS 兼容表（PRD 4.5）—— W5 的数据基础
 * 键为芯片组，值为「需要刷 BIOS 才能支持的 CPU 代际」判定函数/标记
 */
export const BIOS_COMPAT = {
  A320: { needsUpdateFor: ['Ryzen 3000', 'Ryzen 5000'], note: '需更新 BIOS 才能上 Ryzen 3000/5000' },
  B350: { needsUpdateFor: ['Ryzen 3000', 'Ryzen 5000'], note: '需更新 BIOS 才能上 Ryzen 3000/5000' },
  X370: { needsUpdateFor: ['Ryzen 3000', 'Ryzen 5000'], note: '需更新 BIOS 才能上 Ryzen 3000/5000' },
  B450: { needsUpdateFor: ['Ryzen 5000'], note: '需更新 BIOS 才能上 Ryzen 5000' },
  X470: { needsUpdateFor: ['Ryzen 5000'], note: '需更新 BIOS 才能上 Ryzen 5000' },
  A520: { needsUpdateFor: ['Ryzen 5000'], note: '早期批次需更新 BIOS 才能上部分 Ryzen 5000' },
  B550: { needsUpdateFor: ['Ryzen 5000'], note: '早期批次需更新 BIOS 才能上部分 Ryzen 5000' },
  X570: { needsUpdateFor: ['Ryzen 5000'], note: '早期批次需更新 BIOS 才能上部分 Ryzen 5000' },
  B660: { needsUpdateFor: ['Intel 13'], note: '需更新 BIOS 才能上 Intel 13 代' },
  H610: { needsUpdateFor: ['Intel 13'], note: '需更新 BIOS 才能上 Intel 13 代' },
  B760: { needsUpdateFor: ['Intel 14'], note: '需更新 BIOS 才能上 Intel 14 代' },
  Z790: { needsUpdateFor: ['Intel 14'], note: '需更新 BIOS 才能上 Intel 14 代' },
};

/**
 * 判断 CPU 属于哪一代（用于 W5）
 * 依据型号名与插槽推断，尽量稳健
 */
export function cpuGeneration(cpu) {
  if (!cpu) return null;
  const name = `${cpu.name || ''}`.toLowerCase();

  // AMD Ryzen
  if (/ryzen|r[3579]\s*\d/.test(name) || (cpu.socket || '').startsWith('AM')) {
    if (/9\d{3}/.test(name)) return 'Ryzen 9000';
    if (/8\d{3}/.test(name)) return 'Ryzen 8000';
    if (/7\d{3}/.test(name)) return 'Ryzen 7000';
    if (/5\d{3}/.test(name)) return 'Ryzen 5000';
    if (/4\d{3}/.test(name)) return 'Ryzen 4000';
    if (/3\d{3}/.test(name)) return 'Ryzen 3000';
    if (/2\d{3}/.test(name)) return 'Ryzen 2000';
    if (/1\d{3}/.test(name)) return 'Ryzen 1000';
  }

  // Intel Core
  if (/i[3579]-1[0-9]{4}/.test(name) || /ultra\s*[579]/.test(name)) {
    if (/ultra/.test(name)) return 'Intel Core Ultra 200';
    const m = name.match(/i[3579]-(\d{2})\d{3}/);
    if (m) {
      const gen = Number(m[1]);
      // i5-14600KF → 14 代；i5-10400F → 10 代
      if (gen >= 14) return 'Intel 14';
      if (gen === 13) return 'Intel 13';
      if (gen === 12) return 'Intel 12';
      if (gen === 11) return 'Intel 11';
      if (gen === 10) return 'Intel 10';
      return `Intel ${gen}`;
    }
  }

  // Xeon 洋垃圾
  if (/xeon|e5-|e3-/.test(name)) return 'Xeon';

  return null;
}

/** 平台代际是否为生命周期末期（用于 I3） */
const LEGACY_PLATFORMS = ['AM4', 'LGA1200', 'LGA1151', 'LGA2011-3', 'LGA2066'];

// ══════════════════════════════════════════════════════════════════
// 规则集
// ══════════════════════════════════════════════════════════════════

export const RULES = [
  // ── 🔴 错误（17 条）────────────────────────────────────────────
  {
    id: 'E1',
    level: 'error',
    title: 'CPU 与主板插槽不匹配',
    categories: ['cpu', 'motherboard'],
    required: ['cpu', 'motherboard'],
    fields: ['cpu.socket', 'motherboard.socket'],
    good: 'AM5 主板 + AM5 CPU（如 B650 + R7 7800X3D）',
    bad: 'AM4 主板 + LGA1700 CPU（如 B450M + i5-14600KF）',
    check({ cpu, motherboard }) {
      if (cpu.socket === motherboard.socket) return null;
      return {
        reason: `主板「${motherboard.name}」是 ${motherboard.socket} 插槽，而 CPU「${cpu.name}」是 ${cpu.socket} 插槽，两者无法安装。`,
        advice: `换 ${cpu.socket} 插槽的主板，或换 ${motherboard.socket} 插槽的 CPU`,
        refs: ref('motherboard', 'cpu'),
      };
    },
  },
  {
    id: 'E2',
    level: 'error',
    title: '内存代数与主板不匹配',
    categories: ['memory', 'motherboard'],
    required: ['memory', 'motherboard'],
    fields: ['memory.memoryType', 'motherboard.memoryType'],
    good: 'DDR5 内存 + DDR5 主板',
    bad: 'DDR4 内存 + DDR5 主板（插槽缺口位置不同，物理上插不进）',
    check({ memory, motherboard }) {
      if (memory.memoryType === motherboard.memoryType) return null;
      return {
        reason: `主板「${motherboard.name}」只支持 ${motherboard.memoryType}，而内存「${memory.name}」是 ${memory.memoryType}，插槽缺口不同无法安装。`,
        advice: `换 ${motherboard.memoryType} 内存，或换支持 ${memory.memoryType} 的主板`,
        refs: ref('memory', 'motherboard'),
      };
    },
  },
  {
    id: 'E3',
    level: 'error',
    title: '主板内存代数超出 CPU 支持范围',
    categories: ['motherboard', 'cpu'],
    required: ['motherboard', 'cpu'],
    fields: ['motherboard.memoryType', 'cpu.memoryTypes'],
    good: 'CPU 支持 DDR4/DDR5，主板用 DDR5',
    bad: 'CPU 仅支持 DDR5，却配 DDR4 主板',
    check({ motherboard, cpu }) {
      const types = Array.isArray(cpu.memoryTypes) ? cpu.memoryTypes : [];
      if (types.includes(motherboard.memoryType)) return null;
      return {
        reason: `CPU「${cpu.name}」只支持 ${types.join(' / ') || '未知'} 内存，而主板「${motherboard.name}」是 ${motherboard.memoryType} 内存插槽。`,
        advice: `换支持 ${types.join(' / ') || '兼容代数'} 内存的主板`,
        refs: ref('motherboard', 'cpu'),
      };
    },
  },
  {
    id: 'E4',
    level: 'error',
    title: '机箱不支持该主板板型',
    categories: ['motherboard', 'case'],
    required: ['motherboard', 'case'],
    fields: ['motherboard.formFactor', 'case.formFactors'],
    good: '机箱支持 ATX/M-ATX/ITX，装 M-ATX 主板',
    bad: '只支持 Mini-ITX 的机箱装 ATX 主板',
    check({ motherboard, case: kase }) {
      const supported = Array.isArray(kase.formFactors) ? kase.formFactors : [];
      if (supported.includes(motherboard.formFactor)) return null;
      return {
        reason: `机箱「${kase.name}」只支持 ${supported.join(' / ') || '未知'} 板型，而主板「${motherboard.name}」是 ${motherboard.formFactor}。`,
        advice: `换支持 ${motherboard.formFactor} 的机箱，或换 ${supported.join(' / ')} 板型的主板`,
        refs: ref('case', 'motherboard'),
      };
    },
  },
  {
    id: 'E5',
    level: 'error',
    title: '显卡长度超过机箱限长',
    categories: ['gpu', 'case'],
    required: ['gpu', 'case'],
    fields: ['gpu.length_mm', 'case.maxGpuLength'],
    good: '显卡 267mm + 机箱限长 392mm',
    bad: '显卡 358mm + 机箱限长 330mm',
    check({ gpu, case: kase }) {
      const max = n(kase.maxGpuLength);
      if (max === null || gpu.length_mm <= max) return null;
      return {
        reason: `显卡「${gpu.name}」长度 ${fmtMm(gpu.length_mm)}，超过机箱「${kase.name}」的显卡限长 ${fmtMm(max)}，超出 ${fmtMm(gpu.length_mm - max)}。`,
        advice: `换限长 ≥${fmtMm(gpu.length_mm)} 的机箱，或换更短的显卡（≤${fmtMm(max)}）`,
        refs: ref('gpu', 'case'),
      };
    },
  },
  {
    id: 'E6',
    level: 'error',
    title: '显卡厚度超过机箱可用槽位',
    categories: ['gpu', 'case'],
    required: ['gpu', 'case'],
    fields: ['gpu.thicknessSlots', 'case.maxGpuThickness'],
    good: '显卡 2.5 槽 + 机箱限厚 3.5 槽',
    bad: '显卡 3.5 槽 + 机箱限厚 2 槽',
    check({ gpu, case: kase }) {
      const max = n(kase.maxGpuThickness);
      if (max === null || gpu.thicknessSlots <= max) return null;
      return {
        reason: `显卡「${gpu.name}」厚 ${gpu.thicknessSlots} 槽，超过机箱「${kase.name}」的显卡限厚 ${max} 槽，会挡住扩展槽位或顶侧板。`,
        advice: `换限厚 ≥${gpu.thicknessSlots} 槽的机箱，或换更薄的显卡`,
        refs: ref('gpu', 'case'),
      };
    },
  },
  {
    id: 'E7',
    level: 'error',
    title: '风冷散热器高度超过机箱限高',
    categories: ['cooler', 'case'],
    required: ['cooler', 'case'],
    fields: ['cooler.type', 'cooler.height_mm', 'case.maxCoolerHeight'],
    good: '风冷 155mm + 机箱限高 180mm',
    bad: '风冷 157mm + 机箱限高 100mm（顶侧板装不上）',
    check({ cooler, case: kase }) {
      if (cooler.type !== 'air') return null;
      const h = n(cooler.height_mm);
      const max = n(kase.maxCoolerHeight);
      if (h === null || max === null || h <= max) return null;
      return {
        reason: `风冷散热器「${cooler.name}」高度 ${fmtMm(h)}，超过机箱「${kase.name}」的风冷限高 ${fmtMm(max)}，超出 ${fmtMm(h - max)}。`,
        advice: `换限高 ≥${fmtMm(h)} 的机箱，或换更矮的散热器 / 改用水冷`,
        refs: ref('cooler', 'case'),
      };
    },
  },
  {
    id: 'E8',
    level: 'error',
    title: '机箱不支持该冷排规格',
    categories: ['cooler', 'case'],
    required: ['cooler', 'case'],
    fields: ['cooler.type', 'cooler.radiatorSize', 'case.radiatorSupport'],
    good: '机箱支持 360 冷排 + 360 水冷',
    bad: '机箱只支持到 240 冷排，却选 360 水冷',
    check({ cooler, case: kase }) {
      if (cooler.type !== 'aio') return null;
      const size = n(cooler.radiatorSize);
      if (size === null) return null;
      const supported = Array.isArray(kase.radiatorSupport) ? kase.radiatorSupport : [];
      if (supported.includes(size)) return null;
      const desc = supported.length ? supported.map((s) => `${s}`).join(' / ') : '不支持任何水冷';
      return {
        reason: `水冷「${cooler.name}」冷排规格为 ${size}，而机箱「${kase.name}」支持的是 ${desc}。`,
        advice: supported.length
          ? `换 ${desc} 规格的水冷，或换支持 ${size} 冷排的机箱`
          : '该机箱不支持水冷，建议改用风冷散热器，或换支持水冷的机箱',
        refs: ref('cooler', 'case'),
      };
    },
  },
  {
    id: 'E9',
    level: 'error',
    title: '散热器不支持该 CPU 插槽',
    categories: ['cooler', 'cpu'],
    required: ['cooler', 'cpu'],
    fields: ['cooler.sockets', 'cpu.socket'],
    good: '散热器扣具支持 AM5 + CPU 是 AM5',
    bad: '散热器仅支持 AM4，却装在 AM5 或 LGA1700 上',
    check({ cooler, cpu }) {
      const sockets = Array.isArray(cooler.sockets) ? cooler.sockets : [];
      if (sockets.includes(cpu.socket)) return null;
      return {
        reason: `散热器「${cooler.name}」支持 ${sockets.join(' / ') || '未知'} 插槽，而 CPU「${cpu.name}」是 ${cpu.socket} 插槽，扣具不匹配。`,
        advice: `换支持 ${cpu.socket} 的散热器（可向厂商索取扣具），或换 ${sockets.join(' / ')} 插槽的 CPU`,
        refs: ref('cooler', 'cpu'),
      };
    },
  },
  {
    id: 'E10',
    level: 'error',
    title: '电源额定瓦数不足',
    categories: ['psu', 'cpu', 'gpu'],
    required: ['psu', 'cpu'],
    fields: ['psu.wattage', 'power.peak'],
    good: '整机峰值 457W + 电源 650W',
    bad: '整机峰值 457W + 电源 400W（带不动，会关机/重启）',
    check({ psu, power }) {
      if (power.peak <= psu.wattage) return null;
      return {
        reason: `整机峰值功耗 ${fmtW(power.peak)}，超过电源「${psu.name}」的额定 ${fmtW(psu.wattage)}，差 ${fmtW(power.peak - psu.wattage)}。`,
        advice: `换额定 ≥${fmtW(power.recommendedPsu)} 的电源（建议按峰值 ×1.4 留余量）`,
        refs: ref('psu', 'cpu', 'gpu'),
      };
    },
  },
  {
    id: 'E11',
    level: 'error',
    title: '电源显卡供电接口不足',
    categories: ['psu', 'gpu'],
    required: ['psu', 'gpu'],
    fields: ['psu.pcie8pin', 'psu.pcie12vhpwr', 'gpu.pcie8pin', 'gpu.pcie12vhpwr'],
    good: '显卡需 2×8pin + 电源有 4×8pin',
    bad: '显卡需 1×12VHPWR + 电源无 12VHPWR 且 8pin 不够转接',
    check({ psu, gpu }) {
      const need8 = n(gpu.pcie8pin) ?? 0;
      const need12 = n(gpu.pcie12vhpwr) ?? 0;
      const have8 = n(psu.pcie8pin) ?? 0;
      const have12 = n(psu.pcie12vhpwr) ?? 0;

      const missing = [];
      if (have8 < need8) missing.push(`8pin 需 ${need8} 个，电源只有 ${have8} 个`);
      if (have12 < need12) missing.push(`12VHPWR 需 ${need12} 个，电源只有 ${have12} 个`);
      if (missing.length === 0) return null;

      return {
        reason: `显卡「${gpu.name}」供电接口不足：${missing.join('；')}。用转接线降级供电有烧毁风险。`,
        advice: '换接口更充足的电源（注意 12VHPWR 需原生支持，不建议用 8pin 转接）',
        refs: ref('psu', 'gpu'),
      };
    },
  },
  {
    id: 'E12',
    level: 'error',
    title: '电源 CPU 供电接口不足',
    categories: ['psu', 'motherboard'],
    required: ['psu', 'motherboard'],
    fields: ['psu.eps8pin', 'motherboard.cpuPowerConnectors'],
    good: '主板需 2×8pin(8+4) + 电源有 2×8pin',
    bad: '主板需 8+4pin + 电源只有 1×8pin（高负载供电不足）',
    check({ psu, motherboard }) {
      const need = n(motherboard.cpuPowerConnectors) ?? 1;
      const have = n(psu.eps8pin) ?? 0;
      if (have >= need) return null;
      return {
        reason: `主板「${motherboard.name}」需要 ${need} 个 CPU 8pin 供电（按 8pin 等效计），而电源「${psu.name}」只有 ${have} 个。`,
        advice: `换提供 ≥${need} 个 CPU 8pin 的电源，或更换供电需求更低的主板`,
        refs: ref('psu', 'motherboard'),
      };
    },
  },
  {
    id: 'E13',
    level: 'error',
    title: '机箱不支持该电源规格',
    categories: ['psu', 'case'],
    required: ['psu', 'case'],
    fields: ['psu.formFactor', 'case.psuFormFactors'],
    good: 'ATX 电源 + 支持 ATX 的机箱',
    bad: 'ATX 电源 + 只支持 SFX 的 ITX 机箱',
    check({ psu, case: kase }) {
      const supported = Array.isArray(kase.psuFormFactors) ? kase.psuFormFactors : [];
      if (supported.includes(psu.formFactor)) return null;
      return {
        reason: `电源「${psu.name}」是 ${psu.formFactor} 规格，而机箱「${kase.name}」只支持 ${supported.join(' / ') || '未知'} 电源。`,
        advice: `换 ${supported.join(' / ')} 规格的电源，或换支持 ${psu.formFactor} 的机箱`,
        refs: ref('psu', 'case'),
      };
    },
  },
  {
    id: 'E14',
    level: 'error',
    title: '电源长度超过机箱限长',
    categories: ['psu', 'case'],
    required: ['psu', 'case'],
    fields: ['psu.length_mm', 'case.maxPsuLength'],
    good: '电源 140mm + 机箱限长 210mm',
    bad: '电源 180mm + 机箱限长 160mm（顶硬盘架）',
    check({ psu, case: kase }) {
      const max = n(kase.maxPsuLength);
      if (max === null || psu.length_mm <= max) return null;
      return {
        reason: `电源「${psu.name}」长度 ${fmtMm(psu.length_mm)}，超过机箱「${kase.name}」的电源限长 ${fmtMm(max)}，超出 ${fmtMm(psu.length_mm - max)}。`,
        advice: `换长度 ≤${fmtMm(max)} 的电源，或换电源限长更大的机箱`,
        refs: ref('psu', 'case'),
      };
    },
  },
  {
    id: 'E15',
    level: 'error',
    title: '硬盘接口数量超过主板可用接口',
    categories: ['storage', 'motherboard'],
    required: ['storage', 'motherboard'],
    fields: ['storage.interface', 'motherboard.m2Slots', 'motherboard.sataPorts'],
    good: '2 个 NVMe + 主板 2 个 M.2 口',
    bad: '3 个 NVMe + 主板只有 2 个 M.2 口',
    check({ storage, motherboard }) {
      const list = Array.isArray(storage) ? storage : storage ? [storage] : [];
      if (list.length === 0) return null;

      const nvme = list.filter((s) => s.interface === 'NVMe').length;
      const sata = list.filter((s) => s.interface === 'SATA').length;
      const m2 = n(motherboard.m2Slots) ?? 0;
      const sataPorts = n(motherboard.sataPorts) ?? 0;

      const problems = [];
      if (nvme > m2) problems.push(`NVMe 硬盘 ${nvme} 个，主板只有 ${m2} 个 M.2 接口（差 ${nvme - m2} 个）`);
      if (sata > sataPorts) problems.push(`SATA 硬盘 ${sata} 个，主板只有 ${sataPorts} 个 SATA 接口（差 ${sata - sataPorts} 个）`);
      if (problems.length === 0) return null;

      return {
        reason: `主板「${motherboard.name}」接口不足：${problems.join('；')}。`,
        advice: '减少硬盘数量、换接口更多的主板，或用 PCIe 转 M.2 扩展卡',
        refs: ref('storage', 'motherboard'),
      };
    },
  },
  {
    id: 'E16',
    level: 'error',
    title: '无显卡且 CPU 无核显，无法点亮',
    categories: ['cpu', 'gpu'],
    required: ['cpu'],
    fields: ['cpu.igpu', 'gpu'],
    good: 'CPU 带核显（如 R7 7800X3D）或已选独立显卡',
    bad: 'i5-14600KF（无核显）且未选显卡',
    check({ cpu, gpu }) {
      if (gpu) return null;
      if (cpu.igpu === true) return null;
      return {
        reason: `CPU「${cpu.name}」不带核显，且未选择独立显卡，两者都没有将无法点亮显示器。`,
        advice: '选一块独立显卡，或换带核显的 CPU（Intel 非 F 后缀 / AMD 带 G 后缀或 X3D 带核显型号）',
        refs: ref('gpu', 'cpu'),
      };
    },
  },
  {
    id: 'E17',
    level: 'error',
    title: '内存条数超过主板内存槽数',
    categories: ['memory', 'motherboard'],
    required: ['memory', 'motherboard'],
    fields: ['memory.modules', 'motherboard.memorySlots'],
    good: '2 条内存 + 主板 4 槽',
    bad: '4 条内存 + 主板 2 槽',
    check({ memory, motherboard }) {
      const need = n(memory.modules) ?? 1;
      const slots = n(motherboard.memorySlots) ?? 0;
      if (need <= slots) return null;
      return {
        reason: `内存「${memory.name}」共 ${need} 条，而主板「${motherboard.name}」只有 ${slots} 个内存插槽，插不下。`,
        advice: `换 ${slots} 条以内的套装，或换 ≥${need} 槽的主板`,
        refs: ref('memory', 'motherboard'),
      };
    },
  },

  // ── 🟡 警告（11 条）────────────────────────────────────────────
  {
    id: 'W1',
    level: 'warn',
    title: '电源余量偏低',
    categories: ['psu', 'cpu', 'gpu'],
    required: ['psu', 'cpu'],
    fields: ['power.margin', 'psu.wattage', 'power.peak'],
    good: '峰值 457W + 电源 650W（余量 30%）',
    bad: '峰值 457W + 电源 550W（余量 17%）',
    check({ psu, power }) {
      if (power.psuWattage === null) return null;
      if (power.peak > psu.wattage) return null; // 已由 E10 报错，不重复
      if (power.margin >= THRESHOLDS.PSU_LOW_MARGIN_PCT) return null;
      return {
        reason: `整机峰值 ${fmtW(power.peak)} / 电源 ${fmtW(psu.wattage)}，余量仅 ${power.margin}%（低于 ${THRESHOLDS.PSU_LOW_MARGIN_PCT}%），长期满载或瞬时峰值有风险。`,
        advice: `建议换 ${fmtW(power.recommendedPsu)} 及以上电源`,
        refs: ref('psu', 'cpu', 'gpu'),
      };
    },
  },
  {
    id: 'W2',
    level: 'warn',
    title: '散热器能力压不住 CPU',
    categories: ['cooler', 'cpu'],
    required: ['cooler', 'cpu'],
    fields: ['cooler.tdpRating', 'cpu.maxPower'],
    good: '散热能力 245W + CPU 峰值 181W',
    bad: '散热能力 120W + CPU 峰值 181W',
    check({ cooler, cpu }) {
      const rating = n(cooler.tdpRating);
      const need = n(cpu.maxPower);
      if (rating === null || need === null || rating >= need) return null;
      return {
        reason: `散热器「${cooler.name}」散热能力 ${fmtW(rating)}，低于 CPU「${cpu.name}」的峰值功耗 ${fmtW(need)}，高负载会降频或高温。`,
        advice: `换散热能力 ≥${fmtW(need)} 的散热器（建议留 20% 余量）`,
        refs: ref('cooler', 'cpu'),
      };
    },
  },
  {
    id: 'W3',
    level: 'warn',
    title: '内存频率超过主板支持上限',
    categories: ['memory', 'motherboard', 'cpu'],
    required: ['memory', 'motherboard'],
    fields: ['memory.speed', 'motherboard.maxMemorySpeed'],
    good: '内存 DDR4-3200 + 主板支持 3466',
    bad: '内存 DDR4-3600 + 主板最高 3466（将降频）',
    check({ memory, motherboard }) {
      const speed = n(memory.speed);
      const max = n(motherboard.maxMemorySpeed);
      if (speed === null || max === null || speed <= max) return null;
      return {
        reason: `内存「${memory.name}」频率 ${speed} MT/s，超过主板「${motherboard.name}」支持上限 ${max} MT/s，将降频至 ${max} MT/s 运行。`,
        advice: `可换 ≤${max} MT/s 的内存省心，或接受降频（性能损失有限）`,
        refs: ref('memory', 'motherboard'),
      };
    },
  },
  {
    id: 'W4',
    level: 'warn',
    title: '内存频率超过 CPU 官方支持',
    categories: ['memory', 'cpu'],
    required: ['memory', 'cpu'],
    fields: ['memory.speed', 'cpu.maxMemorySpeed'],
    good: '内存 DDR4-3200 + CPU 官方支持 3200',
    bad: '内存 DDR4-3600 + CPU 官方 3200（属超频，可能开不了机）',
    check({ memory, cpu }) {
      const speed = n(memory.speed);
      const max = n(cpu.maxMemorySpeed);
      if (speed === null || max === null || speed <= max) return null;
      // 若 W3（主板限制）已更严格，本规则仍报，但属提示性质；
      // 两级都是 warn，界面会同时列出，PRD 4.2 明确要求这条
      return {
        reason: `内存「${memory.name}」频率 ${speed} MT/s，高于 CPU「${cpu.name}」官方支持 ${max} MT/s，属于超频范畴（需开 XMP/EXPO），个别情况可能开不了机。`,
        advice: '多数可稳定运行；若无法开机，进 BIOS 降到官方频率或关闭 XMP/EXPO',
        refs: ref('memory', 'cpu'),
      };
    },
  },
  {
    id: 'W5',
    level: 'warn',
    title: '老芯片组配新 CPU 可能需刷 BIOS',
    categories: ['motherboard', 'cpu'],
    required: ['motherboard', 'cpu'],
    fields: ['motherboard.chipset', 'cpu.socket'],
    good: 'B650 主板 + Ryzen 7000（同期，无需刷）',
    bad: 'B450 主板 + Ryzen 5000（需先刷 BIOS 才能点亮）',
    check({ motherboard, cpu }) {
      const chipset = `${motherboard.chipset || ''}`.trim();
      const entry = BIOS_COMPAT[chipset];

      // 同插槽才谈得上刷 BIOS
      if (motherboard.socket !== cpu.socket) return null;
      if (!entry) return null;

      const gen = cpuGeneration(cpu);
      if (!gen) return null;

      // 判断该代际是否需要更新
      const needs = entry.needsUpdateFor.some((g) => gen.startsWith(g));
      if (!needs) return null;

      return {
        reason: `主板「${motherboard.name}」（${chipset} 芯片组）搭配 CPU「${cpu.name}」（${gen}），${entry.note}。`,
        advice: motherboard.biosFlashback
          ? '该主板支持无 CPU 刷 BIOS，可先更新到最新版本再装 CPU'
          : '需用兼容的旧 CPU 先行点亮并更新 BIOS，或请商家代为刷新到最新版本',
        refs: ref('motherboard', 'cpu'),
      };
    },
  },
  {
    id: 'W6',
    level: 'warn',
    title: '显卡 PCIe 版本高于主板支持',
    categories: ['gpu', 'motherboard'],
    required: ['gpu', 'motherboard'],
    fields: ['gpu.pcieVersion', 'motherboard.pcieVersion'],
    good: 'PCIe 4.0 显卡 + PCIe 4.0 主板',
    bad: 'PCIe 5.0 显卡 + PCIe 3.0 主板（降速运行）',
    check({ gpu, motherboard }) {
      const gv = n(gpu.pcieVersion);
      const mv = n(motherboard.pcieVersion);
      if (gv === null || mv === null || gv <= mv) return null;
      return {
        reason: `显卡「${gpu.name}」为 PCIe ${gv}.0，而主板「${motherboard.name}」最高支持 PCIe ${mv}.0，将按 PCIe ${mv}.0 降速运行。`,
        advice: '能正常工作，性能损失通常在个位数百分比；追求满速可换 PCIe 更高的主板',
        refs: ref('gpu', 'motherboard'),
      };
    },
  },
  {
    id: 'W7',
    level: 'warn',
    title: '内存未组双通道',
    categories: ['memory'],
    required: ['memory'],
    fields: ['memory.modules'],
    good: '2 条或 4 条内存（双通道）',
    bad: '只插 1 条内存（单通道，带宽减半）',
    check({ memory }) {
      if (memory.modules !== 1) return null;
      return {
        reason: `内存「${memory.name}」只有 1 条，无法组成双通道，内存带宽减半，对核显和游戏帧数影响明显。`,
        advice: '改用 2 条套装（如 8G×2 或 16G×2）组成双通道',
        refs: ref('memory'),
      };
    },
  },
  {
    id: 'W8',
    level: 'warn',
    title: '高功耗配置机箱风扇位偏少',
    categories: ['case', 'cpu', 'gpu'],
    required: ['case', 'cpu'],
    fields: ['case.fanMounts', 'power.peak'],
    good: '峰值 457W + 机箱 7 个风扇位',
    bad: '峰值 500W + 机箱 1 个风扇位（积热）',
    check({ case: kase, power }) {
      const mounts = n(kase.fanMounts);
      if (mounts === null) return null;
      if (power.peak <= THRESHOLDS.HIGH_POWER_W) return null;
      if (mounts >= THRESHOLDS.MIN_FAN_MOUNTS_FOR_HIGH_POWER) return null;
      return {
        reason: `整机峰值 ${fmtW(power.peak)} 属高功耗配置，而机箱「${kase.name}」只有 ${mounts} 个风扇位，散热风道不足易积热。`,
        advice: `建议至少装 ${THRESHOLDS.MIN_FAN_MOUNTS_FOR_HIGH_POWER} 个机箱风扇（前 2 进 + 后 1 出），或换风扇位更多的机箱`,
        refs: ref('case', 'cpu', 'gpu'),
      };
    },
  },
  {
    id: 'W9',
    level: 'warn',
    title: '水冷冷排与高马甲内存冲突',
    categories: ['cooler', 'memory'],
    required: ['cooler', 'memory'],
    fields: ['cooler.type', 'cooler.ramClearance_mm', 'memory.height_mm'],
    good: '内存 34mm + 水冷避让 60mm',
    bad: '内存 53mm + 水冷避让 40mm（顶冷排）',
    check({ cooler, memory }) {
      if (cooler.type !== 'aio') return null;
      const clearance = n(cooler.ramClearance_mm);
      const height = n(memory.height_mm);
      if (clearance === null || height === null || height <= clearance) return null;
      return {
        reason: `水冷「${cooler.name}」的内存避让高度为 ${fmtMm(clearance)}，而内存「${memory.name}」高 ${fmtMm(height)}，装顶部冷排时可能顶住内存马甲。`,
        advice: `换矮条内存（≤${fmtMm(clearance)}），或把冷排改到前面板 / 换避让更好的水冷`,
        refs: ref('cooler', 'memory'),
      };
    },
  },
  {
    id: 'W10',
    level: 'warn',
    title: '主板供电相数偏弱配高端 CPU',
    categories: ['motherboard', 'cpu'],
    required: ['motherboard', 'cpu'],
    fields: ['motherboard.vrmPhases', 'cpu.maxPower'],
    good: '12 相供电 + CPU 峰值 181W',
    bad: '4 相供电 + CPU 峰值 253W（供电发热）',
    check({ motherboard, cpu }) {
      const phases = n(motherboard.vrmPhases);
      const cpuW = n(cpu.maxPower);
      if (phases === null || cpuW === null) return null;
      if (cpuW <= THRESHOLDS.HIGH_END_CPU_W) return null;
      if (phases >= THRESHOLDS.MIN_VRM_PHASES_FOR_HIGH_END) return null;
      return {
        reason: `CPU「${cpu.name}」峰值功耗 ${fmtW(cpuW)} 属高端，而主板「${motherboard.name}」只有 ${phases} 相供电，长时间高负载供电模块温度偏高，可能触发降频。`,
        advice: `建议选 ${THRESHOLDS.MIN_VRM_PHASES_FOR_HIGH_END} 相及以上供电的主板，或给供电区加装风扇`,
        refs: ref('motherboard', 'cpu'),
      };
    },
  },
  {
    id: 'W11',
    level: 'warn',
    title: '系统盘无独立缓存或使用 QLC 颗粒',
    categories: ['storage'],
    required: ['storage'],
    fields: ['storage.dram', 'storage.nandType'],
    good: 'TLC 颗粒 + 有 DRAM 缓存（如三星 990 PRO）',
    bad: 'QLC 颗粒 + 无 DRAM 缓存（做系统盘体验下降）',
    check({ storage }) {
      const list = Array.isArray(storage) ? storage.filter(Boolean) : storage ? [storage] : [];
      if (list.length === 0) return null;
      const sys = list[0]; // 第一个视为系统盘
      const problems = [];
      if (sys.dram === false) problems.push('无独立 DRAM 缓存');
      if (sys.nandType === 'QLC') problems.push('使用 QLC 颗粒');
      if (problems.length === 0) return null;
      return {
        reason: `系统盘「${sys.name}」${problems.join('且')}，作为系统盘长期使用后写入性能衰减较明显。`,
        advice: '日常办公影响不大；若在意体验，建议换 TLC 且有 DRAM 缓存的型号做系统盘',
        refs: ref('storage'),
      };
    },
  },

  // ── 🔵 提示（4 条）────────────────────────────────────────────
  {
    id: 'I1',
    level: 'info',
    title: '电源瓦数富余过多',
    categories: ['psu'],
    // 与 E10/W1 一致要求已选 CPU：否则峰值只有风扇估算值，余量会虚高而误报
    required: ['psu', 'cpu'],
    fields: ['power.margin', 'psu.wattage'],
    good: '峰值 457W + 电源 650W（余量 30%）',
    bad: '峰值 200W + 电源 1000W（余量 80%，白花的钱）',
    check({ psu, power }) {
      if (power.psuWattage === null) return null;
      if (power.margin === null || power.margin <= THRESHOLDS.PSU_HIGH_MARGIN_PCT) return null;
      return {
        reason: `整机峰值 ${fmtW(power.peak)} / 电源 ${fmtW(psu.wattage)}，余量高达 ${power.margin}%，瓦数富余过多。`,
        advice: `可降到 ${fmtW(power.recommendedPsu)} 左右，把预算投到别处；若计划大幅升级显卡则可保留`,
        refs: ref('psu'),
      };
    },
  },
  {
    id: 'I2',
    level: 'info',
    title: '升级空间评估',
    categories: ['motherboard', 'case'],
    required: ['motherboard'],
    fields: ['motherboard.memorySlots', 'motherboard.m2Slots', 'memory.modules', 'case.maxGpuLength'],
    good: '4 槽主板只插 2 条内存 → 还能再加',
    bad: '2 槽主板已插满 2 条，且 1 个 M.2 已用满',
    check({ motherboard, memory, storage, case: kase, gpu }) {
      if (!motherboard) return null;
      const slots = n(motherboard.memorySlots);
      const used = memory ? (n(memory.modules) ?? 0) : 0;
      const freeMem = slots !== null ? slots - used : null;

      const m2 = n(motherboard.m2Slots);
      const list = Array.isArray(storage) ? storage.filter(Boolean) : storage ? [storage] : [];
      const usedM2 = list.filter((s) => s.interface === 'NVMe').length;
      const freeM2 = m2 !== null ? m2 - usedM2 : null;

      const parts = [];
      if (freeMem !== null && freeMem > 0) parts.push(`内存还能加 ${freeMem} 条`);
      else if (freeMem !== null && freeMem <= 0) parts.push('内存插槽已插满');
      if (freeM2 !== null && freeM2 > 0) parts.push(`M.2 还能加 ${freeM2} 个`);
      else if (freeM2 !== null && freeM2 <= 0) parts.push('M.2 接口已用满');

      if (kase && gpu) {
        const maxLen = n(kase.maxGpuLength);
        const gpuLen = n(gpu.length_mm);
        if (maxLen !== null && gpuLen !== null) {
          const room = maxLen - gpuLen;
          parts.push(room >= 50 ? `显卡还有 ${fmtMm(room)} 余量，可升级更长显卡` : `显卡余量仅 ${fmtMm(Math.max(room, 0))}`);
        }
      }

      if (parts.length === 0) return null;
      return {
        reason: `升级空间：${parts.join('；')}。`,
        advice: '规划后续升级时可参考以上余量',
        refs: ref('motherboard', 'case'),
      };
    },
  },
  {
    id: 'I3',
    level: 'info',
    title: '平台处于生命周期末期',
    categories: ['cpu', 'motherboard'],
    required: ['cpu'],
    fields: ['cpu.socket', 'motherboard.socket'],
    good: 'AM5 / LGA1851 等当前主流平台',
    bad: 'AM4 / LGA1200 / LGA2011-3 等已停更平台',
    check({ cpu, motherboard }) {
      const socket = cpu.socket || motherboard?.socket;
      if (!socket) return null;
      if (!LEGACY_PLATFORMS.includes(socket)) return null;
      return {
        reason: `${socket} 平台已进入生命周期末期，后续不再有新 CPU 发布。`,
        advice: '若预算充足可考虑换到当前平台（AM5 / LGA1851）以获得更长升级空间；二手装机则性价比高',
        refs: ref('cpu', 'motherboard'),
      };
    },
  },
  {
    id: 'I4',
    level: 'info',
    title: '含二手 / 矿卡 / 洋垃圾配件',
    categories: [], // 动态填充，见下方 withDynamicCategories
    required: [],
    fields: ['condition'],
    good: '全部为全新配件（condition = new）',
    bad: '含矿卡、洋垃圾主板等（无保修，成色与寿命有风险）',
    check({ config }) {
      const risky = [];
      const label = { used: '二手', mining: '矿卡', oem: '洋垃圾' };
      for (const [cat, val] of Object.entries(config || {})) {
        const items = Array.isArray(val) ? val : val ? [val] : [];
        for (const it of items) {
          if (it && it.condition && it.condition !== 'new') {
            risky.push(`${it.name}（${label[it.condition] || it.condition}）`);
          }
        }
      }
      if (risky.length === 0) return null;
      return {
        reason: `配置中含 ${risky.length} 件非全新配件：${risky.join('、')}。这类配件通常无官方保修。`,
        advice: '购买前确认成色、验货（矿卡建议压力测试）、并了解无保修的售后风险',
        refs: [], // 动态填充
        riskyCategories: null,
      };
    },
  },
];

/** 规则 ID → 规则对象 */
export const RULE_MAP = Object.fromEntries(RULES.map((r) => [r.id, r]));

/** 按级别分组 */
export const RULES_BY_LEVEL = {
  error: RULES.filter((r) => r.level === 'error'),
  warn: RULES.filter((r) => r.level === 'warn'),
  info: RULES.filter((r) => r.level === 'info'),
};

/** 规则总数（应为 32） */
export const RULE_COUNT = RULES.length;

/**
 * 规则 → 品类映射（PRD 4.4）
 * 返回 { [category]: ruleId[] }
 */
export function ruleCategoryMap() {
  const map = {};
  for (const cat of ['cpu', 'motherboard', 'gpu', 'memory', 'psu', 'cooler', 'case', 'storage']) {
    map[cat] = [];
  }
  for (const r of RULES) {
    for (const c of r.categories || []) {
      if (map[c]) map[c].push(r.id);
      else map[c] = [r.id];
    }
  }
  return map;
}

export default RULES;
