/**
 * 整机场景集成测试（T1.9 数据交叉校验 + T2.9 场景回归）
 *
 * 与前一个测试不同，本文件使用 data/*.json 的**真实 300 条数据**，
 * 验证：
 *   1. 真实数据能通过规则引擎（无崩溃、结构正确）
 *   2. 常见整机配置不误报（PRD A5）
 *   3. PRD 指定的两个原始例子能正确报错（A6/A7）
 *   4. 数据交叉一致性：各插槽/代数都有可用配件（T1.9）
 *
 * 这是「数据 + 规则」一起验证的关口；任一环节出问题都应在此暴露。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkCompatibility, resolveConfig } from '../src/core/rules.js';
import { CATEGORY_LIST, CATEGORY_FIELDS } from '../schema/fields.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');

/** 载入全部真实数据 */
function loadAll() {
  const out = {};
  for (const cat of CATEGORY_LIST) {
    const p = join(DATA, CATEGORY_FIELDS[cat].file);
    if (!existsSync(p)) return null;
    out[cat] = JSON.parse(readFileSync(p, 'utf8'));
  }
  return out;
}

const DB = loadAll();
const hasData = DB !== null;

/** 构建 id → 记录 索引 */
function index(db = DB) {
  const m = new Map();
  for (const list of Object.values(db)) for (const r of list) m.set(r.id, r);
  return m;
}

/** 跑一次检查 */
function run(config, db = DB) {
  return checkCompatibility({ config, byId: index(db) });
}

const ids = (res) => res.findings.map((f) => f.id);
const has = (res, id) => res.findings.some((f) => f.id === id);
const get = (res, id) => res.findings.find((f) => f.id === id);

/** 按条件在真实数据里找一个型号 */
function pick(cat, pred, desc) {
  const found = DB[cat].find(pred);
  assert.ok(found, `真实数据中找不到${desc}（品类 ${cat}）`);
  return found;
}

// ══════════════════════════════════════════════════════════════════
// 数据存在性
// ══════════════════════════════════════════════════════════════════

test('真实数据：8 品类齐全且总数 300~500（PRD A2）', { skip: !hasData && 'data/ 尚未生成' }, () => {
  let total = 0;
  for (const cat of CATEGORY_LIST) {
    const list = DB[cat];
    assert.ok(Array.isArray(list), `${cat} 应为数组`);
    assert.ok(list.length >= 30, `${cat} 至少 30 条（PRD A2），实际 ${list.length}`);
    assert.ok(
      list.length >= CATEGORY_FIELDS[cat].minCount,
      `${cat} 应达最低配比 ${CATEGORY_FIELDS[cat].minCount}，实际 ${list.length}`,
    );
    total += list.length;
  }
  assert.ok(total >= 300 && total <= 500, `总数应在 300~500，实际 ${total}`);
});

test('真实数据：全库 id 唯一（T1.9）', { skip: !hasData && 'data/ 尚未生成' }, () => {
  const seen = new Map();
  const dupes = [];
  for (const [cat, list] of Object.entries(DB)) {
    for (const r of list) {
      if (seen.has(r.id)) dupes.push(`${r.id} (${seen.get(r.id)} 与 ${cat})`);
      else seen.set(r.id, cat);
    }
  }
  assert.deepEqual(dupes, [], `存在重复 id: ${dupes.join(', ')}`);
});

test('真实数据：枚举取值全部合法（T1.9 字面量统一）', { skip: !hasData && 'data/ 尚未生成' }, async () => {
  const { ENUMS } = await import('../src/core/enums.js');
  const problems = [];

  for (const [cat, list] of Object.entries(DB)) {
    for (const r of list) {
      // socket（cpu / motherboard / cooler.sockets）
      if (r.socket && !ENUMS.socket.includes(r.socket)) problems.push(`${r.id}.socket=${r.socket}`);
      // formFactor 是跨品类复用字段名，语义各不相同，必须按品类分别用对应枚举：
      //   motherboard → E-ATX/ATX/M-ATX/Mini-ITX
      //   psu         → ATX/SFX/SFX-L/TFX
      //   storage     → M.2 2280 / 2.5" / 3.5" 等
      if (cat === 'motherboard' && r.formFactor && !ENUMS.formFactor.includes(r.formFactor)) {
        problems.push(`${r.id}.formFactor=${r.formFactor}`);
      }
      if (cat === 'psu' && r.formFactor && !ENUMS.psuFormFactor.includes(r.formFactor)) {
        problems.push(`${r.id}.formFactor=${r.formFactor}`);
      }
      if (cat === 'storage' && r.formFactor && !ENUMS.storageFormFactor.includes(r.formFactor)) {
        problems.push(`${r.id}.formFactor=${r.formFactor}`);
      }
      // formFactors（机箱）
      if (Array.isArray(r.formFactors)) {
        for (const v of r.formFactors) if (!ENUMS.formFactor.includes(v)) problems.push(`${r.id}.formFactors 含 ${v}`);
      }
      // psuFormFactors（机箱）
      if (Array.isArray(r.psuFormFactors)) {
        for (const v of r.psuFormFactors) if (!ENUMS.psuFormFactor.includes(v)) problems.push(`${r.id}.psuFormFactors 含 ${v}`);
      }
      // radiatorSupport（机箱）
      if (Array.isArray(r.radiatorSupport)) {
        for (const v of r.radiatorSupport) if (!ENUMS.radiatorSize.includes(v)) problems.push(`${r.id}.radiatorSupport 含 ${v}`);
      }
      // memoryType 枚举只适用于内存与主板；
      // 显卡的 memoryType 是显存类型（GDDR6X/GDDR7），不属于该枚举，不能混检
      if ((cat === 'memory' || cat === 'motherboard') && r.memoryType && !ENUMS.memoryType.includes(r.memoryType)) {
        problems.push(`${r.id}.memoryType=${r.memoryType}`);
      }
      // memoryTypes（CPU）
      if (Array.isArray(r.memoryTypes)) {
        for (const v of r.memoryTypes) if (!ENUMS.memoryType.includes(v)) problems.push(`${r.id}.memoryTypes 含 ${v}`);
      }
      // sockets（散热器）
      if (Array.isArray(r.sockets)) {
        for (const v of r.sockets) if (!ENUMS.socket.includes(v)) problems.push(`${r.id}.sockets 含 ${v}`);
      }
      // condition
      if (r.condition && !ENUMS.condition.includes(r.condition)) problems.push(`${r.id}.condition=${r.condition}`);
      // cooler.type
      if (r.type && cat === 'cooler' && !ENUMS.coolerType.includes(r.type)) problems.push(`${r.id}.type=${r.type}`);
      // storage.interface
      if (r.interface && cat === 'storage' && !ENUMS.storageInterface.includes(r.interface)) problems.push(`${r.id}.interface=${r.interface}`);
      // storage.nandType
      if (cat === 'storage' && r.nandType && !ENUMS.nandType.includes(r.nandType)) problems.push(`${r.id}.nandType=${r.nandType}`);
      // psu.efficiency / modular
      if (cat === 'psu' && r.efficiency && !ENUMS.efficiency.includes(r.efficiency)) problems.push(`${r.id}.efficiency=${r.efficiency}`);
      if (cat === 'psu' && r.modular && !ENUMS.modular.includes(r.modular)) problems.push(`${r.id}.modular=${r.modular}`);
      // case.sidePanel
      if (cat === 'case' && r.sidePanel && !ENUMS.sidePanel.includes(r.sidePanel)) problems.push(`${r.id}.sidePanel=${r.sidePanel}`);
    }
  }
  assert.deepEqual(problems.slice(0, 20), [], `枚举字面量不统一（前 20 条）: ${problems.slice(0, 20).join('; ')}`);
});

// ══════════════════════════════════════════════════════════════════
// T1.9 数据交叉一致性：保证规则可判、不出现「必然报错」
// ══════════════════════════════════════════════════════════════════

test('数据交叉：每个 CPU 插槽都有主板可选（否则 E1 全红）', { skip: !hasData && 'data/ 尚未生成' }, () => {
  const boardSockets = new Set(DB.motherboard.map((m) => m.socket));
  const orphan = [...new Set(DB.cpu.map((c) => c.socket))].filter((s) => !boardSockets.has(s));
  assert.deepEqual(orphan, [], `这些插槽没有对应主板: ${orphan.join(', ')}`);
});

test('数据交叉：每个 CPU 插槽都有散热器扣具可选（否则 E9 全红）', { skip: !hasData && 'data/ 尚未生成' }, () => {
  const coolerSockets = new Set(DB.cooler.flatMap((c) => c.sockets || []));
  const orphan = [...new Set(DB.cpu.map((c) => c.socket))].filter((s) => !coolerSockets.has(s));
  assert.deepEqual(orphan, [], `这些插槽没有散热器支持: ${orphan.join(', ')}`);
});

test('数据交叉：每个 CPU 插槽都存在内存代数匹配的主板（否则 E3 全红）', { skip: !hasData && 'data/ 尚未生成' }, () => {
  const problems = [];
  for (const cpu of DB.cpu) {
    const types = new Set(cpu.memoryTypes || []);
    const ok = DB.motherboard.some(
      (m) => m.socket === cpu.socket && types.has(m.memoryType),
    );
    if (!ok) problems.push(`${cpu.name}(${cpu.socket}, ${[...types].join('/')})`);
  }
  assert.deepEqual(problems, [], `以下 CPU 没有代数匹配的主板: ${problems.join(', ')}`);
});

test('数据交叉：存在 ATX 电源能被机箱支持（否则 E13 全红）', { skip: !hasData && 'data/尚未生成' }, () => {
  const atxCases = DB.case.filter((c) => (c.psuFormFactors || []).includes('ATX'));
  assert.ok(atxCases.length > 0, '没有任何机箱支持 ATX 电源');
  const atxPsus = DB.psu.filter((p) => p.formFactor === 'ATX');
  assert.ok(atxPsus.length > 0, '没有任何 ATX 电源');
});

test('数据交叉：存在能容纳最长显卡的机箱（否则 E5 对旗舰卡必然报错）', { skip: !hasData && 'data/ 尚未生成' }, () => {
  const longest = Math.max(...DB.gpu.map((g) => g.length_mm));
  const fitting = DB.case.filter((c) => c.maxGpuLength >= longest);
  assert.ok(fitting.length > 0, `没有机箱能装下最长的 ${longest}mm 显卡`);
});

test('数据交叉：存在能满足最大冷排的机箱', { skip: !hasData && 'data/ 尚未生成' }, () => {
  const biggest = Math.max(...DB.cooler.filter((c) => c.type === 'aio').map((c) => c.radiatorSize));
  const fitting = DB.case.filter((c) => (c.radiatorSupport || []).includes(biggest));
  assert.ok(fitting.length > 0, `没有机箱支持 ${biggest} 冷排`);
});

test('数据交叉：电源供电接口足以驱动 8pin 需求最大的显卡（用充分型号验证）', { skip: !hasData && 'data/ 尚未生成' }, () => {
  const maxNeed = Math.max(...DB.gpu.map((g) => g.pcie8pin || 0));
  const enough = DB.psu.filter((p) => (p.pcie8pin || 0) >= maxNeed);
  assert.ok(enough.length > 0, `没有电源提供 ${maxNeed} 个 PCIe 8pin`);
});

// ══════════════════════════════════════════════════════════════════
// 场景回归：常见配置不应误报（PRD A5）
// ══════════════════════════════════════════════════════════════════

test('场景：主流游戏配置（AM5 + 4070S + 650W）无红色错误', { skip: !hasData && 'data/ 尚未生成' }, () => {
  const cpu = pick('cpu', (c) => c.socket === 'AM5' && c.igpu, '带核显的 AM5 CPU');
  const mb = pick('motherboard', (m) => m.socket === 'AM5' && m.memoryType === 'DDR5', 'AM5 DDR5 主板');
  const mem = pick('memory', (m) => m.memoryType === 'DDR5' && m.modules === 2 && m.speed <= mb.maxMemorySpeed && m.speed <= cpu.maxMemorySpeed, '兼容频率的 DDR5 双条套装');
  const gpu = pick('gpu', (g) => g.condition === 'new' && g.tdp <= 250, '主流新显卡');
  const psu = pick('psu', (p) => p.wattage >= 750 && p.formFactor === 'ATX' && p.pcie8pin >= (gpu.pcie8pin || 0) && p.pcie12vhpwr >= (gpu.pcie12vhpwr || 0) && p.eps8pin >= mb.cpuPowerConnectors, '充足 ATX 电源');
  const kase = pick('case', (c) => c.maxGpuLength >= gpu.length_mm && c.maxGpuThickness >= gpu.thicknessSlots && c.formFactors.includes(mb.formFactor) && c.psuFormFactors.includes(psu.formFactor) && c.maxPsuLength >= psu.length_mm, '能装下的机箱');
  const cooler = pick('cooler', (c) => c.sockets.includes(cpu.socket) && c.tdpRating >= cpu.maxPower && (c.type !== 'air' || c.height_mm <= kase.maxCoolerHeight), '合适的散热器');
  const ssd = pick('storage', (s) => s.dram === true && s.nandType !== 'QLC', '有缓存的 TLC 系统盘');

  const config = {
    cpu: cpu.id, motherboard: mb.id, gpu: gpu.id, memory: mem.id,
    psu: psu.id, case: kase.id, cooler: cooler.id, storage: [ssd.id],
  };
  const res = run(config);

  const errors = res.findings.filter((f) => f.level === 'error');
  assert.deepEqual(
    errors.map((f) => `${f.id}: ${f.reason}`), [],
    '主流游戏配置不应有红色错误',
  );
  assert.ok(res.checked > 20, `应检查超过 20 条规则，实际 ${res.checked}`);
});

test('场景：纯办公配置（核显、无独显）无红色错误', { skip: !hasData && 'data/ 尚未生成' }, () => {
  const cpu = pick('cpu', (c) => c.igpu === true && c.maxPower <= 100, '低功耗带核显 CPU');
  const mb = pick('motherboard', (m) => m.socket === cpu.socket && (cpu.memoryTypes || []).includes(m.memoryType) && m.formFactor === 'M-ATX', '匹配主板');
  const mem = pick('memory', (m) => m.memoryType === mb.memoryType && m.modules === 2 && m.speed <= mb.maxMemorySpeed && m.speed <= cpu.maxMemorySpeed, '兼容内存');
  const psu = pick('psu', (p) => p.wattage >= 450 && p.eps8pin >= mb.cpuPowerConnectors, '够用电源');
  const kase = pick('case', (c) => c.formFactors.includes(mb.formFactor) && c.psuFormFactors.includes(psu.formFactor) && c.maxPsuLength >= psu.length_mm, '兼容机箱');
  const cooler = pick('cooler', (c) => c.sockets.includes(cpu.socket) && (c.type !== 'air' || c.height_mm <= kase.maxCoolerHeight), '兼容散热器');
  const ssd = pick('storage', (s) => s.dram === true, '有缓存硬盘');

  const config = {
    cpu: cpu.id, motherboard: mb.id, memory: mem.id,
    psu: psu.id, case: kase.id, cooler: cooler.id, storage: [ssd.id],
  };
  const res = run(config);
  const errors = res.findings.filter((f) => f.level === 'error');
  assert.deepEqual(errors.map((f) => `${f.id}: ${f.reason}`), [], '办公配置不应有红色错误');
  assert.ok(!has(res, 'E16'), '带核显 CPU 不应触发 E16');
});

test('场景：二手洋垃圾平台（X99 + E5 + DDR4 ECC）能正常评估', { skip: !hasData && 'data/ 尚未生成' }, () => {
  const cpu = pick('cpu', (c) => c.socket === 'LGA2011-3', '洋垃圾 CPU');
  const mb = pick('motherboard', (m) => m.socket === 'LGA2011-3', 'X99 主板');
  const mem = pick('memory', (m) => m.memoryType === mb.memoryType, 'DDR4 内存');
  const cooler = pick('cooler', (c) => c.sockets.includes('LGA2011-3'), '支持 LGA2011-3 的散热器');

  const config = { cpu: cpu.id, motherboard: mb.id, memory: mem.id, cooler: cooler.id };
  const res = run(config);

  // 洋垃圾平台应触发 I4（无保修提示）与 I3（平台末期）
  assert.ok(has(res, 'I4'), '含洋垃圾应触发 I4');
  assert.ok(has(res, 'I3'), 'LGA2011-3 属末期平台应触发 I3');

  // 但不应有插槽/扣具类错误
  assert.ok(!has(res, 'E1'), '同插槽不应报 E1');
  assert.ok(!has(res, 'E9'), '扣具匹配不应报 E9');
});

// ══════════════════════════════════════════════════════════════════
// PRD 指定的两个原始例子（A6 / A7）
// ══════════════════════════════════════════════════════════════════

test('A6：AM4 主板 + Intel CPU 正确报 E1（PRD 原始例子）', { skip: !hasData && 'data/ 尚未生成' }, () => {
  const mb = pick('motherboard', (m) => m.socket === 'AM4', 'AM4 主板');
  const cpu = pick('cpu', (c) => c.socket === 'LGA1700', 'LGA1700 CPU');

  const res = run({ cpu: cpu.id, motherboard: mb.id });
  assert.ok(has(res, 'E1'), `应报 E1，实际: ${ids(res).join(',')}`);

  const f = get(res, 'E1');
  assert.equal(f.level, 'error');
  assert.ok(f.reason.includes(mb.name), '原因应含主板型号');
  assert.ok(f.reason.includes(cpu.name), '原因应含 CPU 型号');
  assert.ok(f.reason.includes('AM4'), '原因应含 AM4');
  assert.ok(f.reason.includes('LGA1700'), '原因应含 LGA1700');
});

test('A7：低瓦电源 + 高端显卡正确报 E10（PRD 原始例子）', { skip: !hasData && 'data/ 尚未生成' }, () => {
  const gpu = pick('gpu', (g) => g.tdp >= 300, '高端显卡');
  const cpu = pick('cpu', (c) => c.maxPower >= 150 && c.igpu, '高功耗带核显 CPU');
  const psu = pick('psu', (p) => p.wattage === 450, '450W 低瓦电源');

  const res = run({ cpu: cpu.id, gpu: gpu.id, psu: psu.id });
  assert.ok(has(res, 'E10'), `应报 E10，实际: ${ids(res).join(',')}`);

  const f = get(res, 'E10');
  assert.equal(f.level, 'error');
  assert.match(f.reason, /\d+W/, '应报出具体瓦数');
  assert.ok(f.advice.length > 0, '应给出换电源的建议');
});

// ══════════════════════════════════════════════════════════════════
// 真实数据 × 极端组合：不允许崩溃
// ══════════════════════════════════════════════════════════════════

test('鲁棒性：最长显卡 + 最小机箱 → 应报 E5 而非崩溃', { skip: !hasData && 'data/ 尚未生成' }, () => {
  const gpu = DB.gpu.reduce((a, b) => (a.length_mm >= b.length_mm ? a : b));
  const kase = DB.case.reduce((a, b) => (a.maxGpuLength <= b.maxGpuLength ? a : b));
  const res = run({ gpu: gpu.id, case: kase.id });
  assert.ok(has(res, 'E5'), '最长显卡配最小机箱应报 E5');
  const f = get(res, 'E5');
  assert.ok(f.reason.includes(String(gpu.length_mm)), '应含显卡长度');
  assert.ok(f.reason.includes(String(kase.maxGpuLength)), '应含机箱限长');
});

test('鲁棒性：最高风冷 + 最矮机箱 → 应报 E7 而非崩溃', { skip: !hasData && 'data/ 尚未生成' }, () => {
  const airs = DB.cooler.filter((c) => c.type === 'air');
  const cooler = airs.reduce((a, b) => (a.height_mm >= b.height_mm ? a : b));
  const kase = DB.case.reduce((a, b) => (a.maxCoolerHeight <= b.maxCoolerHeight ? a : b));
  const res = run({ cooler: cooler.id, case: kase.id });
  assert.ok(has(res, 'E7'), '最高风冷配最矮机箱应报 E7');
});

test('鲁棒性：最大冷排 + 只支持小冷排的机箱 → 应报 E8', { skip: !hasData && 'data/ 尚未生成' }, () => {
  const aios = DB.cooler.filter((c) => c.type === 'aio');
  const cooler = aios.reduce((a, b) => (a.radiatorSize >= b.radiatorSize ? a : b));
  const kase = pick('case', (c) => (c.radiatorSupport || []).length > 0 && !c.radiatorSupport.includes(cooler.radiatorSize), '不支持该冷排的机箱');
  const res = run({ cooler: cooler.id, case: kase.id });
  assert.ok(has(res, 'E8'), '大冷排配小机箱应报 E8');
});

test('鲁棒性：遍历全部真实配置组合不抛异常', { skip: !hasData && 'data/ 尚未生成' }, () => {
  // 随机抽样 200 组跨品类组合，确保引擎在任何组合下都不崩
  const cats = ['cpu', 'motherboard', 'gpu', 'memory', 'psu', 'case', 'cooler', 'storage'];
  let n = 0;
  for (let i = 0; i < 200; i++) {
    const config = {};
    for (const c of cats) {
      const list = DB[c];
      const rec = list[(i * 7 + c.length * 13) % list.length];
      if (c === 'storage') config.storage = [rec.id];
      else config[c] = rec.id;
    }
    const res = checkCompatibility({ config, byId: index() });
    assert.ok(Array.isArray(res.findings), `第 ${i} 组应返回 findings`);
    assert.equal(res.checked + res.skipped, 32, 'checked + skipped 应恒为 32');
    n++;
  }
  assert.equal(n, 200);
});

test('鲁棒性：全空的 8 品类配置不崩溃且无 finding', { skip: !hasData && 'data/ 尚未生成' }, () => {
  const res = run({});
  assert.ok(Array.isArray(res.findings));
  assert.equal(res.findings.length, 0, '空配置不应产生任何 finding');
  assert.equal(res.checked + res.skipped, 32, 'checked + skipped 应恒为 32');
  // 只有 I4（二手标记）不需要任何必选配件，它会在空配置上运行但返回无问题
  assert.equal(res.checked, 1, '空配置下仅 I4 可执行（它返回无 finding）');
  assert.equal(res.skipped, 31, '其余 31 条因配件未选而跳过');
});

test('鲁棒性：引用不存在的 id 不崩溃', { skip: !hasData && 'data/ 尚未生成' }, () => {
  const res = run({ cpu: 'cpu-nonexistent-999', motherboard: 'mb-nope' });
  assert.ok(Array.isArray(res.findings));
  assert.equal(res.findings.length, 0, '无效 id 应解析为 null 并跳过规则');
});
