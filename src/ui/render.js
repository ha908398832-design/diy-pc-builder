/**
 * 视图渲染（纯函数层）
 *
 * 设计：本模块只做「数据 → HTML 字符串」，不接触 DOM，也不注册事件。
 * 好处是可在 Node 中用单测验证渲染结果（转义是否正确、冲突标记是否出现、
 * 价格是否泄漏等），而不需要浏览器环境。DOM 挂载与事件绑定在 app.js。
 *
 * 安全：所有来自数据/CSV 导入的文本一律经 esc() 转义，防止 HTML 注入。
 */

import {
  CATEGORY_LABELS, CATEGORY_ORDER, CONDITION_LABELS, STATUS_ICONS,
  COOLER_TYPE_LABELS, LEVEL_LABELS, LEVEL_ICONS,
} from '../core/enums.js';
import { FILTER_DEFS, SORT_DEFS, conditionLabel } from '../core/search.js';
import { groupByChipset, isGrouped, formatRange, isSingleVariant, variantsOf } from '../core/grouping.js';

// ══════════════════════════════════════════════════════════════════
// 基础工具
// ══════════════════════════════════════════════════════════════════

/**
 * HTML 转义
 * 用户可通过 CSV 导入任意文本，必须转义后再插入 DOM
 */
export function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const nz = (v) => (v === null || v === undefined || v === '' ? '—' : String(v));

const fmtW = (v) => (typeof v === 'number' ? `${v}W` : '—');
const fmtMm = (v) => (typeof v === 'number' ? `${v}mm` : '—');

/** 生成 class 名 */
const cls = (...parts) => parts.filter(Boolean).join(' ');

// ══════════════════════════════════════════════════════════════════
// 左栏 · 品类导航（PRD 6.4）
// ══════════════════════════════════════════════════════════════════

/**
 * @param {object} o
 * @param {object} o.config     已选配置（ID 引用）
 * @param {object} o.byId       id → 记录
 * @param {object} o.lights     品类状态灯（status.js 输出）
 * @param {string} o.active     当前品类
 * @param {object} o.summary    已选统计
 * @param {object} o.ruleCounts 规则条数统计（右栏口径）
 */
export function renderLeftPanel({ config = {}, byId, lights = {}, active, summary, ruleCounts }) {
  const rows = CATEGORY_ORDER.map((cat) => {
    const v = config[cat];
    const ids = cat === 'storage'
      ? (Array.isArray(v) ? v : v ? [v] : [])
      : (v ? [v] : []);
    const selected = ids.length > 0;
    const recs = ids.map((id) => (byId?.get ? byId.get(id) : null)).filter(Boolean);

    const light = lights[cat] || (selected ? 'ok' : 'unselected');
    const icon = STATUS_ICONS[light] || '⚪';
    // 失效引用：配置里有 ID 但库里找不到对应型号
    const isInvalid = light === 'invalid';

    const shortName = recs.length
      ? (recs[0].name.length > 12 ? `${recs[0].name.slice(0, 11)}…` : recs[0].name)
      : (isInvalid ? '型号已失效' : '未选');

    const titleText = isInvalid
      ? `${CATEGORY_LABELS[cat]}：已选型号在当前型号库中不存在（可能是数据更新后该型号被移除，或你清除了导入的自定义数据）。请重新选择。`
      : `${CATEGORY_LABELS[cat]}：${recs.map((r) => r.name).join('、') || '未选择'}`;

    return `
      <li class="${cls('cat-item', active === cat && 'is-active', !selected && 'is-empty', isInvalid && 'is-invalid')}"
          data-category="${esc(cat)}"
          title="${esc(titleText)}">
        <div class="cat-head">
          <span class="cat-name">${esc(CATEGORY_LABELS[cat])}</span>
          <span class="cat-light" data-level="${esc(light)}">${icon}</span>
        </div>
        <span class="cat-value">${esc(shortName)}</span>
      </li>`;
  }).join('');

  const rc = ruleCounts || { error: 0, warn: 0, info: 0 };

  return `
    <div class="panel-head">
      <h2>品类导航</h2>
      <button type="button" class="btn-ghost" data-action="reset-all" title="清空全部选择">全部重置</button>
    </div>
    <ul class="cat-list">${rows}</ul>
    <div class="panel-foot">
      <div class="foot-line">
        <span>已选 <b data-role="selected-count">${summary?.selected ?? 0}</b> / ${summary?.total ?? 8}</span>
        <span class="muted">未选 ${summary?.unselected ?? 8}</span>
      </div>
      <div class="foot-line rule-counts" title="按规则条数统计">
        <span class="lv lv-error">🔴 ${rc.error}</span>
        <span class="lv lv-warn">🟡 ${rc.warn}</span>
        <span class="lv lv-info">🔵 ${rc.info}</span>
      </div>
    </div>`;
}

/**
 * 配置概览（数字条）
 *
 * 置于工作区顶部，把「这次配得怎么样」压缩成 4 个可扫读的数字：
 * 已选进度 / 兼容性问题 / 整机峰值功耗 / 建议电源瓦数。
 * 表格与右栏面板自然退到次要位置。
 *
 * @param {object} o
 * @param {object} o.summary    selectionSummary 结果
 * @param {object} o.counts     { error, warn, info }
 * @param {object} o.power      computePower 结果
 * @param {number} [o.onSuggestPsu] 建议电源档位（可点击跳转筛选）
 */
export function renderOverview({ summary = {}, counts = {}, power, onSuggestPsu }) {
  const err = counts.error || 0;
  const warn = counts.warn || 0;
  const info = counts.info || 0;

  const problemLevel = err > 0 ? 'error' : warn > 0 ? 'warn' : 'ok';
  const problemValue = err > 0 ? err : warn > 0 ? warn : 0;
  const problemUnit = err > 0 ? '错误' : warn > 0 ? '警告' : '无冲突';

  const peak = power?.peak ?? null;
  const rec = power?.recommendedPsu ?? null;
  const cur = power?.psuWattage ?? null;
  const margin = power?.margin ?? null;

  const marginLevel = power?.level && power.level !== 'ok' ? power.level : null;

  return `
    <div class="overview">
      <div class="ov-cell">
        <div class="ov-label">已选配件</div>
        <div class="ov-value">
          ${summary?.selected ?? 0}<span class="ov-unit">/ ${summary?.total ?? 8}</span>
        </div>
        <div class="ov-sub">未选 ${summary?.unselected ?? 8}</div>
      </div>

      <div class="ov-cell">
        <div class="ov-label">兼容性</div>
        <div class="ov-value" data-level="${esc(problemLevel)}">
          ${problemValue}<span class="ov-unit">${problemUnit}</span>
        </div>
        <div class="ov-sub">
          ${info > 0 ? `🔵 ${info} 条提示` : (err === 0 && warn === 0 ? '全部通过' : '　')}
        </div>
      </div>

      <div class="ov-cell">
        <div class="ov-label">整机峰值功耗</div>
        <div class="ov-value">${peak ?? '—'}<span class="ov-unit">W</span></div>
        <div class="ov-sub">按各部件峰值功耗求和</div>
      </div>

      <div class="ov-cell">
        <div class="ov-label">建议电源</div>
        <div class="ov-value"${marginLevel ? ` data-level="${esc(marginLevel)}"` : ''}>
          ≥${rec ?? '—'}<span class="ov-unit">W</span>
        </div>
        <div class="ov-sub">
          ${cur !== null
            ? `当前 ${cur}W · 余量 ${margin}%`
            : (onSuggestPsu && rec ? `<button class="ov-link" data-action="suggest-psu" data-watts="${esc(rec)}">去选电源 →</button>` : '未选电源')}
        </div>
      </div>
    </div>`;
}

// ══════════════════════════════════════════════════════════════
// 失效引用提示条
// ══════════════════════════════════════════════════════════════
export function renderStaleBanner(invalidCategories = []) {
  if (invalidCategories.length === 0) return '';
  const names = invalidCategories.map((c) => CATEGORY_LABELS[c] || c).join('、');

  return `
    <div class="stale-banner" id="stale-banner">
      <span class="stale-icon">⚠️</span>
      <span class="stale-text">
        有 <b>${invalidCategories.length}</b> 个已选配件在当前型号库中找不到（${esc(names)}）。
        可能是数据更新后该型号被移除，或你清除了导入的自定义数据。
      </span>
      <button type="button" class="btn-ghost" data-action="clear-stale"
              title="移除这些失效的引用，其余配置保持不变">清除失效项</button>
      <button type="button" class="btn-ghost" data-action="dismiss-stale"
              title="暂时忽略提示">忽略</button>
    </div>`;
}

// ══════════════════════════════════════════════════════════════════
// 中栏 · 工具条（PRD 6.5.1）
// ══════════════════════════════════════════════════════════════════

/** 各品类的快捷筛选标签 */
export const QUICK_TAGS = {
  cpu: [
    { key: 'all', label: '全部' },
    { key: 'brand:AMD', label: 'AMD' },
    { key: 'brand:Intel', label: 'Intel' },
    { key: 'igpu', label: '带核显' },
    { key: 'lowPower', label: '≤65W' },
    { key: 'unlocked', label: '可超频' },
  ],
  motherboard: [
    { key: 'all', label: '全部' },
    { key: 'formFactor:M-ATX', label: 'M-ATX' },
    { key: 'formFactor:ATX', label: 'ATX' },
    { key: 'formFactor:Mini-ITX', label: 'ITX' },
    { key: 'wifi', label: '带 WiFi' },
    { key: 'memoryType:DDR5', label: 'DDR5' },
  ],
  gpu: [
    { key: 'all', label: '全部' },
    { key: 'short', label: '短卡 ≤250mm' },
    { key: 'lowPower', label: '≤150W' },
    { key: 'vram:16', label: '16G+' },
  ],
  memory: [
    { key: 'all', label: '全部' },
    { key: 'memoryType:DDR5', label: 'DDR5' },
    { key: 'memoryType:DDR4', label: 'DDR4' },
    { key: 'modules:2', label: '双条套装' },
    { key: 'modules:4', label: '四条套装' },
  ],
  psu: [
    { key: 'all', label: '全部' },
    { key: 'highPower', label: '≥750W' },
    { key: 'formFactor:SFX', label: 'SFX' },
    { key: 'efficiency:金牌', label: '金牌' },
  ],
  case: [
    { key: 'all', label: '全部' },
    { key: 'formFactors:Mini-ITX', label: '支持 ITX' },
    { key: 'longGpu', label: '显卡限长 ≥350mm' },
    { key: 'tallCooler', label: '风冷限高 ≥160mm' },
  ],
  cooler: [
    { key: 'all', label: '全部' },
    { key: 'type:air', label: '风冷' },
    { key: 'type:aio', label: '水冷' },
    { key: 'lowProfile', label: '下压式 ≤70mm' },
  ],
  storage: [
    { key: 'all', label: '全部' },
    { key: 'interface:NVMe', label: 'NVMe' },
    { key: 'interface:SATA', label: 'SATA' },
    { key: 'dram', label: '有缓存' },
  ],
};

/**
 * @param {object} o
 * @param {string} o.category
 * @param {string} [o.query]
 * @param {'table'|'card'} [o.view]
 * @param {object} [o.sort]
 * @param {boolean} [o.includeUsed]  是否含二手
 * @param {number} [o.usedCount]     该品类下二手/矿卡/洋垃圾的数量，用于提示
 */
export function renderToolbar({
  category, query = '', view = 'table', sort = null, includeUsed = false, usedCount = 0,
}) {
  const tags = (QUICK_TAGS[category] || [{ key: 'all', label: '全部' }])
    .map((t) => `<button type="button" class="tag" data-quick="${esc(t.key)}">${esc(t.label)}</button>`)
    .join('');

  const sortDefs = SORT_DEFS[category] || [];
  const sortOpts = sortDefs
    .map((s) => `<option value="${esc(s.key)}"${sort?.key === s.key ? ' selected' : ''}>${esc(s.label)}</option>`)
    .join('');

  return `
    <div class="toolbar-main">
      <span class="cat-title">${esc(CATEGORY_LABELS[category])}</span>
      <input type="search" class="search-input" data-role="search" autocomplete="off"
             placeholder="输入型号或别名，如 7800x3d / 4070S / 小雕"
             value="${esc(query)}" aria-label="搜索型号">
      <select class="sort-select" data-role="sort-key" aria-label="排序方式">
        <option value="">默认</option>${sortOpts}
      </select>
      <button type="button" class="btn-ghost" data-action="sort-dir"
              title="切换升/降序">${sort?.dir === 'desc' ? '↓' : '↑'}</button>
      <div class="view-switch">
        <button type="button" class="vs ${view === 'table' ? 'on' : ''}" data-view="table">表格</button>
        <button type="button" class="vs ${view === 'card' ? 'on' : ''}" data-view="card">卡片</button>
      </div>
    </div>
    <div class="toolbar-quick">
      <span class="quick-label">快捷</span>${tags}
      <label class="used-toggle" title="二手 / 矿卡 / 洋垃圾（默认不显示）">
        <input type="checkbox" data-role="include-used"${includeUsed ? ' checked' : ''}>
        含二手${usedCount > 0 ? `（${usedCount}）` : ''}
      </label>
    </div>`;
}

// ══════════════════════════════════════════════════════════════════
// 中栏 · 型号列表（表格 / 卡片，PRD 6.5.2 / 6.5.3）
// ══════════════════════════════════════════════════════════════════

/** 各品类表格列定义（**不含价格列**，PRD 1.5） */
export const TABLE_COLUMNS = {
  cpu: [
    { key: 'name', label: '型号', main: true },
    { key: '_cores', label: '核心/线程' },
    { key: '_clock', label: '频率GHz' },
    { key: 'maxPower', label: '峰值功耗', num: true },
    { key: '_igpu', label: '核显' },
    { key: 'gameScore', label: '游戏分', num: true },
  ],
  motherboard: [
    { key: 'name', label: '型号', main: true },
    { key: 'chipset', label: '芯片组' },
    { key: 'formFactor', label: '板型' },
    { key: 'socket', label: '插槽' },
    { key: 'memoryType', label: '内存' },
    { key: 'm2Slots', label: 'M.2', num: true },
  ],
  gpu: [
    { key: 'name', label: '型号', main: true },
    { key: 'vram', label: '显存', num: true },
    { key: 'length_mm', label: '长度', num: true },
    { key: 'thicknessSlots', label: '厚度', num: true },
    { key: 'tdp', label: '功耗', num: true },
    { key: 'gameScore', label: '游戏分', num: true },
  ],
  memory: [
    { key: 'name', label: '型号', main: true },
    { key: 'memoryType', label: '代数' },
    { key: 'capacityPerModule', label: '单条', num: true },
    { key: 'modules', label: '条数', num: true },
    { key: 'speed', label: '频率', num: true },
    { key: 'height_mm', label: '高度', num: true },
  ],
  psu: [
    { key: 'name', label: '型号', main: true },
    { key: 'wattage', label: '瓦数', num: true },
    { key: 'formFactor', label: '规格' },
    { key: 'efficiency', label: '认证' },
    { key: 'pcie8pin', label: '8pin', num: true },
    { key: 'length_mm', label: '长度', num: true },
  ],
  case: [
    { key: 'name', label: '型号', main: true },
    { key: '_formFactors', label: '支持板型' },
    { key: 'maxGpuLength', label: '显卡限长', num: true },
    { key: 'maxCoolerHeight', label: '风冷限高', num: true },
    { key: 'maxPsuLength', label: '电源限长', num: true },
    { key: 'fanMounts', label: '风扇位', num: true },
  ],
  cooler: [
    { key: 'name', label: '型号', main: true },
    { key: 'type', label: '类型' },
    { key: '_size', label: '尺寸' },
    { key: 'tdpRating', label: '散热能力', num: true },
    { key: 'noise_dba', label: '噪声', num: true },
  ],
  storage: [
    { key: 'name', label: '型号', main: true },
    { key: 'interface', label: '接口' },
    { key: 'capacity', label: '容量', num: true },
    { key: 'nandType', label: 'NAND' },
    { key: '_dram', label: '缓存' },
    { key: 'readSpeed', label: '读取', num: true },
  ],
};

/** 计算派生列值 */
export function cellValue(rec, col) {
  switch (col.key) {
    case '_cores': {
      const pc = rec.pCores ? `${rec.pCores}P` : null;
      const ec = rec.eCores ? `${rec.eCores}E` : null;
      const hybrid = pc || ec ? `${[pc, ec].filter(Boolean).join('+')}/` : '';
      return `${hybrid}${nz(rec.cores)}/${nz(rec.threads)}`;
    }
    case '_clock':
      return rec.baseClock ? `${rec.baseClock}-${rec.boostClock}` : '—';
    case '_igpu':
      return rec.igpu ? '有' : '无';
    case 'powerConnectors': {
      // 供电接口摘要：显卡变体行用，如「2×8pin」「1×12VHPWR」
      const a = rec.pcie8pin || 0;
      const b = rec.pcie12vhpwr || 0;
      const parts = [];
      if (a) parts.push(`${a}×8pin`);
      if (b) parts.push(`${b}×12VHPWR`);
      return parts.length ? parts.join(' + ') : '免外接';
    }
    case '_formFactors':
      return Array.isArray(rec.formFactors) ? rec.formFactors.join(' ') : '—';
    case '_size':
      if (rec.type === 'aio') return rec.radiatorSize ? `${rec.radiatorSize} 冷排` : '—';
      return rec.height_mm ? `${rec.height_mm}mm` : '—';
    case '_dram':
      return rec.dram ? '有' : '无';
    default: {
      const v = rec[col.key];
      if (Array.isArray(v)) return v.join('; ');
      if (col.key === 'length_mm' || col.key === 'height_mm' || col.key === 'maxGpuLength'
        || col.key === 'maxCoolerHeight' || col.key === 'maxPsuLength') {
        return typeof v === 'number' ? `${v}mm` : '—';
      }
      if (col.key === 'thicknessSlots') return typeof v === 'number' ? `${v}槽` : '—';
      if (col.key === 'maxPower' || col.key === 'tdp' || col.key === 'tdpRating') {
        return typeof v === 'number' ? `${v}W` : '—';
      }
      if (col.key === 'vram' || col.key === 'capacityPerModule') {
        return typeof v === 'number' ? `${v}G` : '—';
      }
      if (col.key === 'capacity') {
        return typeof v === 'number' ? (v >= 1000 ? `${v / 1000}TB` : `${v}GB`) : '—';
      }
      if (col.key === 'wattage') return typeof v === 'number' ? `${v}W` : '—';
      if (col.key === 'speed') return typeof v === 'number' ? `${v}` : '—';
      if (col.key === 'pcie8pin') return typeof v === 'number' ? `×${v}` : '—';
      if (col.key === 'readSpeed') return typeof v === 'number' ? `${v}` : '—';
      if (col.key === 'type') return COOLER_TYPE_LABELS[v] || nz(v);
      return nz(v);
    }
  }
}

/**
 * 渲染表格视图
 *
 * @param {object} o
 * @param {Array}  o.items           当前页记录
 * @param {function} o.checkCandidate (rec) => { level } 行内冲突标记
 * @param {function} o.isSelected     (rec) => boolean
 * @param {Array}  o.compareIds      勾选对比的记录 id
 */
/** 芯片组表格的列定义：按品类给不同的芯片级列 */
function chipTableColumns(category) {
  if (category === 'motherboard') {
    // 芯片行标签形如「B650·M-ATX」，板型已包含在内，故不重复"板型"列
    return [
      { key: 'chipset', label: '芯片组 · 板型', main: true },
      { key: 'socket', label: '插槽' },
      { key: 'memoryType', label: '内存' },
      { key: 'm2Slots', label: 'M.2', num: true },
      { key: 'sataPorts', label: 'SATA', num: true },
    ];
  }
  // 显卡（默认）
  return [
    { key: 'chipset', label: '芯片型号', main: true },
    { key: 'vram', label: '显存', num: true },
    { key: 'length_mm', label: '长度', num: true },
    { key: 'thicknessSlots', label: '厚度', num: true },
    { key: 'tdp', label: '功耗', num: true },
    { key: 'gameScore', label: '游戏分', num: true },
  ];
}

/**
 * 芯片组表格（PRD 3.1.2b）
 *
 * 显卡 / 主板按 chipset 归并：一行一个芯片，显示形态标签与尺寸区间；
 * 点击芯片行展开该芯片下各品牌的具体变体（含真实长度/厚度/供电）。
 *
 * 重要：归并只发生在展示层。规则引擎仍按**具体型号**的尺寸计算，
 * 因此变体行必须带 data-pick，选中的是变体而非芯片。
 *
 * @param {object} o
 * @param {string} o.category
 * @param {Array} o.groups        groupByChipset 的输出
 * @param {function} o.checkCandidate (rec) => { level, findings }
 * @param {function} o.isSelected     (rec) => boolean
 * @param {string} [o.expandedKey]  当前展开的芯片 key
 */
export function renderChipTable({
  category, groups = [], checkCandidate, isSelected, expandedKey = null,
}) {
  const isMb = category === 'motherboard';
  // 主板：芯片行标签已含板型（B650·M-ATX），不再单列"形态"，
  // 也不重复显示"板型"列；显卡则相反（芯片行不含形态信息）
  const cols = chipTableColumns(category);
  const head = cols
    .map((c) => `<th${c.num ? ' class="num"' : ''}>${esc(c.label)}</th>`)
    .join('');
  const showVariantCol = !isMb;   // 显卡才需要独立的形态标签列

  if (groups.length === 0) {
    return `
      <table class="hw-table chip-table">
        <thead><tr><th class="pick"></th>${head}<th class="ops">操作</th></tr></thead>
      </table>
      <div class="empty-hint">没有匹配的型号。试试清空搜索或关掉筛选。</div>`;
  }

  const rows = groups.map((g) => {
    const expanded = expandedKey === g.key;
    const selectedVariant = g.records.find((r) => isSelected?.(r)) || null;

    // 芯片行的兼容状态：任一变体有错即视为该芯片存在冲突
    const checks = g.records.map((r) => checkCandidate?.(r) || { level: 'ok' });
    const worst = checks.reduce((acc, c) => {
      const order = { ok: 0, info: 1, warn: 2, error: 3 };
      return (order[c.level] || 0) > (order[acc] || 0) ? c.level : acc;
    }, 'ok');

    // 尺寸是否含估算值（有估算值则整体标 ≈）
    const sizeApprox = g.records.some((r) => Array.isArray(r.estimated) && r.estimated.includes('length_mm'));
    const approxMark = sizeApprox ? '<span class="approx" title="尺寸为估算值，请以实物规格为准">≈</span>' : '';

    const variantTags = g.variants
      .map((v) => `<span class="vtag vtag-${esc(v)}">${esc(v)}</span>`)
      .join('');

    const chipCell = `
      <td class="main">
        <button type="button" class="chip-name" data-chip="${esc(g.key)}"
                title="${g.count > 1 ? `点击展开 ${g.count} 个品牌的具体版本` : '点击选中'}">
          ${esc(g.label)}<span class="chip-caret">${g.count > 1 ? (expanded ? '▾' : '▸') : ''}</span>
        </button>
        ${g.count > 1 ? `<span class="chip-count">${g.count} 个版本</span>` : ''}
        ${selectedVariant ? `<span class="badge">已选：${esc(selectedVariant.brand || selectedVariant.name.slice(0, 12))}</span>` : ''}
      </td>`;

    // 芯片级参数列
    const paramCells = isMb
      ? `<td>${esc(g.socket || '—')}</td>
         <td>${esc(g.memoryType || '—')}</td>
         <td class="num">${esc(cellValue(g.rep, { key: 'm2Slots' }))}</td>
         <td class="num">${esc(cellValue(g.rep, { key: 'sataPorts' }))}</td>`
      : `<td class="num">${esc(cellValue(g.rep, { key: 'vram' }))}</td>
         <td class="num">${approxMark}${esc(formatRange(g.lengthRange, 'mm'))}</td>
         <td class="num">${esc(formatRange(g.thicknessRange, '槽'))}</td>
         <td class="num">${esc(cellValue(g.rep, { key: 'tdp' }))}</td>
         <td class="num">${esc(cellValue(g.rep, { key: 'gameScore' }))}</td>`;

    const row = `
      <tr class="chip-row${worst === 'ok' ? '' : ' is-conflict'}" data-level="${esc(worst)}"
          ${selectedVariant ? ' data-has-selected="1"' : ''}>
        <td class="pick"><input type="checkbox" disabled></td>
        ${chipCell}
        ${showVariantCol ? `<td class="chip-variants">${variantTags}</td>` : ''}
        ${paramCells}
        <td class="ops">
          ${g.count > 1
            ? `<button type="button" class="btn-pick" data-chip-toggle="${esc(g.key)}">展开</button>`
            : `<button type="button" class="btn-pick" data-pick="${esc(g.records[0].id)}">选它</button>`}
        </td>
      </tr>`;

    if (!expanded) return row;

    // 变体明细行
    const variantRows = g.records.map((r) => {
      const sel = isSelected?.(r);
      const ck = checkCandidate?.(r) || { level: 'ok' };
      const conflict = ck.level === 'error' || ck.level === 'warn';
      const rApprox = Array.isArray(r.estimated) && r.estimated.includes('length_mm') ? '≈' : '';
      const cond = conditionLabel(r.condition);
      // 变体行：主板显示插槽/内存，显卡显示长度/厚度
      const specCells = isMb
        ? `<td>${esc(r.socket || '—')}</td>
           <td>${esc(r.memoryType || '—')}</td>
           <td class="num">${esc(cellValue(r, { key: 'm2Slots' }))}</td>
           <td class="num">${esc(cellValue(r, { key: 'sataPorts' }))}</td>`
        : `<td class="variant-specs">
             <span title="长度">${rApprox}${esc(r.length_mm ?? '—')}mm</span>
             <span title="厚度">${esc(r.thicknessSlots ?? '—')}槽</span>
           </td>
           <td class="num">${esc(r.vram ?? '—')}</td>
           <td class="num">${esc(cellValue(r, { key: 'powerConnectors' }))}</td>
           <td class="num"></td>
           <td class="num"></td>`;

      return `
        <tr class="variant-row${sel ? ' is-selected' : ''}${conflict ? ' is-conflict' : ''}"
            data-level="${esc(ck.level)}" data-variant-of="${esc(g.key)}">
          <td class="pick"></td>
          <td class="main">
            <span class="variant-brand">${esc(r.brand || '')}</span>
            ${esc(r.name)}
            ${cond ? `<span class="badge badge-cond">${esc(cond)}</span>` : ''}
            ${r.custom ? '<span class="badge badge-custom">自定义</span>' : ''}
            ${conflict ? `<span class="row-flag" title="${esc(ck.findings[0]?.reason || '存在兼容问题')}">${LEVEL_ICONS[ck.level]}</span>` : ''}
          </td>
          ${showVariantCol ? `<td class="chip-variants">${variantsOf(r, category).map((v) => `<span class="vtag vtag-${esc(v)}">${esc(v)}</span>`).join('')}</td>` : ''}
          ${specCells}
          <td class="ops">
            <button type="button" class="btn-pick" data-pick="${esc(r.id)}">${sel ? '已选' : '选它'}</button>
          </td>
        </tr>`;
    }).join('');

    return row + variantRows;
  }).join('');

  return `
    <table class="hw-table chip-table">
      <thead><tr><th class="pick"></th>${head}<th class="ops">操作</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

export function renderTable({ category, items = [], checkCandidate, isSelected, compareIds = [] }) {
  const cols = TABLE_COLUMNS[category] || [{ key: 'name', label: '型号', main: true }];
  const compareSet = new Set(compareIds);

  const head = cols
    .map((c) => `<th${c.num ? ' class="num"' : ''}>${esc(c.label)}</th>`)
    .join('');

  if (items.length === 0) {
    return `
      <table class="hw-table">
        <thead><tr><th class="pick"></th>${head}<th class="ops">操作</th></tr></thead>
      </table>
      <div class="empty-hint">没有匹配的型号。试试清空搜索或关掉筛选。</div>`;
  }

  const rows = items.map((rec) => {
    const selected = isSelected ? isSelected(rec) : false;
    const check = checkCandidate ? checkCandidate(rec) : { level: 'ok' };
    const conflict = check.level === 'error' || check.level === 'warn';

    const cells = cols.map((c) => {
      const val = cellValue(rec, c);
      if (c.main) {
        const cond = conditionLabel(rec.condition);
        const custom = rec.custom ? '<span class="badge badge-custom">自定义</span>' : '';
        const condBadge = cond ? `<span class="badge badge-cond">${esc(cond)}</span>` : '';
        // 冲突标记放进型号单元格，避免另占一列
        const flag = conflict
          ? `<span class="row-flag" title="${esc(check.findings[0]?.reason || '与当前配置存在兼容问题')}">${LEVEL_ICONS[check.level]}</span>`
          : '';
        return `<td class="main">${esc(rec.name)}${condBadge}${custom}${flag}</td>`;
      }
      return `<td${c.num ? ' class="num"' : ''}>${esc(val)}</td>`;
    }).join('');

    // 冲突详情行：默认隐藏，hover 该型号行时才显示（解决"红条太吵"）
    const conflictRow = conflict
      ? `<tr class="conflict-row" data-level="${esc(check.level)}">
           <td colspan="${cols.length + 2}">
             ${esc(check.findings[0]?.reason || '与当前配置存在兼容问题')}
             ${check.findings[0]?.refs?.length
               ? check.findings[0].refs
                   .map((r) => `<button type="button" class="link" data-goto="${esc(r.category)}">查看${esc(CATEGORY_LABELS[r.category] || r.category)}</button>`)
                   .join(' ')
               : ''}
           </td>
         </tr>`
      : '';

    return `
      <tr class="${cls('hw-row', selected && 'is-selected', conflict && 'is-conflict')}"
          data-id="${esc(rec.id)}" data-level="${esc(check.level)}">
        <td class="pick">
          <input type="checkbox" data-compare="${esc(rec.id)}"${compareSet.has(rec.id) ? ' checked' : ''}
                 aria-label="加入对比">
        </td>
        ${cells}
        <td class="ops">
          <button type="button" class="btn-pick" data-pick="${esc(rec.id)}">
            ${selected ? '已选' : '选它'}
          </button>
        </td>
      </tr>${conflictRow}`;
  }).join('');

  return `
    <table class="hw-table">
      <thead><tr><th class="pick"></th>${head}<th class="ops">操作</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

/** 渲染卡片视图 */
export function renderCards({ category, items = [], checkCandidate, isSelected }) {
  if (items.length === 0) {
    return '<div class="empty-hint">没有匹配的型号。</div>';
  }
  const cols = (TABLE_COLUMNS[category] || []).slice(0, 5);

  return `<div class="card-grid">${items.map((rec) => {
    const selected = isSelected ? isSelected(rec) : false;
    const check = checkCandidate ? checkCandidate(rec) : { level: 'ok' };
    const conflict = check.level === 'error' || check.level === 'warn';
    const cond = conditionLabel(rec.condition);

    const specs = cols.slice(1).map((c) => `
      <div class="spec"><span>${esc(c.label)}</span><b>${esc(cellValue(rec, c))}</b></div>`).join('');

    return `
      <div class="${cls('hw-card', selected && 'is-selected', conflict && 'is-conflict')}"
           data-id="${esc(rec.id)}" data-level="${esc(check.level)}">
        <div class="card-title">
          ${esc(rec.name)}
          ${cond ? `<span class="badge badge-cond">${esc(cond)}</span>` : ''}
          ${rec.custom ? '<span class="badge badge-custom">自定义</span>' : ''}
        </div>
        <div class="card-specs">${specs}</div>
        ${conflict ? `<div class="card-conflict">${LEVEL_ICONS[check.level]} ${esc(check.findings[0]?.reason || '')}</div>` : ''}
        <button type="button" class="btn-pick" data-pick="${esc(rec.id)}">${selected ? '已选' : '选它'}</button>
      </div>`;
  }).join('')}</div>`;
}

// ══════════════════════════════════════════════════════════════════
// 中栏 · 详情 / 对比（PRD 6.5.4）
// ══════════════════════════════════════════════════════════════════

/** 各品类详情区展示的字段顺序 */
const DETAIL_FIELDS = {
  cpu: ['socket', 'cores', 'threads', 'pCores', 'eCores', 'baseClock', 'boostClock', 'l3Cache', 'tdp', 'maxPower', 'memoryTypes', 'maxMemorySpeed', 'igpu', 'igpuName', 'pcieVersion', 'unlocked', 'gameScore', 'productivityScore', 'year'],
  motherboard: ['socket', 'chipset', 'formFactor', 'memoryType', 'memorySlots', 'maxMemory', 'maxMemorySpeed', 'pcieVersion', 'pcieX16Slots', 'm2Slots', 'sataPorts', 'cpuPowerConnectors', 'vrmPhases', 'wifi', 'usbC', 'biosFlashback', 'length_mm', 'width_mm', 'year'],
  gpu: ['chipset', 'vram', 'memoryType', 'busWidth', 'length_mm', 'thicknessSlots', 'height_mm', 'tdp', 'recommendedPsu', 'pcie8pin', 'pcie12vhpwr', 'pcieVersion', 'outputs', 'coolerType', 'gameScore', 'productivityScore', 'year'],
  memory: ['memoryType', 'capacityPerModule', 'modules', 'speed', 'casLatency', 'voltage', 'height_mm', 'ecc', 'rgb', 'xmpSupport', 'year'],
  psu: ['wattage', 'formFactor', 'length_mm', 'pcie8pin', 'pcie12vhpwr', 'eps8pin', 'efficiency', 'modular', 'atxVersion', 'sataConnectors', 'warranty', 'year'],
  case: ['formFactors', 'maxGpuLength', 'maxGpuThickness', 'maxCoolerHeight', 'radiatorSupport', 'psuFormFactors', 'maxPsuLength', 'expansionSlots', 'driveBays35', 'driveBays25', 'fanMounts', 'sidePanel', 'volume', 'year'],
  cooler: ['type', 'height_mm', 'radiatorSize', 'tdpRating', 'sockets', 'ramClearance_mm', 'fanCount', 'noise_dba', 'rgb', 'thickness_mm', 'year'],
  storage: ['interface', 'formFactor', 'capacity', 'pcieVersion', 'readSpeed', 'writeSpeed', 'nandType', 'dram', 'tbw', 'heatsink', 'year'],
};

const FIELD_LABELS = {
  socket: '插槽', cores: '核心数', threads: '线程数', pCores: '性能核', eCores: '能效核',
  baseClock: '基础频率', boostClock: '加速频率', l3Cache: '三级缓存', tdp: '标称功耗',
  maxPower: '峰值功耗', memoryTypes: '支持内存', maxMemorySpeed: '内存频率上限',
  igpu: '核显', igpuName: '核显型号', pcieVersion: 'PCIe 版本', unlocked: '可超频',
  gameScore: '游戏性能分', productivityScore: '生产力性能分', year: '发布时间',
  chipset: '芯片组', formFactor: '板型', memoryType: '内存代数', memorySlots: '内存槽数',
  maxMemory: '最大内存', pcieX16Slots: 'PCIe x16 槽', m2Slots: 'M.2 接口', sataPorts: 'SATA 接口',
  cpuPowerConnectors: 'CPU 供电 8pin', vrmPhases: '供电相数', wifi: 'WiFi', usbC: 'USB-C',
  biosFlashback: '免 CPU 刷 BIOS', length_mm: '长度', width_mm: '宽度',
  vram: '显存容量', memoryType_gpu: '显存类型', busWidth: '位宽', thicknessSlots: '厚度',
  height_mm: '高度', recommendedPsu: '建议电源', pcie8pin: '8pin 供电', pcie12vhpwr: '12VHPWR',
  outputs: '输出接口', coolerType: '散热形式',
  capacityPerModule: '单条容量', modules: '套装条数', speed: '频率', casLatency: 'CAS 时序',
  voltage: '电压', ecc: 'ECC', rgb: '灯效', xmpSupport: 'XMP/EXPO',
  wattage: '额定瓦数', eps8pin: 'CPU 8pin', efficiency: '80PLUS', modular: '模组化',
  atxVersion: 'ATX 版本', sataConnectors: 'SATA 供电', warranty: '保修',
  formFactors: '支持板型', maxGpuLength: '显卡限长', maxGpuThickness: '显卡限厚',
  maxCoolerHeight: '风冷限高', radiatorSupport: '支持冷排', psuFormFactors: '支持电源规格',
  maxPsuLength: '电源限长', expansionSlots: '扩展槽', driveBays35: '3.5" 硬盘位',
  driveBays25: '2.5" 硬盘位', fanMounts: '风扇位', sidePanel: '侧板', volume: '体积',
  type: '类型', radiatorSize: '冷排规格', tdpRating: '散热能力', sockets: '支持插槽',
  ramClearance_mm: '内存避让', fanCount: '风扇数', noise_dba: '噪声', thickness_mm: '冷排厚度',
  interface: '接口', capacity: '容量', readSpeed: '顺序读取', writeSpeed: '顺序写入',
  nandType: 'NAND 类型', dram: '独立缓存', tbw: '写入寿命', heatsink: '散热片',
};

/** 格式化详情值（含单位与近似标记） */
export function detailValue(rec, key) {
  const v = rec[key];
  if (v === undefined || v === null || v === '') return '—';

  const approx = Array.isArray(rec.estimated) && rec.estimated.includes(key) ? '≈' : '';

  if (Array.isArray(v)) return `${approx}${v.join(' / ')}`;
  if (typeof v === 'boolean') return v ? '是' : '否';

  const unitMap = {
    baseClock: ' GHz', boostClock: ' GHz', l3Cache: ' MB', tdp: ' W', maxPower: ' W',
    maxMemorySpeed: ' MT/s', maxMemory: ' GB', length_mm: ' mm', width_mm: ' mm',
    height_mm: ' mm', maxGpuLength: ' mm', maxGpuThickness: ' 槽', maxCoolerHeight: ' mm',
    maxPsuLength: ' mm', vram: ' GB', busWidth: ' bit', capacityPerModule: ' GB',
    modules: ' 条', speed: ' MT/s', wattage: ' W', volume: ' L', tdpRating: ' W',
    noise_dba: ' dBA', ramClearance_mm: ' mm', thickness_mm: ' mm', capacity: ' GB',
    readSpeed: ' MB/s', writeSpeed: ' MB/s', tbw: ' TBW', fanMounts: ' 个',
    radiatorSize: '', year: ' 年', warranty: ' 年', pcie8pin: ' 个', pcie12vhpwr: ' 个',
    eps8pin: ' 个', sataPorts: ' 个', m2Slots: ' 个', memorySlots: ' 个',
    cpuPowerConnectors: ' 个', vrmPhases: ' 相', expansionSlots: ' 个',
    sataConnectors: ' 个', fanCount: ' 个', pcieX16Slots: ' 个', driveBays35: ' 个',
    driveBays25: ' 个', capacityPerModule_g: '',
  };
  const unit = unitMap[key] ?? '';
  return `${approx}${v}${unit}`;
}

/**
 * 渲染详情区（单击某行型号）
 * @param {object} o
 * @param {object} o.record
 * @param {object} o.candidateCheck 该型号对当前配置的兼容结论
 */
export function renderDetail({ category, record, candidateCheck }) {
  if (!record) {
    return `
      <div class="detail-head"><h3>参数详情</h3></div>
      <div class="empty-hint">单击上方的型号行查看完整参数；勾选 2~4 个可并排对比。</div>`;
  }

  const keys = DETAIL_FIELDS[category] || Object.keys(record).filter((k) => !['id', 'category', 'aliases', 'custom', 'estimated'].includes(k));
  const rows = keys
    .filter((k) => record[k] !== undefined && record[k] !== null && record[k] !== '')
    .map((k) => `
      <div class="kv">
        <span class="k">${esc(FIELD_LABELS[k] || k)}</span>
        <span class="v">${esc(detailValue(record, k))}</span>
      </div>`).join('');

  const cond = conditionLabel(record.condition);
  const check = candidateCheck;
  const conflictBox = check && (check.level === 'error' || check.level === 'warn')
    ? `<div class="detail-conflict" data-level="${esc(check.level)}">
         ${LEVEL_ICONS[check.level]} 与当前配置：${esc(check.findings[0]?.reason || '')}
         ${check.findings[0]?.advice ? `<div class="advice">→ ${esc(check.findings[0].advice)}</div>` : ''}
       </div>`
    : (check ? '<div class="detail-ok">✅ 与当前配置兼容</div>' : '');

  return `
    <div class="detail-head">
      <h3>详情：${esc(record.name)}</h3>
      ${cond ? `<span class="badge badge-cond">${esc(cond)}</span>` : ''}
      ${record.custom ? '<span class="badge badge-custom">自定义</span>' : ''}
    </div>
    <div class="detail-grid">${rows}</div>
    ${record.notes ? `<div class="detail-notes">备注：${esc(record.notes)}</div>` : ''}
    ${conflictBox}
    <div class="detail-actions">
      <button type="button" class="btn-primary" data-pick="${esc(record.id)}">加入配置</button>
      <button type="button" class="btn-ghost" data-compare-add="${esc(record.id)}">加入对比</button>
    </div>`;
}

/**
 * 渲染参数对比表（勾选 2~4 个），差异项高亮
 * **不含价格行**（PRD 1.5）
 */
export function renderCompare({ category, records = [], checkCandidate }) {
  if (records.length < 2) return '';

  const keys = DETAIL_FIELDS[category] || [];
  const usable = keys.filter((k) => records.some((r) => r[k] !== undefined && r[k] !== null));

  const head = records.map((r) => `<th>${esc(r.name)}</th>`).join('');

  const rows = usable.map((k) => {
    const vals = records.map((r) => detailValue(r, k));
    const distinct = new Set(vals.map(String));
    const differs = distinct.size > 1;
    const cells = vals
      .map((v) => `<td${differs ? ' class="diff"' : ''}>${esc(v)}</td>`)
      .join('');
    return `<tr${differs ? ' class="row-diff"' : ''}>
      <th class="k">${esc(FIELD_LABELS[k] || k)}</th>${cells}
    </tr>`;
  }).join('');

  // 与当前配置的兼容结论
  const compat = records
    .map((r) => {
      const c = checkCandidate ? checkCandidate(r) : { level: 'ok' };
      const label = c.level === 'error' ? '🔴 有冲突' : c.level === 'warn' ? '🟡 有警告' : '✅ 兼容';
      return `<td data-level="${esc(c.level)}">${label}</td>`;
    })
    .join('');

  return `
    <div class="compare-head">
      <h3>参数对比</h3>
      <button type="button" class="btn-ghost" data-action="compare-clear">退出对比</button>
    </div>
    <div class="compare-wrap">
      <table class="compare-table">
        <thead><tr><th class="k">参数</th>${head}</tr></thead>
        <tbody>
          ${rows}
          <tr class="compat-row"><th class="k">与当前配置</th>${compat}</tr>
        </tbody>
      </table>
    </div>`;
}

// ══════════════════════════════════════════════════════════════════
// 右栏 · 兼容性检查（PRD 6.6.1）
// ══════════════════════════════════════════════════════════════════

/**
 * @param {object} o
 * @param {Array}  o.findings  规则结果
 * @param {object} o.counts    { error, warn, info }
 * @param {number} o.checked
 * @param {number} o.skipped
 * @param {string} o.filter    'all' | 'error' | 'warn'
 */
export function renderCompatPanel({ findings = [], counts, checked = 0, skipped = 0, filter = 'all' }) {
  const c = counts || { error: 0, warn: 0, info: 0 };

  const visible = findings.filter((f) => {
    if (filter === 'error') return f.level === 'error';
    if (filter === 'warn') return f.level === 'warn' || f.level === 'error';
    return true;
  });

  const cards = visible.length === 0
    ? `<div class="compat-empty">
         <div class="ok-banner">✅ 当前配置未发现冲突</div>
         <div class="muted">已检查 ${checked} 条规则，${skipped} 条因配件未选跳过</div>
       </div>`
    : visible.map((f) => `
        <div class="finding" data-level="${esc(f.level)}">
          <div class="finding-head">
            <span class="lv-icon">${LEVEL_ICONS[f.level]}</span>
            <span class="finding-title">${esc(f.title)}</span>
            <button type="button" class="rule-id" data-rule="${esc(f.id)}" title="查看规则说明">${esc(f.id)}</button>
          </div>
          <div class="finding-reason">${esc(f.reason)}</div>
          ${f.advice ? `<div class="finding-advice">→ ${esc(f.advice)}</div>` : ''}
          ${f.refs?.length
            ? `<div class="finding-refs">${f.refs
                .map((r) => `<button type="button" class="link" data-goto="${esc(r.category)}">查看${esc(CATEGORY_LABELS[r.category] || r.category)}</button>`)
                .join('')}</div>`
            : ''}
        </div>`).join('');

  return `
    <div class="panel-head">
      <h2>兼容性检查</h2>
      <button type="button" class="btn-ghost" data-action="recheck">重新检查</button>
    </div>
    <div class="compat-counts">
      <button type="button" class="cc ${filter === 'error' ? 'on' : ''}" data-filter="error">🔴 ${c.error} 错误</button>
      <button type="button" class="cc ${filter === 'warn' ? 'on' : ''}" data-filter="warn">🟡 ${c.warn} 警告</button>
      <button type="button" class="cc ${filter === 'all' ? 'on' : ''}" data-filter="all">全部</button>
      <span class="muted">🔵 ${c.info}</span>
    </div>
    <div class="finding-list">${cards}</div>
    <div class="panel-foot muted small">已检查 ${checked} / ${checked + skipped} 条规则</div>`;
}

// ══════════════════════════════════════════════════════════════════
// 右栏 · 功耗预算（PRD 6.6.2）
// ══════════════════════════════════════════════════════════════════

export function renderPowerPanel({ power }) {
  if (!power) {
    return `
      <div class="panel-head"><h2>功耗预算</h2></div>
      <div class="empty-hint">选择 CPU 或显卡后开始计算。</div>`;
  }

  const rows = power.breakdown.map((b) => `
    <div class="pw-row" title="${esc(b.basis)}">
      <span class="pw-label">${esc(b.label)}</span>
      <span class="pw-value">${esc(fmtW(b.watts))}</span>
    </div>`).join('');

  const marginText = power.margin === null ? '—' : `${power.margin}%`;
  const marginLevel = power.level;
  const barPct = power.margin === null ? 0 : Math.max(0, Math.min(100, power.margin));

  return `
    <div class="panel-head"><h2>功耗预算</h2></div>
    <div class="power-body">
      <div class="pw-list">${rows}</div>
      <div class="pw-total">
        <div class="pw-row strong"><span class="pw-label">整机峰值</span><span class="pw-value">${esc(fmtW(power.peak))}</span></div>
        <div class="pw-row"><span class="pw-label">建议电源</span><span class="pw-value">≥${esc(fmtW(power.recommendedPsu))}</span></div>
        <div class="pw-row"><span class="pw-label">当前电源</span><span class="pw-value">${power.psuWattage === null ? '未选' : esc(fmtW(power.psuWattage))}</span></div>
      </div>
      <div class="margin-bar" data-level="${esc(marginLevel)}">
        <div class="margin-fill" style="width:${barPct}%"></div>
        <span class="margin-text">余量 ${esc(marginText)}</span>
      </div>
      <div class="pw-hint muted small">余量 &lt;20% 黄 · &lt;0% 红 · &gt;50% 蓝</div>
      <div class="panel-actions">
        <button type="button" class="btn-ghost" data-action="show-power-detail">看功耗明细</button>
        <button type="button" class="btn-ghost" data-action="suggest-psu" data-watts="${esc(power.recommendedPsu)}">按建议选电源</button>
      </div>
    </div>`;
}

// ══════════════════════════════════════════════════════════════════
// 顶部栏（PRD 6.3，**不含预算**）
// ══════════════════════════════════════════════════════════════════

export function renderTopBar({ schemes = [], currentScheme = '', dirty = false, theme = 'dark' }) {
  const opts = schemes
    .map((s) => `<option value="${esc(s)}"${s === currentScheme ? ' selected' : ''}>${esc(s)}</option>`)
    .join('');

  return `
    <div class="brand">🖥 装机助手</div>
    <label class="scheme-picker">
      <span class="muted">方案</span>
      <select data-role="scheme">${opts || '<option value="">（未保存）</option>'}</select>
    </label>
    <button type="button" class="btn-ghost" data-action="scheme-new">＋新建</button>
    <button type="button" class="btn-ghost" data-action="save">💾保存${dirty ? '<span class="dot"></span>' : ''}</button>
    <button type="button" class="btn-ghost" data-action="scheme-manage"
            title="管理方案（重命名 / 删除）">🗂管理</button>
    <button type="button" class="btn-ghost" data-action="compare-open">⚖对比</button>
    <button type="button" class="btn-ghost" data-action="export-open">📤导出</button>
    <button type="button" class="btn-ghost" data-action="import-open">📥导入CSV</button>
    <button type="button" class="btn-ghost" data-action="rules-help">❓规则说明</button>
    <button type="button" class="btn-ghost" data-action="reset-all">↺全部重置</button>
    <span class="spacer"></span>
    <button type="button" class="theme-toggle" data-action="toggle-theme"
            title="切换浅色 / 深色主题">${theme === 'light' ? '☀ 浅色' : '🌙 深色'}</button>
    <button type="button" class="btn-ghost" data-action="toggle-right" title="收起/展开右侧栏">▶</button>`;
}

// ══════════════════════════════════════════════════════════════════
// 方案管理（M8：新建 / 重命名 / 删除 / 切换）
// ══════════════════════════════════════════════════════════════════

/**
 * 渲染方案管理弹窗
 *
 * 每个方案一行，提供「载入 / 重命名 / 删除」三个操作。
 * 删除与覆盖重名都需要二次确认，由 app.js 负责询问，这里只渲染按钮。
 *
 * @param {object} o
 * @param {Array}  o.schemes        [{ name, savedAt, selected, counts: {error,warn}, peak }]
 * @param {string} o.currentScheme  当前方案名
 */
export function renderSchemeManager({ schemes = [], currentScheme = '' }) {
  if (schemes.length === 0) {
    return `
      <div class="modal-head">
        <h2>方案管理</h2>
        <button type="button" class="btn-ghost" data-action="modal-close">关闭</button>
      </div>
      <div class="empty-hint">
        还没有保存过方案。<br>
        <span class="muted">选好一套配置后点顶部「💾保存」即可存为方案。</span>
      </div>`;
  }

  const fmtTime = (ts) => {
    if (!ts) return '—';
    try {
      const d = new Date(ts);
      const p = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    } catch { return '—'; }
  };

  const rows = schemes.map((s) => {
    const isCurrent = s.name === currentScheme;
    const c = s.counts || { error: 0, warn: 0 };
    const compat = c.error > 0
      ? `<span class="lv-error">🔴 ${c.error}</span>`
      : c.warn > 0
        ? `<span class="lv-warn">🟡 ${c.warn}</span>`
        : '<span class="lv-ok">✅ 无冲突</span>';

    return `
      <tr data-scheme-row="${esc(s.name)}"${isCurrent ? ' class="is-current"' : ''}>
        <td class="sch-name">
          ${esc(s.name)}
          ${isCurrent ? '<span class="badge">当前</span>' : ''}
        </td>
        <td class="sch-parts">${s.parts ?? 0} 件</td>
        <td class="sch-compat">${compat}</td>
        <td class="sch-power">${s.peak != null ? `${s.peak}W` : '—'}</td>
        <td class="sch-time muted small">${fmtTime(s.savedAt)}</td>
        <td class="sch-ops">
          <button type="button" class="btn-ghost" data-scheme-load="${esc(s.name)}"
                  ${isCurrent ? 'disabled title="已是当前方案"' : 'title="载入此方案"'}>载入</button>
          <button type="button" class="btn-ghost" data-scheme-rename="${esc(s.name)}"
                  title="重命名">重命名</button>
          <button type="button" class="btn-ghost btn-danger" data-scheme-delete="${esc(s.name)}"
                  title="删除此方案">删除</button>
        </td>
      </tr>`;
  }).join('');

  return `
    <div class="modal-head">
      <h2>方案管理（${schemes.length} 套）</h2>
      <button type="button" class="btn-ghost" data-action="modal-close">关闭</button>
    </div>
    <div class="modal-toolbar">
      <span class="muted small">删除方案不会影响当前正在编辑的配置。</span>
    </div>
    <table class="compare-table scheme-table">
      <thead>
        <tr>
          <th>方案名</th><th>配件</th><th>兼容性</th><th>功耗</th><th>保存时间</th><th>操作</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ══════════════════════════════════════════════════════════════════
// 空状态
// ══════════════════════════════════════════════════════════════════

export function renderEmptyGuide() {
  return `
    <div class="guide-card">
      <h3>从左侧选 CPU 开始</h3>
      <p>先选 <b>CPU</b> 和 <b>主板</b>，插槽匹配是最关键的一步。</p>
      <p class="muted">搜索支持别名：<code>7800x3d</code> · <code>4070S</code> · <code>小雕</code></p>
    </div>`;
}

// ══════════════════════════════════════════════════════════════════
// 规则说明（PRD 6.7.4）
// ══════════════════════════════════════════════════════════════════

export function renderRulesHelp({ rules = [], query = '' }) {
  const q = String(query).trim().toLowerCase();
  const list = q
    ? rules.filter((r) =>
        r.id.toLowerCase().includes(q) ||
        r.title.toLowerCase().includes(q) ||
        (r.fields || []).some((f) => f.toLowerCase().includes(q)))
    : rules;

  const items = list.map((r) => `
    <div class="rule-card" data-level="${esc(r.level)}">
      <div class="rule-head">
        <span class="lv-icon">${LEVEL_ICONS[r.level]}</span>
        <b>${esc(r.id)}</b>
        <span>${esc(r.title)}</span>
        <span class="badge">${esc(LEVEL_LABELS[r.level])}</span>
      </div>
      <div class="rule-body">
        <div><span class="k">涉及品类</span> ${esc((r.categories || []).map((c) => CATEGORY_LABELS[c] || c).join('、') || '—')}</div>
        <div><span class="k">涉及字段</span> <code>${esc((r.fields || []).join(', ') || '—')}</code></div>
        <div class="good">✅ ${esc(r.good || '')}</div>
        <div class="bad">🔴 ${esc(r.bad || '')}</div>
      </div>
    </div>`).join('');

  return `
    <div class="modal-head">
      <h2>规则说明（共 ${rules.length} 条）</h2>
      <button type="button" class="btn-ghost" data-action="modal-close">关闭</button>
    </div>
    <div class="modal-toolbar">
      <input type="search" class="search-input" data-role="rules-search"
             placeholder="搜索规则编号、标题或字段，如 E1 / 插槽 / socket" value="${esc(query)}">
    </div>
    <div class="rule-list">${items || '<div class="empty-hint">没有匹配的规则。</div>'}</div>`;
}
