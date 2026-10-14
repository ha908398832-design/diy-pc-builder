/**
 * 状态仓库（PRD M8-7 本地持久化 / NF6 数据安全）
 *
 * 单一数据源：config（已选配置，ID 引用）+ ui（界面状态）+ custom（CSV 导入）+ schemes（多方案）
 *
 * 设计要点：
 *   - 纯逻辑 + 可注入的 storage，便于在 Node 中单测（不需要浏览器 localStorage）
 *   - 防抖保存，避免频繁写入
 *   - storage 不可用（file:// 受限或被禁用）时降级为内存存储并给出提示，
 *     而不是直接崩溃（PRD NF7 容错 / 风险 R2）
 */

const KEY = 'zhuangji:store:v1';
const KEY_SCHEMES = 'zhuangji:schemes:v1';

/** 默认状态 */
export function defaultState() {
  return {
    config: {
      cpu: null,
      motherboard: null,
      gpu: null,
      memory: null,
      psu: null,
      cooler: null,
      case: null,
      storage: [],
    },
    ui: {
      category: 'cpu',
      query: '',
      filters: {},
      sort: { key: '', dir: 'asc' },
      view: 'table',
      compare: [],
      rightCollapsed: false,
      includeUsed: false,
      selectedDetail: null, // 当前详情区展示的记录 id
      findingFilter: 'all',
      staleDismissed: false, // 是否忽略「失效引用」提示
    },
    custom: {},   // { cpu: [...], ... } CSV 导入的记录
    schemes: {},  // { 方案名: { config, savedAt } }
    currentScheme: '',
    dirty: false,
  };
}

/** 内存兜底存储（localStorage 不可用时） */
export function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    __isMemory: true,
  };
}

/**
 * 探测可用的 storage
 * @returns {{ storage: object, persistent: boolean, reason?: string }}
 */
export function detectStorage(globalObj = globalThis) {
  try {
    const ls = globalObj?.localStorage;
    if (!ls) return { storage: memoryStorage(), persistent: false, reason: '当前环境没有 localStorage' };
    // 真正写一次才能确认可用（隐私模式下 setItem 会抛异常）
    const probe = '__zj_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return { storage: ls, persistent: true };
  } catch (e) {
    return {
      storage: memoryStorage(),
      persistent: false,
      reason: `localStorage 不可用（${e.message}），已降级为内存存储，关闭页面后配置会丢失`,
    };
  }
}

/** 深合并默认值，兼容旧版本存储结构缺字段的情况 */
function normalize(raw) {
  const d = defaultState();
  if (!raw || typeof raw !== 'object') return d;
  return {
    ...d,
    ...raw,
    config: { ...d.config, ...(raw.config || {}) },
    ui: { ...d.ui, ...(raw.ui || {}) },
    custom: { ...(raw.custom || {}) },
    schemes: { ...(raw.schemes || {}) },
  };
}

export class Store {
  /**
   * @param {object} [opts]
   * @param {object} [opts.storage]  注入存储（测试用）
   * @param {boolean}[opts.autoSave] 是否自动保存
   */
  constructor(opts = {}) {
    const det = opts.storage
      ? { storage: opts.storage, persistent: !opts.storage.__isMemory }
      : detectStorage(opts.global);

    this.storage = det.storage;
    this.persistent = det.persistent;
    this.storageWarning = det.reason || null;
    this.autoSave = opts.autoSave !== false;

    this.listeners = new Set();
    this._timer = null;

    this.state = this._load();
  }

  _load() {
    try {
      const raw = this.storage.getItem(KEY);
      if (!raw) return defaultState();
      return normalize(JSON.parse(raw));
    } catch {
      // 存储内容损坏时回退到默认值，不影响启动（NF7）
      return defaultState();
    }
  }

  /** 订阅变更 */
  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** 通知订阅者 */
  _emit(reason) {
    for (const fn of this.listeners) {
      try {
        fn(this.state, reason);
      } catch (e) {
        // 单个订阅者异常不应影响其他订阅者
        console.error('store listener error:', e);
      }
    }
  }

  /** 立即写入存储 */
  flush() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    try {
      this.storage.setItem(KEY, JSON.stringify(this.state));
      return true;
    } catch (e) {
      this.storageWarning = `保存失败：${e.message}`;
      return false;
    }
  }

  /** 调度保存（防抖） */
  _scheduleSave() {
    if (!this.autoSave) return;
    if (this._timer) clearTimeout(this._timer);
    const delay = 300; // PRD T3.2 防抖 300ms
    if (typeof setTimeout === 'function') {
      this._timer = setTimeout(() => {
        this._timer = null;
        this.flush();
      }, delay);
    } else {
      this.flush();
    }
  }

  /**
   * 通用更新
   *
   * dirty 语义：true = 有未保存到方案的改动。
   * 默认每次变更都置为 true；但「保存方案」「载入方案」这类操作本身就代表
   * 已同步，会在 mutator 内把 dirty 设为 false。为了不覆盖 mutator 的意图，
   * 这里用 markDirty:false 明确跳过自动置位。
   */
  update(mutator, reason = 'update', { markDirty = true } = {}) {
    mutator(this.state);
    if (markDirty) this.state.dirty = true;
    this._scheduleSave();
    this._emit(reason);
    return this.state;
  }

  // ── 配置操作 ────────────────────────────────────────────────────

  /** 选择某品类的型号（硬盘为追加） */
  select(category, id) {
    return this.update((s) => {
      if (category === 'storage') {
        const arr = Array.isArray(s.config.storage) ? s.config.storage : [];
        if (!arr.includes(id)) s.config.storage = [...arr, id];
      } else {
        s.config[category] = id;
      }
      // 换配件后清掉详情选中，避免详情区停留在旧的候选上
      if (s.ui.selectedDetail && s.ui.selectedDetail !== id) s.ui.selectedDetail = null;
    }, 'select');
  }

  /** 取消某品类的选择（硬盘可指定单个 id） */
  deselect(category, id = null) {
    return this.update((s) => {
      if (category === 'storage') {
        const arr = Array.isArray(s.config.storage) ? s.config.storage : [];
        s.config.storage = id ? arr.filter((x) => x !== id) : [];
      } else {
        s.config[category] = null;
      }
    }, 'deselect');
  }

  /** 全部重置（PRD 6.4 二次确认由界面负责） */
  resetAll() {
    return this.update((s) => {
      s.config = defaultState().config;
      s.ui.compare = [];
      s.ui.selectedDetail = null;
      s.dirty = true;
    }, 'reset');
  }

  // ── 界面状态 ────────────────────────────────────────────────────

  setCategory(category) {
    return this.update((s) => {
      s.ui.category = category;
      s.ui.selectedDetail = null;
      s.ui.compare = [];
    }, 'category');
  }

  setQuery(query) {
    return this.update((s) => { s.ui.query = query; }, 'query');
  }

  setFilter(key, value) {
    return this.update((s) => {
      const f = { ...s.ui.filters };
      if (value === undefined || value === null || value === '' || value === false) delete f[key];
      else f[key] = value;
      s.ui.filters = f;
    }, 'filter');
  }

  clearFilters() {
    return this.update((s) => { s.ui.filters = {}; s.ui.query = ''; }, 'clear-filters');
  }

  setSort(key, dir) {
    return this.update((s) => {
      s.ui.sort = { key: key || '', dir: dir || (s.ui.sort?.dir === 'asc' ? 'desc' : 'asc') };
    }, 'sort');
  }

  toggleSortDir() {
    return this.update((s) => {
      s.ui.sort = { ...s.ui.sort, dir: s.ui.sort?.dir === 'desc' ? 'asc' : 'desc' };
    }, 'sort-dir');
  }

  setView(view) {
    return this.update((s) => { s.ui.view = view; }, 'view');
  }

  setIncludeUsed(on) {
    return this.update((s) => { s.ui.includeUsed = !!on; }, 'include-used');
  }

  setDetail(id) {
    return this.update((s) => { s.ui.selectedDetail = id; }, 'detail');
  }

  setFindingFilter(filter) {
    return this.update((s) => { s.ui.findingFilter = filter; }, 'finding-filter');
  }

  toggleRightCollapsed() {
    return this.update((s) => { s.ui.rightCollapsed = !s.ui.rightCollapsed; }, 'right-collapse');
  }

  /** 勾选/取消对比（最多 4 个，PRD 6.5.2） */
  toggleCompare(id) {
    return this.update((s) => {
      const arr = Array.isArray(s.ui.compare) ? [...s.ui.compare] : [];
      const i = arr.indexOf(id);
      if (i >= 0) arr.splice(i, 1);
      else if (arr.length < 4) arr.push(id);
      else return; // 已满 4 个，忽略
      s.ui.compare = arr;
    }, 'compare');
  }

  clearCompare() {
    return this.update((s) => { s.ui.compare = []; }, 'compare-clear');
  }

  // ── 自定义数据（CSV 导入，M2）────────────────────────────────────

  setCustom(category, records) {
    return this.update((s) => {
      s.custom = { ...s.custom, [category]: records };
    }, 'custom');
  }

  clearCustom(category = null) {
    return this.update((s) => {
      if (category) {
        const c = { ...s.custom };
        delete c[category];
        s.custom = c;
      } else {
        s.custom = {};
      }
    }, 'custom-clear');
  }

  // ── 方案管理（M8）──────────────────────────────────────────────

  /** 保存当前配置为方案（保存即同步，不应留下 dirty 标记） */
  saveScheme(name) {
    if (!name) return this.state;
    return this.update((s) => {
      s.schemes = {
        ...s.schemes,
        [name]: { config: JSON.parse(JSON.stringify(s.config)), savedAt: Date.now() },
      };
      s.currentScheme = name;
      s.dirty = false;
    }, 'scheme-save', { markDirty: false });
  }

  /** 载入方案（载入后与方案一致，不应是 dirty） */
  loadScheme(name) {
    const scheme = this.state.schemes?.[name];
    if (!scheme) return this.state;
    return this.update((s) => {
      s.config = { ...defaultState().config, ...JSON.parse(JSON.stringify(scheme.config)) };
      s.currentScheme = name;
      s.dirty = false;
      s.ui.compare = [];
      s.ui.selectedDetail = null;
    }, 'scheme-load', { markDirty: false });
  }

  /** 删除方案 */
  deleteScheme(name) {
    return this.update((s) => {
      const sc = { ...s.schemes };
      delete sc[name];
      s.schemes = sc;
      if (s.currentScheme === name) s.currentScheme = '';
    }, 'scheme-delete');
  }

  /** 重命名方案 */
  renameScheme(oldName, newName) {
    if (!oldName || !newName || oldName === newName) return this.state;
    return this.update((s) => {
      if (!s.schemes?.[oldName]) return;
      const sc = { ...s.schemes };
      sc[newName] = sc[oldName];
      delete sc[oldName];
      s.schemes = sc;
      if (s.currentScheme === oldName) s.currentScheme = newName;
    }, 'scheme-rename');
  }

  /** 方案名列表（按保存时间倒序） */
  schemeNames() {
    return Object.entries(this.state.schemes || {})
      .sort((a, b) => (b[1].savedAt || 0) - (a[1].savedAt || 0))
      .map(([name]) => name);
  }

  /** 方案对比（PRD 6.7.1）——只比型号、兼容性、功耗，不含价格 */
  static describeScheme(scheme) {
    if (!scheme) return null;
    const cfg = scheme.config || {};
    return {
      config: cfg,
      storageCount: Array.isArray(cfg.storage) ? cfg.storage.length : 0,
    };
  }
}

export { KEY, KEY_SCHEMES };
export default Store;
