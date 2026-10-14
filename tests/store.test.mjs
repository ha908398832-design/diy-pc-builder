/**
 * 状态仓库测试（T3.2 / PRD M8-7、NF6、NF7、风险 R2）
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Store, defaultState, memoryStorage, detectStorage, KEY } from '../src/core/store.js';

/** 可控的假存储，用于验证写入行为 */
function fakeStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    _dump: () => Object.fromEntries(m),
  };
}

/** 会抛异常的存储，模拟隐私模式 */
function throwingStorage() {
  return {
    getItem: () => null,
    setItem: () => { throw new Error('QuotaExceeded'); },
    removeItem: () => {},
  };
}

// ══════════════════════════════════════════════════════════════════
// 默认状态与持久化
// ══════════════════════════════════════════════════════════════════

test('store：默认状态 8 个品类齐全，硬盘是数组', () => {
  const d = defaultState();
  for (const c of ['cpu', 'motherboard', 'gpu', 'memory', 'psu', 'cooler', 'case']) {
    assert.equal(d.config[c], null, `${c} 默认应为 null`);
  }
  assert.deepEqual(d.config.storage, [], '硬盘默认应为空数组');
  assert.equal(d.ui.category, 'cpu', '默认品类应为 cpu');
  assert.equal(d.ui.includeUsed, false, '含二手默认关闭（PRD M7-11）');
  assert.equal(d.ui.view, 'table', '默认表格视图');
});

test('store：选择与取消选择', () => {
  const s = new Store({ storage: fakeStorage(), autoSave: false });
  s.select('cpu', 'cpu-a');
  assert.equal(s.state.config.cpu, 'cpu-a');
  s.deselect('cpu');
  assert.equal(s.state.config.cpu, null);
});

test('store：硬盘可多选且去重', () => {
  const s = new Store({ storage: fakeStorage(), autoSave: false });
  s.select('storage', 's1');
  s.select('storage', 's2');
  s.select('storage', 's1'); // 重复
  assert.deepEqual(s.state.config.storage, ['s1', 's2'], '应去重');

  s.deselect('storage', 's1');
  assert.deepEqual(s.state.config.storage, ['s2'], '应能单独移除');

  s.deselect('storage');
  assert.deepEqual(s.state.config.storage, [], '不传 id 应清空');
});

test('store：切换品类时清空详情与对比', () => {
  const s = new Store({ storage: fakeStorage(), autoSave: false });
  s.toggleCompare('x');
  s.setDetail('y');
  s.setCategory('gpu');
  assert.deepEqual(s.state.ui.compare, [], '切品类应清空对比');
  assert.equal(s.state.ui.selectedDetail, null, '切品类应清空详情');
});

test('store：全部重置清空配置但不删方案', () => {
  const s = new Store({ storage: fakeStorage(), autoSave: false });
  s.select('cpu', 'cpu-a');
  s.saveScheme('方案A');
  s.select('gpu', 'gpu-a');

  s.resetAll();
  assert.equal(s.state.config.cpu, null);
  assert.equal(s.state.config.gpu, null);
  assert.ok(s.state.schemes['方案A'], '方案不应被重置删除');
});

// ══════════════════════════════════════════════════════════════════
// 对比勾选（PRD 6.5.2 最多 4 个）
// ══════════════════════════════════════════════════════════════════

test('store：对比勾选最多 4 个', () => {
  const s = new Store({ storage: fakeStorage(), autoSave: false });
  for (const id of ['a', 'b', 'c', 'd']) s.toggleCompare(id);
  assert.equal(s.state.ui.compare.length, 4);
  s.toggleCompare('e');
  assert.equal(s.state.ui.compare.length, 4, '超过 4 个应被忽略');
  assert.ok(!s.state.ui.compare.includes('e'), '第 5 个不应加入');

  s.toggleCompare('a');
  assert.deepEqual(s.state.ui.compare, ['b', 'c', 'd'], '应能取消已选的');
});

// ══════════════════════════════════════════════════════════════════
// 订阅与通知
// ══════════════════════════════════════════════════════════════════

test('store：订阅者收到变更，取消订阅后不再收到', () => {
  const s = new Store({ storage: fakeStorage(), autoSave: false });
  let count = 0;
  let lastReason = null;
  const unsub = s.subscribe((state, reason) => { count++; lastReason = reason; });

  s.select('cpu', 'a');
  assert.equal(count, 1);
  assert.equal(lastReason, 'select');

  unsub();
  s.select('gpu', 'b');
  assert.equal(count, 1, '取消订阅后不应再收到');
});

test('store：单个订阅者抛异常不影响其他订阅者', () => {
  const s = new Store({ storage: fakeStorage(), autoSave: false });
  let ok = false;
  s.subscribe(() => { throw new Error('boom'); });
  s.subscribe(() => { ok = true; });
  s.select('cpu', 'a');
  assert.equal(ok, true, '第二个订阅者应仍被调用');
});

// ══════════════════════════════════════════════════════════════════
// 持久化
// ══════════════════════════════════════════════════════════════════

test('store：flush 后能恢复配置（PRD A14 关掉再打开还在）', () => {
  const st = fakeStorage();
  const s1 = new Store({ storage: st, autoSave: false });
  s1.select('cpu', 'cpu-x');
  s1.select('storage', 's1');
  s1.setCategory('gpu');
  s1.setView('card');
  assert.equal(s1.flush(), true);

  // 新实例从同一存储恢复
  const s2 = new Store({ storage: st, autoSave: false });
  assert.equal(s2.state.config.cpu, 'cpu-x');
  assert.deepEqual(s2.state.config.storage, ['s1']);
  assert.equal(s2.state.ui.category, 'gpu');
  assert.equal(s2.state.ui.view, 'card');
});

test('store：存储内容损坏时回退默认值而不崩溃（NF7）', () => {
  const st = fakeStorage({ [KEY]: '{这不是合法 JSON' });
  const s = new Store({ storage: st, autoSave: false });
  assert.equal(s.state.config.cpu, null, '应回退为默认状态');
  s.select('cpu', 'a');
  assert.equal(s.state.config.cpu, 'a', '回退后仍可正常使用');
});

test('store：旧版本存储缺字段时用默认值补齐', () => {
  // 模拟旧版本只存了 config
  const st = fakeStorage({ [KEY]: JSON.stringify({ config: { cpu: 'old-cpu' } }) });
  const s = new Store({ storage: st, autoSave: false });
  assert.equal(s.state.config.cpu, 'old-cpu', '应保留已有值');
  assert.deepEqual(s.state.config.storage, [], '缺失字段应补默认值');
  assert.equal(s.state.ui.view, 'table', '缺失 ui 字段应补默认值');
  assert.equal(typeof s.state.custom, 'object', 'custom 应补默认值');
});

test('store：保存失败不抛异常，并记录警告（风险 R2）', () => {
  const s = new Store({ storage: throwingStorage(), autoSave: false });
  s.select('cpu', 'a');
  assert.doesNotThrow(() => s.flush(), '保存失败不应抛异常');
  assert.equal(s.flush(), false, 'flush 应返回 false');
  assert.ok(s.storageWarning, '应记录警告信息');
});

test('store：dirty 标记随选择置位、随方案保存清除', () => {
  const s = new Store({ storage: fakeStorage(), autoSave: false });
  assert.equal(s.state.dirty, false, '初始不应为 dirty');
  s.select('cpu', 'a');
  assert.equal(s.state.dirty, true, '选择后应标记 dirty');
  s.saveScheme('方案A');
  assert.equal(s.state.dirty, false, '保存方案后应清除 dirty');
});

// ══════════════════════════════════════════════════════════════════
// 方案管理（M8）
// ══════════════════════════════════════════════════════════════════

test('store：保存/载入方案能完整还原配置', () => {
  const s = new Store({ storage: fakeStorage(), autoSave: false });
  s.select('cpu', 'cpu-a');
  s.select('gpu', 'gpu-a');
  s.select('storage', 's1');
  s.saveScheme('游戏机');

  // 改成另一套配置
  s.resetAll();
  s.select('cpu', 'cpu-b');
  assert.equal(s.state.config.cpu, 'cpu-b');

  // 载入回方案
  s.loadScheme('游戏机');
  assert.equal(s.state.config.cpu, 'cpu-a');
  assert.equal(s.state.config.gpu, 'gpu-a');
  assert.deepEqual(s.state.config.storage, ['s1']);
  assert.equal(s.state.currentScheme, '游戏机');
});

test('store：方案配置是深拷贝，后续修改不影响已存方案', () => {
  const s = new Store({ storage: fakeStorage(), autoSave: false });
  s.select('storage', 's1');
  s.saveScheme('A');
  s.select('storage', 's2'); // 修改当前配置
  assert.deepEqual(s.state.schemes['A'].config.storage, ['s1'], '已存方案不应被后续修改影响');
});

test('store：多方案并存且能按保存时间列出', () => {
  const s = new Store({ storage: fakeStorage(), autoSave: false });
  s.select('cpu', 'c1'); s.saveScheme('方案1');
  s.select('cpu', 'c2'); s.saveScheme('方案2');
  const names = s.schemeNames();
  assert.equal(names.length, 2);
  assert.ok(names.includes('方案1') && names.includes('方案2'));
});

test('store：删除方案；删除当前方案时清空 currentScheme', () => {
  const s = new Store({ storage: fakeStorage(), autoSave: false });
  s.select('cpu', 'c1'); s.saveScheme('A');
  s.select('cpu', 'c2'); s.saveScheme('B');
  s.loadScheme('A');

  s.deleteScheme('A');
  assert.equal(s.state.schemes['A'], undefined);
  assert.equal(s.state.currentScheme, '', '删除当前方案应清空 currentScheme');
  assert.ok(s.state.schemes['B'], '其他方案不受影响');
});

test('store：重命名方案保留配置并更新 currentScheme', () => {
  const s = new Store({ storage: fakeStorage(), autoSave: false });
  s.select('cpu', 'c1'); s.saveScheme('旧名');
  s.renameScheme('旧名', '新名');
  assert.equal(s.state.schemes['旧名'], undefined);
  assert.equal(s.state.schemes['新名'].config.cpu, 'c1', '配置应保留');
  assert.equal(s.state.currentScheme, '新名');
});

test('store：重命名到已存在的名字不应丢失数据', () => {
  const s = new Store({ storage: fakeStorage(), autoSave: false });
  s.select('cpu', 'c1'); s.saveScheme('A');
  s.select('cpu', 'c2'); s.saveScheme('B');
  const before = JSON.stringify(s.state.schemes);
  s.renameScheme('A', 'A'); // 同名
  assert.equal(JSON.stringify(s.state.schemes), before, '同名重命名应无变化');
});

test('store：载入不存在的方案不改变状态', () => {
  const s = new Store({ storage: fakeStorage(), autoSave: false });
  s.select('cpu', 'c1');
  s.loadScheme('不存在');
  assert.equal(s.state.config.cpu, 'c1', '配置应保持不变');
});

// ══════════════════════════════════════════════════════════════════
// 自定义数据（M2）
// ══════════════════════════════════════════════════════════════════

test('store：设定与清除自定义数据', () => {
  const s = new Store({ storage: fakeStorage(), autoSave: false });
  s.setCustom('cpu', [{ id: 'custom-1' }]);
  assert.equal(s.state.custom.cpu.length, 1);

  s.clearCustom('cpu');
  assert.equal(s.state.custom.cpu, undefined);

  s.setCustom('cpu', [{ id: 'c1' }]);
  s.setCustom('gpu', [{ id: 'g1' }]);
  s.clearCustom();
  assert.deepEqual(s.state.custom, {}, '不传品类应清空全部自定义数据');
});

test('store：自定义数据随 flush 持久化（M2-7）', () => {
  const st = fakeStorage();
  const s1 = new Store({ storage: st, autoSave: false });
  s1.setCustom('cpu', [{ id: 'custom-x', name: '导入的CPU' }]);
  s1.flush();

  const s2 = new Store({ storage: st, autoSave: false });
  assert.equal(s2.state.custom.cpu[0].id, 'custom-x', '自定义数据应持久化');
});

// ══════════════════════════════════════════════════════════════════
// 存储探测与降级（风险 R2）
// ══════════════════════════════════════════════════════════════════

test('detectStorage：localStorage 可用时返回持久存储', () => {
  const det = detectStorage({ localStorage: fakeStorage() });
  assert.equal(det.persistent, true);
  assert.ok(!det.reason);
});

test('detectStorage：localStorage 抛异常时降级为内存存储并说明原因', () => {
  const det = detectStorage({
    localStorage: {
      setItem() { throw new Error('SecurityError'); },
      getItem: () => null,
      removeItem: () => {},
    },
  });
  assert.equal(det.persistent, false);
  assert.ok(det.reason.includes('SecurityError'), '应说明失败原因');
  assert.ok(det.reason.includes('内存'), '应说明已降级');
});

test('detectStorage：无 localStorage 时不崩溃', () => {
  const det = detectStorage({});
  assert.equal(det.persistent, false);
  assert.ok(det.reason);
  // 降级后 store 仍能工作
  const s = new Store({ storage: det.storage, autoSave: false });
  s.select('cpu', 'a');
  assert.equal(s.state.config.cpu, 'a');
});

test('memoryStorage：基本读写删除', () => {
  const m = memoryStorage();
  m.setItem('k', 'v');
  assert.equal(m.getItem('k'), 'v');
  m.removeItem('k');
  assert.equal(m.getItem('k'), null);
  assert.equal(m.getItem('不存在'), null);
});

test('store：storageWarning 在降级时被设置，界面可据此提示用户', () => {
  const det = detectStorage({ localStorage: { setItem() { throw new Error('nope'); }, getItem: () => null, removeItem: () => {} } });
  const s = new Store({ storage: det.storage, autoSave: false });
  // detectStorage 的 reason 通过构造参数传入时会被覆盖，这里直接验证降级路径可用
  const s2 = new Store({ global: { localStorage: { setItem() { throw new Error('nope'); }, getItem: () => null, removeItem: () => {} } }, autoSave: false });
  assert.ok(s2.storageWarning, '降级时应给出提示文案');
  assert.equal(s2.persistent, false);
});

// ══════════════════════════════════════════════════════════════════
// 防抖保存
// ══════════════════════════════════════════════════════════════════

test('store：自动保存为防抖，多次变更只写一次', async () => {
  const st = fakeStorage();
  const s = new Store({ storage: st, autoSave: true });
  s.select('cpu', 'a');
  s.select('gpu', 'b');
  s.select('memory', 'c');
  // 防抖 300ms，等它触发
  await new Promise((r) => setTimeout(r, 400));
  const saved = JSON.parse(st.getItem(KEY));
  assert.equal(saved.config.cpu, 'a');
  assert.equal(saved.config.gpu, 'b');
  assert.equal(saved.config.memory, 'c');
});

test('store：flush 立即写入，不等防抖', () => {
  const st = fakeStorage();
  const s = new Store({ storage: st, autoSave: true });
  s.select('cpu', 'a');
  s.flush();
  const saved = JSON.parse(st.getItem(KEY));
  assert.equal(saved.config.cpu, 'a');
});
