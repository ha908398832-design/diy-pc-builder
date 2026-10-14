/**
 * 搜索 / 筛选 / 排序（PRD M7 / 3.6.2~3.6.4）
 *
 * 纯函数模块，不接触 DOM，可在 Node 中单测。
 *
 * 搜索要求（PRD 3.6.2 必须命中的情况）：
 *   '7800x3d'   → R7 7800X3D        （大小写不敏感）
 *   '7800 x3d'  → R7 7800X3D        （忽略空格）
 *   '4070S'     → RTX 4070 SUPER    （别名映射）
 *   '小雕'      → 技嘉 B650M 小雕    （中文别名）
 *   'b650m'     → 所有 B650M 主板    （部分匹配）
 *
 * 排序维度：性能分 / 功耗 / 发布时间 / 名称（**不含价格**，PRD 1.5）
 */

import { CATEGORY_ORDER, CONDITION_LABELS } from './enums.js';

/**
 * 归一化字符串：小写、去空格、去连字符与常见分隔符
 * 目的：让 '7800 x3d'、'7800X3D'、'7800-x3d' 都能匹配
 */
export function normalize(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[\s\-_/\\]+/g, '')
    .replace(/[（）()【】\[\]]/g, '')
    .replace(/[™®©]/g, '');
}

/**
 * 为一条记录构建可搜索文本（含别名、品牌、型号）
 * 返回 { normalized: string, raw: string }
 */
export function searchableText(rec) {
  const parts = [
    rec.name,
    rec.brand,
    rec.chipset,
    rec.id,
    ...(Array.isArray(rec.aliases) ? rec.aliases : []),
  ].filter(Boolean);
  const raw = parts.join(' ');
  return { normalized: normalize(raw), raw };
}

/**
 * 判断记录是否命中查询
 * 支持：多关键词（空格分隔，全部命中才算）＋ 归一化子串匹配
 */
export function matchesQuery(rec, query) {
  if (!query || !query.trim()) return true;
  const hay = normalize(searchableText(rec).raw);
  const terms = String(query).trim().split(/\s+/).map(normalize).filter(Boolean);
  if (terms.length === 0) return true;
  return terms.every((t) => hay.includes(t));
}

/**
 * 计算匹配得分（用于排序时把更相关的排前面）
 * 得分越高越靠前：完全等于别名 > 名称前缀 > 名称包含 > 别名包含
 */
export function scoreMatch(rec, query) {
  if (!query || !query.trim()) return 0;
  const q = normalize(query);
  const name = normalize(rec.name);
  const aliases = (Array.isArray(rec.aliases) ? rec.aliases : []).map(normalize);
  const brand = normalize(rec.brand);

  let score = 0;
  if (aliases.some((a) => a === q)) score += 1000;
  if (name === q) score += 900;
  if (aliases.some((a) => a.startsWith(q))) score += 500;
  if (name.startsWith(q)) score += 400;
  if (name.includes(q)) score += 200;
  if (brand.includes(q)) score += 100;
  if (aliases.some((a) => a.includes(q))) score += 50;
  return score;
}

// ══════════════════════════════════════════════════════════════════
// 筛选
// ══════════════════════════════════════════════════════════════════

/**
 * 各品类的筛选条件定义（PRD 3.6.4，**不含价格区间**）
 * 每项：{ key, label, type, field, options? , min?, max? }
 *   type: 'enum' | 'boolean' | 'range' | 'multiEnum'
 */
export const FILTER_DEFS = {
  cpu: [
    { key: 'brand', label: '品牌', type: 'enum', field: 'brand' },
    { key: 'socket', label: '插槽', type: 'enum', field: 'socket' },
    { key: 'igpu', label: '带核显', type: 'boolean', field: 'igpu' },
    { key: 'maxPower', label: '峰值功耗', type: 'range', field: 'maxPower', unit: 'W' },
    { key: 'unlocked', label: '可超频', type: 'boolean', field: 'unlocked' },
    { key: 'condition', label: '新旧', type: 'enum', field: 'condition' },
  ],
  motherboard: [
    { key: 'brand', label: '品牌', type: 'enum', field: 'brand' },
    { key: 'socket', label: '插槽', type: 'enum', field: 'socket' },
    { key: 'chipset', label: '芯片组', type: 'enum', field: 'chipset' },
    { key: 'formFactor', label: '板型', type: 'enum', field: 'formFactor' },
    { key: 'memoryType', label: '内存代数', type: 'enum', field: 'memoryType' },
    { key: 'wifi', label: '带 WiFi', type: 'boolean', field: 'wifi' },
  ],
  gpu: [
    { key: 'brand', label: '品牌', type: 'enum', field: 'brand' },
    { key: 'vram', label: '显存容量', type: 'range', field: 'vram', unit: 'GB' },
    { key: 'condition', label: '新旧', type: 'enum', field: 'condition' },
    { key: 'length_mm', label: '显卡长度', type: 'range', field: 'length_mm', unit: 'mm' },
    { key: 'tdp', label: '功耗', type: 'range', field: 'tdp', unit: 'W' },
  ],
  memory: [
    { key: 'memoryType', label: '代数', type: 'enum', field: 'memoryType' },
    { key: 'capacityPerModule', label: '单条容量', type: 'enum', field: 'capacityPerModule' },
    { key: 'speed', label: '频率', type: 'range', field: 'speed', unit: 'MT/s' },
    { key: 'modules', label: '套装条数', type: 'enum', field: 'modules' },
  ],
  psu: [
    { key: 'wattage', label: '瓦数', type: 'range', field: 'wattage', unit: 'W' },
    { key: 'formFactor', label: '规格', type: 'enum', field: 'formFactor' },
    { key: 'efficiency', label: '认证', type: 'enum', field: 'efficiency' },
    { key: 'modular', label: '模组化', type: 'enum', field: 'modular' },
  ],
  case: [
    { key: 'brand', label: '品牌', type: 'enum', field: 'brand' },
    { key: 'formFactors', label: '支持板型', type: 'multiEnum', field: 'formFactors' },
    { key: 'maxGpuLength', label: '显卡限长', type: 'range', field: 'maxGpuLength', unit: 'mm' },
    { key: 'maxCoolerHeight', label: '风冷限高', type: 'range', field: 'maxCoolerHeight', unit: 'mm' },
  ],
  cooler: [
    { key: 'type', label: '类型', type: 'enum', field: 'type' },
    { key: 'radiatorSize', label: '冷排规格', type: 'enum', field: 'radiatorSize' },
    { key: 'height_mm', label: '风冷高度', type: 'range', field: 'height_mm', unit: 'mm' },
    { key: 'tdpRating', label: '散热能力', type: 'range', field: 'tdpRating', unit: 'W' },
  ],
  storage: [
    { key: 'interface', label: '接口', type: 'enum', field: 'interface' },
    { key: 'capacity', label: '容量', type: 'range', field: 'capacity', unit: 'GB' },
    { key: 'pcieVersion', label: 'PCIe 代数', type: 'enum', field: 'pcieVersion' },
    { key: 'nandType', label: 'NAND', type: 'enum', field: 'nandType' },
    { key: 'dram', label: '有缓存', type: 'boolean', field: 'dram' },
  ],
};

/**
 * 应用一组筛选条件
 * @param {Array} list 记录列表
 * @param {object} filters { [key]: value | {min,max} | boolean }
 * @param {string} category
 */
export function applyFilters(list, filters = {}, category) {
  const defs = FILTER_DEFS[category] || [];
  const active = defs.filter((d) => {
    const v = filters[d.key];
    if (v === undefined || v === null || v === '' || v === false) return false;
    if (typeof v === 'object' && !Array.isArray(v)) {
      return v.min !== undefined && v.min !== '' || v.max !== undefined && v.max !== '';
    }
    return true;
  });

  if (active.length === 0) return list.slice();

  return list.filter((rec) =>
    active.every((d) => {
      const v = filters[d.key];
      const fv = rec[d.field];

      if (d.type === 'boolean') return fv === true;

      if (d.type === 'range') {
        const min = v.min === undefined || v.min === '' ? -Infinity : Number(v.min);
        const max = v.max === undefined || v.max === '' ? Infinity : Number(v.max);
        if (typeof fv !== 'number') return false;
        return fv >= min && fv <= max;
      }

      if (d.type === 'multiEnum') {
        // 记录是多值（如机箱支持多种板型），筛选值命中其一即可
        const arr = Array.isArray(fv) ? fv : [fv];
        const want = Array.isArray(v) ? v : [v];
        return want.some((w) => arr.includes(w));
      }

      // enum
      return fv === v;
    }),
  );
}

/**
 * 汇总某品类某字段的全部可选值（用于生成筛选下拉项）
 */
export function collectOptions(list, category) {
  const defs = FILTER_DEFS[category] || [];
  const out = {};
  for (const d of defs) {
    if (d.type !== 'enum' && d.type !== 'multiEnum') continue;
    const set = new Set();
    for (const rec of list) {
      const v = rec[d.field];
      if (Array.isArray(v)) v.forEach((x) => set.add(x));
      else if (v !== undefined && v !== null) set.add(v);
    }
    out[d.key] = [...set].sort((a, b) =>
      typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), 'zh'),
    );
  }
  return out;
}

// ══════════════════════════════════════════════════════════════════
// 排序（PRD 3.6.3，不含价格）
// ══════════════════════════════════════════════════════════════════

/**
 * 各品类可用的排序维度
 */
export const SORT_DEFS = {
  cpu: [
    { key: 'gameScore', label: '游戏性能' },
    { key: 'productivityScore', label: '生产力性能' },
    { key: 'maxPower', label: '峰值功耗' },
    { key: 'year', label: '发布时间' },
    { key: 'name', label: '名称' },
  ],
  motherboard: [
    { key: 'maxMemorySpeed', label: '内存频率上限' },
    { key: 'm2Slots', label: 'M.2 数量' },
    { key: 'year', label: '发布时间' },
    { key: 'name', label: '名称' },
  ],
  gpu: [
    { key: 'gameScore', label: '游戏性能' },
    { key: 'productivityScore', label: '生产力性能' },
    { key: 'vram', label: '显存容量' },
    { key: 'tdp', label: '功耗' },
    { key: 'year', label: '发布时间' },
    { key: 'name', label: '名称' },
  ],
  memory: [
    { key: 'speed', label: '频率' },
    { key: 'capacityPerModule', label: '单条容量' },
    { key: 'year', label: '发布时间' },
    { key: 'name', label: '名称' },
  ],
  psu: [
    { key: 'wattage', label: '瓦数' },
    { key: 'year', label: '发布时间' },
    { key: 'name', label: '名称' },
  ],
  case: [
    { key: 'maxGpuLength', label: '显卡限长' },
    { key: 'maxCoolerHeight', label: '风冷限高' },
    { key: 'volume', label: '体积' },
    { key: 'name', label: '名称' },
  ],
  cooler: [
    { key: 'tdpRating', label: '散热能力' },
    { key: 'height_mm', label: '高度' },
    { key: 'noise_dba', label: '噪声' },
    { key: 'name', label: '名称' },
  ],
  storage: [
    { key: 'capacity', label: '容量' },
    { key: 'readSpeed', label: '顺序读取' },
    { key: 'year', label: '发布时间' },
    { key: 'name', label: '名称' },
  ],
};

/**
 * 排序
 * @param {Array} list
 * @param {{key:string, dir:'asc'|'desc'}} sort
 * @param {string} category
 */
export function applySort(list, sort, category) {
  if (!sort || !sort.key) return list.slice();
  const dir = sort.dir === 'desc' ? -1 : 1;
  const key = sort.key;

  return list.slice().sort((a, b) => {
    let av = a[key];
    let bv = b[key];

    // 缺失值统一排最后
    const aMissing = av === undefined || av === null || av === '';
    const bMissing = bv === undefined || bv === null || bv === '';
    if (aMissing && bMissing) return 0;
    if (aMissing) return 1;
    if (bMissing) return -1;

    let cmp;
    if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
    else cmp = String(av).localeCompare(String(bv), 'zh', { numeric: true });

    return cmp * dir;
  });
}

// ══════════════════════════════════════════════════════════════════
// 组合：搜索 + 筛选 + 排序
// ══════════════════════════════════════════════════════════════════

/**
 * 「含二手」快捷开关（PRD M7-11）：默认关闭，打开后并入二手/矿卡/洋垃圾
 *
 * 采用「白名单式排除」：只有 condition 明确为二手/矿卡/洋垃圾时才被过滤。
 * 不用 `condition === 'new'` 做正向筛选，因为那样会让 condition 字段缺失的记录
 * 一并消失（数据异常时用户会以为型号不存在，比多显示一条更难排查）。
 */
export function applyConditionFilter(list, includeUsed) {
  if (includeUsed) return list.slice();
  return list.filter((r) => !r.condition || r.condition === 'new');
}

/**
 * 一次调用完成列表加工
 *
 * @param {object} options
 * @param {Array}  options.list       该品类全量数据
 * @param {string} options.category   品类
 * @param {string} [options.query]    搜索词
 * @param {object} [options.filters]  筛选条件
 * @param {object} [options.sort]     排序
 * @param {boolean}[options.includeUsed] 是否含二手（默认 false）
 * @returns {{ items: Array, total: number, matched: number }}
 */
export function queryList({
  list = [],
  category,
  query = '',
  filters = {},
  sort = null,
  includeUsed = false,
} = {}) {
  const total = list.length;

  let items = applyConditionFilter(list, includeUsed);
  items = applyFilters(items, filters, category);

  if (query && query.trim()) {
    items = items.filter((r) => matchesQuery(r, query));
    // 有查询词时按相关度优先排序
    if (!sort || !sort.key) {
      items = items.slice().sort((a, b) => scoreMatch(b, query) - scoreMatch(a, query));
    }
  }

  if (sort && sort.key) {
    items = applySort(items, sort, category);
  }

  return { items, total, matched: items.length };
}

/**
 * 品类顺序（左栏用）
 */
export function categoryOrder() {
  return CATEGORY_ORDER.slice();
}

/**
 * 状态标签文案（二手/矿卡/洋垃圾）
 */
export function conditionLabel(condition) {
  if (!condition || condition === 'new') return null;
  return CONDITION_LABELS[condition] || condition;
}
