/**
 * 芯片组表格渲染测试（PRD 3.1.2b）
 *
 * 重点保障两件事：
 *  1. 芯片行显示**形态标签**与**尺寸区间**
 *  2. 变体行必须携带真实尺寸与 data-pick —— 兼容计算依赖它，
 *     若归并把尺寸吃掉，E5/E6 会给错误结论
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderChipTable, cellValue } from '../src/ui/render.js';
import { groupByChipset } from '../src/core/grouping.js';

const GTX1060 = [
  { id: 'gpu-1', category: 'gpu', brand: '微星', chipset: 'GTX 1060', name: 'GTX1060 AERO ITX 6G',
    condition: 'mining', length_mm: 175, thicknessSlots: 2, pcie8pin: 1, pcie12vhpwr: 0,
    tdp: 75, vram: 6, gameScore: 38, estimated: ['length_mm'] },
  { id: 'gpu-2', category: 'gpu', brand: '华硕', chipset: 'GTX 1060', name: 'DUAL-GTX1060-O6G',
    condition: 'new', length_mm: 242, thicknessSlots: 2, pcie8pin: 1, pcie12vhpwr: 0,
    tdp: 75, vram: 6, gameScore: 38 },
  { id: 'gpu-3', category: 'gpu', brand: '七彩虹', chipset: 'GTX 1060', name: 'iGame GTX1060 烈焰战神 U-6G',
    condition: 'mining', length_mm: 290, thicknessSlots: 3, pcie8pin: 1, pcie12vhpwr: 0,
    tdp: 75, vram: 6, gameScore: 38 },
];

const SINGLE = [
  { id: 'gpu-4', category: 'gpu', brand: '华硕', chipset: 'RTX 3060 Ti', name: 'DUAL-RTX3060TI',
    condition: 'new', length_mm: 279, thicknessSlots: 2.5, pcie8pin: 1, pcie12vhpwr: 0,
    tdp: 200, vram: 8, gameScore: 78 },
];

const ALL = [...GTX1060, ...SINGLE];
const noSel = () => false;
const noCheck = () => ({ level: 'ok', findings: [] });

// ══════════════════════════════════════════════════════════════════
// 1. 芯片行
// ══════════════════════════════════════════════════════════════════

test('芯片行：显示形态标签与尺寸区间', () => {
  const groups = groupByChipset('gpu', ALL);
  const html = renderChipTable({
    category: 'gpu', groups, checkCandidate: noCheck, isSelected: noSel,
  });

  assert.ok(html.includes('GTX 1060'), '应显示芯片名');
  assert.ok(html.includes('175~290 mm'), `应显示长度区间，实际片段缺失`);
  assert.ok(html.includes('2~3 槽'), '应显示厚度区间');
  assert.ok(html.includes('3 个版本'), '应显示版本数');
});

test('芯片行：形态标签带语义样式类', () => {
  const groups = groupByChipset('gpu', ALL);
  const html = renderChipTable({
    category: 'gpu', groups, checkCandidate: noCheck, isSelected: noSel,
  });
  // GTX 1060 含 ITX 变体与矿卡
  assert.ok(html.includes('vtag-ITX'), '应有 ITX 形态标签');
  assert.ok(html.includes('vtag-矿卡'), '应有矿卡形态标签');
});

test('芯片行：估算尺寸显示 ≈ 并带说明', () => {
  const groups = groupByChipset('gpu', ALL);
  const html = renderChipTable({
    category: 'gpu', groups, checkCandidate: noCheck, isSelected: noSel,
  });
  assert.ok(html.includes('≈'), 'estimated 的 length_mm 应显示 ≈');
  assert.ok(
    html.includes('title="尺寸为估算值，请以实物规格为准"'),
    '应有"以实物为准"的说明（PRD 3.1.3）',
  );
});

test('芯片行：多版本显示展开按钮，单版本直接给选它', () => {
  const groups = groupByChipset('gpu', ALL);
  const html = renderChipTable({
    category: 'gpu', groups, checkCandidate: noCheck, isSelected: noSel,
  });
  assert.ok(html.includes('data-chip-toggle="GTX 1060"'), '多版本应有展开按钮');
  assert.ok(html.includes('data-pick="gpu-4"'), '单版本应直接提供选它按钮');
});

// ══════════════════════════════════════════════════════════════════
// 2. 变体行（关键：必须保留真实尺寸）
// ══════════════════════════════════════════════════════════════════

test('变体行：展开后每条变体都带真实长度与厚度', () => {
  const groups = groupByChipset('gpu', ALL);
  const html = renderChipTable({
    category: 'gpu', groups, checkCandidate: noCheck, isSelected: noSel,
    expandedKey: 'GTX 1060',
  });

  // 三个变体的真实尺寸都必须出现
  assert.ok(html.includes('175mm'), '短卡 175mm 应显示');
  assert.ok(html.includes('242mm'), '标准 242mm 应显示');
  assert.ok(html.includes('290mm'), '长卡 290mm 应显示');
  assert.ok(html.includes('2槽') && html.includes('3槽'), '厚度应分别显示');

  // 每条变体都可选中（兼容计算在变体层发生）
  for (const id of ['gpu-1', 'gpu-2', 'gpu-3']) {
    assert.ok(html.includes(`data-pick="${id}"`), `变体 ${id} 应可选中`);
  }
});

test('变体行：按长度升序（短卡在前）', () => {
  const groups = groupByChipset('gpu', ALL);
  const html = renderChipTable({
    category: 'gpu', groups, checkCandidate: noCheck, isSelected: noSel,
    expandedKey: 'GTX 1060',
  });
  const i175 = html.indexOf('175mm');
  const i242 = html.indexOf('242mm');
  const i290 = html.indexOf('290mm');
  assert.ok(i175 < i242 && i242 < i290,
    `变体应按长度升序排列，实际位置 ${i175}/${i242}/${i290}`);
});

test('变体行：显示品牌与供电接口', () => {
  const groups = groupByChipset('gpu', ALL);
  const html = renderChipTable({
    category: 'gpu', groups, checkCandidate: noCheck, isSelected: noSel,
    expandedKey: 'GTX 1060',
  });
  assert.ok(html.includes('微星') && html.includes('华硕') && html.includes('七彩虹'), '应显示各品牌');
  assert.ok(html.includes('1×8pin'), '应显示供电接口');
});

test('变体行：矿卡带成色标签', () => {
  const groups = groupByChipset('gpu', ALL);
  const html = renderChipTable({
    category: 'gpu', groups, checkCandidate: noCheck, isSelected: noSel,
    expandedKey: 'GTX 1060',
  });
  assert.ok(html.includes('badge-cond'), '矿卡应带成色标签');
});

test('变体行：冲突的变体单独标红（不受同芯片其它变体影响）', () => {
  const groups = groupByChipset('gpu', ALL);
  // 只有 gpu-3（290mm）冲突
  const check = (r) => (r.id === 'gpu-3'
    ? { level: 'error', findings: [{ reason: '显卡过长' }] }
    : { level: 'ok', findings: [] });
  const html = renderChipTable({
    category: 'gpu', groups, checkCandidate: check, isSelected: noSel,
    expandedKey: 'GTX 1060',
  });

  // 冲突变体行带 is-conflict 与错误标记
  assert.ok(html.includes('is-conflict'), '冲突变体应有标记');
  assert.ok(html.includes('显卡过长'), '应显示冲突原因');
  // 未选中的变体按钮仍可用（只提示不拦截）
  assert.ok(html.includes('data-pick="gpu-1"'), '非冲突变体仍可选');
});

test('变体行：已选中的变体高亮', () => {
  const groups = groupByChipset('gpu', ALL);
  const html = renderChipTable({
    category: 'gpu', groups,
    checkCandidate: noCheck,
    isSelected: (r) => r.id === 'gpu-2',
    expandedKey: 'GTX 1060',
  });
  assert.ok(html.includes('已选'), '应显示已选状态');
  assert.ok(html.includes('data-has-selected="1"'), '芯片行应标记已含选中变体');
});

// ══════════════════════════════════════════════════════════════════
// 3. 边界
// ══════════════════════════════════════════════════════════════════

test('边界：无数据时给出空态提示', () => {
  const html = renderChipTable({
    category: 'gpu', groups: [], checkCandidate: noCheck, isSelected: noSel,
  });
  assert.ok(html.includes('没有匹配的型号'), '应有空态提示');
  assert.ok(html.includes('chip-table'), '仍应输出表格骨架（保持列头稳定）');
});

test('边界：XSS 转义（芯片名/品牌名可能含特殊字符）', () => {
  const evil = [
    { id: 'x', category: 'gpu', brand: '<img src=x>', chipset: '<script>alert(1)</script>',
      name: 'x', condition: 'new', length_mm: 200, thicknessSlots: 2, vram: 8, tdp: 100 },
  ];
  const html = renderChipTable({
    category: 'gpu', groups: groupByChipset('gpu', evil),
    checkCandidate: noCheck, isSelected: noSel,
  });
  assert.ok(!html.includes('<script>'), '芯片名必须转义');
  assert.ok(!html.includes('<img src=x>'), '品牌名必须转义');
});

// ══════════════════════════════════════════════════════════════════
// 4. 供电接口展示
// ══════════════════════════════════════════════════════════════════

test('供电接口：摘要格式正确', () => {
  assert.equal(
    cellValue({ pcie8pin: 2, pcie12vhpwr: 0 }, { key: 'powerConnectors' }),
    '2×8pin',
  );
  assert.equal(
    cellValue({ pcie8pin: 0, pcie12vhpwr: 1 }, { key: 'powerConnectors' }),
    '1×12VHPWR',
  );
  assert.equal(
    cellValue({ pcie8pin: 1, pcie12vhpwr: 1 }, { key: 'powerConnectors' }),
    '1×8pin + 1×12VHPWR',
  );
  assert.equal(
    cellValue({ pcie8pin: 0, pcie12vhpwr: 0 }, { key: 'powerConnectors' }),
    '免外接',
  );
});

// ══════════════════════════════════════════════════════════════════
// 5. A15 回归
// ══════════════════════════════════════════════════════════════════

test('回归：芯片组表格不含价格内容（A15）', () => {
  const html = renderChipTable({
    category: 'gpu', groups: groupByChipset('gpu', ALL),
    checkCandidate: noCheck, isSelected: noSel, expandedKey: 'GTX 1060',
  });
  assert.ok(!html.includes('¥'), '不应含 ¥');
  assert.ok(!/总价|价格/.test(html), '不应含价格文案');
});