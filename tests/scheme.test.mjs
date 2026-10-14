/**
 * 方案管理测试：删除 / 重命名 / 载入 / 列表展示
 *
 * 背景：store 层原本就实现了 deleteScheme / renameScheme，
 * 但界面从未暴露，导致用户无法删除方案（可用性问题）。
 * 本文件同时覆盖 store 逻辑与渲染输出，确保这次真的接到界面上了。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Store } from '../src/core/store.js';
import { renderSchemeManager, renderTopBar } from '../src/ui/render.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 内存存储，供测试注入 */
function memStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

function newStore() {
  return new Store({ storage: memStorage(), autoSave: false });
}

/** 造一套带方案的状态 */
function withSchemes() {
  const s = newStore();
  s.select('cpu', 'cpu-a');
  s.saveScheme('游戏机');
  s.select('cpu', 'cpu-b');
  s.select('gpu', 'gpu-b');
  s.saveScheme('剪辑机');
  return s;
}

// ══════════════════════════════════════════════════════════════════
// 删除（用户主要诉求）
// ══════════════════════════════════════════════════════════════════

test('方案删除：删除指定方案，其他方案保留', () => {
  const s = withSchemes();
  assert.equal(s.schemeNames().length, 2);

  s.deleteScheme('游戏机');

  const names = s.schemeNames();
  assert.equal(names.length, 1, '应只剩 1 套方案');
  assert.deepEqual(names, ['剪辑机'], '应保留未删除的那套');
  assert.equal(s.state.schemes['游戏机'], undefined, '被删方案应不存在');
});

test('方案删除：删除当前方案后清空 currentScheme，但当前配置不变', () => {
  const s = withSchemes();
  s.loadScheme('游戏机');
  assert.equal(s.state.currentScheme, '游戏机');
  const configBefore = JSON.stringify(s.state.config);

  s.deleteScheme('游戏机');

  assert.equal(s.state.currentScheme, '', '应清空 currentScheme');
  assert.equal(
    JSON.stringify(s.state.config), configBefore,
    '删除方案不应影响正在编辑的配置',
  );
});

test('方案删除：删除非当前方案不影响 currentScheme', () => {
  const s = withSchemes();
  s.loadScheme('剪辑机');
  s.deleteScheme('游戏机');
  assert.equal(s.state.currentScheme, '剪辑机', '不应误清 currentScheme');
});

test('方案删除：删除不存在的方案是安全的空操作', () => {
  const s = withSchemes();
  const before = JSON.stringify(s.state.schemes);
  assert.doesNotThrow(() => s.deleteScheme('不存在'));
  assert.equal(JSON.stringify(s.state.schemes), before, '状态不应改变');
});

test('方案删除：删除后持久化，重新载入不再出现（A14 一致性）', () => {
  const storage = memStorage();
  const s1 = new Store({ storage, autoSave: false });
  s1.select('cpu', 'cpu-a'); s1.saveScheme('要删的');
  s1.select('cpu', 'cpu-b'); s1.saveScheme('要留的');
  s1.deleteScheme('要删的');
  s1.flush();

  const s2 = new Store({ storage, autoSave: false });
  const names = s2.schemeNames();
  assert.deepEqual(names, ['要留的'], '删除结果应被持久化');
});

test('方案删除：全部删完后 schemeNames 为空且不报错', () => {
  const s = withSchemes();
  s.deleteScheme('游戏机');
  s.deleteScheme('剪辑机');
  assert.deepEqual(s.schemeNames(), []);
  assert.doesNotThrow(() => s.deleteScheme('游戏机'));
});

test('方案删除：删除时返回的 state 已更新', () => {
  const s = withSchemes();
  const ret = s.deleteScheme('游戏机');
  assert.equal(ret.schemes['游戏机'], undefined, '返回值应反映删除结果');
});

// ══════════════════════════════════════════════════════════════════
// 重命名
// ══════════════════════════════════════════════════════════════════

test('方案重命名：保留配置与保存时间', () => {
  const s = withSchemes();
  const savedAt = s.state.schemes['游戏机'].savedAt;
  const config = JSON.stringify(s.state.schemes['游戏机'].config);

  s.renameScheme('游戏机', '我的游戏机');

  assert.equal(s.state.schemes['游戏机'], undefined, '旧名应消失');
  assert.ok(s.state.schemes['我的游戏机'], '新名应存在');
  assert.equal(JSON.stringify(s.state.schemes['我的游戏机'].config), config, '配置应保留');
  assert.equal(s.state.schemes['我的游戏机'].savedAt, savedAt, '保存时间应保留');
});

test('方案重命名：重命名当前方案时同步 currentScheme', () => {
  const s = withSchemes();
  s.loadScheme('游戏机');
  s.renameScheme('游戏机', '新名');
  assert.equal(s.state.currentScheme, '新名');
});

test('方案重命名：重命名非当前方案不影响 currentScheme', () => {
  const s = withSchemes();
  s.loadScheme('剪辑机');
  s.renameScheme('游戏机', '新名');
  assert.equal(s.state.currentScheme, '剪辑机');
});

test('方案重命名：同名/空名/不存在的方案是安全空操作', () => {
  const s = withSchemes();
  const before = JSON.stringify(s.state.schemes);

  s.renameScheme('游戏机', '游戏机');   // 同名
  s.renameScheme('游戏机', '');          // 空名
  s.renameScheme('不存在', '新名');       // 源不存在

  assert.equal(JSON.stringify(s.state.schemes), before, '状态不应改变');
});

test('方案重命名：持久化生效', () => {
  const storage = memStorage();
  const s1 = new Store({ storage, autoSave: false });
  s1.select('cpu', 'c1'); s1.saveScheme('旧名');
  s1.renameScheme('旧名', '新名');
  s1.flush();

  const s2 = new Store({ storage, autoSave: false });
  assert.deepEqual(s2.schemeNames(), ['新名']);
});

// ══════════════════════════════════════════════════════════════════
// 渲染：方案管理弹窗
// ══════════════════════════════════════════════════════════════════

test('渲染：方案管理列出每套方案，并带载入/重命名/删除按钮', () => {
  const html = renderSchemeManager({
    schemes: [
      { name: '游戏机', savedAt: Date.now(), parts: 8, counts: { error: 0, warn: 1 }, peak: 446 },
      { name: '剪辑机', savedAt: Date.now(), parts: 7, counts: { error: 2, warn: 0 }, peak: 520 },
    ],
    currentScheme: '游戏机',
  });

  assert.ok(html.includes('游戏机') && html.includes('剪辑机'), '应列出全部方案');
  assert.ok(html.includes('data-scheme-load="游戏机"'), '应有载入按钮');
  assert.ok(html.includes('data-scheme-rename="游戏机"'), '应有重命名按钮');
  assert.ok(html.includes('data-scheme-delete="游戏机"'), '应有删除按钮');
  assert.ok(html.includes('data-scheme-delete="剪辑机"'), '第二套也应有删除按钮');
  assert.ok(html.includes('8 件'), '应显示配件数');
  assert.ok(html.includes('446W'), '应显示功耗');
});

test('渲染：当前方案被标记，且其「载入」按钮禁用（避免无意义操作）', () => {
  const html = renderSchemeManager({
    schemes: [{ name: '当前方案', savedAt: Date.now(), parts: 3, counts: { error: 0, warn: 0 } }],
    currentScheme: '当前方案',
  });
  assert.ok(html.includes('is-current'), '当前方案行应有标记');
  assert.ok(html.includes('<span class="badge">当前</span>'), '应显示「当前」徽标');
  // 当前方案的载入按钮应禁用
  const row = html.slice(html.indexOf('data-scheme-row="当前方案"'));
  assert.ok(/data-scheme-load="当前方案"\s+disabled/.test(row), '当前方案的载入按钮应禁用');
});

test('渲染：兼容性状态分别用 🔴/🟡/✅ 表示', () => {
  const html = renderSchemeManager({
    schemes: [
      { name: '有错', counts: { error: 3, warn: 1 } },
      { name: '有警', counts: { error: 0, warn: 2 } },
      { name: '干净', counts: { error: 0, warn: 0 } },
    ],
    currentScheme: '',
  });
  assert.ok(html.includes('🔴 3'), '有错误应显示红');
  assert.ok(html.includes('🟡 2'), '有警告应显示黄');
  assert.ok(html.includes('✅ 无冲突'), '无问题应显示绿');
});

test('渲染：无方案时给出引导而非空表格', () => {
  const html = renderSchemeManager({ schemes: [], currentScheme: '' });
  assert.ok(html.includes('还没有保存过方案'), '应给出提示');
  assert.ok(!html.includes('<table'), '不应渲染空表格');
  assert.ok(html.includes('data-action="modal-close"'), '应能关闭');
});

test('渲染：方案名含 HTML 时被转义（防注入，CSV 导入/用户输入）', () => {
  const html = renderSchemeManager({
    schemes: [{ name: '<img src=x onerror=alert(1)>', counts: {} }],
    currentScheme: '',
  });
  assert.ok(!/<img[\s>]/i.test(html), '方案名应被转义');
  assert.ok(html.includes('&lt;img'), '应出现转义实体');
  // 属性值中的方案名也要转义
  assert.ok(!html.includes('data-scheme-delete="<img'), '属性中的名字也应转义');
});

test('渲染：删除按钮带 btn-danger 样式类（视觉区分）', () => {
  const html = renderSchemeManager({
    schemes: [{ name: 'X', counts: {} }],
    currentScheme: '',
  });
  assert.ok(html.includes('btn-danger'), '删除按钮应有危险样式');
});

// ══════════════════════════════════════════════════════════════════
// 顶部栏入口
// ══════════════════════════════════════════════════════════════════

test('顶部栏：提供方案管理入口', () => {
  const html = renderTopBar({ schemes: ['A'], currentScheme: 'A' });
  assert.ok(html.includes('data-action="scheme-manage"'), '应有方案管理按钮');
});

// ══════════════════════════════════════════════════════════════════
// 界面接线（防止"逻辑有实现但界面没接"这类问题再发生）
// ══════════════════════════════════════════════════════════════════

test('界面接线：app.js 真正调用了删除与重命名', () => {
  const src = readFileSync(join(ROOT, 'src', 'ui', 'app.js'), 'utf8');

  assert.ok(/store\.deleteScheme\(/.test(src), 'app.js 应调用 store.deleteScheme');
  assert.ok(/store\.renameScheme\(/.test(src), 'app.js 应调用 store.renameScheme');
  assert.ok(/openSchemeManager/.test(src), 'app.js 应实现方案管理弹窗');
  assert.ok(/renderSchemeManager/.test(src), 'app.js 应引用 renderSchemeManager');

  // 事件绑定必须处理删除/重命名/载入三个 data 属性
  for (const attr of ['schemeDelete', 'schemeRename', 'schemeLoad']) {
    assert.ok(
      new RegExp(`t\\.dataset\\.${attr}`).test(src),
      `事件处理应响应 dataset.${attr}`,
    );
  }
});

test('界面接线：删除与重命名都有二次确认或校验', () => {
  const src = readFileSync(join(ROOT, 'src', 'ui', 'app.js'), 'utf8');

  // 删除需要 confirm
  const delFn = src.slice(src.indexOf('function promptDeleteScheme'), src.indexOf('function openSchemeCompare'));
  assert.ok(/confirm\(/.test(delFn), '删除应有二次确认');
  assert.ok(/deleteScheme/.test(delFn), '应调用 deleteScheme');

  // 重命名需要校验空名与重名
  const renFn = src.slice(src.indexOf('function promptRenameScheme'), src.indexOf('function promptDeleteScheme'));
  assert.ok(/trim\(\)/.test(renFn), '应校验空名');
  assert.ok(/includes\(trimmed\)/.test(renFn), '应校验重名');
});

test('界面接线：保存方案时对覆盖同名做确认', () => {
  const src = readFileSync(join(ROOT, 'src', 'ui', 'app.js'), 'utf8');
  const saveFn = src.slice(src.indexOf('function promptSaveScheme'), src.indexOf('function schemeRows'));
  assert.ok(/confirm\(/.test(saveFn), '覆盖同名方案应确认，避免误覆盖');
});

// ══════════════════════════════════════════════════════════════════
// 端到端：完整生命周期
// ══════════════════════════════════════════════════════════════════

test('端到端：新建 → 重命名 → 载入 → 删除 全流程', () => {
  const s = newStore();

  // 新建并保存
  s.select('cpu', 'cpu-x');
  s.select('gpu', 'gpu-x');
  s.saveScheme('方案1');
  assert.equal(s.schemeNames().length, 1);

  // 重命名
  s.renameScheme('方案1', '游戏机');
  assert.deepEqual(s.schemeNames(), ['游戏机']);

  // 改动当前配置
  s.resetAll();
  s.select('cpu', 'cpu-y');
  assert.equal(s.state.config.cpu, 'cpu-y');

  // 载入方案应还原
  s.loadScheme('游戏机');
  assert.equal(s.state.config.cpu, 'cpu-x');
  assert.equal(s.state.config.gpu, 'gpu-x');

  // 删除
  s.deleteScheme('游戏机');
  assert.deepEqual(s.schemeNames(), []);
  // 删除方案后当前配置仍是载入时的内容（符合"删除方案不影响当前配置"）
  assert.equal(s.state.config.cpu, 'cpu-x');
});
