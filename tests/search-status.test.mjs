/**
 * 状态灯汇总（T2.7）+ 搜索/筛选/排序（T2.8）测试
 *
 * 重点：
 *   1. 两种计数口径必须区分（PRD 6.4 明确警告）
 *   2. PRD A13 要求 '7800x3d' / '4070S' / '小雕' 都能命中
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { computeStatusLights, countFindings, selectionSummary, STATUS_CATEGORIES } from '../src/core/status.js';
import {
  normalize, matchesQuery, scoreMatch, applyFilters, applySort, queryList,
  collectOptions, applyConditionFilter, FILTER_DEFS, SORT_DEFS, conditionLabel,
} from '../src/core/search.js';
import { checkCompatibility } from '../src/core/rules.js';
import {
  compatibleBuild, makeCpu, makeMb, makeGpu, makeMem, makePsu, makeCase, makeCooler, makeStorage, makeIndex,
} from './fixtures/hardware.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
function load(cat, file) {
  const p = join(ROOT, 'data', file);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
}
const DB = {
  cpu: load('cpu', 'cpu.json'),
  motherboard: load('motherboard', 'motherboard.json'),
  gpu: load('gpu', 'gpu.json'),
  memory: load('memory', 'memory.json'),
  psu: load('psu', 'psu.json'),
  case: load('case', 'case.json'),
  cooler: load('cooler', 'cooler.json'),
  storage: load('storage', 'storage.json'),
};
const hasData = Object.values(DB).every(Boolean);

// ══════════════════════════════════════════════════════════════════
// T2.7 状态灯
// ══════════════════════════════════════════════════════════════════

test('状态灯：全部未选时 8 个品类都是 unselected', () => {
  const { lights, icons, counts } = computeStatusLights({ findings: [], config: {} });
  for (const cat of STATUS_CATEGORIES) {
    assert.equal(lights[cat], 'unselected', `${cat} 应为 unselected`);
    assert.equal(icons[cat], '⚪');
  }
  assert.equal(counts.unselected, 8);
});

test('状态灯：已选且无 error/warn 时为 🟢 或 🔵（I2 提示不影响健康度）', () => {
  const b = compatibleBuild();
  const res = checkCompatibility({ config: b.config, byId: b.index });
  const { lights, icons } = computeStatusLights({ findings: res.findings, config: b.config });
  for (const cat of STATUS_CATEGORIES) {
    // 基准配置零错误零警告，但 I2（升级空间）会产生 info 级
    assert.ok(
      lights[cat] === 'ok' || lights[cat] === 'info',
      `${cat} 应为 ok 或 info，实际 ${lights[cat]}`,
    );
    assert.ok(icons[cat], `${cat} 必须有图标，实际 ${icons[cat]}`);
  }
  // 提示级不算是问题：不应出现 error / warn
  assert.ok(!Object.values(lights).includes('error'), '不应有 error');
  assert.ok(!Object.values(lights).includes('warn'), '不应有 warn');
});

test('状态灯：E1 插槽冲突使 CPU 与主板【同时】变红（PRD 4.4 定稿行为）', () => {
  const cpu = makeCpu({ id: 'c', socket: 'LGA1700', name: 'i5-14600KF', igpu: false });
  const mb = makeMb({ id: 'm', socket: 'AM4', chipset: 'B450', memoryType: 'DDR4' });
  const items = [cpu, mb];
  const config = { cpu: 'c', motherboard: 'm' };
  const res = checkCompatibility({ config, byId: makeIndex(items) });

  assert.ok(res.findings.some((f) => f.id === 'E1'), '应触发 E1');
  const { lights } = computeStatusLights({ findings: res.findings, config });

  assert.equal(lights.cpu, 'error', 'CPU 应被点亮为 error');
  assert.equal(lights.motherboard, 'error', '主板也应被点亮为 error（相关品类都亮）');
  // 未涉及的品类保持未选
  assert.equal(lights.gpu, 'unselected');
  assert.equal(lights.psu, 'unselected');
});

test('状态灯：两种计数口径必须区分（品类计 vs 规则计）', () => {
  // 构造 E1：一条规则涉及 CPU + 主板
  const cpu = makeCpu({ id: 'c', socket: 'LGA1700', name: 'i5-14600KF', igpu: false });
  const mb = makeMb({ id: 'm', socket: 'AM4', chipset: 'B450', memoryType: 'DDR4' });
  const config = { cpu: 'c', motherboard: 'm' };
  const res = checkCompatibility({ config, byId: makeIndex([cpu, mb]) });

  const lights = computeStatusLights({ findings: res.findings, config });
  const byRule = countFindings(res.findings);

  // 品类计：CPU 与主板两个品类是 error
  const errorCats = STATUS_CATEGORIES.filter((c) => lights.lights[c] === 'error');
  assert.equal(errorCats.length, 2, `品类计应为 2 个 error，实际 ${errorCats.length}`);

  // 规则计：E1 只有 1 条
  const e1Count = res.findings.filter((f) => f.id === 'E1' && f.level === 'error').length;
  assert.equal(e1Count, 1, '规则计 E1 应为 1 条');

  // 两者数值不同，这正是 PRD 6.4 强调不可混用的地方
  assert.notEqual(errorCats.length, byRule.error, '两种口径的数值应不同');
});

test('状态灯：warning 在无 error 时显示 🟡；有 error 时取 error', () => {
  // 只有 W7（单条内存）
  const cpu = makeCpu({ id: 'c', igpu: true });
  const mb = makeMb({ id: 'm' });
  const mem = makeMem({ id: 'r', modules: 1 });
  const config = { cpu: 'c', motherboard: 'm', memory: 'r' };
  const res = checkCompatibility({ config, byId: makeIndex([cpu, mb, mem]) });
  let s = computeStatusLights({ findings: res.findings, config });
  assert.equal(s.lights.memory, 'warn', '单条内存应为 warn');
  assert.equal(s.icons.memory, '🟡');
  assert.equal(s.lights.cpu, 'ok', 'CPU 不受 W7 影响');

  // 再叠加一个 error（内存代数不符）→ 应取更严重的 error
  const mb2 = makeMb({ id: 'm2', memoryType: 'DDR4' });
  const mem2 = makeMem({ id: 'r2', memoryType: 'DDR5', modules: 1 });
  const config2 = { cpu: 'c', motherboard: 'm2', memory: 'r2' };
  const res2 = checkCompatibility({ config: config2, byId: makeIndex([cpu, mb2, mem2]) });
  s = computeStatusLights({ findings: res2.findings, config: config2 });
  assert.equal(s.lights.memory, 'error', '有 error 时应取 error 而非 warn');
});

test('状态灯：未选的品类不会被规则点亮（未选不视为问题）', () => {
  // 只选 CPU，但 CPU 本身能触发 I3（平台末期）
  const cpu = makeCpu({ id: 'c', socket: 'AM4', name: 'Ryzen 5 5600' });
  const config = { cpu: 'c' };
  const res = checkCompatibility({ config, byId: makeIndex([cpu]) });
  assert.ok(res.findings.some((f) => f.id === 'I3'), '应触发 I3');
  const s = computeStatusLights({ findings: res.findings, config });
  assert.equal(s.lights.cpu, 'info', 'CPU 应为 info');
  assert.equal(s.lights.motherboard, 'unselected', '未选的主板应保持 unselected，不被 I3 点亮');
});

test('状态灯：info 级别也反映在灯上（🔵）', () => {
  const cpu = makeCpu({ id: 'c', igpu: true });
  const mb = makeMb({ id: 'm' });
  const psu = makePsu({ id: 'p', wattage: 1200 });
  const config = { cpu: 'c', motherboard: 'm', psu: 'p' };
  const res = checkCompatibility({ config, byId: makeIndex([cpu, mb, psu]) });
  assert.ok(res.findings.some((f) => f.id === 'I1'), '应触发 I1');
  const s = computeStatusLights({ findings: res.findings, config });
  assert.equal(s.lights.psu, 'info', '电源应为 info');
  assert.equal(s.icons.psu, '🔵');
});

test('状态灯：每个品类的图标都非空（覆盖 STATUS_LIGHTS 全部取值）', async () => {
  const { STATUS_LIGHTS, STATUS_ICONS } = await import('../src/core/enums.js');
  for (const lv of STATUS_LIGHTS) {
    assert.ok(STATUS_ICONS[lv], `STATUS_ICONS 缺 ${lv}，界面会出现无图标的状态`);
  }
  // info 必须存在（提示级品类要能显示 🔵）
  assert.equal(STATUS_ICONS.info, '🔵');
});

test('countFindings：按规则条数统计三级', () => {
  const findings = [
    { id: 'E1', level: 'error', categories: ['cpu', 'motherboard'] },
    { id: 'E2', level: 'error', categories: ['memory', 'motherboard'] },
    { id: 'W1', level: 'warn', categories: ['psu'] },
    { id: 'I1', level: 'info', categories: ['psu'] },
  ];
  const c = countFindings(findings);
  assert.equal(c.error, 2);
  assert.equal(c.warn, 1);
  assert.equal(c.info, 1);
  assert.equal(c.total, 4);
});

test('selectionSummary：已选进度统计正确', () => {
  const s1 = selectionSummary({});
  assert.deepEqual(s1, { selected: 0, total: 8, unselected: 8 });

  const s2 = selectionSummary({ cpu: 'a', motherboard: 'b', storage: ['c'] });
  assert.equal(s2.selected, 3);
  assert.equal(s2.unselected, 5);

  // 空数组的 storage 视为未选
  const s3 = selectionSummary({ storage: [] });
  assert.equal(s3.selected, 0);
});

test('状态灯：真实数据下主流配置 8 个灯全绿或仅提示级', { skip: !hasData && 'data/ 未生成' }, () => {
  const find = (cat, pred) => DB[cat].find(pred);
  const cpu = find('cpu', (c) => c.socket === 'AM5' && c.igpu);
  const mb = find('motherboard', (m) => m.socket === 'AM5' && m.memoryType === 'DDR5');
  const mem = find('memory', (m) => m.memoryType === 'DDR5' && m.modules === 2 && m.speed <= mb.maxMemorySpeed && m.speed <= cpu.maxMemorySpeed);
  const gpu = find('gpu', (g) => g.condition === 'new' && g.tdp <= 250);
  const psu = find('psu', (p) => p.wattage >= 750 && p.pcie8pin >= (gpu.pcie8pin || 0) && p.pcie12vhpwr >= (gpu.pcie12vhpwr || 0));
  const kase = find('case', (c) => c.maxGpuLength >= gpu.length_mm && c.formFactors.includes(mb.formFactor) && c.psuFormFactors.includes(psu.formFactor));
  const cooler = find('cooler', (c) => c.sockets.includes(cpu.socket) && c.tdpRating >= cpu.maxPower && (c.type !== 'air' || c.height_mm <= kase.maxCoolerHeight));
  const ssd = find('storage', (s) => s.dram && s.nandType !== 'QLC');

  const index = new Map();
  for (const list of Object.values(DB)) for (const r of list) index.set(r.id, r);

  const config = {
    cpu: cpu.id, motherboard: mb.id, gpu: gpu.id, memory: mem.id,
    psu: psu.id, case: kase.id, cooler: cooler.id, storage: [ssd.id],
  };
  const res = checkCompatibility({ config, byId: index });
  const s = computeStatusLights({ findings: res.findings, config });

  for (const cat of STATUS_CATEGORIES) {
    assert.notEqual(s.lights[cat], 'error', `${cat} 不应为 error（配置本应兼容）`);
    assert.notEqual(s.lights[cat], 'unselected', `${cat} 应已选`);
  }
});

// ══════════════════════════════════════════════════════════════════
// T2.8 搜索
// ══════════════════════════════════════════════════════════════════

test('normalize：大小写、空格、连字符、括号都归一', () => {
  assert.equal(normalize('R7 7800X3D'), 'r77800x3d');
  assert.equal(normalize('7800 x3d'), '7800x3d');
  assert.equal(normalize('7800-X3D'), '7800x3d');
  assert.equal(normalize('RTX 4070 SUPER'), 'rtx4070super');
  assert.equal(normalize('Core i5-14600KF'), 'corei514600kf');
  assert.equal(normalize('微星（MSI）B650M'), '微星msib650m');
  assert.equal(normalize(null), '');
});

test('搜索：PRD 3.6.2 要求的全部情况都能命中（用真实数据，A13）', { skip: !hasData && 'data/ 未生成' }, () => {
  // '7800x3d' → 应命中 R7 7800X3D
  const r1 = queryList({ list: DB.cpu, category: 'cpu', query: '7800x3d', includeUsed: true });
  assert.ok(r1.items.length > 0, '7800x3d 应命中');
  assert.ok(r1.items.some((x) => /7800X3D/i.test(x.name)), '应含 R7 7800X3D');

  // '7800 x3d'（带空格）→ 同样命中
  const r2 = queryList({ list: DB.cpu, category: 'cpu', query: '7800 x3d', includeUsed: true });
  assert.ok(r2.items.length > 0, '带空格的 7800 x3d 也应命中');

  // '4070S' → 应命中 RTX 4070 SUPER（别名映射）
  const r3 = queryList({ list: DB.gpu, category: 'gpu', query: '4070S', includeUsed: true });
  assert.ok(r3.items.length > 0, '4070S 应命中');
  assert.ok(r3.items.some((x) => /4070/i.test(x.name)), '应含 4070 系列');

  // '小雕' → 应命中有该中文别名的型号
  const r4 = queryList({ list: DB.motherboard, category: 'motherboard', query: '小雕', includeUsed: true });
  assert.ok(r4.items.length > 0, '小雕 应命中');
  assert.ok(r4.items.some((x) => (x.aliases || []).some((a) => a.includes('小雕'))), '应含带"小雕"别名的型号');

  // 'b650m' → 应命中所有 B650M 主板
  const r5 = queryList({ list: DB.motherboard, category: 'motherboard', query: 'b650m', includeUsed: true });
  assert.ok(r5.items.length > 0, 'b650m 应命中');
  assert.ok(r5.items.every((x) => /b650m/i.test(x.name) || (x.aliases || []).some((a) => /b650m/i.test(a)) || x.chipset === 'B650'), '所有结果都应与 B650M 相关');
});

test('搜索：大小写不敏感', () => {
  const rec = { name: 'Ryzen 7 7800X3D', brand: 'AMD', aliases: ['7800x3d'] };
  assert.ok(matchesQuery(rec, 'RYZEN'));
  assert.ok(matchesQuery(rec, 'ryzen'));
  assert.ok(matchesQuery(rec, 'rYzEn 7'));
});

test('搜索：多关键词需全部命中', () => {
  const rec = { name: '微星 MAG B650M MORTAR WIFI', brand: '微星', aliases: ['B650M 迫击炮'] };
  assert.ok(matchesQuery(rec, '微星 b650m'), '两个词都命中');
  assert.ok(matchesQuery(rec, 'b650m wifi'));
  assert.ok(!matchesQuery(rec, 'b650m 华硕'), '含不存在的词应不命中');
});

test('搜索：空查询返回全部', () => {
  const list = [{ name: 'A', aliases: [] }, { name: 'B', aliases: [] }];
  assert.equal(queryList({ list, category: 'cpu', query: '' }).items.length, 2);
  assert.equal(queryList({ list, category: 'cpu', query: '   ' }).items.length, 2);
});

test('搜索：相关度排序 — 别名精确命中排最前', () => {
  const list = [
    { name: 'RTX 4070 Ti SUPER', aliases: ['4070tis'], brand: 'X' },
    { name: 'RTX 4070 SUPER', aliases: ['4070S'], brand: 'X' },
    { name: 'RTX 4070', aliases: ['4070'], brand: 'X' },
  ];
  const { items } = queryList({ list, category: 'gpu', query: '4070S' });
  assert.equal(items[0].name, 'RTX 4070 SUPER', '别名精确命中应排第一');
});

test('搜索：中文别名可命中', () => {
  const rec = { name: '技嘉 B650M AORUS ELITE AX', brand: '技嘉', aliases: ['B650M 小雕', '小雕'] };
  assert.ok(matchesQuery(rec, '小雕'));
  assert.ok(scoreMatch(rec, '小雕') > 0);
});

// ══════════════════════════════════════════════════════════════════
// T2.8 筛选
// ══════════════════════════════════════════════════════════════════

test('筛选：enum 精确匹配', () => {
  const list = [
    { name: 'A', socket: 'AM4' },
    { name: 'B', socket: 'AM5' },
    { name: 'C', socket: 'AM5' },
  ];
  const out = applyFilters(list, { socket: 'AM5' }, 'cpu');
  assert.equal(out.length, 2);
  assert.ok(out.every((x) => x.socket === 'AM5'));
});

test('筛选：boolean 只在为 true 时生效', () => {
  const list = [
    { name: 'A', igpu: true },
    { name: 'B', igpu: false },
    { name: 'C', igpu: true },
  ];
  // false 表示未启用该筛选（返回全部）
  assert.equal(applyFilters(list, { igpu: false }, 'cpu').length, 3);
  // true 表示筛出带核显的
  assert.equal(applyFilters(list, { igpu: true }, 'cpu').length, 2);
});

test('筛选：range 支持只填 min / 只填 max / 都填', () => {
  const list = [
    { name: 'A', tdp: 100 },
    { name: 'B', tdp: 200 },
    { name: 'C', tdp: 300 },
  ];
  assert.equal(applyFilters(list, { tdp: { min: 150 } }, 'gpu').length, 2);
  assert.equal(applyFilters(list, { tdp: { max: 250 } }, 'gpu').length, 2);
  assert.equal(applyFilters(list, { tdp: { min: 150, max: 250 } }, 'gpu').length, 1);
  // 空字符串视为未填
  assert.equal(applyFilters(list, { tdp: { min: '', max: '' } }, 'gpu').length, 3);
});

test('筛选：multiEnum（机箱支持板型）命中其一即可', () => {
  const list = [
    { name: 'ITX箱', formFactors: ['Mini-ITX'] },
    { name: '中塔', formFactors: ['ATX', 'M-ATX', 'Mini-ITX'] },
    { name: '大箱', formFactors: ['E-ATX', 'ATX'] },
  ];
  const out = applyFilters(list, { formFactors: 'M-ATX' }, 'case');
  assert.equal(out.length, 1);
  assert.equal(out[0].name, '中塔');
});

test('筛选：多个条件是与关系', () => {
  const list = [
    { name: 'A', socket: 'AM5', igpu: true },
    { name: 'B', socket: 'AM5', igpu: false },
    { name: 'C', socket: 'AM4', igpu: true },
  ];
  const out = applyFilters(list, { socket: 'AM5', igpu: true }, 'cpu');
  assert.equal(out.length, 1);
  assert.equal(out[0].name, 'A');
});

test('筛选：FILTER_DEFS 不含价格维度（PRD 1.5）', () => {
  for (const [cat, defs] of Object.entries(FILTER_DEFS)) {
    for (const d of defs) {
      assert.notEqual(d.field, 'price', `${cat}.${d.key} 不应按价格筛选`);
      assert.ok(!/price|价格/i.test(d.field), `${cat}.${d.key} 字段名不应涉及价格`);
    }
  }
});

test('排序：SORT_DEFS 不含价格维度（PRD 1.5 / 3.6.3）', () => {
  for (const [cat, defs] of Object.entries(SORT_DEFS)) {
    for (const d of defs) {
      assert.notEqual(d.key, 'price', `${cat} 不应按价格排序`);
    }
  }
});

test('collectOptions：汇总筛选可选值（数组字段展开）', () => {
  const list = [
    { socket: 'AM5', formFactors: ['ATX', 'M-ATX'] },
    { socket: 'AM5', formFactors: ['Mini-ITX'] },
    { socket: 'AM4', formFactors: ['ATX'] },
  ];
  const opts = collectOptions(list, 'case');
  assert.deepEqual(opts.formFactors.sort(), ['ATX', 'M-ATX', 'Mini-ITX'].sort());
});

// ══════════════════════════════════════════════════════════════════
// T2.8 排序
// ══════════════════════════════════════════════════════════════════

test('排序：数字升序/降序', () => {
  const list = [{ name: 'A', tdp: 300 }, { name: 'B', tdp: 100 }, { name: 'C', tdp: 200 }];
  assert.deepEqual(
    applySort(list, { key: 'tdp', dir: 'asc' }, 'gpu').map((x) => x.name), ['B', 'C', 'A'],
  );
  assert.deepEqual(
    applySort(list, { key: 'tdp', dir: 'desc' }, 'gpu').map((x) => x.name), ['A', 'C', 'B'],
  );
});

test('排序：缺失值排在最后（无论升降序）', () => {
  const list = [{ name: 'A', v: 2 }, { name: 'B' }, { name: 'C', v: 1 }];
  const asc = applySort(list, { key: 'v', dir: 'asc' }, 'cpu');
  assert.equal(asc[asc.length - 1].name, 'B', '升序时缺失值应最后');
  const desc = applySort(list, { key: 'v', dir: 'desc' }, 'cpu');
  assert.equal(desc[desc.length - 1].name, 'B', '降序时缺失值也应最后');
});

test('排序：名称按中文与数字自然排序', () => {
  const list = [{ name: 'RTX 4070' }, { name: 'RTX 4070 Ti' }, { name: 'RTX 4090' }];
  const out = applySort(list, { key: 'name', dir: 'asc' }, 'gpu');
  assert.equal(out[0].name, 'RTX 4070');
  assert.equal(out[2].name, 'RTX 4090');
});

test('排序：不修改原数组（纯函数）', () => {
  const list = [{ name: 'A', v: 2 }, { name: 'B', v: 1 }];
  const before = list.map((x) => x.name).join(',');
  applySort(list, { key: 'v', dir: 'asc' }, 'cpu');
  assert.equal(list.map((x) => x.name).join(','), before, '原数组顺序不应改变');
});

// ══════════════════════════════════════════════════════════════════
// T2.8 含二手开关
// ══════════════════════════════════════════════════════════════════

test('含二手开关：默认关闭时只显示全新（PRD M7-11）', () => {
  const list = [
    { name: 'A', condition: 'new' },
    { name: 'B', condition: 'mining' },
    { name: 'C', condition: 'oem' },
    { name: 'D', condition: 'used' },
  ];
  assert.equal(applyConditionFilter(list, false).length, 1);
  assert.equal(applyConditionFilter(list, true).length, 4);
});

test('含二手开关：queryList 集成生效', () => {
  const list = [
    { name: 'new-one', condition: 'new', aliases: ['x'] },
    { name: 'mining-one', condition: 'mining', aliases: ['x'] },
  ];
  assert.equal(queryList({ list, category: 'gpu', query: 'x' }).items.length, 1);
  assert.equal(queryList({ list, category: 'gpu', query: 'x', includeUsed: true }).items.length, 2);
});

test('conditionLabel：新返回 null，二手类返回中文标签', () => {
  assert.equal(conditionLabel('new'), null);
  assert.equal(conditionLabel('used'), '二手');
  assert.equal(conditionLabel('mining'), '矿卡');
  assert.equal(conditionLabel('oem'), '洋垃圾');
});

test('真实数据：默认不含二手时数量减少（矿卡/洋垃圾被过滤）', { skip: !hasData && 'data/ 未生成' }, () => {
  const allGpu = queryList({ list: DB.gpu, category: 'gpu', includeUsed: true }).items.length;
  const newOnly = queryList({ list: DB.gpu, category: 'gpu', includeUsed: false }).items.length;
  assert.ok(allGpu > newOnly, `含二手(${allGpu}) 应多于仅全新(${newOnly})`);
  assert.ok(DB.gpu.some((g) => g.condition === 'mining'), '真实数据应含矿卡');
});

test('真实数据：常见筛选组合都能正常返回', { skip: !hasData && 'data/ 未生成' }, () => {
  const r1 = queryList({ list: DB.cpu, category: 'cpu', filters: { socket: 'AM5' }, includeUsed: true });
  assert.ok(r1.items.length > 0, 'AM5 CPU 应存在');
  assert.ok(r1.items.every((x) => x.socket === 'AM5'));

  const r2 = queryList({ list: DB.psu, category: 'psu', filters: { wattage: { min: 750 } }, includeUsed: true });
  assert.ok(r2.items.length > 0, '高瓦电源应存在');
  assert.ok(r2.items.every((x) => x.wattage >= 750));

  const r3 = queryList({ list: DB.case, category: 'case', filters: { formFactors: 'Mini-ITX' }, includeUsed: true });
  assert.ok(r3.items.length > 0, '支持 ITX 的机箱应存在');
});

test('真实数据：排序结果单调（抽查性能分排序）', { skip: !hasData && 'data/ 未生成' }, () => {
  const asc = queryList({ list: DB.cpu, category: 'cpu', sort: { key: 'gameScore', dir: 'asc' }, includeUsed: true }).items;
  for (let i = 1; i < asc.length; i++) {
    assert.ok(asc[i].gameScore >= asc[i - 1].gameScore, `第 ${i} 项性能分应不小于前一项`);
  }
  const desc = queryList({ list: DB.cpu, category: 'cpu', sort: { key: 'gameScore', dir: 'desc' }, includeUsed: true }).items;
  assert.ok(desc[0].gameScore >= desc[desc.length - 1].gameScore);
});
