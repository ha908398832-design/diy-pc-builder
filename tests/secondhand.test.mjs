/**
 * 二手/洋垃圾硬件数据测试（问题 2）
 *
 * 用户诉求：补全大部分二手主流硬件。
 * 本文件验证扩充后的数据在**功能上真正可用**，而不只是条数变多：
 *   1. 数量达标（各品类达到 minCount）
 *   2. 二手覆盖到全部 8 个品类（补全前 PSU/Case/Cooler 是 0 条）
 *   3. 二手平台插槽齐全（LGA1155/1150/1151/1366/2011/2011-3 等）
 *   4. 默认隐藏、"含二手"开关能显示出来（PRD M7-11）
 *   5. 二手件正常参与 32 条规则与功耗计算
 *   6. 二手平台能组成完整可用配置（不能只有 CPU 没主板可配）
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CATEGORY_LIST, CATEGORY_FIELDS } from '../schema/fields.js';
import { SOCKETS, CONDITIONS, CONDITION_LABELS, RISKY_CONDITIONS } from '../src/core/enums.js';
import { checkCompatibility } from '../src/core/rules.js';
import { queryList, applyConditionFilter } from '../src/core/search.js';
import { renderToolbar, renderTable } from '../src/ui/render.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function load(cat) {
  const p = join(ROOT, 'data', CATEGORY_FIELDS[cat].file);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
}
const DB = Object.fromEntries(CATEGORY_LIST.map((c) => [c, load(c)]));
const hasData = Object.values(DB).every(Boolean);

function indexAll() {
  const m = new Map();
  for (const list of Object.values(DB)) for (const r of list) m.set(r.id, r);
  return m;
}

/** 某品类里的二手/矿卡/洋垃圾 */
const usedOf = (cat) => DB[cat].filter((r) => r.condition && r.condition !== 'new');

// ══════════════════════════════════════════════════════════════════
// 1. 数量与总量
// ══════════════════════════════════════════════════════════════════

test('数据量：各品类达到 minCount，总量仍在 PRD 规定的 300~500 内', { skip: !hasData && '无数据' }, () => {
  let total = 0;
  for (const cat of CATEGORY_LIST) {
    const need = CATEGORY_FIELDS[cat].minCount;
    const n = DB[cat].length;
    assert.ok(n >= need, `${cat} 应 ≥${need}，实际 ${n}`);
    total += n;
  }
  assert.ok(total >= 300, `总数应 ≥300，实际 ${total}`);
  assert.ok(total <= 500, `总数不得超过 PRD 上限 500，实际 ${total}`);
});

test('数据量：总量相比扩充前(300)有实质增长', { skip: !hasData && '无数据' }, () => {
  const total = CATEGORY_LIST.reduce((n, c) => n + DB[c].length, 0);
  assert.ok(total > 300, `应多于扩充前的 300，实际 ${total}`);
});

// ══════════════════════════════════════════════════════════════════
// 2. 二手覆盖全部品类（补全前 PSU/Case/Cooler 为 0）
// ══════════════════════════════════════════════════════════════════

test('二手覆盖：8 个品类都有二手/矿卡/洋垃圾，无遗漏品类', { skip: !hasData && '无数据' }, () => {
  const empty = [];
  for (const cat of CATEGORY_LIST) {
    const n = usedOf(cat).length;
    if (n === 0) empty.push(cat);
  }
  assert.deepEqual(
    empty, [],
    `以下品类仍没有二手数据（补全前 PSU/Case/Cooler 就是 0 条）: ${empty.map((c) => CATEGORY_FIELDS[c].label).join('、')}`,
  );
});

test('二手覆盖：CPU/主板/显卡 二手数量充足（各 ≥15）', { skip: !hasData && '无数据' }, () => {
  for (const cat of ['cpu', 'motherboard', 'gpu']) {
    const n = usedOf(cat).length;
    assert.ok(n >= 15, `${CATEGORY_FIELDS[cat].label} 二手应 ≥15，实际 ${n}`);
  }
});

test('二手覆盖：二手件 condition 取值合法', { skip: !hasData && '无数据' }, () => {
  for (const cat of CATEGORY_LIST) {
    for (const r of DB[cat]) {
      assert.ok(
        CONDITIONS.includes(r.condition),
        `${r.id} 的 condition "${r.condition}" 不合法`,
      );
    }
  }
});

test('二手覆盖：三种二手类型（used/mining/oem）都真实存在', { skip: !hasData && '无数据' }, () => {
  const all = CATEGORY_LIST.flatMap((c) => DB[c]);
  for (const cond of ['used', 'mining', 'oem']) {
    assert.ok(
      all.some((r) => r.condition === cond),
      `应存在 ${cond}（${CONDITION_LABELS[cond]}）类型的配件`,
    );
  }
});

// ══════════════════════════════════════════════════════════════════
// 3. 二手平台插槽齐全
// ══════════════════════════════════════════════════════════════════

test('二手平台：常见二手 Intel 插槽都有 CPU 与主板', { skip: !hasData && '无数据' }, () => {
  // 这些是二手市场最主流的平台
  const legacy = ['LGA1155', 'LGA1150', 'LGA1151', 'LGA2011', 'LGA2011-3'];
  const cpuSockets = new Set(DB.cpu.map((c) => c.socket));
  const mbSockets = new Set(DB.motherboard.map((m) => m.socket));

  const missingCpu = legacy.filter((s) => !cpuSockets.has(s));
  const missingMb = legacy.filter((s) => !mbSockets.has(s));

  assert.deepEqual(missingCpu, [], `以下二手插槽没有 CPU: ${missingCpu.join(', ')}`);
  assert.deepEqual(missingMb, [], `以下二手插槽没有主板: ${missingMb.join(', ')}`);
});

test('二手平台：每个插槽都有对应散热器扣具（否则 E9 全红）', { skip: !hasData && '无数据' }, () => {
  const coolerSockets = new Set(DB.cooler.flatMap((c) => c.sockets || []));
  const cpuSockets = [...new Set(DB.cpu.map((c) => c.socket))];
  const orphan = cpuSockets.filter((s) => !coolerSockets.has(s));
  assert.deepEqual(
    orphan, [],
    `以下插槽的 CPU 没有散热器可用（会导致 E9 必然报错）: ${orphan.join(', ')}`,
  );
});

test('二手平台：每个插槽都存在内存代数匹配的主板（否则 E3 全红）', { skip: !hasData && '无数据' }, () => {
  const problems = [];
  for (const cpu of DB.cpu) {
    const types = new Set(cpu.memoryTypes || []);
    const ok = DB.motherboard.some((m) => m.socket === cpu.socket && types.has(m.memoryType));
    if (!ok) problems.push(`${cpu.name}（${cpu.socket}，${[...types].join('/')}）`);
  }
  assert.deepEqual(problems, [], `以下 CPU 没有代数匹配的主板: ${problems.join(', ')}`);
});

test('二手平台：二手 DDR3 平台有内存可选（洋垃圾必需）', { skip: !hasData && '无数据' }, () => {
  const ddr3 = DB.memory.filter((m) => m.memoryType === 'DDR3');
  assert.ok(ddr3.length >= 8, `DDR3 内存应 ≥8 条（洋垃圾平台必需），实际 ${ddr3.length}`);
  // DDR3 平台的主板也要有
  const ddr3Boards = DB.motherboard.filter((m) => m.memoryType === 'DDR3');
  assert.ok(ddr3Boards.length >= 8, `DDR3 主板应 ≥8 条，实际 ${ddr3Boards.length}`);
});

// ══════════════════════════════════════════════════════════════════
// 4. 默认隐藏与开关显示（PRD M7-11）
// ══════════════════════════════════════════════════════════════════

test('可见性：默认过滤掉二手，开启后全部显示', () => {
  const list = [
    { name: '全新A', condition: 'new', aliases: ['a'] },
    { name: '二手B', condition: 'used', aliases: ['b'] },
    { name: '矿卡C', condition: 'mining', aliases: ['c'] },
    { name: '洋垃圾D', condition: 'oem', aliases: ['d'] },
  ];
  assert.equal(applyConditionFilter(list, false).length, 1, '默认只显示全新');
  assert.equal(applyConditionFilter(list, true).length, 4, '开启后显示全部');
});

test('可见性：真实数据下"含二手"开关显著增加可选项', { skip: !hasData && '无数据' }, () => {
  for (const cat of CATEGORY_LIST) {
    const list = DB[cat];
    const off = queryList({ list, category: cat, includeUsed: false }).items.length;
    const on = queryList({ list, category: cat, includeUsed: true }).items.length;
    assert.ok(on >= off, `${cat}: 开启后不应减少`);
    assert.ok(on > off, `${cat}: 应有二手数据，开启后数量应增加（off=${off} on=${on}）`);
  }
});

test('可见性：工具条显示二手数量，用户能发现被隐藏的型号', () => {
  const html = renderToolbar({ category: 'cpu', usedCount: 23 });
  assert.ok(html.includes('含二手（23）'), '应显示二手数量（否则用户以为没有二手可选）');
  assert.ok(html.includes('title="二手 / 矿卡 / 洋垃圾（默认不显示）"'), '应有说明');
});

test('可见性：二手数量为 0 时不显示括号', () => {
  const html = renderToolbar({ category: 'cpu', usedCount: 0 });
  assert.ok(html.includes('含二手'), '仍显示开关');
  assert.ok(!html.includes('含二手（'), '无二手时不应显示数量');
});

test('可见性：二手件在列表中带状态标签', () => {
  const html = renderTable({
    category: 'gpu',
    items: [{ id: 'g1', category: 'gpu', name: 'RX 580 矿卡版', condition: 'mining', aliases: [] }],
    checkCandidate: () => ({ level: 'ok', findings: [] }),
    isSelected: () => false,
  });
  assert.ok(html.includes('矿卡'), '应显示矿卡标签');
});

// ══════════════════════════════════════════════════════════════════
// 5. 二手件参与规则与功耗
// ══════════════════════════════════════════════════════════════════

test('规则参与：二手 CPU + 二手主板 能正常跑全部规则', { skip: !hasData && '无数据' }, () => {
  const byId = indexAll();
  const cpu = usedOf('cpu').find((c) => c.socket === 'AM4') || usedOf('cpu')[0];
  const mb = DB.motherboard.find((m) => m.socket === cpu.socket && (cpu.memoryTypes || []).includes(m.memoryType));
  assert.ok(mb, `应能找到配 ${cpu.socket} 的主板`);

  const res = checkCompatibility({ config: { cpu: cpu.id, motherboard: mb.id }, byId });
  assert.equal(res.checked + res.skipped, 32, 'checked+skipped 应恒为 32');
  // 同插槽同代数不应报 E1/E2/E3
  const ids = res.findings.map((f) => f.id);
  assert.ok(!ids.includes('E1'), '同插槽不应报 E1');
  assert.ok(!ids.includes('E2'), '同代数不应报 E2');
  assert.ok(!ids.includes('E3'), `不应报 E3，实际 findings: ${ids.join(',')}`);
});

test('规则参与：二手件触发 I4 风险提示', { skip: !hasData && '无数据' }, () => {
  const byId = indexAll();
  // 找一套含矿卡的配置
  const mining = DB.gpu.find((g) => g.condition === 'mining');
  assert.ok(mining, '应存在矿卡');
  const cpu = DB.cpu.find((c) => c.igpu);
  const res = checkCompatibility({ config: { cpu: cpu.id, gpu: mining.id }, byId });
  const i4 = res.findings.find((f) => f.id === 'I4');
  assert.ok(i4, '含矿卡应触发 I4');
  assert.match(i4.reason, /矿卡/, '应说明是矿卡');
});

test('规则参与：二手件参与功耗计算', { skip: !hasData && '无数据' }, () => {
  const byId = indexAll();
  const cpu = DB.cpu.find((c) => c.condition !== 'new' && c.maxPower > 100);
  const res = checkCompatibility({ config: { cpu: cpu.id }, byId });
  assert.ok(res.power.peak > 0, '二手 CPU 也应参与功耗计算');
  const cpuRow = res.power.breakdown.find((b) => b.key === 'cpu');
  assert.equal(cpuRow.watts, cpu.maxPower, '应取二手 CPU 的 maxPower');
});

test('规则参与：洋垃圾 X99 平台能组成完整配置并正确评估', { skip: !hasData && '无数据' }, () => {
  const byId = indexAll();
  const cpu = DB.cpu.find((c) => c.socket === 'LGA2011-3');
  const mb = DB.motherboard.find((m) => m.socket === 'LGA2011-3' && (cpu.memoryTypes || []).includes(m.memoryType));
  const mem = DB.memory.find((m) => m.memoryType === mb.memoryType);
  const cooler = DB.cooler.find((c) => (c.sockets || []).includes('LGA2011-3'));

  assert.ok(cpu && mb && mem && cooler, 'X99 平台应能凑齐 CPU/主板/内存/散热器');

  const config = { cpu: cpu.id, motherboard: mb.id, memory: mem.id, cooler: cooler.id };
  const res = checkCompatibility({ config, byId });
  const ids = res.findings.map((f) => f.id);

  assert.ok(!ids.includes('E1'), '同插槽不应报 E1');
  assert.ok(!ids.includes('E2'), '同代数不应报 E2');
  assert.ok(!ids.includes('E9'), '扣具匹配不应报 E9');
  assert.ok(ids.includes('I3'), 'LGA2011-3 属末期平台应触发 I3');
  assert.ok(ids.includes('I4'), '洋垃圾应触发 I4');
});

test('规则参与：每个二手插槽都能凑出无红色错误的配置', { skip: !hasData && '无数据' }, () => {
  const byId = indexAll();
  const sockets = [...new Set(DB.cpu.filter((c) => c.condition !== 'new').map((c) => c.socket))];
  const failures = [];

  for (const socket of sockets) {
    const cpu = DB.cpu.find((c) => c.socket === socket && c.condition !== 'new');
    const mb = DB.motherboard.find((m) => m.socket === socket && (cpu.memoryTypes || []).includes(m.memoryType));
    const mem = mb ? DB.memory.find((m) => m.memoryType === mb.memoryType) : null;
    const cooler = DB.cooler.find((c) => (c.sockets || []).includes(socket));

    if (!mb || !mem || !cooler) {
      failures.push(`${socket}: 缺 ${!mb ? '主板' : ''}${!mem ? ' 内存' : ''}${!cooler ? ' 散热器' : ''}`);
      continue;
    }

    // 关键：很多二手平台（Xeon E5/E3、FX、非 APU 的 AM4）不带核显，
    // 若不配独显，E16「无核显且无显卡」会正确报错。
    // 所以必须补一块显卡，否则测的是"配置不完整"而不是平台兼容性。
    // 注意：不能靠把 igpu 改成 true 来绕过 —— 那会污染关键字段。
    const config = { cpu: cpu.id, motherboard: mb.id, memory: mem.id, cooler: cooler.id };
    if (!cpu.igpu) {
      const gpu = DB.gpu.find((g) => g.condition === 'new') || DB.gpu[0];
      config.gpu = gpu.id;
    }

    const res = checkCompatibility({ config, byId });
    const errors = res.findings.filter((f) => f.level === 'error');
    if (errors.length) {
      failures.push(`${socket}: ${errors.map((e) => e.id).join(',')}`);
    }
  }

  assert.deepEqual(failures, [], `以下二手平台无法组成可用配置:\n${failures.join('\n')}`);
});

// ══════════════════════════════════════════════════════════════════
// 6. 搜索能找到二手型号
// ══════════════════════════════════════════════════════════════════

test('搜索：二手型号的别名可被搜到', { skip: !hasData && '无数据' }, () => {
  const cases = [
    { cat: 'cpu', q: 'e3 1231v3' },
    { cat: 'cpu', q: '4790k' },
    { cat: 'cpu', q: '2600k' },
    { cat: 'motherboard', q: 'b85' },
    { cat: 'gpu', q: '1060' },
    { cat: 'gpu', q: 'rx580' },
  ];
  const failed = [];
  for (const { cat, q } of cases) {
    const r = queryList({ list: DB[cat], category: cat, query: q, includeUsed: true });
    if (r.items.length === 0) failed.push(`${cat} 搜索「${q}」无结果`);
  }
  assert.deepEqual(failed, [], `以下二手搜索无结果:\n${failed.join('\n')}`);
});

test('搜索：洋垃圾 Xeon 可被搜到', { skip: !hasData && '无数据' }, () => {
  const r = queryList({ list: DB.cpu, category: 'cpu', query: 'e5', includeUsed: true });
  assert.ok(r.items.length >= 5, `搜索 e5 应命中多个 Xeon，实际 ${r.items.length}`);
});

// ══════════════════════════════════════════════════════════════════
// 7. 导出清单正确标注二手风险
// ══════════════════════════════════════════════════════════════════

test('导出：含二手件的清单会追加风险提示', { skip: !hasData && '无数据' }, async () => {
  const { buildRows } = await import('../src/ui/export.js');
  const byId = indexAll();
  const cpu = usedOf('cpu')[0];
  const gpu = DB.gpu.find((g) => g.condition === 'mining');
  const resolved = { cpu, gpu, motherboard: null, memory: null, psu: null, cooler: null, case: null, storage: [] };
  const res = checkCompatibility({ resolved, config: {}, byId });
  const { notes, usedItems } = buildRows(resolved, res, { includeUsedWarning: true });

  assert.ok(usedItems.length >= 2, '应识别出二手件');
  assert.ok(notes.some((n) => n.includes('风险提示')), '应输出风险提示');
  assert.ok(notes.some((n) => /矿卡|二手/.test(n)), '提示中应说明类型');
});
