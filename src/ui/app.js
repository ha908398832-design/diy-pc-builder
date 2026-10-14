/**
 * 应用入口：把 store / rules / render 串起来并绑定 DOM 事件
 *
 * 分层：本文件是唯一接触 DOM 的写入方（配合 render.js 的纯字符串输出）。
 * 因此核心逻辑可以完整单测，而本层保持薄。
 */

import { DATA, buildIndex } from '../data/bundle.js';
import { Store } from '../core/store.js';
import { checkCompatibility, checkCandidate } from '../core/rules.js';
import { computeStatusLights, countFindings, selectionSummary } from '../core/status.js';
import { queryList, FILTER_DEFS, collectOptions } from '../core/search.js';
import { RULES, RULE_MAP } from '../core/rules-data.js';
import { CATEGORY_LABELS, CATEGORY_ORDER } from '../core/enums.js';
import { buildImportReport, mergeRecords, stripCustom, buildTemplateCsv } from '../core/csv.js';
import { buildExport, downloadBlob } from './export.js';
import {
  renderLeftPanel, renderToolbar, renderTable, renderCards, renderDetail,
  renderCompare, renderCompatPanel, renderPowerPanel, renderTopBar,
  renderRulesHelp, renderEmptyGuide, renderSchemeManager, renderStaleBanner,
  renderOverview, TABLE_COLUMNS,
} from './render.js';

// ══════════════════════════════════════════════════════════════════
// 库：内置数据 + 自定义数据 合并
// ══════════════════════════════════════════════════════════════════

const store = new Store();

/**
 * 取得合并后的某品类数据（内置 + 自定义；自定义优先覆盖同 id）
 */
function listOf(category) {
  const builtin = DATA[category] || [];
  const custom = store.state.custom?.[category] || [];
  if (custom.length === 0) return builtin;
  const byId = new Map(builtin.map((r) => [r.id, r]));
  for (const r of custom) byId.set(r.id, r);
  return [...byId.values()];
}

/** 全库索引（含自定义），供规则引擎解析 ID */
function indexAll() {
  const m = new Map();
  for (const cat of CATEGORY_ORDER) {
    for (const r of listOf(cat)) m.set(r.id, r);
  }
  return m;
}

/** 取得配置中某品类已选记录（硬盘为数组） */
function selectedOf(category, byId) {
  const v = store.state.config[category];
  if (category === 'storage') {
    const arr = Array.isArray(v) ? v : v ? [v] : [];
    return arr.map((id) => byId.get(id)).filter(Boolean);
  }
  return v ? byId.get(v) || null : null;
}

// ══════════════════════════════════════════════════════════════════
// 派生数据：一次计算，多处复用
// ══════════════════════════════════════════════════════════════════

function derive() {
  const byId = indexAll();
  // 规则引擎需要「已解析」的对象形态
  const resolved = {};
  for (const cat of CATEGORY_ORDER) resolved[cat] = selectedOf(cat, byId);

  const result = checkCompatibility({ resolved, config: store.state.config });
  // 传入 resolved：让状态灯能识别「配置里的 ID 在型号库中找不到」的情况，
  // 否则失效引用会显示成绿色「正常」（它其实没有任何配件）
  const lights = computeStatusLights({
    findings: result.findings,
    config: store.state.config,
    resolved,
  });
  const ruleCounts = countFindings(result.findings);
  const summary = selectionSummary(store.state.config);

  return { byId, resolved, result, lights, ruleCounts, summary };
}

/** 中栏当前列表（搜索/筛选/排序 + 行内兼容标记） */
function visibleList(byId, resolved) {
  const { category, query, filters, sort, includeUsed } = store.state.ui;
  const list = listOf(category);

  const { items, total, matched } = queryList({
    list, category, query, filters, sort, includeUsed,
  });

  // 行内兼容标记：只对可见的前若干条计算，避免大列表卡顿
  const LIMIT = 200;
  const checkMap = new Map();
  for (const rec of items.slice(0, LIMIT)) {
    checkMap.set(rec.id, checkCandidate(category, rec, store.state.config, byId));
  }

  return { category, items, total, matched, checkMap, list };
}

// ══════════════════════════════════════════════════════════════════
// 主题（浅色 / 深色）
// ══════════════════════════════════════════════════════════════════

const THEME_KEY = 'zhuangji:theme';

/** 读取偏好主题；未设置时跟随系统 */
function getTheme() {
  try {
    const saved = localStorage?.getItem?.(THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch { /* localStorage 不可用时忽略 */ }
  try {
    if (window?.matchMedia?.('(prefers-color-scheme: light)').matches) return 'light';
  } catch { /* 不支持则回落深色 */ }
  return 'dark';
}

/** 应用主题到 <html data-theme> */
function applyTheme(theme) {
  // 容错：某些环境（极简 DOM、SSR、测试 shim）可能没有 documentElement
  const el = document?.documentElement;
  if (el && typeof el.setAttribute === 'function') {
    el.setAttribute('data-theme', theme);
  }
}

/** 切换并持久化 */
function toggleTheme() {
  const next = getTheme() === 'dark' ? 'light' : 'dark';
  try { localStorage?.setItem?.(THEME_KEY, next); } catch { /* 忽略写入失败 */ }
  applyTheme(next);
  render();
  toast(next === 'light' ? '已切换到浅色主题' : '已切换到深色主题');
}

// ══════════════════════════════════════════════════════════════════
// 辅助
// ══════════════════════════════════════════════════════════════════

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/**
 * 读取容器内某子元素的 scrollTop（用于跨重渲染保持滚动位置）
 * 容��不存在或尚未渲染时返回 0。
 */
function readScroll(root, selector) {
  try {
    const el = root?.querySelector?.(selector);
    return el && typeof el.scrollTop === 'number' ? el.scrollTop : 0;
  } catch {
    return 0;
  }
}

/**
 * 恢复 scrollTop
 * 说明：内容尚未撑开时（scrollHeight 尚未更新）设置 scrollTop 会被浏览器忽略，
 * 因此在下一帧再补一次，确保长列表也能正确还原。
 */
function restoreScroll(el, top) {
  if (!el || !top) return;
  try {
    if (typeof el.scrollTop === 'number') el.scrollTop = top;
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        try { el.scrollTop = top; } catch { /* 元素可能已卸载 */ }
      });
    }
  } catch { /* 忽略：元素可能已卸载 */ }
}

function render() {
  const s = store.state;
  const d = derive();
  const v = visibleList(d.byId, d.resolved);

  // 失效引用提示（数据升级后旧配置引用了不存在的型号）
  const invalidCats = Object.entries(d.lights.lights)
    .filter(([, lv]) => lv === 'invalid')
    .map(([cat]) => cat);
  const banner = $('#stale-banner-slot');
  if (banner) {
    banner.innerHTML = s.ui.staleDismissed ? '' : renderStaleBanner(invalidCats);
  }

  // 顶部栏
  $('#topbar').innerHTML = renderTopBar({
    schemes: store.schemeNames(),
    currentScheme: s.currentScheme,
    dirty: s.dirty,
    theme: getTheme(),
  });

  // 配置概览（数字条）
  $('#overview-slot').innerHTML = renderOverview({
    summary: d.summary,
    counts: d.result.counts,
    power: d.result.power,
    onSuggestPsu: true,
  });

  // 左栏
  $('#panel-left').innerHTML = renderLeftPanel({
    config: s.config,
    byId: d.byId,
    lights: d.lights.lights,
    active: s.ui.category,
    summary: d.summary,
    ruleCounts: d.ruleCounts,
  });

  // 中栏
  const compareRecs = (s.ui.compare || []).map((id) => d.byId.get(id)).filter(Boolean);
  const detailRec = s.ui.selectedDetail ? d.byId.get(s.ui.selectedDetail) : null;

  // 默认隐藏的二手/矿卡/洋垃圾数量。
  // 库里有大量二手主流型号，但 PRD M7-11 规定默认不显示；
  // 若不提示数量，用户会以为"没有二手可选"。
  const usedCount = v.list.filter((r) => r.condition && r.condition !== 'new').length;

  // 保留滚动位置：中栏每次都整体重建 innerHTML，新元素默认 scrollTop=0，
  // 会导致「点一行看详情 → 列表跳回顶部」。这里先记录旧值，渲染后恢复。
  const centerEl = $('#panel-center');
  const prevListScroll = readScroll(centerEl, '.list-wrap');
  const prevDetailScroll = readScroll(centerEl, '.detail-zone');

  // 详情区按需展开：只有选中了型号或勾选了对比才显示，否则不占空间
  const showDetail = compareRecs.length >= 2 || !!detailRec;
  centerEl.classList.toggle('detail-open', showDetail);

  centerEl.innerHTML = `
    ${renderToolbar({
      category: s.ui.category,
      query: s.ui.query,
      view: s.ui.view,
      sort: s.ui.sort,
      includeUsed: s.ui.includeUsed,
      usedCount,
    })}
    <div class="list-meta">
      <span>共 ${v.total} 个型号</span>
      <span>匹配 <b>${v.matched}</b></span>
      ${!showDetail
        ? '<span class="meta-tip">点击任一行可展开参数详情 · 勾选 2~4 个可并排对比</span>'
        : ''}
      ${s.ui.query ? `<span class="muted">搜索「${escapeHtml(s.ui.query)}」</span>` : ''}
      ${!s.ui.includeUsed && usedCount > 0
        ? `<span class="muted">已隐藏 ${usedCount} 个二手/矿卡/洋垃圾（勾选上方「含二手」查看）</span>`
        : ''}
    </div>
    <div class="list-wrap">
      ${v.items.length === 0 && !s.ui.query && Object.keys(s.ui.filters).length === 0
        ? renderEmptyGuide()
        : (s.ui.view === 'card'
            ? renderCards({ category: s.ui.category, items: v.items, checkCandidate: (r) => v.checkMap.get(r.id), isSelected: (r) => isSelected(r) })
            : renderTable({ category: s.ui.category, items: v.items, checkCandidate: (r) => v.checkMap.get(r.id), isSelected: (r) => isSelected(r), compareIds: s.ui.compare }))}
    </div>
    ${showDetail ? `
    <div class="detail-zone" id="detail-zone">
      <button type="button" class="detail-close" data-action="close-detail"
              title="收起参数详情（Esc）" aria-label="收起参数详情">✕ 收起</button>
      ${compareRecs.length >= 2
        ? renderCompare({ category: s.ui.category, records: compareRecs, checkCandidate: (r) => checkCandidate(s.ui.category, r, s.config, d.byId) })
        : renderDetail({
            category: s.ui.category,
            record: detailRec,
            candidateCheck: detailRec ? checkCandidate(s.ui.category, detailRec, s.config, d.byId) : null,
          })}
    </div>` : ''}`;

  // 恢复滚动位置（见上方说明）
  restoreScroll($('.list-wrap', centerEl), prevListScroll);
  restoreScroll($('.detail-zone', centerEl), prevDetailScroll);

  // 右栏
  $('#panel-right').innerHTML = `
    ${renderCompatPanel({
      findings: d.result.findings,
      counts: d.result.counts,
      checked: d.result.checked,
      skipped: d.result.skipped,
      filter: s.ui.findingFilter,
    })}
    <div class="right-divider"></div>
    ${renderPowerPanel({ power: d.result.power })}`;

  // 右栏收起状态
  document.body.classList.toggle('right-collapsed', !!s.ui.rightCollapsed);

  // 存储降级提示
  const warn = $('#storage-warning');
  if (warn) {
    if (store.storageWarning) {
      warn.textContent = `⚠ ${store.storageWarning}`;
      warn.hidden = false;
    } else {
      warn.hidden = true;
    }
  }
}

function isSelected(rec) {
  const cfg = store.state.config;
  if (rec.category === 'storage') {
    return Array.isArray(cfg.storage) && cfg.storage.includes(rec.id);
  }
  return cfg[rec.category] === rec.id;
}

// ══════════════════════════════════════════════════════════════════
// 事件绑定（委托到根节点，避免每次渲染重绑）
// ══════════════════════════════════════════════════════════════════

function bindEvents() {
  const root = document.getElementById('app');

  root.addEventListener('click', (e) => {
    const t = e.target.closest('button, [data-category]');
    if (!t) return;

    // 品类切换
    if (t.dataset.category) {
      store.setCategory(t.dataset.category);
      return;
    }

    // 选择 / 取消
    if (t.dataset.pick) {
      const byId = indexAll();
      const rec = byId.get(t.dataset.pick);
      if (!rec) return;
      const cat = rec.category;
      if (isSelected(rec)) store.deselect(cat, rec.id);
      else store.select(cat, rec.id);
      return;
    }

    // 加入对比
    if (t.dataset.compareAdd) {
      store.toggleCompare(t.dataset.compareAdd);
      return;
    }

    // 跳转到冲突品类
    if (t.dataset.goto) {
      store.setCategory(t.dataset.goto);
      return;
    }

    // 方案操作（M8）
    if (t.dataset.schemeLoad) { store.loadScheme(t.dataset.schemeLoad); closeModal(); toast(`已载入方案「${t.dataset.schemeLoad}」`); return; }
    if (t.dataset.schemeRename) { promptRenameScheme(t.dataset.schemeRename); return; }
    if (t.dataset.schemeDelete) { promptDeleteScheme(t.dataset.schemeDelete); return; }

    // 过滤右栏
    if (t.dataset.filter) {
      store.setFindingFilter(t.dataset.filter);
      return;
    }

    // 视图切换
    if (t.dataset.view) {
      store.setView(t.dataset.view);
      return;
    }

    // 快捷标签
    if (t.dataset.quick) {
      applyQuickTag(t.dataset.quick);
      return;
    }

    // 规则编号 → 规则说明
    if (t.dataset.rule) {
      openRulesHelp(t.dataset.rule);
      return;
    }

    // 全局操作
    switch (t.dataset.action) {
      case 'reset-all':
        if (confirm('确定清空全部已选配件吗？（已保存的方案不受影响）')) store.resetAll();
        break;
      case 'recheck':
        render();
        break;
      case 'compare-clear':
        store.clearCompare();
        break;
      case 'close-detail':
        // 收起参数详情：清空详情选中与对比勾选
        store.update((st) => {
          st.ui.selectedDetail = null;
          st.ui.compare = [];
        }, 'close-detail');
        break;
      case 'toggle-right':
        store.toggleRightCollapsed();
        break;
      case 'toggle-theme':
        toggleTheme();
        break;
      case 'sort-dir':
        store.toggleSortDir();
        break;
      case 'save':
        promptSaveScheme();
        break;
      case 'scheme-new':
        store.resetAll();
        break;
      case 'scheme-manage':
        openSchemeManager();
        break;
      case 'clear-stale': {
        // 清除失效引用：只清掉「配置里有 ID 但库里找不到」的项，其余配置保持
        const dd = derive();
        const stale = Object.entries(dd.lights.lights)
          .filter(([, lv]) => lv === 'invalid')
          .map(([cat]) => cat);
        if (stale.length === 0) break;
        store.update((st) => {
          for (const cat of stale) {
            if (cat === 'storage') st.config.storage = [];
            else st.config[cat] = null;
          }
          st.ui.staleDismissed = false;
        }, 'clear-stale');
        toast(`已清除 ${stale.length} 个失效配件，请重新选择`);
        break;
      }
      case 'dismiss-stale':
        store.update((st) => { st.ui.staleDismissed = true; }, 'dismiss-stale');
        break;
      case 'compare-open':
        openSchemeCompare();
        break;
      case 'export-open':
        openExport();
        break;
      case 'import-open':
        openImport();
        break;
      case 'rules-help':
        openRulesHelp();
        break;
      case 'suggest-psu': {
        // 按建议瓦数跳到电源并设置瓦数下限筛选
        const watts = Number(t.dataset.watts) || 0;
        store.update((s) => {
          s.ui.category = 'psu';
          s.ui.filters = { wattage: { min: watts } };
          s.ui.query = '';
        }, 'suggest-psu');
        break;
      }
      case 'show-power-detail':
        alert(powerDetailText());
        break;
      case 'modal-close':
        closeModal();
        break;
      default:
        break;
    }
  });

  // 搜索输入（输入即搜）
  root.addEventListener('input', (e) => {
    const el = e.target;
    if (el.dataset.role === 'search') {
      store.setQuery(el.value);
      // 保持焦点与光标位置
      const pos = el.selectionStart;
      render();
      const next = $('[data-role="search"]');
      if (next) {
        next.focus();
        try { next.setSelectionRange(pos, pos); } catch { /* 忽略 */ }
      }
    }
    if (el.dataset.role === 'rules-search') {
      const html = renderRulesHelp({ rules: RULES, query: el.value });
      $('#modal-body').innerHTML = html;
      const box = $('#modal-body [data-role="rules-search"]');
      if (box) { box.focus(); box.setSelectionRange(el.value.length, el.value.length); }
    }
  });

  // 下拉与勾选
  root.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.role === 'sort-key') {
      store.setSort(el.value, store.state.ui.sort?.dir || 'asc');
    }
    if (el.dataset.role === 'include-used') {
      store.setIncludeUsed(el.checked);
    }
    if (el.dataset.role === 'scheme') {
      if (el.value) store.loadScheme(el.value);
    }
    if (el.dataset.compare !== undefined) {
      store.toggleCompare(el.dataset.compare);
    }
    if (el.dataset.role === 'filter-field') {
      const { key, type } = parseFilterDataset(el);
      if (type === 'boolean') store.setFilter(key, el.checked || undefined);
      else store.setFilter(key, el.value || undefined);
    }
    if (el.dataset.role === 'filter-range') {
      const { key, bound } = parseFilterDataset(el);
      const cur = store.state.ui.filters[key] || {};
      store.setFilter(key, { ...cur, [bound]: el.value === '' ? '' : Number(el.value) });
    }
  });

  // 双击行直接加入配置
  root.addEventListener('dblclick', (e) => {
    const row = e.target.closest('.hw-row, .hw-card');
    if (!row) return;
    const byId = indexAll();
    const rec = byId.get(row.dataset.id);
    if (rec && !isSelected(rec)) store.select(rec.category, rec.id);
  });

  // 单击行显示详情
  root.addEventListener('click', (e) => {
    const row = e.target.closest('.hw-row, .hw-card');
    if (!row) return;
    if (e.target.closest('button, input')) return; // 按钮/勾选框已单独处理
    store.setDetail(row.dataset.id);
  });

  // 键盘快捷键（PRD 6.11）
  document.addEventListener('keydown', (e) => {
    // Ctrl+S 保存 / Ctrl+E 导出
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      promptSaveScheme();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e') {
      e.preventDefault();
      openExport();
      return;
    }
    if (e.key === 'Escape') {
      // 弹窗优先关闭；没有弹窗时收起参数详情
      const modal = $('#modal');
      if (modal && !modal.hidden) {
        closeModal();
      } else if (store.state.ui.selectedDetail || (store.state.ui.compare || []).length) {
        store.update((st) => {
          st.ui.selectedDetail = null;
          st.ui.compare = [];
        }, 'close-detail');
      }
      return;
    }
    const inInput = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
    if (e.key === '/' && !inInput) {
      e.preventDefault();
      $('[data-role="search"]')?.focus();
      return;
    }
    // 1~8 切品类
    if (!inInput && /^[1-8]$/.test(e.key)) {
      const cat = CATEGORY_ORDER[Number(e.key) - 1];
      if (cat) store.setCategory(cat);
    }
  });

  // 订阅 store 变更 → 重渲染
  store.subscribe(() => render());
}

// ══════════════════════════════════════════════════════════════════
// 快捷标签与筛选面板
// ══════════════════════════════════════════════════════════════════

function applyQuickTag(tag) {
  store.update((s) => {
    s.ui.query = '';
    switch (tag) {
      case 'all': s.ui.filters = {}; break;
      case 'igpu': s.ui.filters = { igpu: true }; break;
      case 'unlocked': s.ui.filters = { unlocked: true }; break;
      case 'lowPower': {
        const cat = s.ui.category;
        if (cat === 'cpu') s.ui.filters = { maxPower: { max: 65 } };
        else if (cat === 'gpu') s.ui.filters = { tdp: { max: 150 } };
        else s.ui.filters = {};
        break;
      }
      case 'highPower': s.ui.filters = { wattage: { min: 750 } }; break;
      case 'short': s.ui.filters = { length_mm: { max: 250 } }; break;
      case 'longGpu': s.ui.filters = { maxGpuLength: { min: 350 } }; break;
      case 'tallCooler': s.ui.filters = { maxCoolerHeight: { min: 160 } }; break;
      case 'lowProfile': s.ui.filters = { height_mm: { max: 70 } }; break;
      case 'dram': s.ui.filters = { dram: true }; break;
      default: {
        // 形如 brand:AMD / formFactor:M-ATX / modules:2
        const [key, val] = tag.split(':');
        if (!key || val === undefined) { s.ui.filters = {}; break; }
        const num = Number(val);
        s.ui.filters = { [key]: Number.isFinite(num) && String(num) === val ? num : val };
      }
    }
  }, 'quick-tag');
}

function parseFilterDataset(el) {
  return {
    key: el.dataset.key,
    type: el.dataset.type,
    bound: el.dataset.bound,
    values: el.dataset.values ? el.dataset.values.split(';') : null,
  };
}

// ══════════════════════════════════════════════════════════════════
// 弹窗
// ══════════════════════════════════════════════════════════════════

function openModal(title, bodyHtml) {
  const m = $('#modal');
  m.hidden = false;
  $('#modal-body').innerHTML = bodyHtml;
}

function closeModal() {
  const m = $('#modal');
  if (m) m.hidden = true;
  const inp = $('#file-input');
  if (inp) inp.value = '';
}

function openRulesHelp(highlightId = null) {
  openModal('规则说明', renderRulesHelp({ rules: RULES, query: highlightId || '' }));
}

/** 保存方案 */
function promptSaveScheme() {
  const names = store.schemeNames();
  const suggest = store.state.currentScheme || `方案 ${names.length + 1}`;
  const name = prompt('方案名称：', suggest);
  if (!name) return;
  const trimmed = name.trim();
  if (!trimmed) return;

  // 覆盖已存在的方案时明确确认，避免误覆盖
  if (names.includes(trimmed) && trimmed !== store.state.currentScheme) {
    if (!confirm(`方案「${trimmed}」已存在，要覆盖它吗？`)) return;
  }
  store.saveScheme(trimmed);
  toast(`已保存方案「${trimmed}」`);
}

/** 组装方案管理所需的数据（含每套方案的配件数、兼容性、功耗） */
function schemeRows() {
  const byId = indexAll();
  return store.schemeNames().map((name) => {
    const scheme = store.state.schemes[name];
    const cfg = scheme?.config || {};
    let parts = 0;
    for (const cat of CATEGORY_ORDER) {
      const v = cfg[cat];
      if (cat === 'storage') parts += Array.isArray(v) ? v.length : 0;
      else if (v) parts += 1;
    }
    const res = checkCompatibility({ config: cfg, byId });
    return {
      name,
      savedAt: scheme?.savedAt,
      parts,
      counts: res.counts,
      peak: res.power?.peak ?? null,
    };
  });
}

/** 打开方案管理（新建 / 载入 / 重命名 / 删除） */
function openSchemeManager() {
  openModal('方案管理', renderSchemeManager({
    schemes: schemeRows(),
    currentScheme: store.state.currentScheme,
  }));
}

/** 重命名方案（带重复名与空名校验） */
function promptRenameScheme(oldName) {
  const next = prompt('新的方案名称：', oldName);
  if (next === null) return;               // 用户取消
  const trimmed = next.trim();
  if (!trimmed) { toast('方案名不能为空'); return; }
  if (trimmed === oldName) return;          // 没改
  if (store.schemeNames().includes(trimmed)) {
    toast(`已存在名为「${trimmed}」的方案`);
    return;
  }
  store.renameScheme(oldName, trimmed);
  toast(`已重命名为「${trimmed}」`);
  openSchemeManager();                      // 刷新列表
}

/** 删除方案（二次确认） */
function promptDeleteScheme(name) {
  const scheme = store.state.schemes[name];
  if (!scheme) return;
  if (!confirm(`确定删除方案「${name}」吗？此操作不可撤销。`)) return;

  const wasCurrent = store.state.currentScheme === name;
  store.deleteScheme(name);
  toast(wasCurrent ? `已删除方案「${name}」（当前配置保持不变）` : `已删除方案「${name}」`);
  openSchemeManager();                      // 刷新列表
}

/** 方案对比（PRD 6.7.1：只比型号、兼容性、功耗，不含价格） */
function openSchemeCompare() {
  const names = store.schemeNames();
  if (names.length < 2) {
    openModal('方案对比', '<div class="empty-hint">至少需要保存 2 套方案才能对比。先选好一套配置点「💾保存」。</div>');
    return;
  }
  const a = names[0];
  const b = names[1];
  const byId = indexAll();
  const rows = [];
  for (const cat of CATEGORY_ORDER) {
    const idA = (store.state.schemes[a].config || {})[cat];
    const idB = (store.state.schemes[b].config || {})[cat];
    const recA = cat === 'storage'
      ? (Array.isArray(idA) ? idA : []).map((x) => byId.get(x)).filter(Boolean)[0]
      : byId.get(idA);
    const recB = cat === 'storage'
      ? (Array.isArray(idB) ? idB : []).map((x) => byId.get(x)).filter(Boolean)[0]
      : byId.get(idB);
    const same = (recA?.id || null) === (recB?.id || null);
    rows.push(`
      <tr class="${same ? '' : 'row-diff'}">
        <th class="k">${CATEGORY_LABELS[cat]}</th>
        <td>${recA ? escapeHtml(recA.name) : '未选'}</td>
        <td>${recB ? escapeHtml(recB.name) : '未选'}</td>
        <td>${same ? '相同' : '不同'}</td>
      </tr>`);
  }

  // 各自跑一次兼容性与功耗
  const stat = (name) => {
    const cfg = store.state.schemes[name].config || {};
    const res = checkCompatibility({ config: cfg, byId });
    return { res };
  };
  const sa = stat(a);
  const sb = stat(b);

  openModal('方案对比', `
    <div class="modal-toolbar">
      <label>左：<select id="cmp-left">${names.map((n) => `<option${n === a ? ' selected' : ''}>${escapeHtml(n)}</option>`).join('')}</select></label>
      <label>右：<select id="cmp-right">${names.map((n) => `<option${n === b ? ' selected' : ''}>${escapeHtml(n)}</option>`).join('')}</select></label>
    </div>
    <table class="compare-table scheme-compare">
      <thead><tr><th class="k">部件</th><th>${escapeHtml(a)}</th><th>${escapeHtml(b)}</th><th>差异</th></tr></thead>
      <tbody>
        ${rows.join('')}
        <tr class="compat-row">
          <th class="k">兼容性</th>
          <td>🔴${sa.res.counts.error} 🟡${sa.res.counts.warn}</td>
          <td>🔴${sb.res.counts.error} 🟡${sb.res.counts.warn}</td>
          <td>—</td>
        </tr>
        <tr class="compat-row">
          <th class="k">功耗</th>
          <td>${sa.res.power.peak}W / ${sa.res.power.psuWattage ?? '未选'}W</td>
          <td>${sb.res.power.peak}W / ${sb.res.power.psuWattage ?? '未选'}W</td>
          <td>—</td>
        </tr>
      </tbody>
    </table>`);
}

/** 导出（M9） */
function openExport() {
  const d = derive();
  openModal('导出清单', `
    <div class="modal-toolbar">
      <label>格式：
        <select id="exp-format">
          <option value="xlsx">表格 (.xlsx)</option>
          <option value="csv">CSV（Excel 可直接打开）</option>
          <option value="text">纯文本</option>
        </select>
      </label>
    </div>
    <div class="exp-options">
      <label><input type="checkbox" id="exp-params" checked> 关键参数摘要</label>
      <label><input type="checkbox" id="exp-notes" checked> 兼容性备注</label>
      <label><input type="checkbox" id="exp-used"> 二手风险提示</label>
    </div>
    <div class="exp-preview" id="exp-preview"></div>
    <div class="modal-actions">
      <button type="button" class="btn-primary" id="exp-do">导出</button>
      <button type="button" class="btn-ghost" data-action="modal-close">取消</button>
    </div>`);

  const preview = () => {
    const fmt = $('#exp-format').value;
    const opts = {
      includeParams: $('#exp-params').checked,
      includeNotes: $('#exp-notes').checked,
      includeUsedWarning: $('#exp-used').checked,
      format: fmt,
    };
    const out = buildExport(d.resolved, d.result, opts);
    $('#exp-preview').innerHTML = `<pre>${escapeHtml(out.preview)}</pre>`;
    return out;
  };

  preview();
  for (const id of ['exp-format', 'exp-params', 'exp-notes', 'exp-used']) {
    $(`#${id}`).addEventListener('change', preview);
  }
  $('#exp-do').addEventListener('click', () => {
    const out = preview();
    downloadBlob(out.filename, out.blob);
    toast(`已导出 ${out.filename}`);
  });
}

/** CSV 导入（M2） */
function openImport() {
  openModal('导入硬件数据', `
    <div class="modal-toolbar">
      <label>1️⃣ 品类：
        <select id="imp-cat">
          ${CATEGORY_ORDER.map((c) => `<option value="${c}">${CATEGORY_LABELS[c]}</option>`).join('')}
        </select>
      </label>
      <label>2️⃣ 文件：<input type="file" id="imp-file" accept=".csv,text/csv"></label>
      <button type="button" class="btn-ghost" id="imp-template">下载空白模板</button>
    </div>
    <div id="imp-report" class="imp-report"><div class="empty-hint">选择 CSV 文件后在这里显示校验报告。</div></div>
    <div class="modal-actions">
      <span class="muted">重名处理：</span>
      <label><input type="radio" name="imp-dup" value="skip" checked> 跳过</label>
      <label><input type="radio" name="imp-dup" value="overwrite"> 覆盖</label>
      <label><input type="radio" name="imp-dup" value="keep-both"> 并存</label>
      <button type="button" class="btn-primary" id="imp-do" disabled>确认导入</button>
      <button type="button" class="btn-ghost" data-action="modal-close">取消</button>
    </div>`);

  let pending = null;

  $('#imp-template').addEventListener('click', () => {
    const cat = $('#imp-cat').value;
    const csv = buildTemplateCsv(cat);
    downloadBlob(`${cat}-模板.csv`, new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  });

  $('#imp-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const cat = $('#imp-cat').value;
    const text = await file.text();
    const existing = listOf(cat).filter((r) => !r.custom);
    const report = buildImportReport(text, cat, existing);
    pending = { cat, report };

    const dup = report.duplicates.length;
    $('#imp-report').innerHTML = `
      <div class="imp-summary">
        <div class="ok">✅ 可用 ${report.summary.valid} 条</div>
        <div class="warn">⚠ 非法 ${report.summary.invalid} 条（将跳过）</div>
        <div class="warn">⚠ 重名 ${dup} 条</div>
      </div>
      ${report.invalid.length ? `<details><summary>查看非法明细</summary><ul>${report.invalid.map((i) => `<li>第 ${i.row} 行：${escapeHtml(i.errors.join('；'))}</li>`).join('')}</ul></details>` : ''}
      ${dup ? `<details><summary>查看重名明细</summary><ul>${report.duplicates.map((i) => `<li>第 ${i.row} 行：${escapeHtml(i.id)}${i.inFile ? '（文件内重复）' : '（与现有型号同名）'}</li>`).join('')}</ul></details>` : ''}
      ${report.warnings.length ? `<div class="muted small">${escapeHtml(report.warnings.join('；'))}</div>` : ''}`;
    $('#imp-do').disabled = report.summary.valid + dup === 0;
  });

  $('#imp-do').addEventListener('click', () => {
    if (!pending) return;
    const strategy = document.querySelector('input[name="imp-dup"]:checked')?.value || 'skip';
    const { cat, report } = pending;
    const existing = listOf(cat).filter((r) => !r.custom);
    const merged = mergeRecords(existing, report, strategy);
    store.setCustom(cat, merged.merged.filter((r) => r.custom));
    closeModal();
    toast(`已导入 ${merged.added} 条（覆盖 ${merged.overwritten}、跳过 ${merged.skipped}、并存 ${merged.renamed}）`);
  });
}

// ══════════════════════════════════════════════════════════════════
// 辅助
// ══════════════════════════════════════════════════════════════════

function powerDetailText() {
  const d = derive();
  const p = d.result.power;
  const lines = p.breakdown.map((b) => `${b.label}：${b.watts}W\n    ${b.basis}`);
  lines.push('', `整机峰值：${p.peak}W`, `建议电源：≥${p.recommendedPsu}W（峰值 ×1.4 向上取 50W 档）`);
  if (p.psuWattage !== null) lines.push(`当前电源：${p.psuWattage}W，余量 ${p.margin}%`);
  return lines.join('\n');
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2000);
}

// ══════════════════════════════════════════════════════════════════
// 启动
// ══════════════════════════════════════════════════════════════════

export function start() {
  applyTheme(getTheme());
  render();
  bindEvents();
  // 启动时把数据规模写到控制台，便于确认内联数据已加载
  console.log(`[装机助手] 已加载 ${[...CATEGORY_ORDER].reduce((n, c) => n + listOf(c).length, 0)} 个型号`);
}

// 供调试与测试使用
export { store, listOf, indexAll, selectedOf, derive, visibleList };

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
}
