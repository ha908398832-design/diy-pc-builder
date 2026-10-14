/**
 * 芯片级归并测试（PRD 3.1.2b）
 *
 * 核心保障：归并只发生在展示层，**规则引擎仍按具体型号尺寸计算**。
 * 若误把尺寸"归并掉"，E5(显卡限长)/E6(显卡厚度) 会给出错误结论。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  groupByChipset, isGrouped, groupKeyOf, inferVariants, variantsOf,
  fieldRange, formatRange, isSingleVariant, groupSummary, VARIANTS,
} from '../src/core/grouping.js';
import { checkCompatibility } from '../src/core/rules.js';

// ── 测试数据：模拟 GTX 1060 的三种形态（尺寸差异是真实存在的）──
const GTX1060 = [
  { id: 'gpu-1', category: 'gpu', chipset: 'GTX 1060', name: '微星 GTX1060 AERO ITX 6G',
    condition: 'mining', length_mm: 175, thicknessSlots: 2, pcie8pin: 1, pcie12vhpwr: 0,
    tdp: 75, vram: 6, gameScore: 38 },
  { id: 'gpu-2', category: 'gpu', chipset: 'GTX 1060', name: '华硕 DUAL-GTX1060-O6G',
    condition: 'new', length_mm: 242, thicknessSlots: 2, pcie8pin: 1, pcie12vhpwr: 0,
    tdp: 75, vram: 6, gameScore: 38 },
  { id: 'gpu-3', category: 'gpu', chipset: 'GTX 1060', name: '七彩虹 iGame GTX1060 烈焰战神 U-6G',
    condition: 'mining', length_mm: 290, thicknessSlots: 3, pcie8pin: 1, pcie12vhpwr: 0,
    tdp: 75, vram: 6, gameScore: 38 },
];

const RTX4090 = [
  { id: 'gpu-4', category: 'gpu', chipset: 'RTX 4090', name: '微星 RTX 4090 SUPRIM X 24G',
    condition: 'new', length_mm: 336, thicknessSlots: 3.8, pcie8pin: 0, pcie12vhpwr: 1,
    tdp: 450, vram: 24, gameScore: 195 },
  { id: 'gpu-5', category: 'gpu', chipset: 'RTX 4090', name: '华硕 ROG RTX 4090 24G',
    condition: 'new', length_mm: 358, thicknessSlots: 3.5, pcie8pin: 0, pcie12vhpwr: 1,
    tdp: 450, vram: 24, gameScore: 195 },
];

const ALL_GPU = [...GTX1060, ...RTX4090];

// ══════════════════════════════════════════════════════════════════
// 1. 基本归并
// ══════════════════════════════════════════════════════════════════

test('归并：仅显卡与主板启用，且以 chipset 为键', () => {
  assert.equal(isGrouped('gpu'), true);
  assert.equal(isGrouped('motherboard'), true);
  assert.equal(isGrouped('cpu'), false);
  assert.equal(isGrouped('psu'), false);
  assert.equal(groupKeyOf('gpu'), 'chipset');
  assert.equal(groupKeyOf('cpu'), null);
});

test('归并：同芯片合并为 1 组，组内保留全部变体', () => {
  const gs = groupByChipset('gpu', ALL_GPU);
  assert.equal(gs.length, 2, 'GTX 1060 与 RTX 4090 应合并为 2 组');

  const g1060 = gs.find((g) => g.chipset === 'GTX 1060');
  assert.equal(g1060.count, 3);
  assert.equal(g1060.records.length, 3, '变体不能丢');
  assert.deepEqual(
    g1060.records.map((r) => r.id).sort(),
    ['gpu-1', 'gpu-2', 'gpu-3'],
    '三个变体都要在',
  );
});

test('归并：变体按长度升序（小机箱用户优先看到短卡）', () => {
  const g = groupByChipset('gpu', ALL_GPU).find((x) => x.chipset === 'GTX 1060');
  const lens = g.records.map((r) => r.length_mm);
  assert.deepEqual(lens, [175, 242, 290], `应升序，实际 ${lens}`);
});

test('归并：芯片行显示尺寸区间而非单一值', () => {
  const g = groupByChipset('gpu', ALL_GPU).find((x) => x.chipset === 'GTX 1060');

  assert.deepEqual(g.lengthRange, { min: 175, max: 290, exact: false });
  assert.equal(formatRange(g.lengthRange, 'mm'), '175~290 mm');

  assert.deepEqual(g.thicknessRange, { min: 2, max: 3, exact: false });
  assert.equal(formatRange(g.thicknessRange, '槽'), '2~3 槽');
});

test('归并：尺寸一致时显示单值而非区间', () => {
  const single = [
    { id: 'a', category: 'gpu', chipset: 'X1', name: 'X1', condition: 'new', length_mm: 200, thicknessSlots: 2 },
  ];
  const g = groupByChipset('gpu', single)[0];
  assert.equal(formatRange(g.lengthRange, 'mm'), '200 mm');
  assert.equal(formatRange(g.thicknessRange, '槽'), '2 槽');
  assert.ok(isSingleVariant(g), '单变体应被识别');
});

test('归并：非归并品类退化为逐条返回（不丢数据）', () => {
  const cpus = [
    { id: 'c1', category: 'cpu', name: 'CPU-A' },
    { id: 'c2', category: 'cpu', name: 'CPU-B' },
  ];
  const gs = groupByChipset('cpu', cpus);
  assert.equal(gs.length, 2, 'CPU 不归并，每条一组');
  assert.equal(gs[0].records.length, 1);
});

test('归并：chipset 缺失的记录不会丢失', () => {
  const bad = [
    { id: 'x1', category: 'gpu', name: '无芯片名', length_mm: 200 },
    { id: 'x2', category: 'gpu', name: '另一条', length_mm: 210 },
  ];
  const gs = groupByChipset('gpu', bad);
  assert.equal(gs.length, 2, '无 chipset 应各自独立成组');
  assert.deepEqual(gs.map((g) => g.records[0].id).sort(), ['x1', 'x2']);
});

test('归并：空输入不报错', () => {
  assert.deepEqual(groupByChipset('gpu', []), []);
  assert.deepEqual(groupByChipset('gpu', null), []);
});

// ══════════════════════════════════════════════════════════════════
// 2. 形态标签
// ══════════════════════════════════════════════════════════════════

test('形态：按长度与厚度自动判定', () => {
  assert.deepEqual(inferVariants({ length_mm: 175, thicknessSlots: 2 }), ['ITX', '单槽薄']);
  assert.deepEqual(inferVariants({ length_mm: 200, thicknessSlots: 2 }), ['单风扇', '单槽薄']);
  assert.deepEqual(inferVariants({ length_mm: 260, thicknessSlots: 2.5 }), ['标准']);
  assert.deepEqual(inferVariants({ length_mm: 358, thicknessSlots: 3.5 }), ['长卡']);
  // 矿卡标记来自 condition，与长度无关；缺厚度时不应臆测「单槽薄」
  assert.deepEqual(inferVariants({ length_mm: 290, condition: 'mining' }), ['矿卡']);
  assert.deepEqual(inferVariants({ length_mm: 175, thicknessSlots: 2, condition: 'mining' }),
    ['ITX', '单槽薄', '矿卡']);
  // 缺长度时给兜底「标准」，不崩
  assert.deepEqual(inferVariants({ thicknessSlots: 2.5 }), ['标准']);
});

test('形态：数据里的 variant 字段优先于自动推导', () => {
  const rec = { variant: 'ITX', length_mm: 300, thicknessSlots: 3 };
  assert.deepEqual(variantsOf(rec), ['ITX'], '显式声明应覆盖推导结果');
});

test('形态：组内形态取并集，顺序稳定', () => {
  const g = groupByChipset('gpu', ALL_GPU).find((x) => x.chipset === 'GTX 1060');
  // GTX1060: ITX(175) / 单风扇(242) / 单槽薄+长卡?(290, 3槽)
  assert.ok(g.variants.includes('ITX'));
  assert.ok(g.variants.includes('矿卡'), '组内有矿卡应标注');
  // 顺序必须符合 VARIANTS 声明顺序，不是随机
  const idx = g.variants.map((v) => VARIANTS.indexOf(v));
  assert.deepEqual(idx, [...idx].sort((a, b) => a - b), '形态顺序应按 VARIANTS 声明');
});

// ══════════════════════════════════════════════════════════════════
// 3. 核心保障：规则仍按具体型号计算
// ══════════════════════════════════════════════════════════════════

test('关键：归并不影响规则 —— 短卡能装进小机箱，长卡不能', () => {
  const byId = new Map(ALL_GPU.map((g) => [g.id, g]));

  // 一个只支持 180mm 显卡的小机箱
  const smallCase = {
    id: 'case-small', category: 'case', name: '小机箱',
    maxGpuLength: 180, maxGpuThickness: 2.5,
    formFactors: ['ITX'], psuFormFactors: ['SFX'], radiatorSupport: [],
    expansionSlots: 4, maxPsuLength: 160, maxCoolerHeight: 65,
  };
  byId.set(smallCase.id, smallCase);

  // 短卡变体（175mm）应通过
  const shortRes = checkCompatibility({
    config: { gpu: 'gpu-1', case: smallCase.id },
    byId,
  });
  const shortIds = shortRes.findings.map((f) => f.id);
  assert.ok(!shortIds.includes('E5'), `175mm 短卡应能装进 180mm 机箱，实际报错: ${shortIds.join(',')}`);

  // 长卡变体（290mm）应报 E5
  const longRes = checkCompatibility({
    config: { gpu: 'gpu-3', case: smallCase.id },
    byId,
  });
  const longIds = longRes.findings.map((f) => f.id);
  assert.ok(longIds.includes('E5'), `290mm 长卡装不进 180mm 机箱，应报 E5，实际: ${longIds.join(',')}`);
});

test('关键：厚度差异同样独立判定', () => {
  const byId = new Map(ALL_GPU.map((g) => [g.id, g]));
  // 限厚 2.2 槽的紧凑机箱
  const tightCase = {
    id: 'case-tight', category: 'case', name: '紧凑机箱',
    maxGpuLength: 400, maxGpuThickness: 2.2,
    formFactors: ['M-ATX'], psuFormFactors: ['ATX'], radiatorSupport: [],
    expansionSlots: 6, maxPsuLength: 180, maxCoolerHeight: 160,
  };
  byId.set(tightCase.id, tightCase);

  // 2 槽的 gpu-2 应通过
  const ok = checkCompatibility({ config: { gpu: 'gpu-2', case: tightCase.id }, byId });
  assert.ok(!ok.findings.map((f) => f.id).includes('E6'), '2 槽卡应装得下 2.2 槽限厚');

  // 3 槽的 gpu-3 应报 E6
  const bad = checkCompatibility({ config: { gpu: 'gpu-3', case: tightCase.id }, byId });
  assert.ok(bad.findings.map((f) => f.id).includes('E6'), '3 槽卡应报 E6');
});

test('关键：归并出的代表记录仅用于展示，不参与兼容计算', () => {
  const g = groupByChipset('gpu', ALL_GPU).find((x) => x.chipset === 'GTX 1060');
  // rep 只是展示代表；真正的计算必须能取到任意变体
  assert.ok(g.records.includes(g.rep));
  for (const r of g.records) {
    assert.ok(typeof r.length_mm === 'number', '每个变体都必须有自己的真实长度');
    assert.ok(typeof r.thicknessSlots === 'number', '每个变体都必须有自己的真实厚度');
  }
});

test('关键：芯片行的功耗取组内最大供电需求（最挑电源的变体）', () => {
  const mixed = [
    { id: 'm1', category: 'gpu', chipset: 'M1', name: '省电版', condition: 'new',
      length_mm: 200, thicknessSlots: 2, pcie8pin: 0, pcie12vhpwr: 0, tdp: 100 },
    { id: 'm2', category: 'gpu', chipset: 'M1', name: '高功耗版', condition: 'new',
      length_mm: 320, thicknessSlots: 3, pcie8pin: 3, pcie12vhpwr: 0, tdp: 100 },
  ];
  const g = groupByChipset('gpu', mixed)[0];
  assert.equal(g.pcie8pin, 3, '芯片行应显示最高供电需求，否则会低估电源要求');
});

// ══════════════════════════════════════════════════════════════════
// 4. 展示辅助
// ══════════════════════════════════════════════════════════════════

test('展示：摘要包含尺寸与版本数', () => {
  const g = groupByChipset('gpu', ALL_GPU).find((x) => x.chipset === 'GTX 1060');
  const s = groupSummary(g);
  assert.ok(s.includes('175~290 mm'), `应含长度区间，实际 "${s}"`);
  assert.ok(s.includes('3 个版本'), `应含版本数，实际 "${s}"`);
});

test('展示：单变体不显示"版本数"（避免误导成"1 个版本"）', () => {
  const one = [{ id: 'o1', category: 'gpu', chipset: 'Z', name: 'Z', condition: 'new',
    length_mm: 250, thicknessSlots: 2.5 }];
  const g = groupByChipset('gpu', one)[0];
  assert.ok(!groupSummary(g).includes('个版本'), '单变体不应显示版本数');
});

test('展示：代表记录优先选全新', () => {
  const g = groupByChipset('gpu', ALL_GPU).find((x) => x.chipset === 'GTX 1060');
  assert.equal(g.rep.condition, 'new', '组内有全新时应以全新为代表');
});

test('展示：全为矿卡时代表取第一条', () => {
  const onlyMining = GTX1060.filter((g) => g.condition === 'mining');
  const g = groupByChipset('gpu', onlyMining).find((x) => x.chipset === 'GTX 1060');
  assert.equal(g.rep.condition, 'mining');
  assert.ok(g.variants.includes('矿卡'), '应标注矿卡形态');
});

test('展示：formatRange 处理缺失值', () => {
  assert.equal(formatRange(null, 'mm'), '—');
  assert.equal(formatRange(undefined, 'mm'), '—');
});

test('展示：fieldRange 忽略非数值', () => {
  const r = fieldRange([{ length_mm: 'abc' }, { length_mm: 200 }, {}], 'length_mm');
  assert.deepEqual(r, { min: 200, max: 200, exact: true }, '非数值应被忽略');
});