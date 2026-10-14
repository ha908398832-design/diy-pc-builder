/**
 * 芯片级归并（PRD 3.1.2b）
 *
 * 显卡按 chipset、主板按 chipset 归并为「芯片行」，
 * 点击芯片行可展开该芯片下各品牌的具体变体（含真实长度/厚度/供电）。
 *
 * 关键约束（务必保持）：
 *   归并只发生在**展示层**。规则引擎仍按**具体型号**的尺寸计算 ——
 *   因为同一芯片不同品牌的尺寸差异直接决定 E5(显卡限长) / E6(显卡厚度)
 *   的判定结果（实测 GTX 1060 有 175mm ITX / 242mm 标准 / 290mm 长卡三种）。
 *
 * 本模块为纯函数，不接触 DOM，可在 Node 中直接单测。
 */

import { CATEGORY_LABELS } from './enums.js';

/** 支持芯片归并的品类 → 归并键字段 */
export const GROUPED_CATEGORIES = {
  gpu: 'chipset',
  motherboard: 'chipset',
};

/** 该品类是否启用芯片归并 */
export function isGrouped(category) {
  return Object.hasOwn(GROUPED_CATEGORIES, category);
}

/** 取归并键（未启用归并的品类返回 null） */
export function groupKeyOf(category) {
  return GROUPED_CATEGORIES[category] || null;
}

// ══════════════════════════════════════════════════════════════════
// 形态判定
// ══════════════════════════════════════════════════════════════════

/** 形态枚举（写入数据的 variant 字段时也用这些值） */
export const VARIANTS = ['ITX', '单风扇', '单槽薄', '标准', '长卡', '矿卡'];

/**
 * 由长度 + 厚度 + 成色推导形态标签
 *
 * 阈值说明（基于实测常见非公版尺寸）：
 *   ≤180mm  → ITX/短卡（多数 ITX 卡 168~183mm）
 *   ≤210mm  → 单风扇（紧凑机箱可选）
 *   ≥320mm  → 长卡（需大机箱，常见于旗舰非公版）
 *   厚度 ≤2 槽 → 单槽薄
 *   condition = mining → 矿卡
 *
 * @param {object} rec  型号记录
 * @returns {string[]} 形态标签数组
 */
export function inferVariants(rec) {
  const tags = [];
  const len = rec.length_mm;
  const thick = rec.thicknessSlots;

  if (typeof len === 'number') {
    if (len <= 180) tags.push('ITX');
    else if (len <= 210) tags.push('单风扇');
    if (len >= 320) tags.push('长卡');
  }
  if (typeof thick === 'number' && thick <= 2) tags.push('单槽薄');

  if (rec.condition === 'mining') tags.push('矿卡');

  // 没有长度信息时不能瞎猜，至少标注成色
  if (tags.length === 0) tags.push('标准');
  return tags;
}

/** 记录的实际形态：优先用 variant 字段，否则自动推导 */
export function variantsOf(rec) {
  if (rec.variant) return [rec.variant];
  return inferVariants(rec);
}

// ══════════════════════════════════════════════════════════════════
// 区间计算
// ══════════════════════════════════════════════════════════════════

/**
 * 求一组记录在某数值字段上的区间
 *
 * @returns {{min:number,max:number,exact:boolean}|null}
 *   exact=true 表示组内该字段完全一致（min === max）
 */
export function fieldRange(records, field) {
  const vals = records
    .map((r) => r[field])
    .filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (vals.length === 0) return null;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  return { min, max, exact: min === max };
}

/**
 * 格式化区间为展示字符串
 *
 * @param {object|null} range fieldRange 结果
 * @param {string} unit 单位后缀（如 'mm'）
 * @returns {string}
 */
export function formatRange(range, unit = '') {
  if (!range) return '—';
  const suffix = unit ? ` ${unit}` : '';
  return range.exact
    ? `${range.min}${suffix}`
    : `${range.min}~${range.max}${suffix}`;
}

// ══════════════════════════════════════════════════════════════════
// 归并主函数
// ══════════════════════════════════════════════════════════════════

/**
 * 把同品类的型号列表按芯片归并
 *
 * @param {string} category 品类（gpu / motherboard）
 * @param {Array} items 该品类的型号记录
 * @returns {Array} 芯片组数组，每项：
 *   {
 *     key,            // 归并键值，如 'GTX 1060'
 *     chipset,        // 同 key
 *     label,          // 展示用芯片名
 *     records,        // 该芯片下所有变体（按长度升序）
 *     rep,            // 代表记录（芯片级参数取自它）
 *     count,          // 变体数量
 *     lengthRange,    // 长度区间
 *     thicknessRange, // 厚度区间
 *     variants,       // 形态标签（组内并集，有序去重）
 *     conditions,     // 组内出现的成色集合
 *     // 以下为芯片级聚合值（取自 rep，兼容性计算不依赖它们）
 *     vram, tdp, gameScore, productivityScore, powerConnectors
 *   }
 */
export function groupByChipset(category, items) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const key = groupKeyOf(category);
  if (!key) {
    // 未启用归并的品类：每条记录自成一组（保持统一调用方式）
    return items.map((rec) => singleGroup(category, rec));
  }

  const map = new Map();
  for (const rec of items) {
    const k = (rec[key] ?? '').toString().trim();
    // 归并键为空（数据缺字段）时退回用 id，保证不丢数据
    const groupKey = k || `__solo__:${rec.id}`;
    if (!map.has(groupKey)) map.set(groupKey, []);
    map.get(groupKey).push(rec);
  }

  const groups = [];
  for (const [k, recs] of map) {
    if (k.startsWith('__solo__:')) {
      groups.push(singleGroup(category, recs[0]));
      continue;
    }

    // 变体按长度升序（小机箱用户优先看到短卡），长度缺失的排最后
    const sorted = [...recs].sort((a, b) => {
      const la = typeof a.length_mm === 'number' ? a.length_mm : Infinity;
      const lb = typeof b.length_mm === 'number' ? b.length_mm : Infinity;
      if (la !== lb) return la - lb;
      // 长度相同则按成色：全新在前，便于推荐
      const rank = (r) => (r.condition === 'new' ? 0 : 1);
      return rank(a) - rank(b) || String(a.name).localeCompare(String(b.name));
    });

    // 代表记录：优先全新，其次第一条
    const rep = sorted.find((r) => r.condition === 'new') || sorted[0];

    // 形态标签并集，保持 VARIANTS 的声明顺序
    const seen = new Set(sorted.flatMap(variantsOf));
    const variants = VARIANTS.filter((v) => seen.has(v));

    groups.push({
      key: k,
      chipset: k,
      label: k,
      records: sorted,
      rep,
      count: sorted.length,
      lengthRange: fieldRange(sorted, 'length_mm'),
      thicknessRange: fieldRange(sorted, 'thicknessSlots'),
      variants,
      conditions: [...new Set(sorted.map((r) => r.condition).filter(Boolean))],
      vram: rep.vram,
      tdp: rep.tdp,
      gameScore: rep.gameScore,
      productivityScore: rep.productivityScore,
      // 供电接口：取组内最大值（最"挑"电源的那个变体）
      pcie8pin: maxOf(sorted, 'pcie8pin'),
      pcie12vhpwr: maxOf(sorted, 'pcie12vhpwr'),
      category,
    });
  }

  return groups;
}

/** 单条记录自成一组（用于未启用归并的品类，或归并键缺失时） */
function singleGroup(category, rec) {
  return {
    key: rec.id,
    chipset: null,
    label: rec.name,
    records: [rec],
    rep: rec,
    count: 1,
    lengthRange: fieldRange([rec], 'length_mm'),
    thicknessRange: fieldRange([rec], 'thicknessSlots'),
    variants: variantsOf(rec),
    conditions: rec.condition ? [rec.condition] : [],
    vram: rec.vram,
    tdp: rec.tdp,
    gameScore: rec.gameScore,
    productivityScore: rec.productivityScore,
    pcie8pin: rec.pcie8pin,
    pcie12vhpwr: rec.pcie12vhpwr,
    category,
  };
}

/** 取组内某数值字段的最大值（缺失按 0） */
function maxOf(records, field) {
  let m = 0;
  for (const r of records) {
    const v = r[field];
    if (typeof v === 'number' && Number.isFinite(v) && v > m) m = v;
  }
  return m;
}

/**
 * 判断某芯片组是否只有 1 个变体
 * 单变体时点击芯片行应**直接选中**，不弹层（少一次点击）
 */
export function isSingleVariant(group) {
  return !group || group.count <= 1;
}

/**
 * 芯片组的展示摘要（用于列表行副标题）
 * 例：「175~290mm · 2~3.8槽 · 3 个版本」
 */
export function groupSummary(group) {
  if (!group) return '';
  const parts = [];
  const len = formatRange(group.lengthRange, 'mm');
  if (len !== '—') parts.push(len);
  const th = formatRange(group.thicknessRange, '槽');
  if (th !== '—') parts.push(th);
  if (group.count > 1) parts.push(`${group.count} 个版本`);
  return parts.join(' · ');
}

/** 品类名（用于日志与提示文案） */
export function categoryLabel(category) {
  return CATEGORY_LABELS[category] || category;
}