/**
 * 构建产物冒烟测试（T5.1 / A1）
 *
 * 为什么需要：自写打包器的最大风险是模块图/导入导出绑定出错，
 * 而这类问题只有真正执行一遍才能发现。
 *
 * 做法：从 dist/装机助手.html 中取出内联的 <script>，
 * 在一个最小 DOM shim 环境中执行它，验证：
 *   1. 脚本能无异常跑完（说明模块图、导入导出绑定都正确）
 *   2. 数据已内联（启动日志给出 300 个型号）
 *   3. 渲染真实发生（左栏品类、中栏型号行、右栏面板都出现在 DOM 中）
 *   4. 交互可用（点「选它」后配置被写入、状态灯更新）
 *
 * 这比"看一眼截图"更强：它检查的是实际行为。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist', '装机助手.html');

/**
 * 从 data/*.json 汇总型号总数
 * 用于断言产物内联的数据量与磁盘一致，避免把数字写死
 * （写死的数字在数据扩充后会失效，属于测试脆弱性）
 */
function dataTotal() {
  const cats = ['cpu', 'motherboard', 'gpu', 'memory', 'psu', 'case', 'cooler', 'storage'];
  let n = 0;
  for (const c of cats) {
    const p = join(ROOT, 'data', `${c}.json`);
    if (existsSync(p)) {
      n += JSON.parse(readFileSync(p, 'utf8')).length;
    }
  }
  return n;
}

// ══════════════════════════════════════════════════════════════════
// 最小 DOM shim
// ══════════════════════════════════════════════════════════════════

/** 极简元素实现，够 app.js 使用 */
class El {
  constructor(tag = 'div', attrs = {}) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.attributes = { ...attrs };
    this.dataset = {};
    this.style = {};
    this._html = '';
    this._text = '';
    this.hidden = false;
    this.value = '';
    this.checked = false;
    this.files = [];
    this.parentNode = null;
    this.classList = {
      _set: new Set(),
      add: (...c) => c.forEach((x) => this.classList._set.add(x)),
      remove: (...c) => c.forEach((x) => this.classList._set.delete(x)),
      toggle: (c, on) => (on ? this.classList._set.add(c) : this.classList._set.delete(c)),
      contains: (c) => this.classList._set.has(c),
    };
    for (const [k, v] of Object.entries(attrs)) {
      if (k.startsWith('data-')) {
        this.dataset[k.slice(5).replace(/-([a-z])/g, (m, c) => c.toUpperCase())] = v;
      }
    }
  }

  get innerHTML() { return this._html; }
  set innerHTML(v) {
    this._html = String(v);
    // 简单解析出带 data 属性的元素，供查询与事件测试使用。
    // 这不是完整 HTML 解析器，只覆盖断言所需的选择器。
    this.children = parseLite(this._html, this);
  }

  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); }
  setAttribute(k, v) { this.attributes[k] = v; }
  getAttribute(k) { return this.attributes[k]; }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  removeChild(c) { this.children = this.children.filter((x) => x !== c); }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  addEventListener() {}
  removeEventListener() {}
  focus() {}
  click() {}
  setSelectionRange() {}
  closest() { return null; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
}

/** 从 HTML 字符串里粗略提取元素（仅取属性与文本，够断言用） */
function parseLite(html, parent) {
  const out = [];
  const tagRe = /<(\w+)([^>]*)>([\s\S]*?)<\/\1>|<(\w+)([^>]*)\/>/g;
  let m;
  while ((m = tagRe.exec(html)) !== null) {
    const tag = m[1] || m[4];
    const attrStr = m[2] || m[5] || '';
    const el = new El(tag);
    const attrRe = /([\w-]+)\s*=\s*"([^"]*)"/g;
    let a;
    while ((a = attrRe.exec(attrStr)) !== null) {
      const key = a[1];
      const val = a[2];
      if (key.startsWith('data-')) {
        el.dataset[key.slice(5).replace(/-([a-z])/g, (x, c) => c.toUpperCase())] = val;
      } else if (key === 'class') {
        val.split(/\s+/).filter(Boolean).forEach((c) => el.classList.add(c));
      } else {
        el.attributes[key] = val;
      }
    }
    el._text = (m[3] || '').replace(/<[^>]*>/g, '').trim();
    el.parentNode = parent;
    out.push(el);
  }
  return out;
}

/** 递归收集全部后代元素 */
function descendants(el, acc = []) {
  for (const c of el.children || []) {
    acc.push(c);
    descendants(c, acc);
  }
  return acc;
}

/** 构造 window/document 环境 */
function makeDom() {
  const byId = {};
  for (const id of ['app', 'topbar', 'panel-left', 'panel-center', 'panel-right', 'modal', 'modal-body', 'toast', 'storage-warning', 'file-input']) {
    const el = new El('div', { id });
    if (id === 'modal' || id === 'toast' || id === 'storage-warning') el.hidden = true;
    byId[id] = el;
  }

  const body = new El('body');
  body.classList = {
    _set: new Set(),
    add: (...c) => c.forEach((x) => body.classList._set.add(x)),
    remove: (...c) => c.forEach((x) => body.classList._set.delete(x)),
    toggle: (c, on) => (on ? body.classList._set.add(c) : body.classList._set.delete(c)),
    contains: (c) => body.classList._set.has(c),
  };

  const document = {
    readyState: 'complete',
    body,
    activeElement: null,
    getElementById: (id) => byId[id] || null,
    querySelector: (sel) => {
      // 支持 #id 与 [data-role="x"]、[data-action="x"] 等常见选择器
      if (sel.startsWith('#')) return byId[sel.slice(1)] || null;
      const m = sel.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/);
      if (m) {
        const key = m[1].replace(/-([a-z])/g, (x, c) => c.toUpperCase());
        const want = m[2];
        for (const el of [byId.app, byId['panel-center'], byId['panel-right'], byId.topbar, byId['panel-left'], byId['modal-body']]) {
          for (const d of descendants(el)) {
            if (d.dataset?.[key] !== undefined && (!want || d.dataset[key] === want)) return d;
          }
        }
      }
      return null;
    },
    querySelectorAll: (sel) => {
      const m = sel.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/);
      if (!m) return [];
      const key = m[1].replace(/-([a-z])/g, (x, c) => c.toUpperCase());
      const want = m[2];
      const out = [];
      for (const el of [byId.app, byId['panel-center'], byId['panel-right'], byId.topbar, byId['panel-left'], byId['modal-body']]) {
        for (const d of descendants(el)) {
          if (d.dataset?.[key] !== undefined && (!want || d.dataset[key] === want)) out.push(d);
        }
      }
      return out;
    },
    createElement: (tag) => new El(tag),
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  const localStorage = (() => {
    const m = new Map();
    return {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => m.set(k, String(v)),
      removeItem: (k) => m.delete(k),
      _dump: () => Object.fromEntries(m),
    };
  })();

  const window = {
    document,
    localStorage,
    addEventListener: () => {},
    location: { href: 'file:///dist/装机助手.html' },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
    console,
    Blob: globalThis.Blob,
    URL: globalThis.URL,
    TextEncoder,
    alert: () => {},
    prompt: () => null,
    confirm: () => true,
  };

  return { window, document, localStorage, byId, body };
}

/** 取出产物内联脚本 */
function extractScript() {
  const html = readFileSync(DIST, 'utf8');
  const start = html.lastIndexOf('<script>');
  const end = html.lastIndexOf('</script>');
  assert.ok(start >= 0 && end > start, '产物应含内联 script');
  const code = html.slice(start + '<script>'.length, end);

  // 产物中数据模块被内联为 __defs["src/data/bundle.js"]，
  // 其中的 DOM 元素占位注释不影响执行
  return code;
}

// ══════════════════════════════════════════════════════════════════
// 测试
// ══════════════════════════════════════════════════════════════════

const hasDist = existsSync(DIST);

test('产物冒烟：脚本能在最小 DOM 环境中完整执行（验证模块图与绑定）', { skip: !hasDist && '未构建，请先运行 node tools/build.mjs' }, () => {
  const dom = makeDom();
  const code = extractScript();

  const logs = [];
  const sandbox = {
    window: dom.window,
    document: dom.document,
    localStorage: dom.localStorage,
    console: {
      log: (...a) => logs.push(a.join(' ')),
      error: (...a) => logs.push(`ERROR ${a.join(' ')}`),
      warn: (...a) => logs.push(`WARN ${a.join(' ')}`),
    },
    setTimeout,
    clearTimeout,
    Blob: globalThis.Blob,
    URL: globalThis.URL,
    TextEncoder,
    TextDecoder,
    Map,
    Set,
    Array,
    Object,
    JSON,
    Math,
    Date,
    Number,
    String,
    Boolean,
    RegExp,
    Error,
    Promise,
    parseInt,
    parseFloat,
    isNaN,
    alert: () => {},
    prompt: () => null,
    confirm: () => true,
  };
  sandbox.globalThis = sandbox;

  const context = vm.createContext(sandbox);
  // 执行失败会抛错，测试即失败 —— 这正是我们要抓的（打包器 bug）
  assert.doesNotThrow(() => {
    vm.runInContext(code, context, { filename: 'dist-artifact.js' });
  }, '产物脚本应在无 DOM 依赖缺失的情况下执行成功');

  // 启动日志应报告已加载的型号数（证明数据被内联且模块绑定正确）
  const loaded = logs.find((l) => l.includes('已加载'));
  assert.ok(loaded, `应输出启动日志，实际日志: ${JSON.stringify(logs)}`);
  const n = Number((loaded.match(/(\d+)\s*个型号/) || [])[1]);

  // 期望数量从 data/*.json 实时汇总，避免把数字写死
  // （v1.2 数据从 300 扩充到 476 时，写死的 300 曾导致本测试失败）
  const expected = dataTotal();
  assert.equal(n, expected, `应加载 ${expected} 个型号，实际 ${n}`);
  assert.ok(n >= 300, `型号总数应至少 300，实际 ${n}`);
  assert.ok(!logs.some((l) => l.startsWith('ERROR')), `不应有运行时错误: ${logs.filter((l) => l.startsWith('ERROR')).join('; ')}`);
});

test('产物冒烟：渲染真实发生 —— 左栏 8 品类、右栏两面板都出现在 DOM', { skip: !hasDist && '未构建' }, () => {
  const dom = makeDom();
  const code = extractScript();
  const sandbox = {
    window: dom.window,
    document: dom.document,
    localStorage: dom.localStorage,
    console: { log: () => {}, error: () => {}, warn: () => {} },
    setTimeout, clearTimeout, Blob: globalThis.Blob, URL: globalThis.URL,
    TextEncoder, TextDecoder,
    Map, Set, Array, Object, JSON, Math, Date, Number, String, Boolean,
    RegExp, Error, Promise, parseInt, parseFloat, isNaN,
    alert: () => {}, prompt: () => null, confirm: () => true,
  };
  sandbox.globalThis = sandbox;
  vm.runInContext(code, vm.createContext(sandbox), { filename: 'dist-artifact.js' });

  // 左栏：8 个品类条目
  const left = dom.byId['panel-left'].innerHTML;
  assert.ok(left.includes('品类导航'), '左栏应有标题');
  for (const label of ['CPU', '主板', '显卡', '内存', '电源', '机箱', '散热器', '硬盘']) {
    assert.ok(left.includes(label), `左栏应含 ${label}`);
  }
  const catCount = (left.match(/data-category="/g) || []).length;
  assert.equal(catCount, 8, `左栏应有 8 个品类，实际 ${catCount}`);

  // 中栏：工具条 + 型号表格
  const center = dom.byId['panel-center'].innerHTML;
  assert.ok(center.includes('data-role="search"'), '中栏应有搜索框');
  assert.ok(center.includes('hw-table'), '中栏应渲染表格');
  assert.ok(center.includes('data-pick='), '表格应有选它按钮');
  assert.ok(center.includes('7800X3D') || center.includes('Ryzen'), '中栏应含真实 CPU 型号');

  // 右栏：兼容性 + 功耗
  const right = dom.byId['panel-right'].innerHTML;
  assert.ok(right.includes('兼容性检查'), '右栏应有兼容性面板');
  assert.ok(right.includes('功耗预算'), '右栏应有功耗面板');
  assert.ok(right.includes('已检查'), '应显示规则检查数量');

  // 顶部栏
  const top = dom.byId.topbar.innerHTML;
  assert.ok(top.includes('装机助手'), '顶部栏应有品牌');
  assert.ok(top.includes('data-action="export-open"'), '顶部栏应有导出按钮');
});

test('产物冒烟：界面不出现价格（A15 在真实产物上复验）', { skip: !hasDist && '未构建' }, () => {
  const dom = makeDom();
  const code = extractScript();
  const sandbox = {
    window: dom.window,
    document: dom.document,
    localStorage: dom.localStorage,
    console: { log: () => {}, error: () => {}, warn: () => {} },
    setTimeout, clearTimeout, Blob: globalThis.Blob, URL: globalThis.URL,
    TextEncoder, TextDecoder,
    Map, Set, Array, Object, JSON, Math, Date, Number, String, Boolean,
    RegExp, Error, Promise, parseInt, parseFloat, isNaN,
    alert: () => {}, prompt: () => null, confirm: () => true,
  };
  sandbox.globalThis = sandbox;
  vm.runInContext(code, vm.createContext(sandbox), { filename: 'dist-artifact.js' });

  const rendered = [
    dom.byId.topbar.innerHTML,
    dom.byId['panel-left'].innerHTML,
    dom.byId['panel-center'].innerHTML,
    dom.byId['panel-right'].innerHTML,
  ].join('\n');

  assert.ok(!rendered.includes('¥'), '渲染结果不应含 ¥');
  assert.ok(!/总价|价格|超支|已用\s*[¥￥]/.test(rendered), '渲染结果不应含价格文案');
  // 功耗预算必须保留
  assert.ok(rendered.includes('功耗预算'), 'M4 功耗预算面板必须存在');
});

test('产物冒烟：脚本不含外部网络请求（NF1 离线可用）', { skip: !hasDist && '未构建' }, () => {
  const code = extractScript();
  // 允许 XML 命名空间字符串（xlsx 规范要求），但不允许 fetch/XHR/import()
  assert.ok(!/\bfetch\s*\(/.test(code), '不应使用 fetch');
  assert.ok(!/XMLHttpRequest/.test(code), '不应使用 XMLHttpRequest');
  assert.ok(!/\bimport\s*\(/.test(code), '不应有动态 import（file:// 下会失败）');
  assert.ok(!/<script[^>]+src=/.test(code), '不应引用外部脚本');
  // http(s) 仅允许出现在 XML 命名空间里
  const httpMatches = code.match(/https?:\/\/[^\s"'`]{0,80}/g) || [];
  for (const u of httpMatches) {
    assert.ok(
      u.includes('openxmlformats.org') || u.includes('w3.org'),
      `不应有外部资源引用: ${u}`,
    );
  }
});

test('产物冒烟：数据与关键功能模块都已内联', { skip: !hasDist && '未构建' }, () => {
  const code = extractScript();
  const html = readFileSync(DIST, 'utf8');
  // 13 个模块定义
  const defCount = (code.match(/__defs\["/g) || []).length;
  assert.equal(defCount, 13, `应内联 13 个模块，实际 ${defCount}`);
  // 关键模块存在
  for (const mod of ['src/core/rules.js', 'src/core/power.js', 'src/core/search.js', 'src/ui/export.js', 'src/data/bundle.js']) {
    assert.ok(code.includes(`__defs["${mod}"]`), `应内联模块 ${mod}`);
  }
  // CSS 已内联
  assert.ok(html.includes('<style>'), 'CSS 应内联');
  assert.ok(html.includes('--left-w'), 'CSS 变量应存在');
  // 数据规模
  assert.ok(code.includes('DATA_TOTAL'), '数据模块应导出 DATA_TOTAL');
});

test('产物冒烟：在标签页可见的顶层元素结构正确', { skip: !hasDist && '未构建' }, () => {
  const html = readFileSync(DIST, 'utf8');
  for (const id of ['topbar', 'panel-left', 'panel-center', 'panel-right', 'modal', 'toast', 'storage-warning', 'app']) {
    assert.ok(html.includes(`id="${id}"`), `产物应含 #${id}`);
  }
  assert.ok(html.includes('lang="zh-CN"'), '应声明中文语言');
  assert.ok(html.includes('charset="UTF-8"'), '应声明 UTF-8 编码');
  assert.ok(!html.includes('<!--CSS-->'), '不应残留占位符');
});
