/**
 * 32 条兼容性规则测试（PRD 第四部分 / T2.9）
 *
 * 标准：每条规则至少 1 个正例（不触发）+ 1 个反例（触发），
 *      并校验文案含双方型号与数值（PRD M3-3）。
 *
 * 做法：从 compatibleBuild() 这套「零问题基准配置」出发，
 *      只替换一件配件来精确触发目标规则，其余保持兼容，
 *      这样能验证规则「该报才报、不该报不报」。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checkCompatibility, resolveConfig, checkCandidate } from '../src/core/rules.js';
import { RULES, RULE_MAP, RULE_COUNT, RULES_BY_LEVEL, ruleCategoryMap, cpuGeneration, BIOS_COMPAT } from '../src/core/rules-data.js';
import { makeIndex } from './fixtures/hardware.mjs';
import {
  makeCpu, makeMb, makeGpu, makeMem, makePsu, makeCase, makeCooler, makeAio, makeStorage,
  compatibleBuild,
} from './fixtures/hardware.mjs';

/** 用给定配件集合跑检查 */
function run(items, config) {
  const byId = makeIndex(items);
  return checkCompatibility({ config, byId });
}

/** 取指定规则编号的 finding */
function finding(res, id) {
  return res.findings.find((f) => f.id === id);
}

/** 断言某规则触发 */
function expectTriggered(res, id, opts = {}) {
  const f = finding(res, id);
  assert.ok(f, `规则 ${id} 应触发，但未触发。实际触发: [${res.findings.map((x) => x.id).join(', ')}]`);
  assert.ok(f.reason && f.reason.length > 0, `${id} 必须有 reason`);
  assert.ok(f.advice && f.advice.length > 0, `${id} 必须有 advice`);
  if (opts.level) assert.equal(f.level, opts.level, `${id} 级别应为 ${opts.level}`);
  return f;
}

/** 断言某规则未触发 */
function expectNotTriggered(res, id) {
  const f = finding(res, id);
  assert.equal(f, undefined, `规则 ${id} 不应触发，但触发了：${f?.reason}`);
}

// ══════════════════════════════════════════════════════════════════
// 0. 规则注册表本身
// ══════════════════════════════════════════════════════════════════

test('规则注册表：共 32 条（17 错误 + 11 警告 + 4 提示）', () => {
  assert.equal(RULE_COUNT, 32, `规则总数应为 32，实际 ${RULE_COUNT}`);
  assert.equal(RULES_BY_LEVEL.error.length, 17, '错误级应为 17 条');
  assert.equal(RULES_BY_LEVEL.warn.length, 11, '警告级应为 11 条');
  assert.equal(RULES_BY_LEVEL.info.length, 4, '提示级应为 4 条');
});

test('规则注册表：编号连续且与 PRD 一致（E1-E17 / W1-W11 / I1-I4）', () => {
  const expect = [
    ...Array.from({ length: 17 }, (_, i) => `E${i + 1}`),
    ...Array.from({ length: 11 }, (_, i) => `W${i + 1}`),
    ...Array.from({ length: 4 }, (_, i) => `I${i + 1}`),
  ];
  assert.deepEqual(RULES.map((r) => r.id), expect);
});

test('规则注册表：每条都有必需元数据', () => {
  for (const r of RULES) {
    assert.ok(r.id, 'id 缺失');
    assert.ok(['error', 'warn', 'info'].includes(r.level), `${r.id} level 非法`);
    assert.ok(r.title && r.title.length > 0, `${r.id} 缺 title`);
    assert.ok(Array.isArray(r.categories), `${r.id} categories 应为数组`);
    assert.ok(Array.isArray(r.required), `${r.id} required 应为数组`);
    assert.ok(Array.isArray(r.fields), `${r.id} fields 应为数组`);
    assert.ok(r.good && r.good.length > 0, `${r.id} 缺 good 示例`);
    assert.ok(r.bad && r.bad.length > 0, `${r.id} 缺 bad 示例`);
    assert.equal(typeof r.check, 'function', `${r.id} check 应为函数`);
  }
});

test('规则注册表：categories 取值都是合法品类', () => {
  const valid = new Set(['cpu', 'motherboard', 'gpu', 'memory', 'psu', 'cooler', 'case', 'storage']);
  for (const r of RULES) {
    for (const c of r.categories) {
      assert.ok(valid.has(c), `${r.id} 的 categories 含非法品类 "${c}"`);
    }
  }
});

test('规则注册表：required 取值都是合法品类', () => {
  const valid = new Set(['cpu', 'motherboard', 'gpu', 'memory', 'psu', 'cooler', 'case', 'storage']);
  for (const r of RULES) {
    for (const c of r.required) {
      assert.ok(valid.has(c), `${r.id} 的 required 含非法品类 "${c}"`);
    }
  }
});

test('规则→品类映射：8 个品类都有相关规则（状态灯可用）', () => {
  const map = ruleCategoryMap();
  for (const cat of ['cpu', 'motherboard', 'gpu', 'memory', 'psu', 'cooler', 'case', 'storage']) {
    assert.ok(Array.isArray(map[cat]), `${cat} 缺映射`);
    assert.ok(map[cat].length > 0, `${cat} 没有任何相关规则，状态灯无法点亮`);
  }
});

test('基准配置：完全兼容的一套配置应零错误零警告', () => {
  const b = compatibleBuild();
  const res = run(b.items, b.config);
  const bad = res.findings.filter((f) => f.level !== 'info');
  assert.deepEqual(
    bad.map((f) => `${f.id}:${f.reason}`), [],
    '基准配置不应有任何错误或警告（提示级允许存在）',
  );
});

test('引擎：未选齐时跳过相关规则并计入 skipped，不误报', () => {
  const b = compatibleBuild();
  // 只选 CPU
  const res = run(b.items, { cpu: b.cpu.id });
  assert.ok(res.skipped > 0, '应跳过大量规则');
  assert.equal(res.checked + res.skipped, 32, 'checked + skipped 应等于 32');
  // 只选 CPU 时不应报任何需要 CPU+主板 的规则
  expectNotTriggered(res, 'E1');
  expectNotTriggered(res, 'E4');
  expectNotTriggered(res, 'E5');
});

test('引擎：findings 按 error → warn → info 排序', () => {
  const b = compatibleBuild();
  const cpu = makeCpu({ id: 'cpu-x', socket: 'LGA1700', name: 'Intel i5-14600KF', igpu: false });
  const mb = makeMb({ id: 'mb-x', socket: 'AM4', chipset: 'B450', memoryType: 'DDR4' });
  const mem = makeMem({ id: 'mem-x', memoryType: 'DDR4', speed: 6400, modules: 1, height_mm: 56 });
  const gpu = makeGpu({ id: 'gpu-x', tdp: 320, pcie8pin: 3 });
  const psu = makePsu({ id: 'psu-x', wattage: 400, pcie8pin: 1, eps8pin: 1 });
  const kase = makeCase({ id: 'case-x', maxGpuLength: 200, maxGpuThickness: 2 });
  const cooler = makeAio({ id: 'cooler-x', radiatorSize: 420, sockets: ['AM4'] });
  const ssd = makeStorage({ id: 'ssd-x', dram: false, nandType: 'QLC' });

  const items = [cpu, mb, mem, gpu, psu, kase, cooler, ssd];
  const config = {
    cpu: cpu.id, motherboard: mb.id, memory: mem.id, gpu: gpu.id,
    psu: psu.id, case: kase.id, cooler: cooler.id, storage: [ssd.id],
  };
  const res = run(items, config);
  assert.ok(res.findings.length > 0);
  const levels = res.findings.map((f) => f.level);
  const firstWarn = levels.indexOf('warn');
  const firstInfo = levels.indexOf('info');
  const lastError = levels.lastIndexOf('error');
  if (lastError >= 0 && firstWarn >= 0) assert.ok(lastError < firstWarn, 'error 应排在 warn 之前');
  if (firstWarn >= 0 && firstInfo >= 0) assert.ok(firstWarn < firstInfo, 'warn 应排在 info 之前');
});

test('引擎：单条规则抛异常不影响整体（NF7 容错）', () => {
  const b = compatibleBuild();
  const byId = makeIndex(b.items);
  // 用 getter 让某字段访问抛错，模拟脏数据
  const evil = { ...b.cpu, id: 'cpu-evil' };
  Object.defineProperty(evil, 'socket', {
    get() { throw new Error('模拟脏数据'); },
    enumerable: true,
  });
  const idx = new Map(byId);
  idx.set('cpu-evil', evil);
  const res = checkCompatibility({ config: { ...b.config, cpu: 'cpu-evil' }, byId: idx });
  assert.ok(Array.isArray(res.findings), '应仍返回结果而非崩溃');
});

// ══════════════════════════════════════════════════════════════════
// E1 ~ E17：错误级
// ══════════════════════════════════════════════════════════════════

test('E1 插槽不匹配 —— 正例（同插槽）不报', () => {
  const b = compatibleBuild();
  expectNotTriggered(run(b.items, b.config), 'E1');
});

test('E1 插槽不匹配 —— 反例（AM4 主板 + LGA1700 CPU）报错且文案含双方型号', () => {
  const b = compatibleBuild();
  const cpu = makeCpu({ id: 'cpu-intel', name: 'Intel i5-14600KF', socket: 'LGA1700', igpu: false });
  const mb = makeMb({ id: 'mb-am4', name: '微星 B450M 迫击炮', socket: 'AM4', chipset: 'B450', memoryType: 'DDR4' });
  const mem = makeMem({ id: 'mem-d4', memoryType: 'DDR4', speed: 3200 });
  const cooler = makeCooler({ id: 'c-ok', sockets: ['AM4', 'LGA1700'] });
  const items = [cpu, mb, mem, cooler];
  const config = { cpu: cpu.id, motherboard: mb.id, memory: mem.id, cooler: cooler.id };

  const f = expectTriggered(run(items, config), 'E1', { level: 'error' });
  assert.match(f.reason, /B450M 迫击炮/, 'reason 应含主板型号');
  assert.match(f.reason, /i5-14600KF/, 'reason 应含 CPU 型号');
  assert.match(f.reason, /AM4/, 'reason 应含主板插槽');
  assert.match(f.reason, /LGA1700/, 'reason 应含 CPU 插槽');
  assert.deepEqual(f.refs.map((r) => r.category), ['motherboard', 'cpu'], '应可跳转主板与 CPU');
});

test('E2 内存代数与主板不符 —— 正反例', () => {
  const b = compatibleBuild();
  expectNotTriggered(run(b.items, b.config), 'E2');

  const mb = makeMb({ id: 'mb-d5', memoryType: 'DDR5', socket: 'AM5' });
  const mem = makeMem({ id: 'mem-d4', memoryType: 'DDR4', speed: 3200 });
  const cpu = makeCpu({ id: 'cpu-d5', memoryTypes: ['DDR5'] });
  const items = [cpu, mb, mem];
  const f = expectTriggered(run(items, { cpu: cpu.id, motherboard: mb.id, memory: mem.id }), 'E2');
  assert.match(f.reason, /DDR5/);
  assert.match(f.reason, /DDR4/);
});

test('E3 主板代数不在 CPU 支持范围 —— 正反例', () => {
  const b = compatibleBuild();
  expectNotTriggered(run(b.items, b.config), 'E3');

  // CPU 只支持 DDR5，主板却是 DDR4
  const cpu = makeCpu({ id: 'cpu-d5only', memoryTypes: ['DDR5'] });
  const mb = makeMb({ id: 'mb-d4', memoryType: 'DDR4' });
  const mem = makeMem({ id: 'mem-d4', memoryType: 'DDR4', speed: 3200 });
  const items = [cpu, mb, mem];
  const f = expectTriggered(run(items, { cpu: cpu.id, motherboard: mb.id, memory: mem.id }), 'E3');
  assert.match(f.reason, /DDR5/);
  assert.match(f.reason, /DDR4/);
});

test('E4 机箱不支持主板板型 —— 正反例', () => {
  const b = compatibleBuild();
  expectNotTriggered(run(b.items, b.config), 'E4');

  const mb = makeMb({ id: 'mb-atx', formFactor: 'ATX' });
  const kase = makeCase({ id: 'case-itx', name: 'ITX 小机箱', formFactors: ['Mini-ITX'], maxGpuLength: 250, maxCoolerHeight: 70, psuFormFactors: ['SFX'], maxPsuLength: 150, radiatorSupport: [120] });
  const cpu = makeCpu({ id: 'cpu-a' });
  const items = [cpu, mb, kase];
  const f = expectTriggered(run(items, { cpu: cpu.id, motherboard: mb.id, case: kase.id }), 'E4');
  assert.match(f.reason, /ATX/);
  assert.match(f.reason, /Mini-ITX/);
});

test('E5 显卡超长 —— 正反例（含具体毫米数）', () => {
  const b = compatibleBuild();
  expectNotTriggered(run(b.items, b.config), 'E5');

  const gpu = makeGpu({ id: 'gpu-long', name: '超长显卡', length_mm: 358 });
  const kase = makeCase({ id: 'case-small', name: '小机箱', maxGpuLength: 330 });
  const cpu = makeCpu({ id: 'cpu-a' });
  const items = [cpu, gpu, kase];
  const f = expectTriggered(run(items, { cpu: cpu.id, gpu: gpu.id, case: kase.id }), 'E5');
  assert.match(f.reason, /358mm/, '应含显卡长度');
  assert.match(f.reason, /330mm/, '应含机箱限长');
  assert.match(f.reason, /28mm/, '应含超出量');
});

test('E6 显卡超厚 —— 正反例', () => {
  const b = compatibleBuild();
  expectNotTriggered(run(b.items, b.config), 'E6');

  const gpu = makeGpu({ id: 'gpu-thick', thicknessSlots: 3.5 });
  const kase = makeCase({ id: 'case-thin', maxGpuThickness: 2 });
  const cpu = makeCpu({ id: 'cpu-a' });
  const items = [cpu, gpu, kase];
  const f = expectTriggered(run(items, { cpu: cpu.id, gpu: gpu.id, case: kase.id }), 'E6');
  assert.match(f.reason, /3\.5 槽/);
  assert.match(f.reason, /2 槽/);
});

test('E7 风冷超高 —— 正反例；水冷不受此规则约束', () => {
  const b = compatibleBuild();
  expectNotTriggered(run(b.items, b.config), 'E7');

  const cooler = makeCooler({ id: 'cooler-tall', name: '高塔风冷', height_mm: 165 });
  const kase = makeCase({ id: 'case-low', maxCoolerHeight: 100 });
  const cpu = makeCpu({ id: 'cpu-a' });
  const items = [cpu, cooler, kase];
  const f = expectTriggered(run(items, { cpu: cpu.id, cooler: cooler.id, case: kase.id }), 'E7');
  assert.match(f.reason, /165mm/);
  assert.match(f.reason, /100mm/);

  // 水冷不应触发 E7（即便机箱限高很小）
  const aio = makeAio({ id: 'aio-a', radiatorSize: 240 });
  const items2 = [cpu, aio, kase];
  expectNotTriggered(run(items2, { cpu: cpu.id, cooler: aio.id, case: kase.id }), 'E7');
});

test('E8 机箱不支持该冷排规格 —— 正反例；风冷不受约束', () => {
  const b = compatibleBuild();
  expectNotTriggered(run(b.items, b.config), 'E8');

  const aio = makeAio({ id: 'aio-360', name: '360 水冷', radiatorSize: 360 });
  const kase = makeCase({ id: 'case-240only', radiatorSupport: [120, 240] });
  const cpu = makeCpu({ id: 'cpu-a' });
  const items = [cpu, aio, kase];
  const f = expectTriggered(run(items, { cpu: cpu.id, cooler: aio.id, case: kase.id }), 'E8');
  assert.match(f.reason, /360/);
  assert.match(f.reason, /120 \/ 240/);

  // 机箱完全不支持水冷
  const kase2 = makeCase({ id: 'case-nowc', radiatorSupport: [] });
  const items2 = [cpu, aio, kase2];
  const f2 = expectTriggered(run(items2, { cpu: cpu.id, cooler: aio.id, case: kase2.id }), 'E8');
  assert.match(f2.reason, /不支持任何水冷/);

  // 风冷不应触发 E8
  const air = makeCooler({ id: 'c-air', height_mm: 155 });
  const items3 = [cpu, air, kase2];
  expectNotTriggered(run(items3, { cpu: cpu.id, cooler: air.id, case: kase2.id }), 'E8');
});

test('E9 散热器不支持该插槽 —— 正反例', () => {
  const b = compatibleBuild();
  expectNotTriggered(run(b.items, b.config), 'E9');

  const cpu = makeCpu({ id: 'cpu-am5', socket: 'AM5', name: 'R7 7800X3D' });
  const cooler = makeCooler({ id: 'cooler-old', name: '老款散热器', sockets: ['AM4', 'LGA1200'] });
  const items = [cpu, cooler];
  const f = expectTriggered(run(items, { cpu: cpu.id, cooler: cooler.id }), 'E9');
  assert.match(f.reason, /AM4 \/ LGA1200/);
  assert.match(f.reason, /AM5/);
});

test('E10 电源瓦数不足 —— 正反例（PRD 原始例子）', () => {
  const b = compatibleBuild();
  expectNotTriggered(run(b.items, b.config), 'E10');

  const cpu = makeCpu({ id: 'cpu-big', name: 'i9-14900K', maxPower: 253 });
  const gpu = makeGpu({ id: 'gpu-big', name: 'RTX 4090', tdp: 450, pcie8pin: 4 });
  const psu = makePsu({ id: 'psu-small', name: '400W 电源', wattage: 400, pcie8pin: 4, eps8pin: 2 });
  const mb = makeMb({ id: 'mb-a' });
  const items = [cpu, gpu, psu, mb];
  const res = run(items, { cpu: cpu.id, gpu: gpu.id, psu: psu.id, motherboard: mb.id });
  const f = expectTriggered(res, 'E10');
  assert.match(f.reason, /400W/, '应含电源瓦数');

  // 峰值 = 253 + 450 + 40 + 10(风扇) = 753W
  assert.match(f.reason, /753W/, '应含整机峰值');
  assert.match(f.advice, /1050W|1100W/, '建议瓦数应约 753×1.4 取档');
  // 同时应触发 W1 之外的其他相关规则不属于 E10 职责
});

test('E11 电源显卡供电接口不足 —— 正反例（8pin 与 12VHPWR 都要够）', () => {
  const b = compatibleBuild();
  expectNotTriggered(run(b.items, b.config), 'E11');

  // 8pin 不够
  const gpu = makeGpu({ id: 'gpu-3x8', name: '三 8pin 显卡', pcie8pin: 3, tdp: 350 });
  const psu = makePsu({ id: 'psu-1x8', name: '单 8pin 电源', wattage: 850, pcie8pin: 1 });
  const cpu = makeCpu({ id: 'cpu-a' });
  const items = [cpu, gpu, psu];
  const f = expectTriggered(run(items, { cpu: cpu.id, gpu: gpu.id, psu: psu.id }), 'E11');
  assert.match(f.reason, /8pin 需 3 个，电源只有 1 个/);

  // 12VHPWR 不够
  const gpu2 = makeGpu({ id: 'gpu-12v', name: '12VHPWR 显卡', pcie8pin: 0, pcie12vhpwr: 1, tdp: 450 });
  const psu2 = makePsu({ id: 'psu-no12v', name: '无 12VHPWR 电源', wattage: 1000, pcie8pin: 4, pcie12vhpwr: 0 });
  const items2 = [cpu, gpu2, psu2];
  const f2 = expectTriggered(run(items2, { cpu: cpu.id, gpu: gpu2.id, psu: psu2.id }), 'E11');
  assert.match(f2.reason, /12VHPWR 需 1 个，电源只有 0 个/);
});

test('E12 电源 CPU 供电接口不足 —— 正反例', () => {
  const b = compatibleBuild();
  expectNotTriggered(run(b.items, b.config), 'E12');

  const mb = makeMb({ id: 'mb-8plus4', cpuPowerConnectors: 2 });
  const psu = makePsu({ id: 'psu-1eps', eps8pin: 1 });
  const cpu = makeCpu({ id: 'cpu-a' });
  const items = [cpu, mb, psu];
  const f = expectTriggered(run(items, { cpu: cpu.id, motherboard: mb.id, psu: psu.id }), 'E12');
  assert.match(f.reason, /需要 2 个 CPU 8pin/);
  assert.match(f.reason, /只有 1 个/);
});

test('E13 机箱不支持该电源规格 —— 正反例', () => {
  const b = compatibleBuild();
  expectNotTriggered(run(b.items, b.config), 'E13');

  const psu = makePsu({ id: 'psu-atx', formFactor: 'ATX' });
  const kase = makeCase({ id: 'case-sfx', psuFormFactors: ['SFX', 'SFX-L'] });
  const cpu = makeCpu({ id: 'cpu-a' });
  const items = [cpu, psu, kase];
  const f = expectTriggered(run(items, { cpu: cpu.id, psu: psu.id, case: kase.id }), 'E13');
  assert.match(f.reason, /ATX 规格/);
  assert.match(f.reason, /SFX \/ SFX-L/);
});

test('E14 电源超长 —— 正反例', () => {
  const b = compatibleBuild();
  expectNotTriggered(run(b.items, b.config), 'E14');

  const psu = makePsu({ id: 'psu-long', name: '长电源', length_mm: 180 });
  const kase = makeCase({ id: 'case-short', maxPsuLength: 160 });
  const cpu = makeCpu({ id: 'cpu-a' });
  const items = [cpu, psu, kase];
  const f = expectTriggered(run(items, { cpu: cpu.id, psu: psu.id, case: kase.id }), 'E14');
  assert.match(f.reason, /180mm/);
  assert.match(f.reason, /160mm/);
  assert.match(f.reason, /20mm/);
});

test('E15 硬盘接口不够 —— 正反例（M.2 与 SATA 分别统计）', () => {
  const b = compatibleBuild();
  expectNotTriggered(run(b.items, b.config), 'E15');

  const mb = makeMb({ id: 'mb-few', m2Slots: 1, sataPorts: 2 });
  const s1 = makeStorage({ id: 'ssd-1' });
  const s2 = makeStorage({ id: 'ssd-2' });
  const s3 = makeStorage({ id: 'ssd-3' });
  const cpu = makeCpu({ id: 'cpu-a' });
  const items = [cpu, mb, s1, s2, s3];
  const f = expectTriggered(
    run(items, { cpu: cpu.id, motherboard: mb.id, storage: [s1.id, s2.id, s3.id] }),
    'E15',
  );
  assert.match(f.reason, /NVMe 硬盘 3 个，主板只有 1 个 M\.2 接口/);
  assert.match(f.reason, /差 2 个/);

  // SATA 不够
  const mb2 = makeMb({ id: 'mb-sata1', m2Slots: 2, sataPorts: 1 });
  const h1 = makeStorage({ id: 'hdd-1', interface: 'SATA', formFactor: '3.5"', name: 'HDD1' });
  const h2 = makeStorage({ id: 'hdd-2', interface: 'SATA', formFactor: '3.5"', name: 'HDD2' });
  const items2 = [cpu, mb2, h1, h2];
  const f2 = expectTriggered(run(items2, { cpu: cpu.id, motherboard: mb2.id, storage: [h1.id, h2.id] }), 'E15');
  assert.match(f2.reason, /SATA 硬盘 2 个，主板只有 1 个 SATA 接口/);
});

test('E16 无核显且无显卡 —— 正反例（点不亮）', () => {
  const b = compatibleBuild();
  expectNotTriggered(run(b.items, b.config), 'E16');

  // 无核显 + 无显卡 → 报错
  const cpu = makeCpu({ id: 'cpu-kf', name: 'Intel i5-14600KF', igpu: false });
  const mb = makeMb({ id: 'mb-a' });
  const items = [cpu, mb];
  const f = expectTriggered(run(items, { cpu: cpu.id, motherboard: mb.id }), 'E16');
  assert.match(f.reason, /不带核显/);
  assert.match(f.reason, /无法点亮/);

  // 无核显但有显卡 → 不报
  const gpu = makeGpu({ id: 'gpu-a' });
  const items2 = [cpu, mb, gpu];
  expectNotTriggered(run(items2, { cpu: cpu.id, motherboard: mb.id, gpu: gpu.id }), 'E16');

  // 有核显无显卡 → 不报
  const cpu2 = makeCpu({ id: 'cpu-igpu', igpu: true });
  const items3 = [cpu2, mb];
  expectNotTriggered(run(items3, { cpu: cpu2.id, motherboard: mb.id }), 'E16');
});

test('E17 内存条数超过插槽数 —— 正反例', () => {
  const b = compatibleBuild();
  expectNotTriggered(run(b.items, b.config), 'E17');

  const mb = makeMb({ id: 'mb-2slot', memorySlots: 2 });
  const mem = makeMem({ id: 'mem-4x', modules: 4 });
  const cpu = makeCpu({ id: 'cpu-a' });
  const items = [cpu, mb, mem];
  const f = expectTriggered(run(items, { cpu: cpu.id, motherboard: mb.id, memory: mem.id }), 'E17');
  assert.match(f.reason, /共 4 条/);
  assert.match(f.reason, /只有 2 个内存插槽/);
});

// ══════════════════════════════════════════════════════════════════
// W1 ~ W11：警告级
// ══════════════════════════════════════════════════════════════════

test('W1 电源余量偏低 —— 正反例（<20% 才报）', () => {
  const b = compatibleBuild();
  // 完整基准配置峰值 446W（含硬盘 8W）；650W 余量 32% → 不报
  expectNotTriggered(run(b.items, b.config), 'W1');

  const cpu = makeCpu({ id: 'cpu-a' });
  const mb = makeMb({ id: 'mb-a' });
  const gpu = makeGpu({ id: 'gpu-a' });
  const mem = makeMem({ id: 'mem-a' });
  // 本用例未选硬盘，故峰值 = 162+220+40+6+10 = 438W
  // 选 520W → 余量 15.8% < 20% → 报
  const psu = makePsu({ id: 'psu-520', name: '520W', wattage: 520 });
  const items = [cpu, mb, gpu, mem, psu];
  const res = run(items, { cpu: cpu.id, motherboard: mb.id, gpu: gpu.id, memory: mem.id, psu: psu.id });
  const f = expectTriggered(res, 'W1', { level: 'warn' });
  assert.match(f.reason, /438W/);
  assert.match(f.reason, /520W/);
  // E10 不应触发（瓦数够）
  expectNotTriggered(res, 'E10');
});

test('W2 散热压不住 CPU —— 正反例', () => {
  const b = compatibleBuild();
  // 基准：CPU 162W vs 散热 245W → 不报
  expectNotTriggered(run(b.items, b.config), 'W2');

  const cpu = makeCpu({ id: 'cpu-hot', name: 'i9-14900K', maxPower: 253 });
  const cooler = makeCooler({ id: 'cooler-weak', name: '小风冷', tdpRating: 120 });
  const items = [cpu, cooler];
  const f = expectTriggered(run(items, { cpu: cpu.id, cooler: cooler.id }), 'W2');
  assert.match(f.reason, /120W/);
  assert.match(f.reason, /253W/);
});

test('W3 内存频率超主板上限 —— 正反例', () => {
  const b = compatibleBuild();
  expectNotTriggered(run(b.items, b.config), 'W3');

  const mb = makeMb({ id: 'mb-3466', maxMemorySpeed: 3466 });
  const mem = makeMem({ id: 'mem-3600', name: 'DDR4-3600', speed: 3600, memoryType: 'DDR5' });
  const cpu = makeCpu({ id: 'cpu-a' });
  const items = [cpu, mb, mem];
  const f = expectTriggered(run(items, { cpu: cpu.id, motherboard: mb.id, memory: mem.id }), 'W3');
  assert.match(f.reason, /3600 MT\/s/);
  assert.match(f.reason, /3466 MT\/s/);
});

test('W4 内存频率超 CPU 官方支持 —— 正反例', () => {
  const b = compatibleBuild();
  expectNotTriggered(run(b.items, b.config), 'W4');

  const cpu = makeCpu({ id: 'cpu-3200', maxMemorySpeed: 3200, memoryTypes: ['DDR4'] });
  const mb = makeMb({ id: 'mb-d4', memoryType: 'DDR4', maxMemorySpeed: 4000 });
  const mem = makeMem({ id: 'mem-3600', speed: 3600, memoryType: 'DDR4' });
  const items = [cpu, mb, mem];
  const res = run(items, { cpu: cpu.id, motherboard: mb.id, memory: mem.id });
  const f = expectTriggered(res, 'W4');
  assert.match(f.reason, /3600 MT\/s/);
  assert.match(f.reason, /3200 MT\/s/);
  // 主板支持 4000，故 W3 不应触发
  expectNotTriggered(res, 'W3');
});

test('W5 老芯片组需刷 BIOS —— 正反例（B450+Ryzen5000）', () => {
  const b = compatibleBuild();
  expectNotTriggered(run(b.items, b.config), 'W5');

  // B450 + Ryzen 5000
  const cpu = makeCpu({ id: 'cpu-5600', name: 'Ryzen 5 5600', socket: 'AM4', memoryTypes: ['DDR4'], maxMemorySpeed: 3200 });
  const mb = makeMb({ id: 'mb-b450', name: '微星 B450M 迫击炮', socket: 'AM4', chipset: 'B450', memoryType: 'DDR4', maxMemorySpeed: 3466, biosFlashback: false });
  const items = [cpu, mb];
  const f = expectTriggered(run(items, { cpu: cpu.id, motherboard: mb.id }), 'W5');
  assert.match(f.reason, /B450/, '应说明芯片组');
  assert.match(f.reason, /Ryzen 5000/, '应说明 CPU 代际');
  assert.match(f.advice, /旧 CPU|商家/, '未支持免 CPU 刷 BIOS 时应给出手工方案');

  // 支持 biosFlashback 时建议应不同
  const mb2 = makeMb({ id: 'mb-b450-fb', socket: 'AM4', chipset: 'B450', memoryType: 'DDR4', biosFlashback: true });
  const f2 = expectTriggered(run([cpu, mb2], { cpu: cpu.id, motherboard: mb2.id }), 'W5');
  assert.match(f2.advice, /无 CPU 刷 BIOS/, '支持免 CPU 刷写时应提示该便利');
});

test('W5 芯片组代际识别正确（cpuGeneration）', () => {
  assert.equal(cpuGeneration({ name: 'Ryzen 5 5600', socket: 'AM4' }), 'Ryzen 5000');
  assert.equal(cpuGeneration({ name: 'Ryzen 7 7800X3D', socket: 'AM5' }), 'Ryzen 7000');
  assert.equal(cpuGeneration({ name: 'Ryzen 7 9800X3D', socket: 'AM5' }), 'Ryzen 9000');
  assert.equal(cpuGeneration({ name: 'Intel i5-14600KF' }), 'Intel 14');
  assert.equal(cpuGeneration({ name: 'Intel i5-13400F' }), 'Intel 13');
  assert.equal(cpuGeneration({ name: 'Intel i5-12400F' }), 'Intel 12');
  assert.equal(cpuGeneration({ name: 'Intel i5-10400F' }), 'Intel 10');
  assert.equal(cpuGeneration({ name: 'Xeon E5-2680v4' }), 'Xeon');
  assert.equal(cpuGeneration({ name: '未知型号' }), null);
});

test('W6 显卡 PCIe 高于主板 —— 正反例', () => {
  const b = compatibleBuild();
  // 基准：GPU PCIe 4 vs 主板 4 → 不报
  expectNotTriggered(run(b.items, b.config), 'W6');

  const gpu = makeGpu({ id: 'gpu-p5', pcieVersion: 5 });
  const mb = makeMb({ id: 'mb-p3', pcieVersion: 3 });
  const cpu = makeCpu({ id: 'cpu-a' });
  const items = [cpu, gpu, mb];
  const f = expectTriggered(run(items, { cpu: cpu.id, gpu: gpu.id, motherboard: mb.id }), 'W6');
  assert.match(f.reason, /PCIe 5\.0/);
  assert.match(f.reason, /PCIe 3\.0/);
});

test('W7 单条内存未组双通道 —— 正反例', () => {
  const b = compatibleBuild();
  // 基准 2 条 → 不报
  expectNotTriggered(run(b.items, b.config), 'W7');

  const mem = makeMem({ id: 'mem-1x', modules: 1, name: '单条 16G' });
  const cpu = makeCpu({ id: 'cpu-a' });
  const mb = makeMb({ id: 'mb-a' });
  const items = [cpu, mb, mem];
  const f = expectTriggered(run(items, { cpu: cpu.id, motherboard: mb.id, memory: mem.id }), 'W7');
  assert.match(f.reason, /只有 1 条/);
  assert.match(f.reason, /双通道/);
});

test('W8 高功耗配置风扇位不足 —— 正反例', () => {
  const b = compatibleBuild();
  // 基准峰值 438W > 400 阈值，但机箱有 7 个风扇位 → 不报
  expectNotTriggered(run(b.items, b.config), 'W8');

  // 造出「高功耗 + 风扇位少」：CPU 253W + 显卡 220W + 主板 40W + 风扇 10W = 523W
  const cpu = makeCpu({ id: 'cpu-big', maxPower: 253 });
  const mb = makeMb({ id: 'mb-big' });
  const gpu = makeGpu({ id: 'gpu-big', tdp: 220 });
  const kase = makeCase({ id: 'case-1fan', fanMounts: 1 });
  const items = [cpu, mb, gpu, kase];
  const res = run(items, { cpu: cpu.id, motherboard: mb.id, gpu: gpu.id, case: kase.id });
  const f = expectTriggered(res, 'W8');
  assert.match(f.reason, /风扇位/);
  assert.match(f.reason, /523W/, '应报出峰值功耗');

  // 低功耗配置即使风扇位少也不报（峰值 35+40+10 = 85W < 400W）
  const cpuLow = makeCpu({ id: 'cpu-low', maxPower: 35 });
  const items2 = [cpuLow, mb, kase];
  expectNotTriggered(run(items2, { cpu: cpuLow.id, motherboard: mb.id, case: kase.id }), 'W8');

  // 高功耗但风扇位够 → 不报
  const kaseGood = makeCase({ id: 'case-good', fanMounts: 6 });
  const items3 = [cpu, mb, gpu, kaseGood];
  expectNotTriggered(
    run(items3, { cpu: cpu.id, motherboard: mb.id, gpu: gpu.id, case: kaseGood.id }),
    'W8',
  );
});

test('W9 水冷与高马甲内存冲突 —— 正反例；风冷不受此规则', () => {
  const b = compatibleBuild();
  expectNotTriggered(run(b.items, b.config), 'W9');

  const aio = makeAio({ id: 'aio-a', ramClearance_mm: 40, radiatorSize: 240 });
  const mem = makeMem({ id: 'mem-tall', name: '高马甲内存', height_mm: 53 });
  const cpu = makeCpu({ id: 'cpu-a' });
  const items = [cpu, aio, mem];
  const f = expectTriggered(run(items, { cpu: cpu.id, cooler: aio.id, memory: mem.id }), 'W9');
  assert.match(f.reason, /40mm/);
  assert.match(f.reason, /53mm/);

  // 风冷不触发 W9（风冷由 E7 高度与安装位置决定，规则仅针对水冷）
  const air = makeCooler({ id: 'c-air', ramClearance_mm: 32, height_mm: 155 });
  const items2 = [cpu, air, mem];
  expectNotTriggered(run(items2, { cpu: cpu.id, cooler: air.id, memory: mem.id }), 'W9');
});

test('W10 主板供电相数偏弱 —— 正反例', () => {
  const b = compatibleBuild();
  expectNotTriggered(run(b.items, b.config), 'W10');

  const cpu = makeCpu({ id: 'cpu-big', maxPower: 253 });
  const mb = makeMb({ id: 'mb-weak', vrmPhases: 4 });
  const items = [cpu, mb];
  const f = expectTriggered(run(items, { cpu: cpu.id, motherboard: mb.id }), 'W10');
  assert.match(f.reason, /253W/);
  assert.match(f.reason, /4 相/);

  // CPU 功耗不高时不报
  const cpuLow = makeCpu({ id: 'cpu-low', maxPower: 65 });
  expectNotTriggered(run([cpuLow, mb], { cpu: cpuLow.id, motherboard: mb.id }), 'W10');
});

test('W11 无 DRAM/QLC 做系统盘 —— 正反例', () => {
  const b = compatibleBuild();
  expectNotTriggered(run(b.items, b.config), 'W11');

  // 无 DRAM
  const s1 = makeStorage({ id: 'ssd-nodram', name: '无缓存盘', dram: false });
  const cpu = makeCpu({ id: 'cpu-a' });
  const mb = makeMb({ id: 'mb-a' });
  const f1 = expectTriggered(run([cpu, mb, s1], { cpu: cpu.id, motherboard: mb.id, storage: [s1.id] }), 'W11');
  assert.match(f1.reason, /无独立 DRAM 缓存/);

  // QLC
  const s2 = makeStorage({ id: 'ssd-qlc', name: 'QLC 盘', nandType: 'QLC' });
  const f2 = expectTriggered(run([cpu, mb, s2], { cpu: cpu.id, motherboard: mb.id, storage: [s2.id] }), 'W11');
  assert.match(f2.reason, /QLC/);

  // 两者都有
  const s3 = makeStorage({ id: 'ssd-bad', name: '低端盘', dram: false, nandType: 'QLC' });
  const f3 = expectTriggered(run([cpu, mb, s3], { cpu: cpu.id, motherboard: mb.id, storage: [s3.id] }), 'W11');
  assert.match(f3.reason, /无独立 DRAM 缓存且使用 QLC 颗粒/);
});

// ══════════════════════════════════════════════════════════════════
// I1 ~ I4：提示级
// ══════════════════════════════════════════════════════════════════

test('I1 电源余量过大 —— 正反例（>50% 才报）', () => {
  const b = compatibleBuild();
  // 基准 650W，峰值 438W，余量 32.6% → 不报
  expectNotTriggered(run(b.items, b.config), 'I1');

  const cpu = makeCpu({ id: 'cpu-a' });
  const mb = makeMb({ id: 'mb-a' });
  const psu = makePsu({ id: 'psu-1000', name: '1000W', wattage: 1000 });
  const items = [cpu, mb, psu];
  // 峰值 = 162+40+10 = 212W，余量 78.8%
  const f = expectTriggered(run(items, { cpu: cpu.id, motherboard: mb.id, psu: psu.id }), 'I1', { level: 'info' });
  assert.match(f.reason, /212W/);
  assert.match(f.reason, /1000W/);
});

test('I2 升级空间评估 —— 有剩余时给出提示', () => {
  const b = compatibleBuild();
  // 基准：4 槽只插 2 条、2 个 M.2 只用 1 个 → 应报
  const f = expectTriggered(run(b.items, b.config), 'I2', { level: 'info' });
  assert.match(f.reason, /内存还能加 2 条/);
  assert.match(f.reason, /M\.2 还能加 1 个/);

  // 全部插满则不应提示"还能加"
  const mb = makeMb({ id: 'mb-full', memorySlots: 2, m2Slots: 1 });
  const mem = makeMem({ id: 'mem-2x', modules: 2 });
  const ssd = makeStorage({ id: 'ssd-1' });
  const cpu = makeCpu({ id: 'cpu-a' });
  const res = run([cpu, mb, mem, ssd], { cpu: cpu.id, motherboard: mb.id, memory: mem.id, storage: [ssd.id] });
  const f2 = res.findings.find((x) => x.id === 'I2');
  assert.ok(f2, 'I2 应仍触发以告知插满状态');
  assert.match(f2.reason, /内存插槽已插满/);
  assert.match(f2.reason, /M\.2 接口已用满/);
});

test('I3 平台生命周期末期提示 —— 正反例', () => {
  const b = compatibleBuild();
  // 基准 AM5 → 不报
  expectNotTriggered(run(b.items, b.config), 'I3');

  const cpu = makeCpu({ id: 'cpu-am4', name: 'Ryzen 5 5600', socket: 'AM4' });
  const mb = makeMb({ id: 'mb-am4', socket: 'AM4', chipset: 'B550', memoryType: 'DDR4' });
  const items = [cpu, mb];
  const f = expectTriggered(run(items, { cpu: cpu.id, motherboard: mb.id }), 'I3', { level: 'info' });
  assert.match(f.reason, /AM4/);
});

test('I4 二手/矿卡/洋垃圾标记 —— 正反例', () => {
  const b = compatibleBuild();
  // 全新型号 → 不报
  expectNotTriggered(run(b.items, b.config), 'I4');

  const gpu = makeGpu({ id: 'gpu-mining', name: 'RX 5700XT', condition: 'mining' });
  const cpu = makeCpu({ id: 'cpu-oem', name: 'Xeon E5-2680v4', condition: 'oem' });
  const mb = makeMb({ id: 'mb-a' });
  const items = [cpu, gpu, mb];
  const res = run(items, { cpu: cpu.id, gpu: gpu.id, motherboard: mb.id });
  const f = expectTriggered(res, 'I4');
  assert.match(f.reason, /矿卡/);
  assert.match(f.reason, /洋垃圾/);
  assert.match(f.reason, /2 件/);
});

// ══════════════════════════════════════════════════════════════════
// 覆盖度自检：确保 32 条都被正反例覆盖
// ══════════════════════════════════════════════════════════════════

test('覆盖度：32 条规则都在本文件中被显式测试（正例或反例）', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, 'rules.test.mjs'), 'utf8');

  const missing = [];
  for (const r of RULES) {
    // 查找 `'E1 ` 或 `"E1 ` 形式的规则编号在测试标题中出现
    const re = new RegExp(`['"\`]${r.id}\\s`);
    if (!re.test(src)) missing.push(r.id);
  }
  assert.deepEqual(missing, [], `以下规则没有专门的测试用例: ${missing.join(', ')}`);
});
