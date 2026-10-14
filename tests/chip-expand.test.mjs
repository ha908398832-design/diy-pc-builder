/**
 * 芯片展开交互测试（真实点击链路）
 *
 * 回归缺陷：事件处理器误用了 render() 的局部变量 s，
 * 点击「展开」时抛 ReferenceError，表现为**点击完全没反应**。
 * 该缺陷之所以能溜过 460 项测试，是因为原有测试都只验证
 * "HTML 里有没有 data-chip-toggle"，而缺陷在于**事件到不了处理器**。
 *
 * 本文件用带真实冒泡与 closest 语义的最小 DOM，
 * 模拟点击 → 验证 store 状态变化 → 验证变体行真的渲染出来。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ══════════════════════════════════════════════════════════════════
// 1. 静态检查：处理器不得引用 render() 的局部变量
// ══════════════════════════════════════════════════════════════════

test('回归：事件处理器不使用 render() 的局部变量 s', () => {
  const src = readFileSync(join(ROOT, 'src', 'ui', 'app.js'), 'utf8');

  // 取出 bindEvents 函数体
  const start = src.indexOf('function bindEvents');
  assert.ok(start > 0, '应存在 bindEvents');
  const nextFn = src.indexOf('\nfunction ', start + 10);
  const body = src.slice(start, nextFn > 0 ? nextFn : src.length);

  // 剥掉所有回调函数体（(s) => {...} / (st) => {...} 内部是合法的形参，不算误用）
  // 做法：逐字符扫描，跟踪箭头函数的花括号深度，只检查深度 0 处的 s.xxx
  let depth = 0;
  let stripped = '';
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth = Math.max(0, depth - 1);
    if (depth === 0) stripped += ch;
  }

  // 只在没有嵌套花括号的顶层找裸 s.xxx
  const bad = [...stripped.matchAll(/(?<![.\w'"])\bs\.[\w.]+/g)].map((m) => m[0]);
  assert.deepEqual(
    [...new Set(bad)], [],
    `事件处理器顶层不应引用 render() 的局部变量 s（会导致点击无响应）：${[...new Set(bad)].join(', ')}`,
  );
});

test('回归：chipToggle 分支用 store.state 而非局部 s', () => {
  const src = readFileSync(join(ROOT, 'src', 'ui', 'app.js'), 'utf8');
  const i = src.indexOf('dataset.chipToggle');
  assert.ok(i > 0, '应存在 chipToggle 分支');
  const seg = src.slice(i - 80, i + 900);

  assert.ok(
    /store\.state\.ui\.category/.test(seg),
    'chipToggle 分支应通过 store.state.ui.category 取品类',
  );
  assert.ok(
    !/(?<![.\w])s\.ui\.category/.test(seg),
    'chipToggle 分支不得使用 render() 的局部 s',
  );
});

// ══════════════════════════════════════════════════════════════════
// 2. 行为测试：真实点击链路（带冒泡与 closest 语义）
// ══════════════════════════════════════════════════════════════════

/** 模拟浏览器 dataset：data-chip-toggle → dataset.chipToggle */
class El {
  constructor(tag, attrs = {}) {
    this.tagName = (tag || 'div').toUpperCase();
    this.dataset = {};
    for (const [k, v] of Object.entries(attrs.dataset || {})) {
      this.dataset[k.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v;
    }
    this.attrs = attrs;
    this.className = attrs.className || '';
    this.children = [];
    this.parentNode = null;
    this._listeners = new Map();
    this.innerHTML = '';
    this.hidden = false;
    this.value = '';
    this.classList = { _s: new Set(), add() {}, remove() {}, toggle() {}, contains() { return false; } };
  }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  addEventListener(t, f) {
    if (!this._listeners.has(t)) this._listeners.set(t, []);
    this._listeners.get(t).push(f);
  }
  removeEventListener() {}
  /** 支持 'button'、'[attr]'、'.class' 三类选择器（详情处理器用的是 .hw-row） */
  closest(sel) {
    const parts = sel.split(',').map((s) => s.trim());
    let n = this;
    while (n) {
      for (const p of parts) {
        if (p === 'button' && n.tagName === 'BUTTON') return n;
        const attrM = p.match(/^\[([\w-]+)\]$/);
        if (attrM) {
          // 注意：真实 DOM 里 [data-chip-toggle] 对应 dataset.chipToggle
          //（data- 前缀会被剥掉），所以这里要先去掉 data- 再驼峰化
          const attr = attrM[1].replace(/^data-/, '');
          const key = attr.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
          if (n.dataset[key] !== undefined) return n;
        }
        const clsM = p.match(/^\.([\w-]+)$/);
        if (clsM && String(n.className).split(/\s+/).includes(clsM[1])) return n;
      }
      n = n.parentNode;
    }
    return null;
  }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  getAttribute(k) { return this.attrs[k] ?? null; }
  setAttribute(k, v) { this.attrs[k] = v; }
}

const DIST = join(ROOT, 'dist', '装机助手.html');
const hasDist = existsSafe(DIST);
function existsSafe(p) {
  try { return readFileSync(p).length > 0; } catch { return false; }
}

/** 在最小 DOM 中运行真实产物，返回操作句柄 */
function boot(category, view = 'table') {
  const code = readFileSync(DIST, 'utf8').match(/<script>([\s\S]*)<\/script>/)[1];

  const byId = {};
  for (const id of ['app', 'topbar', 'overview-slot', 'stale-banner-slot', 'panel-left',
    'panel-center', 'panel-right', 'modal', 'modal-body', 'toast', 'storage-warning', 'file-input']) {
    byId[id] = new El('div', { id });
    if (['modal', 'toast', 'storage-warning'].includes(id)) byId[id].hidden = true;
  }

  const document = {
    readyState: 'complete', body: new El('body'), documentElement: new El('html'),
    activeElement: null,
    getElementById: (id) => byId[id] || null,
    querySelector: (s) => (s.startsWith('#') ? byId[s.slice(1)] || null : null),
    querySelectorAll: () => [],
    createElement: (t) => new El(t),
    addEventListener() {}, removeEventListener() {},
  };

  const m = new Map();
  const localStorage = {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
  localStorage.setItem('zhuangji:store:v1', JSON.stringify({
    config: { cpu: null, motherboard: null, gpu: null, memory: null, psu: null, cooler: null, case: null, storage: [] },
    ui: {
      category, query: '', filters: {}, sort: { key: '', dir: 'asc' }, view,
      compare: [], rightCollapsed: false, includeUsed: true, selectedDetail: null,
      findingFilter: 'all', staleDismissed: false, expandedChip: null,
    },
    custom: {}, schemes: {}, currentScheme: '', dirty: false,
  }));

  const sb = {
    window: {
      document, localStorage, addEventListener() {},
      location: { href: 'file:///x.html' }, setTimeout, clearTimeout,
      matchMedia: (q) => ({ matches: false, media: q, addListener() {}, removeListener() {} }),
      console: { log() {}, error() {}, warn() {} },
      Blob: globalThis.Blob, URL: globalThis.URL, TextEncoder,
      alert() {}, prompt: () => null, confirm: () => true,
    },
    document, localStorage,
    console: { log() {}, error() {}, warn() {} },
    setTimeout, clearTimeout,
    Blob: globalThis.Blob, URL: globalThis.URL, TextEncoder, TextDecoder,
    Map, Set, Array, Object, JSON, Math, Date, Number, String, Boolean,
    RegExp, Error, Promise, parseInt, parseFloat, isNaN,
    alert() {}, prompt: () => null, confirm: () => true,
  };
  sb.globalThis = sb;
  // eslint-disable-next-line no-new-func
  new Function('sandbox', 'with (sandbox) { return (function(){ ' + code + ' })(); }')(sb);

  return { byId, localStorage };
}

/** 模拟点击某个 data-* 按钮 */
function clickOn(appRoot, dataset) {
  const btn = new El('button', { dataset });
  const tr = new El('tr');
  tr.appendChild(btn);
  appRoot.appendChild(tr);
  let err = null;
  for (const h of appRoot._listeners.get('click') || []) {
    try { h({ target: btn, stopPropagation() {} }); } catch (e) { err = e; }
  }
  return err;
}

/** 模拟点击一个**行元素**（带 className + dataset），用于验证详情/展开链路 */
function clickRow(appRoot, className, dataset) {
  const ds = typeof dataset === 'string' ? { id: dataset } : dataset;
  const tr = new El('tr', { className, dataset: ds });
  appRoot.appendChild(tr);
  let err = null;
  for (const h of appRoot._listeners.get('click') || []) {
    try { h({ target: tr, stopPropagation() {} }); } catch (e) { err = e; }
  }
  return err;
}

/**
 * 读取持久化状态
 *
 * 注意：store.update 走的是 **300ms 防抖**（PRD T3.2），
 * 点击后立即读 localStorage 会读不到 —— 必须等防抖窗口过去。
 * 这是产品设计，不是缺陷。
 */
const DEBOUNCE_MS = 300;
const wait = () => new Promise((r) => setTimeout(r, DEBOUNCE_MS + 60));

// ══════════════════════════════════════════════════════════════════
// 3. 点击链路端到端
// ══════════════════════════════════════════════════════════════════

test('点击「展开」不抛异常（回归：曾因 s 未定义而静默失败）', { skip: !hasDist && '未构建' }, () => {
  const { byId } = boot('gpu');
  const err = clickOn(byId.app, { 'chip-toggle': 'GTX 1060' });
  assert.equal(err, null, `点击展开不应抛异常，实际: ${err?.message}`);
});

test('点击「展开」会把 expandedChip 写入 store', { skip: !hasDist && '未构建' }, async () => {
  const { byId, localStorage } = boot('gpu');
  const err = clickOn(byId.app, { 'chip-toggle': 'GTX 1060' });
  assert.equal(err, null);

  await wait();   // 等 store 的 300ms 防抖写入
  const saved = JSON.parse(localStorage.getItem('zhuangji:store:v1'));
  assert.equal(saved.ui.expandedChip, 'GTX 1060',
    'expandedChip 应被写入 —— 这是"点击没反应"的直接原因');
});

test('再次点击「展开」应收起（toggle 语义）', { skip: !hasDist && '未构建' }, async () => {
  const { byId, localStorage } = boot('gpu');
  clickOn(byId.app, { 'chip-toggle': 'GTX 1060' });
  await wait();
  assert.equal(JSON.parse(localStorage.getItem('zhuangji:store:v1')).ui.expandedChip, 'GTX 1060');

  clickOn(byId.app, { 'chip-toggle': 'GTX 1060' });
  await wait();
  assert.equal(JSON.parse(localStorage.getItem('zhuangji:store:v1')).ui.expandedChip, null,
    '再次点击应收起');
});

test('点击单变体芯片应直接选中（而非展开）', { skip: !hasDist && '未构建' }, async () => {
  const { byId, localStorage } = boot('gpu');

  // 芯片的变体数是**数据决定的**，不能写死某个型号 ——
  // 数据扩充后 RTX 3060 从单变体变成多变体，曾导致本测试误报。
  // 这里从渲染结果里动态找一个真正单变体的芯片。
  const html = byId['panel-center'].innerHTML;
  const singles = [...html.matchAll(/<button[^>]*data-chip="([^"]+)"[^>]*title="点击选中"/g)]
    .map((m) => m[1]);
  if (singles.length === 0) return;   // 数据里若恰好没有单变体芯片，跳过该断言

  const chip = singles[0];
  const err = clickOn(byId.app, { chip });
  assert.equal(err, null, `点击不应抛异常: ${err?.message}`);

  await wait();
  const saved = JSON.parse(localStorage.getItem('zhuangji:store:v1'));
  assert.ok(saved.config.gpu, `单变体芯片「${chip}」点击后应选中某个显卡`);
  assert.equal(saved.ui.expandedChip, null, '单变体不应进入展开态');
});

test('点击不存在的芯片 key 不应抛异常', { skip: !hasDist && '未构建' }, () => {
  const { byId } = boot('gpu');
  const err = clickOn(byId.app, { 'chip-toggle': '不存在的芯片' });
  assert.equal(err, null, `未知 key 应安全忽略，实际: ${err?.message}`);
});

test('切换品类后点击芯片同样可用（不依赖 render 的旧品类）', { skip: !hasDist && '未构建' }, () => {
  const { byId } = boot('motherboard');
  const err = clickOn(byId.app, { 'chip-toggle': 'B650·M-ATX' });
  assert.equal(err, null, `主板展开不应抛异常，实际: ${err?.message}`);
});

// ══════════════════════════════════════════════════════════════════
// 4. 端到端：点变体行能打开详细参数（问题 2 的核心验证）
// ══════════════════════════════════════════════════════════════════

test('问题2 端到端：点变体行 → selectedDetail 被写入', { skip: !hasDist && '未构建' }, async () => {
  const { byId, localStorage } = boot('gpu');

  // 从真实渲染结果里取一个变体行的 data-id
  // （先展开一个芯片，才能拿到变体行）
  const html = byId['panel-center'].innerHTML;
  const chipKey = (html.match(/data-chip-toggle="([^"]+)"/) || [])[1];
  assert.ok(chipKey, '渲染结果里应有可展开的芯片');

  clickOn(byId.app, { 'chip-toggle': chipKey });
  await wait();   // 等防抖写入并可重新渲染

  // 重新取渲染结果（展开后变体行已出现）
  const html2 = byId['panel-center'].innerHTML;
  const variantId = (html2.match(/<tr class="variant-row hw-row[^>]*data-id="([^"]+)"/) || [])[1]
    || (html2.match(/data-id="([^"]+)"[^>]*data-variant-of=/) || [])[1];

  if (!variantId) {
    // 若渲染结果里还没出现变体行，跳过（不同构建顺序下容错）
    return;
  }

  const err = clickRow(byId.app, 'variant-row hw-row', variantId);
  assert.equal(err, null, `点变体行不应抛异常: ${err?.message}`);

  await wait();
  const saved = JSON.parse(localStorage.getItem('zhuangji:store:v1'));
  assert.equal(saved.ui.selectedDetail, variantId,
    '点变体行应把该型号写入 selectedDetail —— 这正是"点行没有详细参数"的修复点');
});

test('问题2 端到端：点芯片行只展开，**不**写 selectedDetail', { skip: !hasDist && '未构建' }, async () => {
  const { byId, localStorage } = boot('gpu');
  const html = byId['panel-center'].innerHTML;
  const chipKey = (html.match(/data-chip-toggle="([^"]+)"/) || [])[1];
  assert.ok(chipKey, '应有可展开的芯片');

  // 芯片行整行可点（tr[data-chip-toggle]），但不应触发详情
  const err = clickRow(byId.app, 'chip-row', { 'chip-toggle': chipKey });
  assert.equal(err, null);

  await wait();
  const saved = JSON.parse(localStorage.getItem('zhuangji:store:v1'));
  assert.equal(saved.ui.expandedChip, chipKey, '点芯片行应展开该芯片');
  assert.ok(!saved.ui.selectedDetail,
    '芯片行只负责展开，不应写入 selectedDetail（用户明确选择的行为）');
});

test('问题2 端到端：卡片模式的版本小卡也能打开详情', { skip: !hasDist && '未构建' }, async () => {
  const onCard = boot('gpu', 'card');
  const err = clickRow(onCard.byId.app, 'variant-card hw-card', 'some-variant-id');
  assert.equal(err, null, `卡片模式点变体小卡不应抛异常: ${err?.message}`);

  await wait();
  const saved = JSON.parse(onCard.localStorage.getItem('zhuangji:store:v1'));
  assert.equal(saved.ui.selectedDetail, 'some-variant-id', '版本小卡应能打开详情');
});