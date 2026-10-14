/**
 * 视图渲染层测试（T3.x）
 *
 * 渲染层是纯函数（数据 → HTML 字符串），因此可在 Node 中直接单测。
 * 重点验证：
 *   1. HTML 转义（CSV 导入的文本可能含尖括号/引号，必须防注入）
 *   2. 冲突行标记与「仍可点选」（PRD M3-4 只提示不拦截）
 *   3. 界面绝不出现价格（PRD 1.5 / A15）
 *   4. 差异项高亮、双口径计数等 PRD 明确规定
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  esc, renderLeftPanel, renderToolbar, renderTable, renderCards, renderDetail,
  renderCompare, renderCompatPanel, renderPowerPanel, renderTopBar, renderEmptyGuide,
  renderRulesHelp, cellValue, detailValue, TABLE_COLUMNS, QUICK_TAGS,
} from '../src/ui/render.js';
import { computePower } from '../src/core/power.js';
import { RULES } from '../src/core/rules-data.js';
import { CATEGORY_ORDER, CATEGORY_LABELS } from '../src/core/enums.js';
import {
  makeCpu, makeMb, makeGpu, makeMem, makePsu, makeCase, makeCooler, makeStorage,
  makeIndex, compatibleBuild,
} from './fixtures/hardware.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ══════════════════════════════════════════════════════════════════
// 转义
// ══════════════════════════════════════════════════════════════════

test('esc：转义全部 HTML 敏感字符', () => {
  assert.equal(esc('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(esc('a & b'), 'a &amp; b');
  assert.equal(esc('say "hi"'), 'say &quot;hi&quot;');
  assert.equal(esc("it's"), 'it&#39;s');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
  assert.equal(esc(0), '0');
});

test('渲染：型号名含 HTML 时不产生可执行标签（防注入）', () => {
  const evil = makeCpu({
    id: 'cpu-evil',
    name: '<img src=x onerror=alert(1)>',
    aliases: ['<b>x</b>'],
  });
  const byId = makeIndex([evil]);
  const html = renderTable({
    category: 'cpu',
    items: [evil],
    checkCandidate: () => ({ level: 'ok', findings: [] }),
    isSelected: () => false,
  });

  // 核心断言：不得出现任何可被浏览器解析为标签的构造
  assert.ok(!/<img[\s>]/i.test(html), '不应出现真实的 img 标签');
  assert.ok(!/<script[\s>]/i.test(html), '不应出现 script 标签');
  assert.ok(!/<b[\s>]/i.test(html), '不应出现 b 标签');
  // 原始尖括号必须已变成实体
  assert.ok(html.includes('&lt;img'), '应被转义为实体');
  assert.ok(!html.includes('<img src=x'), '不应保留未转义的原始文本');

  // 左栏与详情区同样要转义
  const left = renderLeftPanel({
    config: { cpu: 'cpu-evil' }, byId, active: 'cpu',
    summary: { selected: 1, total: 8, unselected: 7 },
  });
  assert.ok(!/<img[\s>]/i.test(left), '左栏也应转义');

  const detail = renderDetail({ category: 'cpu', record: evil });
  assert.ok(!/<img[\s>]/i.test(detail), '详情区也应转义');
  assert.ok(!/<script[\s>]/i.test(detail), '详情区不应出现 script 标签');
});

test('渲染：CSV 导入的自定义备注也被转义', () => {
  const rec = makeStorage({ id: 's1', notes: '<script>bad</script>', custom: true });
  const html = renderDetail({ category: 'storage', record: rec });
  assert.ok(!/<script[\s>]/i.test(html), 'notes 应被转义，不得形成 script 标签');
  assert.ok(html.includes('&lt;script&gt;'), '应出现转义后的实体');
});

// ══════════════════════════════════════════════════════════════════
// A15：界面绝不出现价格（PRD 1.5）
// ══════════════════════════════════════════════════════════════════

test('A15：渲染函数产出中不含价格符号或价格文案', () => {
  const b = compatibleBuild();
  const withPrice = { ...b.cpu, price: 2599 }; // 即使数据里有价格
  const items = [withPrice, b.mb, b.gpu, b.mem, b.psu, b.kase, b.cooler, b.ssd];

  const outputs = [
    renderTopBar({ schemes: ['我的配置'], currentScheme: '我的配置' }),
    renderToolbar({ category: 'cpu', query: '' }),
    renderTable({ category: 'cpu', items: [withPrice], checkCandidate: () => ({ level: 'ok', findings: [] }), isSelected: () => false }),
    renderCards({ category: 'cpu', items: [withPrice], checkCandidate: () => ({ level: 'ok', findings: [] }), isSelected: () => false }),
    renderDetail({ category: 'cpu', record: withPrice }),
    renderCompare({ category: 'cpu', records: [b.cpu, b.gpu].map((r) => ({ ...r, price: 999 })) }),
    renderCompatPanel({ findings: [], counts: { error: 0, warn: 0, info: 0 } }),
    renderPowerPanel({ power: computePower(b.resolved) }),
    renderLeftPanel({ config: b.config, byId: b.index, active: 'cpu', summary: { selected: 8, total: 8, unselected: 0 } }),
    renderRulesHelp({ rules: RULES }),
  ];

  // 注意：'预算' 一词本身是合法的 —— M4「功耗预算」是电源瓦数计算，PRD 1.5 明确保留。
  // 要检测的是"钱"的痕迹。正则需足够精确，避免误伤正常文案
  // （例如 I2 规则的错误示例里有「M.2 已用满」，朴素的 /已用/ 会误报）。
  const moneyPatterns = [
    { re: /¥/, desc: '¥ 符号' },
    { re: />\s*价格\s*</, desc: '价格列标签' },
    { re: /总价/, desc: '总价文案' },
    { re: /超支/, desc: '超支文案' },
    { re: /\d+\s*元\b/, desc: '金额数值（如 2599 元）' },
    { re: /已用\s*[¥￥]/, desc: '已用金额' },
    { re: /预算\s*[:：]?\s*[¥￥]/, desc: '预算金额输入' },
    { re: /价格未填/, desc: '价格未填提示' },
  ];

  for (const [i, html] of outputs.entries()) {
    for (const { re, desc } of moneyPatterns) {
      assert.ok(!re.test(html), `第 ${i} 个渲染输出不应含${desc}`);
    }
  }
});

test('A15：功耗预算面板保留（M4 与钱无关，不得一并移除）', () => {
  const b = compatibleBuild();
  const html = renderPowerPanel({ power: computePower(b.resolved) });
  assert.ok(html.includes('功耗预算'), 'M4 功耗预算面板必须保留');
  assert.ok(html.includes('整机峰值'), '应显示整机峰值');
  assert.ok(!html.includes('¥'), '但仍不得出现货币符号');
});

test('A15：表格列定义不含价格列', () => {
  for (const [cat, cols] of Object.entries(TABLE_COLUMNS)) {
    for (const c of cols) {
      assert.notEqual(c.key, 'price', `${cat} 表格不应有价格列`);
      assert.ok(!/价格/.test(c.label), `${cat} 列标签不应为价格`);
    }
  }
});

test('A15：渲染源码中不含价格展示代码（门禁前置检查）', () => {
  const src = readFileSync(join(ROOT, 'src', 'ui', 'render.js'), 'utf8');
  // 注释里可以提到"不含价格"，但不应出现取 price 字段的渲染
  const body = src.replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/rec\.price|record\.price|\.price\b/.test(body), '渲染逻辑不应读取 price 字段');
  assert.ok(!body.includes('¥'), '渲染逻辑不应输出 ¥ 符号');
});

// ══════════════════════════════════════════════════════════════════
// 左栏
// ══════════════════════════════════════════════════════════════════

test('左栏：8 个品类齐全，已选显示型号、未选显示"未选"', () => {
  const b = compatibleBuild();
  const html = renderLeftPanel({
    config: { cpu: b.cpu.id },
    byId: b.index,
    active: 'cpu',
    lights: { cpu: 'error', motherboard: 'unselected' },
    summary: { selected: 1, total: 8, unselected: 7 },
  });

  for (const cat of CATEGORY_ORDER) {
    assert.ok(html.includes(`data-category="${cat}"`), `应含 ${cat} 条目`);
    assert.ok(html.includes(CATEGORY_LABELS[cat]), `应显示 ${cat} 中文名`);
  }
  assert.ok(html.includes('未选'), '未选品类应显示"未选"');
  assert.ok(html.includes('已选 <b data-role="selected-count">1</b> / 8'), '应显示进度');
  assert.ok(html.includes('is-active'), '当前品类应高亮');
});

test('左栏：状态灯按品类显示，E1 使 CPU 与主板同时红', () => {
  const b = compatibleBuild();
  const html = renderLeftPanel({
    config: { cpu: b.cpu.id, motherboard: b.mb.id },
    byId: b.index,
    active: 'cpu',
    lights: { cpu: 'error', motherboard: 'error', gpu: 'ok' },
    summary: { selected: 2, total: 8, unselected: 6 },
  });
  // 两个 error 灯
  const errorLights = html.match(/data-level="error"/g) || [];
  assert.equal(errorLights.length, 2, `应有 2 个 error 状态灯，实际 ${errorLights.length}`);
  assert.ok(html.includes('🔴'), '应显示红色图标');
});

test('左栏：底部按规则条数统计（与右栏同口径）', () => {
  const html = renderLeftPanel({
    config: {}, byId: new Map(), active: 'cpu',
    summary: { selected: 0, total: 8, unselected: 8 },
    ruleCounts: { error: 1, warn: 3, info: 0 },
  });
  assert.ok(html.includes('🔴 1'), '应显示错误规则条数');
  assert.ok(html.includes('🟡 3'), '应显示警告规则条数');
});

test('左栏：多选品类（硬盘）显示第一件并标注', () => {
  const s1 = makeStorage({ id: 's1', name: '990 PRO' });
  const s2 = makeStorage({ id: 's2', name: 'SN850X' });
  const html = renderLeftPanel({
    config: { storage: ['s1', 's2'] },
    byId: makeIndex([s1, s2]),
    active: 'storage',
    summary: { selected: 1, total: 8, unselected: 7 },
  });
  assert.ok(html.includes('990 PRO'), '应显示第一件硬盘');
});

// ══════════════════════════════════════════════════════════════════
// 工具条
// ══════════════════════════════════════════════════════════════════

test('工具条：含搜索框、排序、视图切换、快捷标签、含二手开关', () => {
  const html = renderToolbar({ category: 'cpu' });
  assert.ok(html.includes('data-role="search"'), '应有搜索框');
  assert.ok(html.includes('数据'=== '' ? '' : 'data-role="sort-key"'), '应有排序选择');
  assert.ok(html.includes('data-view="table"') && html.includes('data-view="card"'), '应有视图切换');
  assert.ok(html.includes('data-quick="all"'), '应有快捷标签');
  assert.ok(html.includes('data-role="include-used"'), '应有含二手开关');
  assert.ok(!html.includes('checked'), '含二手默认关闭');
});

test('工具条：搜索框回填当前查询词并转义', () => {
  const html = renderToolbar({ category: 'cpu', query: '<b>x</b>' });
  assert.ok(html.includes('&lt;b&gt;x&lt;/b&gt;'), '查询词应转义回填');
  assert.ok(!html.includes('<b>x</b>'), '不应原样插入');
});

test('工具条：8 个品类都有快捷标签定义', () => {
  for (const cat of CATEGORY_ORDER) {
    assert.ok(Array.isArray(QUICK_TAGS[cat]), `${cat} 应有快捷标签`);
    assert.ok(QUICK_TAGS[cat].length > 0, `${cat} 快捷标签不应为空`);
    const html = renderToolbar({ category: cat });
    assert.ok(html.includes('data-quick='), `${cat} 工具条应渲染出快捷标签`);
  }
});

// ══════════════════════════════════════════════════════════════════
// 表格 / 卡片
// ══════════════════════════════════════════════════════════════════

test('表格：8 个品类都有列定义，且首列是型号', () => {
  for (const cat of CATEGORY_ORDER) {
    const cols = TABLE_COLUMNS[cat];
    assert.ok(Array.isArray(cols) && cols.length >= 4, `${cat} 列定义过少`);
    assert.equal(cols[0].main, true, `${cat} 首列应为型号`);
  }
});

test('cellValue：派生列计算正确', () => {
  const cpu = makeCpu({ cores: 8, threads: 16, baseClock: 4.2, boostClock: 5.0, igpu: true });
  assert.equal(cellValue(cpu, { key: '_cores' }), '8/16');
  assert.equal(cellValue(cpu, { key: '_clock' }), '4.2-5');
  assert.equal(cellValue(cpu, { key: '_igpu' }), '有');

  // Intel 大小核
  const intel = makeCpu({ pCores: 6, eCores: 8, cores: 14, threads: 20 });
  assert.equal(cellValue(intel, { key: '_cores' }), '6P+8E/14/20');

  // 机箱板型数组
  const kase = makeCase({ formFactors: ['ATX', 'M-ATX'] });
  assert.equal(cellValue(kase, { key: '_formFactors' }), 'ATX M-ATX');

  // 散热器尺寸
  assert.equal(cellValue(makeCooler({ height_mm: 155 }), { key: '_size' }), '155mm');
  assert.equal(cellValue(makeCooler({ type: 'aio', radiatorSize: 360, height_mm: undefined }), { key: '_size' }), '360 冷排');

  // 硬盘缓存
  assert.equal(cellValue(makeStorage({ dram: true }), { key: '_dram' }), '有');

  // 容量换算
  assert.equal(cellValue(makeStorage({ capacity: 1000 }), { key: 'capacity' }), '1TB');
  assert.equal(cellValue(makeStorage({ capacity: 500 }), { key: 'capacity' }), '500GB');
});

test('表格：选中行标 ✅（is-selected），未选中显示"选它"', () => {
  const a = makeCpu({ id: 'a', name: 'CPU-A' });
  const b = makeCpu({ id: 'b', name: 'CPU-B' });
  const html = renderTable({
    category: 'cpu',
    items: [a, b],
    checkCandidate: () => ({ level: 'ok', findings: [] }),
    isSelected: (r) => r.id === 'a',
  });
  assert.ok(html.includes('is-selected'), '选中行应有样式类');
  assert.ok(html.includes('已选'), '选中行按钮应显示已选');
  assert.ok(html.includes('选它'), '未选中行按钮应显示选它');
});

test('表格：冲突行标 ⚠ 但仍保留可点选的按钮（PRD M3-4 只提示不拦截）', () => {
  const bad = makeGpu({ id: 'g', name: '冲突显卡' });
  const html = renderTable({
    category: 'gpu',
    items: [bad],
    checkCandidate: () => ({
      level: 'error',
      findings: [{ reason: '插槽不匹配', refs: [{ category: 'motherboard' }] }],
    }),
    isSelected: () => false,
  });

  assert.ok(html.includes('is-conflict'), '应有冲突标记');
  assert.ok(html.includes('data-level="error"'), '应标记错误级别');
  assert.ok(html.includes('插槽不匹配'), '应显示冲突原因');
  // 关键：仍可点选
  assert.ok(html.includes(`data-pick="g"`), '冲突型号仍必须有可点选的按钮');
  assert.ok(!html.includes('disabled'), '不得禁用任何选项');
  assert.ok(html.includes('data-goto="motherboard"'), '应提供跳转到冲突部件的入口');
});

test('表格：空列表给出提示而非报错', () => {
  const html = renderTable({ category: 'cpu', items: [], checkCandidate: () => ({ level: 'ok', findings: [] }) });
  assert.ok(html.includes('没有匹配的型号'), '应给出空状态提示');
});

test('表格：二手件带状态标签', () => {
  const mining = makeGpu({ id: 'm', condition: 'mining' });
  const html = renderTable({
    category: 'gpu', items: [mining],
    checkCandidate: () => ({ level: 'ok', findings: [] }), isSelected: () => false,
  });
  assert.ok(html.includes('矿卡'), '应显示矿卡标签');
});

test('表格：自定义导入件带"自定义"标记（M2-5）', () => {
  const custom = makeCpu({ id: 'c', custom: true });
  const html = renderTable({
    category: 'cpu', items: [custom],
    checkCandidate: () => ({ level: 'ok', findings: [] }), isSelected: () => false,
  });
  assert.ok(html.includes('自定义'), '应显示自定义标记');
});

test('表格：勾选框反映对比状态', () => {
  const a = makeCpu({ id: 'a' });
  const html = renderTable({
    category: 'cpu', items: [a],
    checkCandidate: () => ({ level: 'ok', findings: [] }),
    isSelected: () => false,
    compareIds: ['a'],
  });
  assert.ok(/data-compare="a"\s+checked/.test(html), '已加入对比的应勾选');
});

test('卡片：含型号、关键参数、加入按钮', () => {
  const cpu = makeCpu({ id: 'c', name: 'CPU-X' });
  const html = renderCards({
    category: 'cpu', items: [cpu],
    checkCandidate: () => ({ level: 'ok', findings: [] }), isSelected: () => false,
  });
  assert.ok(html.includes('CPU-X'));
  assert.ok(html.includes('card-specs'), '应有参数区');
  assert.ok(html.includes('data-pick="c"'), '应有加入按钮');
});

// ══════════════════════════════════════════════════════════════════
// 详情 / 对比
// ══════════════════════════════════════════════════════════════════

test('详情：未选中型号时显示引导', () => {
  const html = renderDetail({ category: 'cpu', record: null });
  assert.ok(html.includes('单击'), '应提示如何操作');
});

test('详情：展示该品类关键字段与备注', () => {
  const cpu = makeCpu({ id: 'c', notes: '对内存频率敏感' });
  const html = renderDetail({ category: 'cpu', record: cpu });
  assert.ok(html.includes('插槽'), '应含插槽');
  assert.ok(html.includes('AM5'), '应含插槽值');
  assert.ok(html.includes('核心数'), '应含核心数');
  assert.ok(html.includes('峰值功耗'), '应含峰值功耗');
  assert.ok(html.includes('对内存频率敏感'), '应含备注');
  assert.ok(html.includes('加入配置'), '应有加入按钮');
});

test('详情：近似值标 ≈（PRD 3.1.3）', () => {
  const cpu = makeCpu({ id: 'c', productivityScore: 88, estimated: ['productivityScore'] });
  const html = renderDetail({ category: 'cpu', record: cpu });
  assert.ok(html.includes('≈'), '近似字段应标 ≈');
});

test('详情：兼容时显示 ✅，冲突时显示原因与建议', () => {
  const cpu = makeCpu({ id: 'c' });

  const okHtml = renderDetail({ category: 'cpu', record: cpu, candidateCheck: { level: 'ok', findings: [] } });
  assert.ok(okHtml.includes('✅'), '兼容应显示 ✅');

  const badHtml = renderDetail({
    category: 'cpu', record: cpu,
    candidateCheck: {
      level: 'error',
      findings: [{ reason: '插槽不匹配', advice: '换主板' }],
    },
  });
  assert.ok(badHtml.includes('插槽不匹配'), '应显示原因');
  assert.ok(badHtml.includes('换主板'), '应显示建议');
  assert.ok(badHtml.includes('→'), '建议应以 → 开头');
});

test('对比：差异项高亮（PRD 6.5.4）', () => {
  const a = makeCpu({ id: 'a', name: 'CPU-A', socket: 'AM5', cores: 8, threads: 16 });
  const b = makeCpu({ id: 'b', name: 'CPU-B', socket: 'LGA1700', cores: 8, threads: 16 });
  const html = renderCompare({
    category: 'cpu', records: [a, b],
    checkCandidate: () => ({ level: 'ok', findings: [] }),
  });
  assert.ok(html.includes('class="diff"') || html.includes('row-diff'), '差异行应有高亮');
  assert.ok(html.includes('AM5') && html.includes('LGA1700'), '应显示双方值');
});

test('对比：少于 2 个型号时不渲染', () => {
  assert.equal(renderCompare({ category: 'cpu', records: [makeCpu({ id: 'a' })] }), '');
});

test('对比：末行显示与当前配置的兼容结论', () => {
  const a = makeCpu({ id: 'a', name: 'A' });
  const b = makeCpu({ id: 'b', name: 'B' });
  const html = renderCompare({
    category: 'cpu', records: [a, b],
    checkCandidate: (r) => (r.id === 'a' ? { level: 'ok', findings: [] } : { level: 'error', findings: [] }),
  });
  assert.ok(html.includes('✅ 兼容'), 'A 应显示兼容');
  assert.ok(html.includes('🔴 有冲突'), 'B 应显示冲突');
});

// ══════════════════════════════════════════════════════════════════
// 右栏
// ══════════════════════════════════════════════════════════════════

test('右栏兼容：无问题时显示绿色横幅与 checked/skipped 说明', () => {
  const html = renderCompatPanel({
    findings: [], counts: { error: 0, warn: 0, info: 0 }, checked: 16, skipped: 16,
  });
  assert.ok(html.includes('✅ 当前配置未发现冲突'), '应显示绿色横幅');
  assert.ok(html.includes('已检查 16 条规则，16 条因配件未选跳过'), '应说明检查与跳过数量（PRD M3-9）');
});

test('右栏兼容：每条 finding 含级别、标题、编号、原因、建议、跳转', () => {
  const html = renderCompatPanel({
    findings: [{
      id: 'E1', level: 'error', title: 'CPU 与主板插槽不匹配',
      reason: '主板 B450M 是 AM4，而 CPU i5-14600KF 是 LGA1700。',
      advice: '换 LGA1700 主板',
      refs: [{ category: 'motherboard' }, { category: 'cpu' }],
    }],
    counts: { error: 1, warn: 0, info: 0 },
    checked: 1, skipped: 31,
  });
  assert.ok(html.includes('🔴'), '应含级别图标');
  assert.ok(html.includes('CPU 与主板插槽不匹配'), '应含标题');
  assert.ok(html.includes('E1'), '应含规则编号');
  assert.ok(html.includes('AM4'), '原因应含具体数值');
  assert.ok(html.includes('→ 换 LGA1700 主板'), '建议应以 → 开头');
  assert.ok(html.includes('data-goto="motherboard"') && html.includes('data-goto="cpu"'), '应有跳转按钮');
  assert.ok(html.includes('data-rule="E1"'), '规则编号应可点击查看说明');
});

test('右栏兼容：过滤只看错误', () => {
  const findings = [
    { id: 'E1', level: 'error', title: 'E1标题', reason: 'r', advice: 'a', refs: [] },
    { id: 'W1', level: 'warn', title: 'W1标题', reason: 'r', advice: 'a', refs: [] },
  ];
  const onlyError = renderCompatPanel({ findings, counts: { error: 1, warn: 1, info: 0 }, filter: 'error' });
  assert.ok(onlyError.includes('E1标题'), '应显示错误');
  assert.ok(!onlyError.includes('W1标题'), '不应显示警告');

  const all = renderCompatPanel({ findings, counts: { error: 1, warn: 1, info: 0 }, filter: 'all' });
  assert.ok(all.includes('E1标题') && all.includes('W1标题'), 'all 应都显示');
});

test('右栏功耗：按部件列明细、峰值、建议瓦数、余量条', () => {
  const b = compatibleBuild();
  const power = computePower(b.resolved);
  // 基准峰值 = CPU 162 + 显卡 220 + 主板 40 + 内存 2×3 + 硬盘 8 + 风扇 10 = 446W
  // 漏算任一部件都会偏低，因此这里显式断言
  assert.equal(power.peak, 446, `基准峰值应为 446W，实际 ${power.peak}W`);
  const html = renderPowerPanel({ power });
  assert.ok(html.includes('整机峰值'), '应含峰值标签');
  assert.ok(html.includes(`${power.peak}W`), '应显示峰值数值');
  assert.ok(html.includes(`≥${power.recommendedPsu}W`), '应显示建议电源');
  assert.ok(html.includes('余量'), '应显示余量');
  assert.ok(html.includes('margin-bar'), '应有余量条');
  assert.ok(html.includes('按建议选电源'), '应有跳转选电源按钮');
});

test('右栏功耗：未选配件时给出提示而非报错', () => {
  const html = renderPowerPanel({ power: computePower({}) });
  assert.ok(html.includes('整机峰值') || html.includes('选择 CPU'), '应给出可读状态');
});

test('右栏功耗：余量等级反映在 data-level（颜色）', () => {
  const b = compatibleBuild();
  // 基准峰值 446W（含硬盘 8W）
  // 低余量（warn）：520W → 余量 14.2%
  const low = computePower({ ...b.resolved, psu: makePsu({ id: 'p-low', wattage: 520 }) });
  assert.equal(low.level, 'warn', `520W 应判 warn，实际 ${low.level}（峰值 ${low.peak}W）`);
  assert.ok(renderPowerPanel({ power: low }).includes('data-level="warn"'), '低余量应标 warn');

  // 余量过大（info）：1200W → 余量 63.5%
  const high = computePower({ ...b.resolved, psu: makePsu({ id: 'p-high', wattage: 1200 }) });
  assert.equal(high.level, 'info', `1200W 应判 info，实际 ${high.level}`);
  assert.ok(renderPowerPanel({ power: high }).includes('data-level="info"'), '余量过大应标 info');

  // 健康区间（ok）：650W → 余量 32.6%
  const ok = computePower({ ...b.resolved, psu: makePsu({ id: 'p-ok', wattage: 650 }) });
  assert.equal(ok.level, 'ok', `650W 应判 ok，实际 ${ok.level}`);
});

test('右栏功耗：每个数字带计算方法说明（tooltip，M4-5）', () => {
  const b = compatibleBuild();
  const html = renderPowerPanel({ power: computePower(b.resolved) });
  assert.ok(html.includes('title='), '应有计算依据提示');
  assert.ok(html.includes('maxPower'), 'CPU 行应说明取的是 maxPower');
});

// ══════════════════════════════════════════════════════════════════
// 顶部栏 / 空状态 / 规则说明
// ══════════════════════════════════════════════════════════════════

test('顶部栏：含方案切换与全部全局操作按钮，且无预算输入', () => {
  const html = renderTopBar({ schemes: ['方案A', '方案B'], currentScheme: '方案A' });
  assert.ok(html.includes('方案A') && html.includes('方案B'), '应列出方案');
  for (const action of ['scheme-new', 'save', 'compare-open', 'export-open', 'import-open', 'rules-help']) {
    assert.ok(html.includes(`data-action="${action}"`), `应有 ${action} 按钮`);
  }
  assert.ok(!html.includes('预算'), '顶部栏不应有预算输入（PRD 1.5）');
  assert.ok(!html.includes('已用'), '顶部栏不应有已用金额');
});

test('顶部栏：有未保存改动时显示小圆点', () => {
  const dirty = renderTopBar({ schemes: ['A'], currentScheme: 'A', dirty: true });
  assert.ok(dirty.includes('class="dot"'), '有改动应显示小圆点');
  const clean = renderTopBar({ schemes: ['A'], currentScheme: 'A', dirty: false });
  assert.ok(!clean.includes('class="dot"'), '无改动不应显示圆点');
});

test('空状态：给出从 CPU 开始的引导与别名示例', () => {
  const html = renderEmptyGuide();
  assert.ok(html.includes('CPU'), '应提示先选 CPU');
  assert.ok(html.includes('主板'), '应提示选主板');
  assert.ok(html.includes('7800x3d'), '应给出别名搜索示例');
});

test('规则说明：列出 32 条并含正误示例与字段', () => {
  const html = renderRulesHelp({ rules: RULES });
  assert.ok(html.includes(`共 ${RULES.length} 条`), '应显示规则总数');
  assert.ok(html.includes('32'), '规则数应为 32');
  for (const id of ['E1', 'E10', 'W1', 'I1']) {
    assert.ok(html.includes(id), `应含规则 ${id}`);
  }
  assert.ok(html.includes('涉及字段'), '应含字段说明');
  assert.ok(html.includes('✅'), '应含正确示例');
  assert.ok(html.includes('🔴'), '应含错误示例');
});

test('规则说明：支持按编号与关键词过滤', () => {
  const byId = renderRulesHelp({ rules: RULES, query: 'E1' });
  assert.ok(byId.includes('E1'), '应命中 E1');
  // E1 命中时不应还列出所有 32 条
  const count = (byId.match(/class="rule-card"/g) || []).length;
  assert.ok(count < RULES.length, `过滤后条数(${count})应少于总数(${RULES.length})`);

  const byWord = renderRulesHelp({ rules: RULES, query: '插槽' });
  assert.ok(byWord.includes('插槽'), '应能按中文关键词命中');

  const none = renderRulesHelp({ rules: RULES, query: 'zzz不存在zzz' });
  assert.ok(none.includes('没有匹配的规则'), '无匹配应给出提示');
});

// ══════════════════════════════════════════════════════════════════
// 真实数据渲染烟测
// ══════════════════════════════════════════════════════════════════

test('真实数据：8 个品类都能渲染表格而不抛异常', () => {
  const files = { cpu: 'cpu.json', motherboard: 'motherboard.json', gpu: 'gpu.json', memory: 'memory.json', psu: 'psu.json', case: 'case.json', cooler: 'cooler.json', storage: 'storage.json' };
  for (const [cat, f] of Object.entries(files)) {
    const p = join(ROOT, 'data', f);
    if (!existsSync(p)) continue;
    const list = JSON.parse(readFileSync(p, 'utf8'));
    const html = renderTable({
      category: cat,
      items: list.slice(0, 10),
      checkCandidate: () => ({ level: 'ok', findings: [] }),
      isSelected: () => false,
    });
    assert.ok(html.includes('hw-table'), `${cat} 表格应渲染`);
    assert.ok(html.length > 500, `${cat} 表格内容过短`);
    assert.ok(!html.includes('undefined'), `${cat} 表格不应出现 undefined`);

    const cards = renderCards({
      category: cat, items: list.slice(0, 5),
      checkCandidate: () => ({ level: 'ok', findings: [] }), isSelected: () => false,
    });
    assert.ok(cards.includes('card-grid'), `${cat} 卡片应渲染`);
    assert.ok(!cards.includes('undefined'), `${cat} 卡片不应出现 undefined`);

    const detail = renderDetail({ category: cat, record: list[0] });
    assert.ok(detail.includes('详情'), `${cat} 详情应渲染`);
    assert.ok(!detail.includes('undefined'), `${cat} 详情不应出现 undefined`);
    assert.ok(!detail.includes('[object Object]'), `${cat} 详情不应出现对象字面量`);
  }
});

test('真实数据：详情区不泄漏 id/category/aliases 等内部字段', () => {
  const p = join(ROOT, 'data', 'cpu.json');
  if (!existsSync(p)) return;
  const list = JSON.parse(readFileSync(p, 'utf8'));
  const html = renderDetail({ category: 'cpu', record: list[0] });
  assert.ok(!html.includes('aliases'), '详情不应显示 aliases 字段');
  assert.ok(!/>\s*cpu\s*</.test(html), '详情不应显示 category 原值');
});
