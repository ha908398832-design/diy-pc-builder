/**
 * 芯片视图测试（表格 + 卡片）
 *
 * 覆盖用户反馈的三个问题：
 *   问题 1：表格模式下显卡芯片行不展开
 *          → 根因：归并基于筛选后的记录，关闭「含二手」时芯片塌缩成单变体
 *   问题 2：点芯片行/变体行没有详细参数
 *          → 根因：芯片表用 .chip-row/.variant-row，而详情处理器只认 .hw-row
 *   问题 3：卡片模式没按芯片归类
 *          → 根因：归并分支只在表格模式里，卡片模式直接平铺
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderChipTable, renderChipCards } from '../src/ui/render.js';
import { groupByChipset } from '../src/core/grouping.js';
import { queryList } from '../src/core/search.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// 一个芯片：1 个全新 + 2 个二手（用于验证关闭「含二手」时的行为）
const MIXED = [
  { id: 'n1', category: 'gpu', brand: '华硕', chipset: 'GTX 1660 SUPER', name: '华硕 1660S 全新',
    condition: 'new', length_mm: 242, thicknessSlots: 2, pcie8pin: 1, pcie12vhpwr: 0,
    tdp: 125, vram: 6, gameScore: 55 },
  { id: 'u1', category: 'gpu', brand: '微星', chipset: 'GTX 1660 SUPER', name: '微星 1660S 二手',
    condition: 'used', length_mm: 204, thicknessSlots: 2, pcie8pin: 1, pcie12vhpwr: 0,
    tdp: 125, vram: 6, gameScore: 55 },
  { id: 'm1', category: 'gpu', brand: '七彩虹', chipset: 'GTX 1660 SUPER', name: '七彩虹 1660S 矿卡',
    condition: 'mining', length_mm: 280, thicknessSlots: 2.5, pcie8pin: 1, pcie12vhpwr: 0,
    tdp: 125, vram: 6, gameScore: 55 },
];

const MB = [
  { id: 'mb1', category: 'motherboard', brand: '微星', chipset: 'B650', name: 'B650M MORTAR',
    formFactor: 'M-ATX', socket: 'AM5', memoryType: 'DDR5', m2Slots: 2, sataPorts: 4,
    length_mm: 244, condition: 'new' },
  { id: 'mb2', category: 'motherboard', brand: '华硕', chipset: 'B650', name: 'PRIME B650M-A',
    formFactor: 'M-ATX', socket: 'AM5', memoryType: 'DDR5', m2Slots: 2, sataPorts: 4,
    length_mm: 244, condition: 'new' },
];

const noCheck = () => ({ level: 'ok', findings: [] });
const noSel = () => false;

// ══════════════════════════════════════════════════════════════════
// 问题 1：芯片按全部版本计数，不受「含二手」影响
// ══════════════════════════════════════════════════════════════════

test('问题1：关闭「含二手」时芯片行仍按全部版本计数（不塌缩）', () => {
  // 关闭含二手 → 只剩 1 条可见
  const visible = queryList({ list: MIXED, category: 'gpu', includeUsed: false });
  assert.equal(visible.items.length, 1, '关闭含二手后应只剩 1 条可见');

  // 但归并用的是"绕过含二手"的列表
  const forGroup = queryList({ list: MIXED, category: 'gpu', includeUsed: true });
  const groups = groupByChipset('gpu', forGroup.items);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].count, 3, '芯片行应显示 3 个版本，而不是塌缩成 1 个');
});

test('问题1：app.js 用 groupItems（绕过含二手）做归并', () => {
  const src = readFileSync(join(ROOT, 'src', 'ui', 'app.js'), 'utf8');
  assert.ok(/groupItems/.test(src), '应提供 groupItems（绕过含二手筛选的归并用列表）');
  assert.ok(
    /groupByChipset\(s\.ui\.category, v\.groupItems\)/.test(src),
    '归并应使用 v.groupItems 而非 v.items',
  );
  assert.ok(
    !/groupByChipset\(s\.ui\.category, v\.items\)/.test(src),
    '不应再用筛选后的 v.items 做归并（那会导致芯片塌缩）',
  );
});

test('问题1：芯片行在多版本时提供展开入口', () => {
  const groups = groupByChipset('gpu', MIXED);
  const html = renderChipTable({ category: 'gpu', groups, checkCandidate: noCheck, isSelected: noSel });
  assert.ok(html.includes('3 个版本'), '应显示版本数');
  assert.ok(html.includes('data-chip-toggle="GTX 1660 SUPER"'), '应提供展开按钮');
  assert.ok(html.includes('点击展开 3 个品牌的具体版本'), 'title 应说明可展开');
});

// ══════════════════════════════════════════════════════════════════
// 问题 2：点变体行能出详细参数（hw-row + data-id）
// ══════════════════════════════════════════════════════════════════

test('问题2：变体行带 hw-row 类与 data-id（详情处理器才认得）', () => {
  const groups = groupByChipset('gpu', MIXED);
  const html = renderChipTable({
    category: 'gpu', groups, checkCandidate: noCheck, isSelected: noSel,
    expandedKey: 'GTX 1660 SUPER',
  });

  // 详情处理器是 closest('.hw-row, .hw-card') → 芯片表必须给变体行加 hw-row
  assert.ok(/class="variant-row hw-row/.test(html), '变体行必须有 hw-row 类');
  for (const id of ['n1', 'u1', 'm1']) {
    assert.ok(html.includes(`data-id="${id}"`), `变体行应有 data-id="${id}"`);
  }
});

test('问题2：点变体行不应被按钮拦截（行本身可点）', () => {
  const groups = groupByChipset('gpu', MIXED);
  const html = renderChipTable({
    category: 'gpu', groups, checkCandidate: noCheck, isSelected: noSel,
    expandedKey: 'GTX 1660 SUPER',
  });
  // 行上有 data-id，且「选它」是独立按钮；点行其他区域应能出详情
  const rows = html.match(/<tr class="variant-row hw-row[^>]*>/g) || [];
  assert.equal(rows.length, 3, '应有 3 个变体行');
  for (const r of rows) {
    assert.ok(r.includes('data-id='), `变体行应带 data-id：${r.slice(0, 80)}`);
  }
});

test('问题2：芯片行本身不出详情（只负责展开）——符合用户选择', () => {
  const groups = groupByChipset('gpu', MIXED);
  const html = renderChipTable({ category: 'gpu', groups, checkCandidate: noCheck, isSelected: noSel });
  // 芯片行不应带 data-id（带了就会被详情处理器捕获）
  const chipRows = html.match(/<tr class="chip-row[^>]*>/g) || [];
  assert.equal(chipRows.length, 1);
  assert.ok(!chipRows[0].includes('data-id='), '芯片行不应带 data-id（用户要求芯片行只展开不出详情）');
});

test('问题2：主板变体行同样可点开详情', () => {
  const groups = groupByChipset('motherboard', MB);
  const html = renderChipTable({
    category: 'motherboard', groups, checkCandidate: noCheck, isSelected: noSel,
    expandedKey: 'B650·M-ATX',
  });
  assert.ok(/class="variant-row hw-row/.test(html), '主板变体行也应有 hw-row');
  assert.ok(html.includes('data-id="mb1"') && html.includes('data-id="mb2"'));
});

// ══════════════════════════════════════════════════════════════════
// 二手版本灰显标注
// ══════════════════════════════════════════════════════════════════

test('二手灰显：含二手关闭时，二手版本带 is-dimmed 与「筛选外」标注', () => {
  const groups = groupByChipset('gpu', MIXED);
  const html = renderChipTable({
    category: 'gpu', groups, checkCandidate: noCheck, isSelected: noSel,
    expandedKey: 'GTX 1660 SUPER', includeUsed: false,
  });
  assert.ok(html.includes('is-dimmed'), '二手版本应灰显');
  assert.ok(html.includes('筛选外'), '应标注"筛选外"说明原因');

  // 全新版本不应被灰显
  const newRow = (html.match(/<tr class="variant-row[^>]*data-id="n1"[^>]*>/g) || [])[0];
  assert.ok(newRow && !newRow.includes('is-dimmed'), '全新版本不应灰显');
});

test('二手灰显：含二手开启时不灰显（用户明确要看）', () => {
  const groups = groupByChipset('gpu', MIXED);
  const html = renderChipTable({
    category: 'gpu', groups, checkCandidate: noCheck, isSelected: noSel,
    expandedKey: 'GTX 1660 SUPER', includeUsed: true,
  });
  assert.ok(!html.includes('is-dimmed'), '含二手开启时不应灰显');
  assert.ok(!html.includes('筛选外'), '不应出现"筛选外"标注');
});

// ══════════════════════════════════════════════════════════════════
// 问题 3：卡片模式也按芯片归并
// ══════════════════════════════════════════════════════════════════

test('问题3：卡片模式按芯片归并 —— 一个芯片一张卡', () => {
  const groups = groupByChipset('gpu', MIXED);
  const html = renderChipCards({ category: 'gpu', groups, checkCandidate: noCheck, isSelected: noSel });

  // 注意正则要精确匹配 chip-card 本身，不能误匹配 chip-card-head
  const cards = html.match(/<div class="chip-card(?: [^"]*)?"/g) || [];
  assert.equal(cards.length, 1, '3 个版本应归并成 1 张芯片卡（而不是 3 张）');
  assert.ok(html.includes('GTX 1660 SUPER'), '芯片卡标题应是芯片名');
  assert.ok(html.includes('3 个版本'), '应显示版本数');
});

test('问题3：卡片模式展开后是各品牌版本小卡', () => {
  const groups = groupByChipset('gpu', MIXED);
  const collapsed = renderChipCards({ category: 'gpu', groups, checkCandidate: noCheck, isSelected: noSel });
  assert.ok(!collapsed.includes('variant-grid'), '未展开时不应有版本容器');

  const expanded = renderChipCards({
    category: 'gpu', groups, checkCandidate: noCheck, isSelected: noSel,
    expandedKey: 'GTX 1660 SUPER',
  });
  assert.ok(expanded.includes('variant-grid'), '展开后应有版本容器');
  const vcards = expanded.match(/class="variant-card hw-card[^"]*"/g) || [];
  assert.equal(vcards.length, 3, '应有 3 张版本小卡');
});

test('问题3：卡片模式的版本小卡可点开详情（hw-card + data-id）', () => {
  const groups = groupByChipset('gpu', MIXED);
  const html = renderChipCards({
    category: 'gpu', groups, checkCandidate: noCheck, isSelected: noSel,
    expandedKey: 'GTX 1660 SUPER',
  });
  assert.ok(/class="variant-card hw-card/.test(html), '版本小卡应有 hw-card 类');
  for (const id of ['n1', 'u1', 'm1']) {
    assert.ok(html.includes(`data-id="${id}"`), `版本小卡应有 data-id="${id}"`);
  }
});

test('问题3：app.js 卡片模式对归并品类走 renderChipCards', () => {
  const src = readFileSync(join(ROOT, 'src', 'ui', 'app.js'), 'utf8');
  assert.ok(/renderChipCards\(\{/.test(src), '应调用 renderChipCards');
  // 归并判断必须在 view 分支之外（否则卡片模式又会被绕过）
  const idx = src.indexOf('isGrouped(s.ui.category)');
  const cardIdx = src.indexOf("s.ui.view === 'card'", idx - 200);
  assert.ok(idx > 0, '应有归并判断');
  assert.ok(
    src.includes('isGrouped(s.ui.category)\n            // 显卡/主板：按芯片归并'),
    '归并判断应在 view 分支之前，两种模式共用',
  );
});

test('问题3：卡片模式支持主板（按板型分组）', () => {
  const groups = groupByChipset('motherboard', MB);
  const html = renderChipCards({
    category: 'motherboard', groups, checkCandidate: noCheck, isSelected: noSel,
    expandedKey: 'B650·M-ATX',
  });
  assert.ok(html.includes('B650·M-ATX'), '应显示芯片组·板型');
  assert.ok(html.includes('插槽'), '主板卡片应显示插槽');
  assert.ok(html.includes('AM5'), '应显示 AM5');
});

test('问题3：卡片模式的二手版本也灰显', () => {
  const groups = groupByChipset('gpu', MIXED);
  const html = renderChipCards({
    category: 'gpu', groups, checkCandidate: noCheck, isSelected: noSel,
    expandedKey: 'GTX 1660 SUPER', includeUsed: false,
  });
  assert.ok(html.includes('is-dimmed'), '卡片模式的二手版本也应灰显');
  assert.ok(html.includes('筛选外'), '也应标注"筛选外"');
});

// ══════════════════════════════════════════════════════════════════
// 回归：既有行为不能被破坏
// ══════════════════════════════════════════════════════════════════

test('回归：未归并品类不受影响（仍用 renderCards / renderTable）', () => {
  const src = readFileSync(join(ROOT, 'src', 'ui', 'app.js'), 'utf8');
  assert.ok(/renderCards\(\{ category: s\.ui\.category, items: v\.items/.test(src),
    '未归并品类的卡片模式应仍用 renderCards + v.items');
  assert.ok(/renderTable\(\{ category: s\.ui\.category, items: v\.items/.test(src),
    '未归并品类的表格模式应仍用 renderTable + v.items');
});

test('回归：芯片表格仍支持主板专用列', () => {
  const groups = groupByChipset('motherboard', MB);
  const html = renderChipTable({ category: 'motherboard', groups, checkCandidate: noCheck, isSelected: noSel });
  assert.ok(html.includes('芯片组 · 板型'), '主板列头不变');
  assert.ok(!html.includes('>厚度<'), '主板不应有厚度列');
});

test('回归：A15 —— 新视图不含价格内容', () => {
  for (const html of [
    renderChipTable({ category: 'gpu', groups: groupByChipset('gpu', MIXED), checkCandidate: noCheck, isSelected: noSel }),
    renderChipCards({ category: 'gpu', groups: groupByChipset('gpu', MIXED), checkCandidate: noCheck, isSelected: noSel, expandedKey: 'GTX 1660 SUPER' }),
  ]) {
    assert.ok(!html.includes('¥'), '不应含 ¥');
    assert.ok(!/总价|价格/.test(html), '不应含价格文案');
  }
});

// ══════════════════════════════════════════════════════════════════
// 品牌徽章：按需显示，避免重名（各品类 name 约定不同）
// ══════════════════════════════════════════════════════════════════

test('品牌徽章：名称为「芯片+型号」（显卡约定）时显示徽章', () => {
  // 显卡：name 不含品牌
  const gpuRec = [{
    id: 'g1', category: 'gpu', brand: '耕升', chipset: 'GTX 1660 SUPER',
    name: 'GTX 1660 SUPER Pegasus', condition: 'new',
    length_mm: 168, thicknessSlots: 2, pcie8pin: 1, pcie12vhpwr: 0, tdp: 125, vram: 6,
  }];
  const html = renderChipTable({
    category: 'gpu', groups: groupByChipset('gpu', gpuRec),
    checkCandidate: noCheck, isSelected: noSel,
    expandedKey: 'GTX 1660 SUPER',   // 必须展开才会渲染变体行
  });
  assert.ok(html.includes('variant-brand'), '显卡变体应显示品牌徽章');
  assert.ok(!/耕升 耕升/.test(html), '不应出现重复品牌');
});

test('品牌徽章：名称已含品牌（主板约定）时不重复显示', () => {
  const mbRec = [{
    id: 'm1', category: 'motherboard', brand: '微星', chipset: 'B650',
    name: '微星 MAG B650M MORTAR WIFI', formFactor: 'M-ATX',
    socket: 'AM5', memoryType: 'DDR5', m2Slots: 2, sataPorts: 4, length_mm: 244,
    condition: 'new',
  }];
  const html = renderChipTable({
    category: 'motherboard', groups: groupByChipset('motherboard', mbRec),
    checkCandidate: noCheck, isSelected: noSel,
    expandedKey: 'B650·M-ATX',   // 必须展开才会渲染变体行
  });
  assert.ok(!/微星\s*<span class="variant-brand">微星/.test(html), '不应重复品牌徽章');
  assert.ok(!/微星 微星/.test(html), '不应出现"微星 微星"');
  assert.ok(html.includes('微星 MAG B650M MORTAR WIFI'), '名称应正常显示');
});

test('品牌徽章：卡片模式的变体小卡同样按需显示', () => {
  const mbRec = [{
    id: 'm1', category: 'motherboard', brand: '微星', chipset: 'B650',
    name: '微星 MAG B650M MORTAR WIFI', formFactor: 'M-ATX',
    socket: 'AM5', memoryType: 'DDR5', m2Slots: 2, sataPorts: 4, length_mm: 244,
    condition: 'new',
  }];
  const html = renderChipCards({
    category: 'motherboard', groups: groupByChipset('motherboard', mbRec),
    checkCandidate: noCheck, isSelected: noSel, expandedKey: 'B650·M-ATX',
  });
  assert.ok(!/微星 微星/.test(html), '卡片模式也不应重复品牌');
});

test('品牌徽章：真实数据下 GPU 与主板都不出现重复品牌', () => {
  const gpus = JSON.parse(readFileSync(join(ROOT, 'data', 'gpu.json'), 'utf8'));
  for (const g of gpus) {
    if (!g.brand) continue;
    // 名称以品牌开头时才会重复，此时不应渲染徽章 —— 由渲染逻辑保证
    // 这里只做数据层面的合理性检查：品牌不应在名称里出现两次
    const cnt = String(g.name).split(g.brand).length - 1;
    assert.ok(cnt <= 1, `${g.id}: 名称中品牌「${g.brand}」出现 ${cnt} 次 → "${g.name}"`);
  }
});
