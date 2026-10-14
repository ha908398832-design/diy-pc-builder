/**
 * 兼容性规则引擎（PRD M3）
 *
 * 职责：
 *   1. 按 required 过滤未选齐的规则，计入 skipped（PRD M3-6，不误报）
 *   2. 执行全部 check，收集 findings
 *   3. 每条 finding 含 level/title/id/reason/advice/refs（PRD M3-3）
 *   4. 按 error → warn → info 排序（PRD M3-7 的展示顺序）
 *   5. 返回统计 { findings, checked, skipped }
 *
 * 纯函数，不接触 DOM，可在 Node 中单测。
 */

import { RULES, RULE_MAP, RULE_COUNT } from './rules-data.js';
import { LEVEL_SEVERITY } from './enums.js';
import { computePower } from './power.js';

/** 配置里各品类的键 */
const CONFIG_KEYS = [
  'cpu',
  'motherboard',
  'gpu',
  'memory',
  'psu',
  'cooler',
  'case',
  'storage',
];

/**
 * 把 store.config 的 ID 引用解析为对象
 * @param {object} config  { cpu: 'id'|null, ..., storage: ['id', ...] }
 * @param {Map<string, object>|object} byId  型号库索引
 * @returns {object} { cpu: {...}, ..., storage: [...] }
 */
export function resolveConfig(config = {}, byId) {
  const get = (id) => {
    if (!id) return null;
    if (byId instanceof Map) return byId.get(id) || null;
    return byId?.[id] || null;
  };

  const resolved = {};
  for (const key of CONFIG_KEYS) {
    const val = config[key];
    if (key === 'storage') {
      const arr = Array.isArray(val) ? val : val ? [val] : [];
      resolved.storage = arr.map(get).filter(Boolean);
    } else {
      resolved[key] = get(val);
    }
  }
  return resolved;
}

/** 判断某规则的 required 是否都已选 */
function requirementsMet(rule, resolved) {
  const req = rule.required || [];
  for (const key of req) {
    const v = resolved[key];
    if (key === 'storage') {
      if (!Array.isArray(v) || v.length === 0) return false;
    } else if (!v) {
      return false;
    }
  }
  return true;
}

/**
 * 为 I4 这类规则动态推断涉及品类（哪个品类的配件是二手的就点亮哪个）
 */
function dynamicCategories(rule, resolved, finding) {
  if (rule.id !== 'I4') return rule.categories || [];
  const cats = [];
  const label = { used: 1, mining: 1, oem: 1 };
  for (const key of CONFIG_KEYS) {
    const v = resolved[key];
    const items = Array.isArray(v) ? v : v ? [v] : [];
    if (items.some((it) => it && it.condition && it.condition !== 'new')) {
      cats.push(key);
    }
  }
  return cats;
}

/**
 * 运行兼容性检查
 *
 * @param {object} options
 * @param {object} options.config     已选配置（ID 引用）
 * @param {Map|object} options.byId   型号库索引（id → 记录）
 * @param {object} [options.resolved] 也可直接传入已解析的对象
 * @returns {{
 *   findings: Array,
 *   checked: number,
 *   skipped: number,
 *   total: number,
 *   counts: { error:number, warn:number, info:number },
 *   power: object
 * }}
 */
export function checkCompatibility({ config = {}, byId, resolved: preResolved } = {}) {
  const resolved = preResolved || resolveConfig(config, byId);

  // 功耗先算出来，多条规则（E10/W1/I1/W8）都要用
  const power = computePower(resolved);
  const ctx = { ...resolved, power, config: resolved };

  const findings = [];
  let checked = 0;
  let skipped = 0;

  for (const rule of RULES) {
    if (!requirementsMet(rule, resolved)) {
      skipped++;
      continue;
    }
    checked++;

    let result;
    try {
      result = rule.check(ctx);
    } catch (e) {
      // 单条规则异常不应影响整体（PRD NF7 容错）
      result = {
        reason: `规则执行异常：${e.message}`,
        advice: '请检查该配件数据是否完整',
        refs: [],
        _internalError: true,
      };
    }

    if (!result) continue;

    const cats = result.categories || dynamicCategories(rule, resolved, result);

    findings.push({
      id: rule.id,
      level: rule.level,
      title: rule.title,
      reason: result.reason,
      advice: result.advice,
      refs: result.refs || [],
      categories: cats,
      fields: rule.fields || [],
      good: rule.good,
      bad: rule.bad,
    });
  }

  // 按严重度排序；同级按规则编号（E1<E2<... W1<... I1<...）
  const idOrder = (id) => {
    const prefix = id[0];
    const num = Number(id.slice(1));
    const base = prefix === 'E' ? 0 : prefix === 'W' ? 1000 : 2000;
    return base + num;
  };
  findings.sort((a, b) => {
    const d = LEVEL_SEVERITY[b.level] - LEVEL_SEVERITY[a.level];
    if (d !== 0) return d;
    return idOrder(a.id) - idOrder(b.id);
  });

  const counts = {
    error: findings.filter((f) => f.level === 'error').length,
    warn: findings.filter((f) => f.level === 'warn').length,
    info: findings.filter((f) => f.level === 'info').length,
  };

  return {
    findings,
    checked,
    skipped,
    total: RULE_COUNT,
    counts,
    power,
  };
}

/**
 * 只判断某个候选型号能否配当前配置（PRD 6.5.4 对比表的「与当前配置」列）
 * 做法：把它代入对应品类，跑一次完整检查，只回报与该品类相关的 findings
 *
 * @param {string} category   候选型号所属品类
 * @param {object} candidate  候选型号记录
 * @param {object} config     当前配置（ID 引用）
 * @param {Map|object} byId   型号库索引
 * @returns {{ level:'error'|'warn'|'ok', findings:Array }}
 */
export function checkCandidate(category, candidate, config, byId) {
  const trial = { ...config };
  if (category === 'storage') {
    const arr = Array.isArray(config.storage) ? [...config.storage] : config.storage ? [config.storage] : [];
    trial.storage = [candidate.id, ...arr];
  } else {
    trial[category] = candidate.id;
  }

  const { findings } = checkCompatibility({ config: trial, byId });

  // 只保留与该品类相关的
  const relevant = findings.filter((f) => (f.categories || []).includes(category));

  let level = 'ok';
  if (relevant.some((f) => f.level === 'error')) level = 'error';
  else if (relevant.some((f) => f.level === 'warn')) level = 'warn';

  return { level, findings: relevant };
}

/**
 * 批量判断某品类下所有候选（供列表行内 ⚠ 标记使用）
 * 注意：为性能考虑，仅对传入的候选列表计算
 */
export function checkCandidates(category, candidates, config, byId) {
  const out = new Map();
  for (const c of candidates) {
    out.set(c.id, checkCandidate(category, c, config, byId));
  }
  return out;
}

export { RULES, RULE_MAP, RULE_COUNT };
export { computePower };
