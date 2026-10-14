/**
 * 旧版本数据兼容性测试（数据/枚举变更后，用户已保存的配置与新版本的关系）
 *
 * 背景：v1.2 大规模调整了数据（新增 176 个型号、改动枚举与 minCount）。
 * 用户升级后浏览器里还留着**旧版本保存的配置**（localStorage），
 * 其中可能引用：
 *   · 已被删除或改名的型号 ID
 *   · 已不存在的枚举值
 *   · 旧版本存储结构里缺少的字段
 * 本文件确保这些情况都不会导致崩溃或误导性显示。
 *
 * 注意：本项目从未删除过型号（数据只增不减），但**用户自己用 CSV 导入的
 * 自定义数据可能被清除**，或用户手动清过 localStorage 的一部分，
 * 所以「引用了不存在的 ID」是真实可能发生的场景。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Store, defaultState, KEY } from '../src/core/store.js';
import { checkCompatibility, resolveConfig } from '../src/core/rules.js';
import { computeStatusLights, selectionSummary } from '../src/core/status.js';
import { queryList } from '../src/core/search.js';
import { CATEGORY_LIST, CATEGORY_FIELDS } from '../schema/fields.js';
import { ENUMS, CATEGORY_ORDER } from '../src/core/enums.js';

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

function memStorage(initial = null) {
  const m = new Map();
  if (initial !== null) m.set(KEY, typeof initial === 'string' ? initial : JSON.stringify(initial));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _get: () => (m.has(KEY) ? m.get(KEY) : null),
  };
}

// ══════════════════════════════════════════════════════════════════
// 1. 存储结构兼容（旧版本字段缺失 / 多出字段）
// ══════════════════════════════════════════════════════════════════

test('旧数据：只存了 config 的旧结构能被补全默认值', () => {
  const s = new Store({
    storage: memStorage({ config: { cpu: 'cpu-old' } }),
    autoSave: false,
  });
  assert.equal(s.state.config.cpu, 'cpu-old', '已有值应保留');
  assert.deepEqual(s.state.config.storage, [], '缺失的 storage 应补空数组');
  assert.equal(s.state.ui.category, 'cpu', '缺失的 ui 应补默认值');
  assert.equal(s.state.ui.includeUsed, false, '缺失的 includeUsed 应补默认值');
  assert.equal(typeof s.state.custom, 'object', 'custom 应补默认值');
  assert.equal(typeof s.state.schemes, 'object', 'schemes 应补默认值');
});

test('旧数据：多出未知字段不影响加载', () => {
  const s = new Store({
    storage: memStorage({
      config: { cpu: 'cpu-a' },
      ui: { category: 'cpu' },
      unknownField: { foo: 1 },
      ui2: 'x',
    }),
    autoSave: false,
  });
  assert.equal(s.state.config.cpu, 'cpu-a');
  assert.doesNotThrow(() => s.update((st) => { st.dirty = true; }, 't'));
});

test('旧数据：存储内容非法 JSON 时回退默认值而不崩溃', () => {
  const s = new Store({ storage: memStorage('{不是合法 JSON'), autoSave: false });
  assert.deepEqual(s.state.config, defaultState().config);
});

test('旧数据：存储是 null / 空字符串 / 数组时都不崩溃', () => {
  for (const bad of [null, '', '[]', 'null', '0', '"str"']) {
    const s = new Store({ storage: memStorage(bad), autoSave: false });
    assert.ok(s.state && s.state.config, `输入 ${JSON.stringify(bad)} 时应得到可用状态`);
  }
});

test('旧数据：config 字段类型异常（字符串而非数组）时不崩溃', () => {
  const s = new Store({
    storage: memStorage({ config: { storage: 'not-an-array', cpu: 123 } }),
    autoSave: false,
  });
  // 不应抛异常
  assert.doesNotThrow(() => selectionSummary(s.state.config));
  assert.doesNotThrow(() => computeStatusLights({ findings: [], config: s.state.config }));
});

// ══════════════════════════════════════════════════════════════════
// 2. 引用了不存在的型号 ID（核心风险场景）
// ══════════════════════════════════════════════════════════════════

test('失效 ID：rules 解析时被安全丢弃，不崩溃', () => {
  const byId = indexAll();
  const config = {
    cpu: 'cpu-已被删除的型号',
    motherboard: 'motherboard-不存在',
    storage: ['storage-不存在', 'storage-也不存在'],
  };
  let resolved;
  assert.doesNotThrow(() => { resolved = resolveConfig(config, byId); });
  assert.equal(resolved.cpu, null, '失效 CPU 应解析为 null');
  assert.equal(resolved.motherboard, null, '失效主板应解析为 null');
  assert.deepEqual(resolved.storage, [], '失效硬盘应被过滤掉');
});

test('失效 ID：规则引擎照常返回结果（跳过相关规则），不报假错误', () => {
  const byId = indexAll();
  const config = { cpu: 'cpu-不存在', motherboard: 'mb-不存在' };
  const res = checkCompatibility({ config, byId });
  assert.ok(Array.isArray(res.findings), '应返回 findings 数组');
  assert.equal(res.checked + res.skipped, 32, 'checked+skipped 应恒为 32');
  assert.equal(res.findings.length, 0, '全部失效时不应产生任何 finding');
});

test('失效 ID：部分失效时只评估仍有效的部分，且不误报插槽类错误', { skip: !hasData && '无数据' }, () => {
  const byId = indexAll();
  const realCpu = DB.cpu[0];
  const config = {
    cpu: realCpu.id,              // 有效
    motherboard: 'mb-已删除',      // 失效
  };
  const res = checkCompatibility({ config, byId });
  assert.equal(res.checked + res.skipped, 32, 'checked+skipped 应恒为 32');
  // 关键：需要 CPU+主板 的规则必须被「跳过」而不是误报 E1
  const ids = res.findings.map((f) => f.id);
  assert.ok(!ids.includes('E1'), '主板失效时不应报 E1（应跳过该规则）');
  assert.ok(!ids.includes('E4'), '主板失效时不应报 E4');
  assert.ok(res.checked < 32, '应有规则被跳过');
  // 只有 CPU 有效时，可执行的规则很少（不需要其他配件的规则）
  assert.ok(res.checked <= 5, `检查数应很少，实际 ${res.checked}`);
});

test('失效 ID：状态灯不显示为绿色「正常」，而是 invalid（真实缺陷回归）', () => {
  const config = { cpu: 'cpu-不存在', motherboard: 'mb-不存在' };
  // 传入 resolved 后应能识别失效
  const resolved = { cpu: null, motherboard: null, gpu: null, memory: null, psu: null, cooler: null, case: null, storage: [] };
  const { lights, icons } = computeStatusLights({ findings: [], config, resolved });

  assert.equal(lights.cpu, 'invalid', '失效 CPU 不应显示为 ok（绿色）'); 
  assert.equal(lights.motherboard, 'invalid', '失效主板不应显示为 ok（绿色）');
  assert.equal(icons.cpu, '⚠️', '应有可辨识的失效图标');
  assert.notEqual(icons.cpu, '🟢', '绝不能是绿色正常');
});

test('失效 ID：未传 resolved 时保持向后兼容（旧调用方不受影响）', () => {
  const config = { cpu: 'cpu-x' };
  const { lights } = computeStatusLights({ findings: [], config });
  assert.equal(lights.cpu, 'ok', '不传 resolved 时按旧行为视为已选');
});

test('失效 ID：硬盘部分失效仍算已选（用户还能用剩下的）', () => {
  const config = { storage: ['ssd-gone', 'ssd-ok'] };
  const resolved = { storage: [{ id: 'ssd-ok' }] };
  const { lights } = computeStatusLights({ findings: [], config, resolved });
  assert.equal(lights.storage, 'ok', '还有有效硬盘时应算已选');
});

test('失效 ID：硬盘全部失效则标记 invalid', () => {
  const config = { storage: ['ssd-gone', 'ssd-gone2'] };
  const resolved = { storage: [] };
  const { lights } = computeStatusLights({ findings: [], config, resolved });
  assert.equal(lights.storage, 'invalid', '全部失效应标记 invalid');
});

test('失效 ID：Store 层面原样保留（不静默清除），但界面按未选呈现', () => {
  const s = new Store({
    storage: memStorage({ config: { cpu: 'cpu-已删除' } }),
    autoSave: false,
  });
  // 保留原值：用户可能只是暂时切了数据源，不应粗暴清空
  assert.equal(s.state.config.cpu, 'cpu-已删除', 'Store 不应静默改写用户配置');
  // 解析时拿不到对象
  const byId = indexAll();
  assert.equal(resolveConfig(s.state.config, byId).cpu, null, '解析时应为 null');
});

test('失效 ID：每次启动都跑一遍规则不崩溃（幂等）', () => {
  const byId = indexAll();
  const config = { cpu: 'x', motherboard: 'y', gpu: 'z', memory: 'w', psu: 'v', cooler: 'u', case: 't', storage: ['s'] };
  for (let i = 0; i < 5; i++) {
    const res = checkCompatibility({ config, byId });
    assert.ok(Array.isArray(res.findings));
  }
});

// ══════════════════════════════════════════════════════════════════
// 3. 方案里的失效 ID（升级后打开旧方案）
// ══════════════════════════════════════════════════════════════════

test('旧方案：含失效 ID 时仍能载入，不崩溃', () => {
  const storage = memStorage({
    schemes: {
      旧方案: {
        config: { cpu: 'cpu-已删除', gpu: 'gpu-已删除', storage: ['ssd-已删除'] },
        savedAt: 1700000000000,
      },
    },
    currentScheme: '旧方案',
  });
  const s = new Store({ storage, autoSave: false });
  assert.doesNotThrow(() => s.loadScheme('旧方案'));
  assert.equal(s.state.config.cpu, 'cpu-已删除', '应载入原始值，由解析层兜底');
});

test('旧方案：方案名列表与删除在含失效 ID 时仍正常', () => {
  const s = new Store({
    storage: memStorage({
      schemes: {
        A: { config: { cpu: 'cpu-gone' }, savedAt: 1 },
        B: { config: { cpu: 'cpu-gone-2' }, savedAt: 2 },
      },
    }),
    autoSave: false,
  });
  assert.equal(s.schemeNames().length, 2);
  assert.doesNotThrow(() => s.deleteScheme('A'));
  assert.equal(s.schemeNames().length, 1);
});

test('旧方案：对含失效 ID 的方案做兼容性评估不崩溃', { skip: !hasData && '无数据' }, () => {
  const byId = indexAll();
  const staleSchemes = [
    { cpu: 'cpu-gone', motherboard: 'mb-gone' },
    { cpu: DB.cpu[0].id, gpu: 'gpu-gone' },        // 部分有效
    { storage: ['ssd-gone', 'ssd-gone-2'] },
    {},
  ];
  for (const cfg of staleSchemes) {
    assert.doesNotThrow(() => {
      const res = checkCompatibility({ config: cfg, byId });
      assert.equal(res.checked + res.skipped, 32);
    }, `配置 ${JSON.stringify(cfg)} 不应导致崩溃`);
  }
});

// ══════════════════════════════════════════════════════════════════
// 4. 枚举变更的兼容性
// ══════════════════════════════════════════════════════════════════

test('枚举：v1.2 新增插槽后，仍包含 v1.1 的全部插槽（只增不减）', () => {
  // v1.1 时的插槽集合
  const v11 = ['AM4', 'AM5', 'LGA1200', 'LGA1700', 'LGA1851', 'LGA2011-3', 'LGA2066', 'LGA1151', 'LGA1150'];
  const missing = v11.filter((s) => !ENUMS.socket.includes(s));
  assert.deepEqual(missing, [], `旧插槽不应被移除: ${missing.join(', ')}`);
});

test('枚举：v1.2 新增插槽都在列表中', () => {
  const added = ['LGA1155', 'LGA1156', 'LGA1151-2', 'LGA1366', 'LGA2011', 'AM3+', 'FM2+'];
  const missing = added.filter((s) => !ENUMS.socket.includes(s));
  assert.deepEqual(missing, [], `新增插槽缺失: ${missing.join(', ')}`);
});

test('枚举：品类列表未变（旧配置的品类键仍有效）', () => {
  const expected = ['cpu', 'motherboard', 'gpu', 'memory', 'psu', 'case', 'cooler', 'storage'];
  assert.deepEqual([...CATEGORY_ORDER].sort(), [...expected].sort());
  for (const c of expected) {
    assert.ok(ENUMS.category.includes(c), `品类 ${c} 应仍存在`);
  }
});

test('枚举：condition 取值未变（旧数据的 condition 仍合法）', () => {
  for (const c of ['new', 'used', 'mining', 'oem']) {
    assert.ok(ENUMS.condition.includes(c), `condition ${c} 应仍存在`);
  }
});

test('枚举：busWidth 上限放宽后仍接受旧数据的常规取值', () => {
  // v1.1 上限 1024，v1.2 放宽到 8192 以容纳 HBM
  const busWidthField = (() => {
    const src = readFileSync(join(ROOT, 'schema', 'fields.js'), 'utf8');
    const m = src.match(/key: 'busWidth'[\s\S]{0,160}?max: (\d+)/);
    return m ? Number(m[1]) : null;
  })();
  assert.ok(busWidthField !== null, '应能读到 busWidth 的 max');
  assert.ok(busWidthField >= 1024, '上限不应低于 v1.1 的 1024（否则旧数据会越界）');
  assert.ok(busWidthField >= 2048, '上限应容纳 HBM2 的 2048bit');
});

// ══════════════════════════════════════════════════════════════════
// 4b. 失效引用的界面提示
// ══════════════════════════════════════════════════════════════════

test('失效提示：给出可操作说明，而不是只显示一个图标', async () => {
  const { renderStaleBanner } = await import('../src/ui/render.js');
  const html = renderStaleBanner(['cpu', 'gpu']);

  assert.ok(html.includes('⚠️'), '应有警示图标');
  assert.ok(html.includes('CPU') && html.includes('显卡'), '应指出是哪些品类失效');
  assert.ok(html.includes('找不到'), '应说明原因');
  assert.ok(html.includes('data-action="clear-stale"'), '应提供「清除失效项」动作');
  assert.ok(html.includes('data-action="dismiss-stale"'), '应提供「忽略」动作');
});

test('失效提示：无失效项时不渲染任何内容', async () => {
  const { renderStaleBanner } = await import('../src/ui/render.js');
  assert.equal(renderStaleBanner([]), '', '无失效项应返回空字符串');
  assert.equal(renderStaleBanner(), '', '不传参数也不应报错');
});

test('失效提示：左栏失效项显示「型号已失效」而非「未选」', async () => {
  const { renderLeftPanel } = await import('../src/ui/render.js');
  const html = renderLeftPanel({
    config: { cpu: 'cpu-已删除' },
    byId: new Map(),                 // 库里找不到
    lights: { cpu: 'invalid' },
    active: 'cpu',
    summary: { selected: 1, total: 8, unselected: 7 },
  });
  assert.ok(html.includes('型号已失效'), '应明确提示失效，而非含糊地显示「未选」');
  assert.ok(html.includes('is-invalid'), '应有样式类便于高亮');
  assert.ok(html.includes('⚠️'), '应显示警示图标');
  assert.ok(html.includes('重新选择'), 'title 中应给出处理建议');
});

test('失效提示：界面接线存在（app.js 处理清除与忽略动作）', () => {
  const src = readFileSync(join(ROOT, 'src', 'ui', 'app.js'), 'utf8');
  assert.ok(/case 'clear-stale'/.test(src), '应处理清除失效项');
  assert.ok(/case 'dismiss-stale'/.test(src), '应处理忽略');
  assert.ok(/renderStaleBanner/.test(src), '应引用失效提示渲染函数');
  assert.ok(/resolved,\s*\n?\s*\}\)/.test(src) || /computeStatusLights\(\{[\s\S]{0,200}resolved/.test(src),
    'computeStatusLights 应传入 resolved，否则识别不出失效引用');
});

test('失效提示：清除失效项只清失效的品类，保留有效配置', () => {
  const s = new Store({ storage: memStorage(), autoSave: false });
  // 模拟：CPU 有效引用、显卡失效引用
  s.update((st) => {
    st.config.cpu = 'cpu-有效';
    st.config.gpu = 'gpu-已失效';
  }, 'seed');

  // 模拟 app.js 的清除逻辑
  const stale = ['gpu'];
  s.update((st) => {
    for (const cat of stale) st.config[cat] = null;
  }, 'clear-stale');

  assert.equal(s.state.config.gpu, null, '失效项应被清除');
  assert.equal(s.state.config.cpu, 'cpu-有效', '有效配置必须保留');
});

test('失效提示：忽略后可持久化，不会每次都弹', () => {
  const storage = memStorage();
  const s1 = new Store({ storage, autoSave: false });
  s1.update((st) => { st.ui.staleDismissed = true; }, 'dismiss');
  s1.flush();

  const s2 = new Store({ storage, autoSave: false });
  assert.equal(s2.state.ui.staleDismissed, true, '忽略状态应持久化');
});

// ══════════════════════════════════════════════════════════════════
// 5. 自定义（CSV 导入）数据与内置数据的关系
// ══════════════════════════════════════════════════════════════════

test('自定义数据：清空后引用其 ID 的配置不崩溃（模拟用户删除了导入数据）', () => {
  const byId = indexAll(); // 只含内置数据
  const config = { cpu: 'cpu-我导入过的自定义型号' };
  assert.doesNotThrow(() => checkCompatibility({ config, byId }));
  const resolved = resolveConfig(config, byId);
  assert.equal(resolved.cpu, null);
});

test('自定义数据：与内置数据合并时同 ID 以自定义为准（升级后仍可覆盖）', () => {
  const s = new Store({ storage: memStorage(), autoSave: false });
  const custom = [{ id: 'cpu-xxx', name: '我的覆盖版', category: 'cpu', condition: 'new' }];
  s.setCustom('cpu', custom);
  assert.equal(s.state.custom.cpu[0].name, '我的覆盖版');
  // 内置数据未被修改
  if (hasData) {
    assert.ok(!DB.cpu.some((c) => c.name === '我的覆盖版'), '内置数据不应被写入');
  }
});

// ══════════════════════════════════════════════════════════════════
// 6. 数据规模变化后的行为（v1.1 的 300 → v1.2 的 476）
// ══════════════════════════════════════════════════════════════════

test('数据增长：搜索与筛选在扩大后的数据集上仍返回合理结果', { skip: !hasData && '无数据' }, () => {
  for (const cat of CATEGORY_LIST) {
    const list = DB[cat];
    const all = queryList({ list, category: cat, includeUsed: true });
    assert.ok(all.items.length > 0, `${cat} 应有结果`);
    assert.ok(all.matched <= all.total, `${cat} 匹配数不应超过总数`);

    const newOnly = queryList({ list, category: cat, includeUsed: false });
    assert.ok(newOnly.items.length > 0, `${cat} 仅全新也应有结果`);
    assert.ok(newOnly.items.length <= all.items.length, `${cat} 仅全新不应多于含二手`);
  }
});

test('数据增长：所有型号的 ID 仍唯一（升级不会造成重复项）', { skip: !hasData && '无数据' }, () => {
  const seen = new Map();
  const dupes = [];
  for (const [cat, list] of Object.entries(DB)) {
    for (const r of list) {
      if (seen.has(r.id)) dupes.push(`${r.id}（${seen.get(r.id)} 与 ${cat}）`);
      else seen.set(r.id, cat);
    }
  }
  assert.deepEqual(dupes, [], `存在重复 ID: ${dupes.join(', ')}`);
});

test('数据增长：枚举取值全部合法（新增数据未越界）', { skip: !hasData && '无数据' }, () => {
  const problems = [];
  for (const [cat, list] of Object.entries(DB)) {
    for (const r of list) {
      if (r.socket && !ENUMS.socket.includes(r.socket)) problems.push(`${r.id}.socket=${r.socket}`);
      if (cat === 'cooler' && r.type && !ENUMS.coolerType.includes(r.type)) problems.push(`${r.id}.type=${r.type}`);
      if (cat === 'memory' && r.memoryType && !ENUMS.memoryType.includes(r.memoryType)) problems.push(`${r.id}.memoryType=${r.memoryType}`);
      if (Array.isArray(r.sockets)) {
        for (const v of r.sockets) if (!ENUMS.socket.includes(v)) problems.push(`${r.id}.sockets含${v}`);
      }
      if (Array.isArray(r.memoryTypes)) {
        for (const v of r.memoryTypes) if (!ENUMS.memoryType.includes(v)) problems.push(`${r.id}.memoryTypes含${v}`);
      }
    }
  }
  assert.deepEqual(problems.slice(0, 10), [], `枚举越界: ${problems.slice(0, 10).join('; ')}`);
});
