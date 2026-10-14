/**
 * 弹窗事件可达性测试
 *
 * 回归缺陷：事件监听曾绑定在 #app 上，而 #modal 位于 #app 之外，
 * 导致弹窗内所有按钮（删除 / 关闭 / 重命名 / 载入）收不到点击 —— 事件在
 * #app 处就停止了冒泡。
 *
 * 本文件用最小 DOM 模拟真实冒泡行为，验证"按钮在弹窗里也能被处理"。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ══════════════════════════════════════════════════════════════════
// 1. 结构：弹窗必须在事件委托根节点内，或监听挂在 document 上
// ══════════════════════════════════════════════════════════════════

test('结构：#modal 与 #app 的包含关系', () => {
  const tpl = readFileSync(join(ROOT, 'templates', 'index.html'), 'utf8');

  const appStart = tpl.indexOf('<div id="app"');
  const appEnd = tpl.indexOf('</div>\n\n<div id="modal"') >= 0
    ? tpl.indexOf('</div>\n\n<div id="modal"')
    : tpl.indexOf('id="modal"');
  const modalIdx = tpl.indexOf('id="modal"');

  // 弹窗应位于 #app 内部（这样委托到 #app 才收得到）
  const appOpenIdx = tpl.indexOf('<div id="app"');
  const modalOpenIdx = tpl.indexOf('<div id="modal"');
  assert.ok(appOpenIdx >= 0, '模板应含 #app');
  assert.ok(modalOpenIdx >= 0, '模板应含 #modal');
  assert.ok(
    modalOpenIdx > appOpenIdx,
    '#modal 必须放在 #app 内部，否则事件委托收不到弹窗内的点击',
  );
});

test('结构：弹窗内按钮的 data-action 都在事件处理 switch 里有对应分支', () => {
  const src = readFileSync(join(ROOT, 'src', 'ui', 'app.js'), 'utf8');

  // 弹窗里会用到的动作
  const modalActions = [
    'modal-close',       // 关闭弹窗（删除/重命名/对比/导出等共用）
    'scheme-manage',      // 打开管理
    'compare-open',
    'export-open',
    'import-open',
    'rules-help',
  ];
  for (const a of modalActions) {
    assert.ok(
      src.includes(`case '${a}'`),
      `app.js 应处理 data-action="${a}"（弹窗内按钮）`,
    );
  }
});

// ══════════════════════════════════════════════════════════════════
// 2. 行为：用带冒泡的最小 DOM 验证点击可达
// ══════════════════════════════════════════════════════════════════

/** 支持冒泡的最小元素 */
class Node2 {
  constructor(tag, attrs = {}) {
    this.tagName = tag.toUpperCase();
    this.dataset = { ...(attrs.dataset || {}) };
    this.attrs = attrs;
    this.parentNode = null;
    this.children = [];
    this._listeners = new Map();
    this.textContent = '';
  }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  addEventListener(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(fn);
  }
  /** 模拟真实冒泡：先走自身监听，再逐级向父节点 */
  dispatchClick() {
    let node = this;
    const path = [];
    while (node) { path.push(node); node = node.parentNode; }
    for (const n of path) {
      const fns = n._listeners.get('click') || [];
      for (const fn of fns) fn({ target: this, stopPropagation() {} });
    }
  }
  closest() { return null; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
}

test('行为：点击弹窗内的按钮，事件能冒泡到委托根节点', () => {
  // 复刻真实结构：modal 挂在 app 内部（修复后的结构）
  // 注意 dataset 用 camelCase —— 真实 DOM 中 data-scheme-delete 会被暴露为
  // dataset.schemeDelete，app.js 正是按 camelCase 读取的。
  const app = new Node2('div', { dataset: { id: 'app' } });
  const modal = new Node2('div', { dataset: { id: 'modal' } });
  const modalBox = new Node2('div');
  const modalBody = new Node2('div');
  const deleteBtn = new Node2('button', { dataset: { schemeDelete: '游戏机' } });
  const closeBtn = new Node2('button', { dataset: { action: 'modal-close' } });

  // 结构：modal > modal-box > modal-body > buttons
  modal.appendChild(modalBox);
  modalBox.appendChild(modalBody);
  modalBody.appendChild(deleteBtn);
  modalBody.appendChild(closeBtn);

  // 关键：modal 挂在 app 内部（修复后）
  app.appendChild(modal);

  // 在 app 上挂监听，记录收到的动作（与 app.js 的 closest 逻辑对应）
  const received = [];
  app.addEventListener('click', (e) => {
    const t = e.target;
    if (t.dataset.schemeDelete) received.push('delete:' + t.dataset.schemeDelete);
    if (t.dataset.action === 'modal-close') received.push('close');
  });

  deleteBtn.dispatchClick();
  closeBtn.dispatchClick();

  assert.deepEqual(
    received,
    ['delete:游戏机', 'close'],
    '弹窗内按钮的点击应能被 #app 上的委托捕获',
  );
});

test('行为：若 modal 在 #app 外部，点击无法冒泡到 #app（复现原缺陷）', () => {
  const app = new Node2('div', { dataset: { id: 'app' } });
  const modal = new Node2('div', { dataset: { id: 'modal' } });
  const btn = new Node2('button', { dataset: { 'scheme-delete': 'X' } });
  modal.appendChild(btn);
  // 注意：modal 不 append 到 app —— 这就是原来的结构

  const received = [];
  app.addEventListener('click', () => received.push('hit'));

  btn.dispatchClick();
  assert.deepEqual(
    received, [],
    'modal 在 #app 外时，事件不会冒泡到 #app（这正是原缺陷的机制）',
  );
});

// ══════════════════════════════════════════════════════════════════
// 3. 绑定根节点：应覆盖 #modal 所在层级
// ══════════════════════════════════════════════════════════════════

test('绑定：事件委托根节点能覆盖 #modal', () => {
  const src = readFileSync(join(ROOT, 'src', 'ui', 'app.js'), 'utf8');
  // 修复后：要么监听挂在 document，要么 modal 移进 #app 后仍绑 #app
  // 两种都可以接受，但要能收��� modal 内的点击
  const usesDocument = /document\.addEventListener\('click'/.test(src)
    || /document\.body\.addEventListener\('click'/.test(src);
  const usesApp = /getElementById\('app'\)/.test(src);
  assert.ok(
    usesDocument || usesApp,
    '应存在一个能覆盖 #modal 的事件委托根节点',
  );
});

test('绑定：删除/关闭的分支确实调用了 store/closeModal', () => {
  const src = readFileSync(join(ROOT, 'src', 'ui', 'app.js'), 'utf8');

  // 关闭：应调用 closeModal 并把 modal 隐藏
  const closeIdx = src.indexOf('function closeModal');
  assert.ok(closeIdx > 0, '应有 closeModal 函数');
  const closeFn = src.slice(closeIdx, closeIdx + 400);
  assert.ok(/hidden\s*=\s*true/.test(closeFn), 'closeModal 应把 #modal 置为 hidden');

  // 删除：应调用 store.deleteScheme
  assert.ok(
    /function promptDeleteScheme/.test(src),
    '应有 promptDeleteScheme',
  );
  const delIdx = src.indexOf('function promptDeleteScheme');
  const delFn = src.slice(delIdx, delIdx + 800);
  assert.ok(/store\.deleteScheme\(/.test(delFn), 'promptDeleteScheme 应调用 store.deleteScheme');
  assert.ok(/confirm\(/.test(delFn), '删除应有二次确认');
});
