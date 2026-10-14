/**
 * M4 功耗计算测试（PRD 3.4.2）
 *
 * 重点验证 PRD 中给出的算例：
 *   i5-14600KF(maxPower 181W) + RTX 4070S(220W) + 主板 40W + 内存 2×3W + 机箱风扇 10W = 457W
 *   建议电源 = ceil(457×1.4/50)×50 = 650W
 *   550W 电源余量 = (550−457)/550 = 16.9% ≈ 17% → W1 警告
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computePower, powerFlags } from '../src/core/power.js';
import { POWER_MODEL, THRESHOLDS } from '../src/core/enums.js';

/** PRD 贯穿全文的示例配置 */
const CPU = {
  name: 'Intel i5-14600KF',
  tdp: 125,
  maxPower: 181,
};
const MB = { name: '微星 B450M 迫击炮' };
const GPU = { name: '华硕 RTX 4070S', tdp: 220 };
const MEM = { name: '16G×2 DDR4-3600', modules: 2 };
const PSU550 = { name: '550W 金牌', wattage: 550 };

test('功耗：PRD 示例配置整机峰值 = 457W', () => {
  const p = computePower({ cpu: CPU, motherboard: MB, gpu: GPU, memory: MEM, psu: PSU550 });
  assert.equal(p.peak, 457, `峰值应为 457W，实际 ${p.peak}W`);
});

test('功耗：建议电源 = 650W（峰值×1.4 向上取 50W 档）', () => {
  const p = computePower({ cpu: CPU, motherboard: MB, gpu: GPU, memory: MEM, psu: PSU550 });
  // 457 × 1.4 = 639.8 → ceil(639.8/50)=13 → 650
  assert.equal(p.recommendedPsu, 650, `建议电源应为 650W，实际 ${p.recommendedPsu}W`);
});

test('功耗：550W 电源余量 ≈17% 且判为 warn（触发 W1）', () => {
  const p = computePower({ cpu: CPU, motherboard: MB, gpu: GPU, memory: MEM, psu: PSU550 });
  assert.equal(p.margin, 16.9, `余量应为 16.9%，实际 ${p.margin}%`);
  assert.equal(p.level, 'warn', '17% < 20% 应判 warn');
  const flags = powerFlags(p);
  assert.equal(flags.lowMargin, true, '应标记 lowMargin');
  assert.equal(flags.insufficient, false, '不应标记 power 不足');
});

test('功耗：CPU 必须取 maxPower 而非 tdp', () => {
  const p = computePower({ cpu: CPU, motherboard: MB });
  const cpuRow = p.breakdown.find((b) => b.key === 'cpu');
  assert.equal(cpuRow.watts, 181, 'CPU 应取 maxPower=181W');
  assert.match(cpuRow.basis, /maxPower/, '依据应说明取自 maxPower');
  assert.match(cpuRow.basis, /125/, '依据应对比标称 TDP 125W');
  // 机箱风扇估算 10W 恒在（PRD 3.4.2），故峰值 = 181 + 40 + 10 = 231W
  // 若误用 tdp 会得到 125 + 40 + 10 = 175W，与 231W 明显不同
  assert.equal(p.peak, 231, `峰值应为 181+40+10=231W，实际 ${p.peak}W`);
  assert.notEqual(p.peak, 175, '不得误用 tdp 计算');
});

test('功耗：CPU 缺 maxPower 时按 tdp × 1.2 兜底', () => {
  const noMax = { name: 'X', tdp: 100 };
  const p = computePower({ cpu: noMax, motherboard: MB });
  const cpuRow = p.breakdown.find((b) => b.key === 'cpu');
  assert.equal(cpuRow.watts, 120, '100 × 1.2 = 120W');
  assert.match(cpuRow.basis, /估算|兜底|缺 maxPower/);
});

test('功耗：硬盘按接口/规格分别取值（NVMe 8W / SATA SSD 5W / 3.5" HDD 9W）', () => {
  const p = computePower({
    motherboard: MB,
    storage: [
      { name: 'NVMe盘', interface: 'NVMe', formFactor: 'M.2 2280' },
      { name: 'SATA SSD', interface: 'SATA', formFactor: '2.5"' },
      { name: '机械盘', interface: 'SATA', formFactor: '3.5"' },
    ],
  });
  const row = p.breakdown.find((b) => b.key === 'storage');
  assert.equal(row.watts, 8 + 5 + 9, '应合计 22W');
  assert.match(row.basis, /NVMe盘 8W/);
  assert.match(row.basis, /SATA SSD 5W/);
  assert.match(row.basis, /机械盘 9W/);
});

test('功耗：多条内存按 3W × 条数', () => {
  const p1 = computePower({ memory: { name: 'M', modules: 1 } });
  assert.equal(p1.breakdown.find((b) => b.key === 'memory').watts, 3);
  const p2 = computePower({ memory: { name: 'M', modules: 4 } });
  assert.equal(p2.breakdown.find((b) => b.key === 'memory').watts, 12);
  assert.match(p2.breakdown.find((b) => b.key === 'memory').basis, /4 条 × 3W = 12W/);
});

test('功耗：水冷计入泵 10W，风冷不计', () => {
  const aio = computePower({ cooler: { name: 'A', type: 'aio', radiatorSize: 360 } });
  const air = computePower({ cooler: { name: 'B', type: 'air', height_mm: 155 } });
  assert.equal(aio.breakdown.find((b) => b.key === 'cooler')?.watts, 10);
  assert.equal(air.breakdown.find((b) => b.key === 'cooler'), undefined, '风冷不应出现独立功耗行');
  // 但两者都会有风扇估算
  assert.ok(aio.breakdown.find((b) => b.key === 'caseFans'));
  assert.ok(air.breakdown.find((b) => b.key === 'caseFans'));
});

test('功耗：电源瓦数 < 峰值 → error（触发 E10）', () => {
  const p = computePower({ cpu: CPU, motherboard: MB, gpu: GPU, memory: MEM, psu: { name: 'P', wattage: 400 } });
  assert.equal(p.level, 'error');
  const flags = powerFlags(p);
  assert.equal(flags.insufficient, true);
  assert.ok(p.margin < 0, '余量应为负');
});

test('功耗：余量 > 50% → info（触发 I1）', () => {
  const p = computePower({ cpu: CPU, motherboard: MB, gpu: GPU, memory: MEM, psu: { name: 'P', wattage: 1200 } });
  assert.equal(p.level, 'info');
  const flags = powerFlags(p);
  assert.equal(flags.highMargin, true);
  assert.equal(flags.lowMargin, false);
});

test('功耗：余量在 20%~50% 之间 → ok（既不 W1 也不 I1）', () => {
  const p = computePower({ cpu: CPU, motherboard: MB, gpu: GPU, memory: MEM, psu: { name: 'P', wattage: 650 } });
  // (650-457)/650 = 29.7%
  assert.equal(p.margin, 29.7);
  assert.equal(p.level, 'ok');
  const flags = powerFlags(p);
  assert.equal(flags.lowMargin, false);
  assert.equal(flags.highMargin, false);
  assert.equal(flags.insufficient, false);
});

test('功耗：边界值 — 余量正好 20% 不报警，略低于 20% 报警', () => {
  // 峰值 457，找 wattage 使余量恰为 20%：457/0.8 = 571.25 → 572 时余量 20.1%
  const ok = computePower({ cpu: CPU, motherboard: MB, gpu: GPU, memory: MEM, psu: { name: 'P', wattage: 572 } });
  assert.ok(ok.margin >= 20, `余量应 ≥20%，实际 ${ok.margin}`);
  assert.equal(powerFlags(ok).lowMargin, false, '恰好 20% 不应报警（PRD: <20% 才报）');

  const warn = computePower({ cpu: CPU, motherboard: MB, gpu: GPU, memory: MEM, psu: { name: 'P', wattage: 570 } });
  assert.ok(warn.margin < 20);
  assert.equal(powerFlags(warn).lowMargin, true);
});

test('功耗：未选电源时 margin 为 null 且不判等级', () => {
  const p = computePower({ cpu: CPU, motherboard: MB });
  assert.equal(p.psuWattage, null);
  assert.equal(p.margin, null);
  assert.equal(p.level, 'ok');
  assert.deepEqual(powerFlags(p), { lowMargin: false, highMargin: false, insufficient: false });
});

test('功耗：空配置 → incomplete 且峰值为风扇估算', () => {
  const p = computePower({});
  assert.equal(p.incomplete, true, '未选 CPU/显卡应标记 incomplete');
  assert.equal(p.peak, POWER_MODEL.CASE_FANS_W);
  assert.ok(Array.isArray(p.breakdown));
});

test('功耗：breakdown 每行都带取值依据（供 M4-5 展开）', () => {
  const p = computePower({ cpu: CPU, motherboard: MB, gpu: GPU, memory: MEM, cooler: { name: 'A', type: 'aio' }, case: { name: 'C' }, psu: PSU550 });
  assert.ok(p.breakdown.length >= 6);
  for (const row of p.breakdown) {
    assert.ok(typeof row.key === 'string' && row.key, '每行需有 key');
    assert.ok(typeof row.label === 'string' && row.label, '每行需有 label');
    assert.equal(typeof row.watts, 'number');
    assert.ok(typeof row.basis === 'string' && row.basis.length > 0, `${row.key} 需有取值依据`);
  }
});

test('功耗：建议电源始终是 50 的整数倍', () => {
  for (const watts of [0, 100, 181, 300, 457, 500, 620, 999, 1500]) {
    const p = computePower({ cpu: { name: 'C', maxPower: watts }, motherboard: MB });
    assert.equal(p.recommendedPsu % POWER_MODEL.PSU_ROUNDING_STEP, 0,
      `峰值输入 ${watts}W 时建议电源 ${p.recommendedPsu}W 应为 50 的倍数`);
  }
});

test('功耗：纯核显办公配置功耗远低于游戏配置', () => {
  const office = computePower({ cpu: { name: 'i5-12400', maxPower: 117 }, motherboard: MB, memory: MEM, psu: { name: 'P', wattage: 450 } });
  const gaming = computePower({ cpu: CPU, motherboard: MB, gpu: GPU, memory: MEM, psu: PSU550 });
  assert.ok(office.peak < gaming.peak, '办公配置峰值应更低');
  assert.ok(office.peak < 250, `办公峰值应 <250W，实际 ${office.peak}W`);
});

test('功耗：阈值常量与 PRD 一致', () => {
  assert.equal(THRESHOLDS.PSU_LOW_MARGIN_PCT, 20, 'PRD W1: <20%');
  assert.equal(THRESHOLDS.PSU_HIGH_MARGIN_PCT, 50, 'PRD I1: >50%');
  assert.equal(POWER_MODEL.PSU_HEADROOM_FACTOR, 1.4, 'PRD: 峰值 × 1.4');
  assert.equal(POWER_MODEL.MOTHERBOARD_W, 40);
  assert.equal(POWER_MODEL.MEMORY_PER_MODULE_W, 3);
  assert.equal(POWER_MODEL.AIO_PUMP_W, 10);
  assert.equal(POWER_MODEL.CASE_FANS_W, 10);
  assert.deepEqual(POWER_MODEL.STORAGE_W, { NVMe: 8, SATA_SSD: 5, HDD_35: 9 });
});
