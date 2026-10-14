/**
 * 状态灯汇总（PRD 4.4 / 6.4）
 *
 * 定稿规则：每个品类的状态灯 = 该品类参与的**所有**规则结果中最严重的一级。
 * 一条规则涉及多个品类时，涉及的品类**同时点亮**。
 *
 * 重要：这里有**两种计数口径**，实现时不可混用（PRD 6.4 明确警告）：
 *   - 左栏状态灯 → 按**品类**统计（如 E1 使 CPU 与主板同时变红）
 *   - 右栏面板 + 底部统计 → 按**规则条数**统计
 *
 * 纯函数模块，不接触 DOM。
 */

import { LEVEL_SEVERITY, STATUS_ICONS } from './enums.js';

/** 8 个品类（与 enums.CATEGORY_ORDER 一致） */
export const STATUS_CATEGORIES = [
  'cpu',
  'motherboard',
  'gpu',
  'memory',
  'psu',
  'case',
  'cooler',
  'storage',
];

/**
 * 计算每个品类的状态灯
 *
 * @param {object} options
 * @param {Array} options.findings   规则引擎输出的 findings（每条含 level 与 categories）
 * @param {object} options.config    已选配置（ID 引用），用于判断"未选"
 * @returns {{
 *   lights: { [category]: 'error'|'warn'|'ok'|'unselected' },
 *   icons:  { [category]: string },
 *   counts: { error:number, warn:number, ok:number, unselected:number }
 * }}
 */
export function computeStatusLights({ findings = [], config = {} } = {}) {
  const lights = {};
  const icons = {};

  // 先判断每个品类是否已选
  for (const cat of STATUS_CATEGORIES) {
    const v = config[cat];
    const selected = cat === 'storage'
      ? Array.isArray(v) && v.length > 0
      : !!v;
    lights[cat] = selected ? 'ok' : 'unselected';
  }

  // 按 findings 点亮：一条规则涉及多品类则都点亮
  for (const f of findings) {
    const cats = Array.isArray(f.categories) ? f.categories : [];
    for (const cat of cats) {
      if (!(cat in lights)) continue;
      // 未选的品类不因规则而被点亮（未选不视为问题，PRD 4.4）
      if (lights[cat] === 'unselected') continue;

      const cur = lights[cat];
      const curSev = cur === 'ok' ? 0 : LEVEL_SEVERITY[cur] || 0;
      const newSev = LEVEL_SEVERITY[f.level] || 0;
      if (newSev > curSev) lights[cat] = f.level;
    }
  }

  for (const cat of STATUS_CATEGORIES) {
    icons[cat] = STATUS_ICONS[lights[cat]];
  }

  const counts = { error: 0, warn: 0, ok: 0, unselected: 0 };
  for (const cat of STATUS_CATEGORIES) counts[lights[cat]]++;

  return { lights, icons, counts };
}

/**
 * 按规则条数统计（右栏面板 + 底部统计用，PRD 6.4 / 6.6.1）
 *
 * 与 computeStatusLights 的口径区分：
 *   E1 使 CPU 与主板同时变红 → 品类计 🔴2，规则计 🔴1
 */
export function countFindings(findings = []) {
  const counts = { error: 0, warn: 0, info: 0, total: 0 };
  for (const f of findings) {
    if (f.level === 'error') counts.error++;
    else if (f.level === 'warn') counts.warn++;
    else if (f.level === 'info') counts.info++;
    counts.total++;
  }
  return counts;
}

/**
 * 汇总一份「已选进度」（左栏底部统计用）
 */
export function selectionSummary(config = {}) {
  let selected = 0;
  for (const cat of STATUS_CATEGORIES) {
    const v = config[cat];
    const has = cat === 'storage'
      ? Array.isArray(v) && v.length > 0
      : !!v;
    if (has) selected++;
  }
  return {
    selected,
    total: STATUS_CATEGORIES.length,
    unselected: STATUS_CATEGORIES.length - selected,
  };
}
