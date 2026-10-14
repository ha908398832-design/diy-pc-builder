/**
 * A1~A15 验收对照测试（PRD 第九部分）
 *
 * 把验收标准逐条固化为可执行断言。浏览器相关项（真实双击、断网）
 * 在此以"可自动化验证的等价条件"覆盖，人工步骤记录在 docs/ACCEPTANCE.md。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { CATEGORY_LIST, CATEGORY_FIELDS } from '../schema/fields.js';
import { RULES, RULE_COUNT } from '../src/core/rules-data.js';
import { checkCompatibility } from '../src/core/rules.js';
import { queryList } from '../src/core/search.js';
import { buildImportReport, mergeRecords } from '../src/core/csv.js';
import { buildExport } from '../src/ui/export.js';
import { Store } from '../src/core/store.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist', '装机助手.html');

function load(cat) {
  const p = join(ROOT, 'data', CATEGORY_FIELDS[cat].file);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
}
const DB = Object.fromEntries(CATEGORY_LIST.map((c) => [c, load(c)]));
const hasData = Object.values(DB).every(Boolean);
const hasDist = existsSync(DIST);

function indexAll() {
  const m = new Map();
  for (const list of Object.values(DB)) for (const r of list) m.set(r.id, r);
  return m;
}

// ══════════════════════════════════════════════════════════════════

test('A1：产物为单文件、无外部引用、断网可用', { skip: !hasDist && '未构建' }, () => {
  const html = readFileSync(DIST, 'utf8');
  // 单文件：无外部脚本/样式
  assert.ok(!/<script[^>]+src=/i.test(html), '不应引用外部脚本');
  assert.ok(!/<link[^>]+stylesheet/i.test(html), '不应引用外部样式表');
  assert.ok(!/@import\s+url/i.test(html), 'CSS 不应 @import');
  // 无网络请求代码
  const code = html.slice(html.lastIndexOf('<script>'));
  assert.ok(!/\bfetch\s*\(/.test(code), '不应使用 fetch');
  assert.ok(!/XMLHttpRequest/.test(code), '不应使用 XHR');
  // 所有 http(s) 仅出现在 XML 命名空间（不产生网络请求）
  for (const u of code.match(/https?:\/\/[^\s"'`]{0,80}/g) || []) {
    assert.ok(u.includes('openxmlformats.org') || u.includes('w3.org'), `不应有外部资源: ${u}`);
  }
  // 数据已内联
  assert.ok(code.includes('__defs["src/data/bundle.js"]'), '数据应内联');
});

test('A2：8 品类齐全，每品类 ≥30，总计 300~500', { skip: !hasData && '无数据' }, () => {
  let total = 0;
  for (const cat of CATEGORY_LIST) {
    const n = DB[cat].length;
    assert.ok(n >= 30, `${cat} 应 ≥30，实际 ${n}`);
    assert.ok(n >= CATEGORY_FIELDS[cat].minCount, `${cat} 应达最低配比 ${CATEGORY_FIELDS[cat].minCount}`);
    total += n;
  }
  assert.ok(total >= 300 && total <= 500, `总数应 300~500，实际 ${total}`);
});

test('A3：关键参数无缺漏，通过数据校验', { skip: !hasData && '无数据' }, async () => {
  const { execFileSync } = await import('node:child_process');
  const out = execFileSync(process.execPath, [join(ROOT, 'tools', 'validate-data.mjs')], {
    cwd: ROOT, encoding: 'utf8',
  });
  assert.match(out, /校验通过：0 错误/, '数据校验应 0 错误');
});

test('A4：32 条规则逐条有测例且全部通过', () => {
  assert.equal(RULE_COUNT, 32, '规则数应为 32');
  assert.equal(RULES.filter((r) => r.level === 'error').length, 17, '错误级 17 条');
  assert.equal(RULES.filter((r) => r.level === 'warn').length, 11, '警告级 11 条');
  assert.equal(RULES.filter((r) => r.level === 'info').length, 4, '提示级 4 条');

  // 规则测试文件必须显式覆盖全部编号
  const src = readFileSync(join(ROOT, 'tests', 'rules.test.mjs'), 'utf8');
  const missing = RULES.filter((r) => !new RegExp(`['"\`]${r.id}\\s`).test(src)).map((r) => r.id);
  assert.deepEqual(missing, [], `以下规则缺测例: ${missing.join(', ')}`);
});

test('A5：典型场景不误报（主流配置无红色错误）', { skip: !hasData && '无数据' }, () => {
  const byId = indexAll();
  const find = (cat, pred) => DB[cat].find(pred);

  const cpu = find('cpu', (c) => c.socket === 'AM5' && c.igpu);
  const mb = find('motherboard', (m) => m.socket === 'AM5' && m.memoryType === 'DDR5');
  const mem = find('memory', (m) => m.memoryType === 'DDR5' && m.modules === 2
    && m.speed <= mb.maxMemorySpeed && m.speed <= cpu.maxMemorySpeed);
  const gpu = find('gpu', (g) => g.condition === 'new' && g.tdp <= 250);
  const psu = find('psu', (p) => p.wattage >= 850 && p.pcie8pin >= (gpu.pcie8pin || 0)
    && p.pcie12vhpwr >= (gpu.pcie12vhpwr || 0) && p.eps8pin >= mb.cpuPowerConnectors);
  const kase = find('case', (c) => c.maxGpuLength >= gpu.length_mm
    && c.maxGpuThickness >= gpu.thicknessSlots
    && c.formFactors.includes(mb.formFactor)
    && c.psuFormFactors.includes(psu.formFactor)
    && c.maxPsuLength >= psu.length_mm);
  const cooler = find('cooler', (c) => c.sockets.includes(cpu.socket)
    && c.tdpRating >= cpu.maxPower && (c.type !== 'air' || c.height_mm <= kase.maxCoolerHeight));
  const ssd = find('storage', (s) => s.dram && s.nandType !== 'QLC');

  const config = {
    cpu: cpu.id, motherboard: mb.id, gpu: gpu.id, memory: mem.id,
    psu: psu.id, case: kase.id, cooler: cooler.id, storage: [ssd.id],
  };
  const res = checkCompatibility({ config, byId });
  const errors = res.findings.filter((f) => f.level === 'error');
  assert.deepEqual(errors.map((f) => `${f.id}: ${f.reason}`), [], '主流配置不应有红色错误');
});

test('A6：AM4 主板 + Intel CPU 正确报 E1', { skip: !hasData && '无数据' }, () => {
  const byId = indexAll();
  const mb = DB.motherboard.find((m) => m.socket === 'AM4');
  const cpu = DB.cpu.find((c) => c.socket === 'LGA1700');
  const res = checkCompatibility({ config: { cpu: cpu.id, motherboard: mb.id }, byId });
  const f = res.findings.find((x) => x.id === 'E1');
  assert.ok(f, '应触发 E1');
  assert.equal(f.level, 'error');
  assert.ok(f.reason.includes(mb.name), '原因应含主板型号');
  assert.ok(f.reason.includes(cpu.name), '原因应含 CPU 型号');
  assert.ok(f.reason.includes('AM4') && f.reason.includes('LGA1700'), '原因应含双方插槽');
});

test('A7：低瓦电源 + 高端显卡正确报 E10', { skip: !hasData && '无数据' }, () => {
  const byId = indexAll();
  const gpu = DB.gpu.find((g) => g.tdp >= 300);
  const cpu = DB.cpu.find((c) => c.maxPower >= 150);
  const psu = DB.psu.find((p) => p.wattage === 450);
  const res = checkCompatibility({ config: { cpu: cpu.id, gpu: gpu.id, psu: psu.id }, byId });
  const f = res.findings.find((x) => x.id === 'E10');
  assert.ok(f, '应触发 E10');
  assert.equal(f.level, 'error');
  assert.match(f.reason, /\d+W/, '应报出具体瓦数');
  assert.ok(f.advice, '应给出建议');
});

test('A8：不兼容型号仍可被选中（只提示不拦截）', { skip: !hasData && '无数据' }, async () => {
  // 渲染层：冲突行必须仍带可点选按钮且无 disabled
  const { renderTable } = await import('../src/ui/render.js');
  const gpu = DB.gpu[0];
  const html = renderTable({
    category: 'gpu',
    items: [gpu],
    checkCandidate: () => ({ level: 'error', findings: [{ reason: '冲突', refs: [] }] }),
    isSelected: () => false,
  });
  assert.ok(html.includes('is-conflict'), '应有冲突标记');
  assert.ok(html.includes(`data-pick="${gpu.id}"`), '仍应有可点选按钮');
  assert.ok(!/\bdisabled\b/.test(html), '不得禁用选择');

  // 数据层：冲突型号也能写入配置
  const store = new Store({ global: {}, autoSave: false });
  store.select('gpu', gpu.id);
  assert.equal(store.state.config.gpu, gpu.id, '冲突型号应能被选中');
});

test('A9：状态灯相关品类都亮（E1 使 CPU 与主板同时红）', { skip: !hasData && '无数据' }, async () => {
  const { computeStatusLights } = await import('../src/core/status.js');
  const byId = indexAll();
  const mb = DB.motherboard.find((m) => m.socket === 'AM4');
  const cpu = DB.cpu.find((c) => c.socket === 'LGA1700');
  const config = { cpu: cpu.id, motherboard: mb.id };
  const res = checkCompatibility({ config, byId });
  const { lights } = computeStatusLights({ findings: res.findings, config });
  assert.equal(lights.cpu, 'error', 'CPU 应为 error');
  assert.equal(lights.motherboard, 'error', '主板也应为 error');
});

test('A10：方案保存与对比可用（不含价格）', () => {
  const store = new Store({ global: {}, autoSave: false });
  store.select('cpu', 'cpu-a');
  store.select('gpu', 'gpu-a');
  store.saveScheme('方案A');
  store.resetAll();
  store.select('cpu', 'cpu-b');
  store.saveScheme('方案B');

  assert.equal(store.schemeNames().length, 2, '应保存 2 套方案');
  store.loadScheme('方案A');
  assert.equal(store.state.config.cpu, 'cpu-a', '载入应还原配置');

  // 对比弹窗代码不得含价格
  const appSrc = readFileSync(join(ROOT, 'src', 'ui', 'app.js'), 'utf8');
  const compareFn = appSrc.slice(appSrc.indexOf('function openSchemeCompare'), appSrc.indexOf('function openExport'));
  assert.ok(!compareFn.includes('¥'), '方案对比不应含价格');
  assert.ok(!/总价|差价/.test(compareFn), '方案对比不应含总价/差价');
});

test('A11：导出清单可用且不含价格', { skip: !hasData && '无数据' }, () => {
  const byId = indexAll();
  const cpu = DB.cpu[0], mb = DB.motherboard[0];
  const resolved = { cpu, motherboard: mb, gpu: null, memory: null, psu: null, cooler: null, case: null, storage: [] };
  const res = checkCompatibility({ resolved, config: {}, byId });
  for (const format of ['xlsx', 'csv', 'text']) {
    const out = buildExport(resolved, res, { format });
    const text = `${out.rows.flat().join('|')}\n${out.notes.join('|')}\n${out.preview}`;
    assert.ok(out.rows.length >= 2, `${format} 应有内容`);
    assert.ok(!text.includes('¥'), `${format} 不应含 ¥`);
    assert.ok(!/总价|合计|价格/.test(text), `${format} 不应含价格字样`);
  }
});

test('A12：CSV 导入可用且脏数据有报告', () => {
  const COLS = ['id', 'category', 'brand', 'name', 'aliases', 'condition', 'socket', 'cores',
    'threads', 'baseClock', 'boostClock', 'tdp', 'maxPower', 'memoryTypes', 'maxMemorySpeed',
    'igpu', 'gameScore', 'productivityScore'];
  const row = (o = {}) => {
    const b = {
      id: 'cpu-x', category: 'cpu', brand: 'T', name: 'T', aliases: 'x', condition: 'new',
      socket: 'AM5', cores: 8, threads: 16, baseClock: 4.2, boostClock: 5.0, tdp: 120,
      maxPower: 162, memoryTypes: 'DDR5', maxMemorySpeed: 5200, igpu: '是',
      gameScore: 100, productivityScore: 88,
    };
    const m = { ...b, ...o };
    return COLS.map((c) => m[c]).join(',');
  };
  const csv = [
    COLS.join(','),
    row({ id: 'cpu-good' }),
    row({ id: 'cpu-bad', socket: 'am5错' }),      // 枚举越界
    row({ id: 'cpu-missing', cores: '' }),         // 缺必填
  ].join('\n');

  const report = buildImportReport(csv, 'cpu', []);
  assert.equal(report.summary.valid, 1, '应识别 1 条可用');
  assert.ok(report.summary.invalid >= 2, '应识别非法记录');
  assert.ok(report.invalid.some((i) => i.errors.some((e) => e.includes('不合法'))), '应报枚举错误');
  assert.ok(report.invalid.some((i) => i.errors.some((e) => e.includes('缺必填'))), '应报缺字段');

  // 重名处理三策略
  const existing = [{ id: 'cpu-good', category: 'cpu', name: '已存在' }];
  const rep2 = buildImportReport(csv, 'cpu', existing);
  assert.equal(rep2.summary.duplicate, 1, '应检出重名');
  const skip = mergeRecords(existing, rep2, 'skip');
  const over = mergeRecords(existing, rep2, 'overwrite');
  const both = mergeRecords(existing, rep2, 'keep-both');
  assert.equal(skip.skipped, 1, 'skip 应跳过');
  assert.equal(over.overwritten, 1, 'overwrite 应覆盖');
  assert.equal(both.renamed, 1, 'keep-both 应重命名');
});

test('A13：别名模糊匹配可用（7800x3d / 4070S / 小雕）', { skip: !hasData && '无数据' }, () => {
  const r1 = queryList({ list: DB.cpu, category: 'cpu', query: '7800x3d', includeUsed: true });
  assert.ok(r1.items.some((x) => /7800X3D/i.test(x.name)), '7800x3d 应命中');

  const r2 = queryList({ list: DB.gpu, category: 'gpu', query: '4070S', includeUsed: true });
  assert.ok(r2.items.length > 0, '4070S 应命中');
  assert.ok(r2.items.some((x) => /4070/i.test(x.name)), '应含 4070 系列');

  const r3 = queryList({ list: DB.motherboard, category: 'motherboard', query: '小雕', includeUsed: true });
  assert.ok(r3.items.length > 0, '小雕 应命中');
  assert.ok(r3.items.some((x) => (x.aliases || []).some((a) => a.includes('小雕'))), '应命中中文别名');

  // 大小写与空格不敏感
  const r4 = queryList({ list: DB.cpu, category: 'cpu', query: '7800 X3D', includeUsed: true });
  assert.ok(r4.items.length > 0, '带空格也应命中');
});

test('A14：关掉再打开配置还在（持久化）', () => {
  const mem = (() => {
    const m = new Map();
    return {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => m.set(k, String(v)),
      removeItem: (k) => m.delete(k),
    };
  })();
  const s1 = new Store({ storage: mem, autoSave: false });
  s1.select('cpu', 'cpu-persist');
  s1.select('storage', 'ssd-persist');
  s1.setCategory('gpu');
  s1.flush();

  const s2 = new Store({ storage: mem, autoSave: false });
  assert.equal(s2.state.config.cpu, 'cpu-persist', 'CPU 应恢复');
  assert.deepEqual(s2.state.config.storage, ['ssd-persist'], '硬盘应恢复');
  assert.equal(s2.state.ui.category, 'gpu', '界面状态应恢复');
});

test('A15：界面不出现任何价格', { skip: !hasDist && '未构建' }, async () => {
  const { execFileSync } = await import('node:child_process');
  const out = execFileSync(process.execPath, [join(ROOT, 'tools', 'check-no-price.mjs')], {
    cwd: ROOT, encoding: 'utf8',
  });
  assert.match(out, /门禁通过/, '无价格门禁应通过');
  // 产物渲染结果也不含价格（在 artifact.test.mjs 中另有运行时复验）
  const html = readFileSync(DIST, 'utf8');
  const uiPart = html.slice(0, html.indexOf('__defs['));
  assert.ok(!uiPart.includes('¥'), 'UI 部分不应含 ¥');
});
