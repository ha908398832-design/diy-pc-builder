#!/usr/bin/env node
/**
 * 数据校验脚本（PRD T0.3）
 *
 * 校验 data/*.json：
 *   - 缺必填 / 条件必填
 *   - 类型错误
 *   - 枚举越界（含数组元素）
 *   - 数值越界、数组条数
 *   - id 全局唯一
 *   - 跨字段一致性（case.formFactors ⊆ FORM_FACTORS 等，由枚举约束天然覆盖）
 *   - 品类与所在文件一致
 *
 * 用法:
 *   node tools/validate-data.mjs            # 校验全部存在的文件
 *   node tools/validate-data.mjs cpu gpu    # 只校验指定品类
 *   node tools/validate-data.mjs --json     # 输出 JSON（供其他工具消费）
 *
 * 退出码: 0 = 无错误；1 = 有错误；2 = 脚本自身异常
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ENUMS, CATEGORY_LABELS } from '../src/core/enums.js';
import {
  CATEGORY_LIST,
  CATEGORY_FIELDS,
  allFieldsOf,
} from '../schema/fields.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = join(ROOT, 'data');

const argv = process.argv.slice(2);
const JSON_OUT = argv.includes('--json');
const only = argv.filter((a) => !a.startsWith('--'));

// ── 工具 ────────────────────────────────────────────────────────────
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * 判断字段值是否缺失
 *
 * 数组的空值语义需要按字段区分：
 *   - 声明了 minItems（如 aliases / sockets / formFactors 至少 1 项）→ [] 算缺失
 *   - 未声明 minItems（如 case.radiatorSupport，语义是"无冷排位填空数组"）→ [] 合法
 * 若一律把 [] 判为缺失，则"机箱完全不支持水冷"这一真实情况无法表达，
 * 用户只能随便填个数值，反而让 E8 产生误判。
 */
function isMissing(v, field) {
  if (v === undefined || v === null || v === '') return true;
  if (Array.isArray(v) && v.length === 0) return !!field?.minItems;
  return false;
}

/** 收集错误 */
class Report {
  constructor() {
    this.errors = [];
    this.warnings = [];
    this.stats = {};
  }
  error(category, index, id, field, message) {
    this.errors.push({ category, index, id, field, message });
  }
  warn(category, index, id, field, message) {
    this.warnings.push({ category, index, id, field, message });
  }
}

/** 类型校验 */
function checkType(value, type) {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'string[]':
      return Array.isArray(value) && value.every((x) => typeof x === 'string');
    case 'number[]':
      return Array.isArray(value) && value.every((x) => typeof x === 'number' && Number.isFinite(x));
    case 'number|null':
      return value === null || (typeof value === 'number' && Number.isFinite(value));
    case 'string|null':
      return value === null || typeof value === 'string';
    default:
      return false;
  }
}

const typeLabel = {
  string: '字符串',
  number: '数字',
  boolean: '布尔值(是/否)',
  'string[]': '字符串数组',
  'number[]': '数字数组',
  'number|null': '数字或空',
  'string|null': '字符串或空',
};

/** 校验一条记录 */
function validateRecord(rec, category, index, report, seenIds) {
  const fields = allFieldsOf(category);
  const id = rec && typeof rec.id === 'string' ? rec.id : `#${index}`;

  if (!isPlainObject(rec)) {
    report.error(category, index, id, '-', '记录不是对象');
    return;
  }

  // 未知字段（警告，便于发现拼写错误）
  const known = new Set(fields.map((f) => f.key));
  for (const k of Object.keys(rec)) {
    if (!known.has(k)) {
      report.warn(category, index, id, k, `未知字段 "${k}"（可能是拼写错误）`);
    }
  }

  // category 必须与文件一致
  if (rec.category !== undefined && rec.category !== category) {
    report.error(
      category, index, id, 'category',
      `应为 "${category}"，实际 "${rec.category}"`,
    );
  }

  for (const f of fields) {
    const v = rec[f.key];

    // 条件必填
    let required = !!f.required;
    if (!required && f.requiredIf) {
      required = rec[f.requiredIf.field] === f.requiredIf.equals;
    }

    if (required && isMissing(v, f)) {
      const cond = f.requiredIf
        ? `（当 ${f.requiredIf.field} = ${f.requiredIf.equals} 时必填）`
        : '';
      report.error(category, index, id, f.key, `必填字段缺失${cond}`);
      continue;
    }

    if (isMissing(v, f)) continue; // 可选且为空，跳过后续检查

    // 类型
    if (!checkType(v, f.type)) {
      report.error(
        category, index, id, f.key,
        `类型错误：应为 ${typeLabel[f.type] || f.type}，实际 ${Array.isArray(v) ? 'array' : typeof v}`,
      );
      continue;
    }

    // 枚举
    if (f.enum) {
      const allowed = ENUMS[f.enum];
      if (f.enumItem) {
        for (const item of v) {
          if (!allowed.includes(item)) {
            report.error(
              category, index, id, f.key,
              `枚举越界："${item}" 不在允许值 [${allowed.join(', ')}] 中`,
            );
          }
        }
      } else if (!allowed.includes(v)) {
        report.error(
          category, index, id, f.key,
          `枚举越界："${v}" 不在允许值 [${allowed.join(', ')}] 中`,
        );
      }
    }

    // 数值范围
    if (f.range && typeof v === 'number') {
      if (v < f.range.min || v > f.range.max) {
        report.error(
          category, index, id, f.key,
          `数值越界：${v} 应在 ${f.range.min} ~ ${f.range.max} 之间`,
        );
      }
    }

    // 数组条数
    if (f.minItems && Array.isArray(v) && v.length < f.minItems) {
      report.error(
        category, index, id, f.key,
        `数组元素不足：至少 ${f.minItems} 个，实际 ${v.length} 个`,
      );
    }

    // 交叉引用：aliases 不应含空白
    if (f.key === 'aliases') {
      for (const a of v) {
        if (a.trim() === '') {
          report.error(category, index, id, f.key, 'aliases 含空白项');
        }
      }
    }

    // estimated 列出的字段名必须是真实字段
    if (f.key === 'estimated') {
      for (const name of v) {
        if (!known.has(name)) {
          report.warn(category, index, id, f.key, `estimated 引用了不存在的字段 "${name}"`);
        }
      }
    }
  }

  // id 唯一性
  if (typeof rec.id === 'string' && rec.id.length > 0) {
    if (seenIds.has(rec.id)) {
      report.error(category, index, rec.id, 'id', `id 重复（已被 ${seenIds.get(rec.id)} 使用）`);
    } else {
      seenIds.set(rec.id, `${category}[${index}]`);
    }
    if (!rec.id.startsWith(`${category}-`)) {
      report.warn(
        category, index, rec.id, 'id',
        `id 建议以 "${category}-" 开头（格式 {category}-{brand}-{model}）`,
      );
    }
  }
}

/** 校验跨品类一致性（数据齐全时才有意义） */
function crossFileChecks(all, report) {
  const byId = new Map();
  for (const [cat, list] of Object.entries(all)) {
    for (const rec of list) if (rec && rec.id) byId.set(rec.id, { cat, rec });
  }

  const cpus = all.cpu || [];
  const boards = all.motherboard || [];
  const cases = all.case || [];
  const coolers = all.cooler || [];

  // 1. 每个 CPU 插槽都应有可选主板
  if (cpus.length && boards.length) {
    const boardSockets = new Set(boards.map((b) => b.socket));
    for (const cpu of cpus) {
      if (cpu.socket && !boardSockets.has(cpu.socket)) {
        report.warn('cross', -1, cpu.id, 'socket',
          `没有同插槽(${cpu.socket})的主板可选，E1 将全部为红`);
      }
    }
  }

  // 2. 每个 CPU 插槽都应有可选散热器
  if (cpus.length && coolers.length) {
    const coolerSockets = new Set(coolers.flatMap((c) => c.sockets || []));
    for (const cpu of cpus) {
      if (cpu.socket && !coolerSockets.has(cpu.socket)) {
        report.warn('cross', -1, cpu.id, 'socket',
          `没有支持 ${cpu.socket} 的散热器可选，E9 将全部为红`);
      }
    }
  }

  // 3. 机箱冷排支持值必须来自 RADIATOR_SIZES（已由枚举覆盖，这里补充排序检查）
  for (const c of cases) {
    if (Array.isArray(c.radiatorSupport) ) {
      const sorted = [...c.radiatorSupport].sort((a, b) => a - b);
      if (JSON.stringify(sorted) !== JSON.stringify(c.radiatorSupport)) {
        report.warn('case', -1, c.id, 'radiatorSupport', '建议按升序排列，便于阅读');
      }
    }
  }
}

// ── 主流程 ──────────────────────────────────────────────────────────
function main() {
  const report = new Report();
  const targets = only.length ? only : CATEGORY_LIST;

  // 检查未知品类参数
  for (const t of targets) {
    if (!CATEGORY_LIST.includes(t)) {
      console.error(`未知品类: ${t}（可选: ${CATEGORY_LIST.join(', ')}）`);
      process.exit(2);
    }
  }

  if (!existsSync(DATA_DIR)) {
    if (JSON_OUT) {
      console.log(JSON.stringify({ ok: true, message: 'data/ 目录尚不存在，跳过校验', errors: [], warnings: [], stats: {} }, null, 2));
    } else {
      console.log('data/ 目录尚不存在 —— 还没有数据文件，跳过校验。');
      console.log('（阶段 1 生成数据后，本脚本将开始实际校验）');
    }
    process.exit(0);
  }

  const seenIds = new Map();
  const all = {};
  let totalRecords = 0;
  let missingFiles = 0;

  for (const category of targets) {
    const meta = CATEGORY_FIELDS[category];
    const file = join(DATA_DIR, meta.file);
    const label = `${CATEGORY_LABELS[category]}( ${meta.file} )`;

    if (!existsSync(file)) {
      missingFiles++;
      report.stats[category] = { count: 0, status: '文件缺失' };
      continue;
    }

    let parsed;
    try {
      let raw = readFileSync(file, 'utf8');
      // 容忍 BOM：Windows 上用记事本/Excel/PowerShell 保存常带 BOM
      if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
      parsed = JSON.parse(raw);
    } catch (e) {
      report.error(category, -1, '-', '-', `JSON 解析失败: ${e.message}`);
      report.stats[category] = { count: 0, status: 'JSON 错误' };
      continue;
    }

    // 允许两种结构：顶层数组，或 { items: [...] }
    const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed.items) ? parsed.items : null;
    if (!list) {
      report.error(category, -1, '-', '-', '数据结构应为数组，或含 items 数组的对象');
      report.stats[category] = { count: 0, status: '结构错误' };
      continue;
    }

    all[category] = list;
    list.forEach((rec, i) => validateRecord(rec, category, i, report, seenIds));
    totalRecords += list.length;

    const errCount = report.errors.filter((e) => e.category === category).length;
    report.stats[category] = {
      count: list.length,
      minCount: meta.minCount,
      enough: list.length >= meta.minCount,
      errors: errCount,
      status: errCount === 0 ? 'OK' : `${errCount} 个错误`,
    };
  }

  crossFileChecks(all, report);

  // ── 输出 ──────────────────────────────────────────────────────────
  if (JSON_OUT) {
    console.log(JSON.stringify({
      ok: report.errors.length === 0,
      totalRecords,
      stats: report.stats,
      errors: report.errors,
      warnings: report.warnings,
    }, null, 2));
    process.exit(report.errors.length === 0 ? 0 : 1);
  }

  console.log('══════════════════════════════════════════════');
  console.log(' 装机助手 · 数据校验报告');
  console.log('══════════════════════════════════════════════\n');

  console.log('品类        记录数   最低要求   状态');
  console.log('──────────────────────────────────────────────');
  for (const [cat, s] of Object.entries(report.stats)) {
    const name = CATEGORY_LABELS[cat] || cat;
    const pad = (str, n) => String(str).padEnd(n, ' ');
    const padL = (str, n) => String(str).padStart(n, ' ');
    console.log(
      `${pad(name, 10)}  ${padL(s.count, 5)}  ${padL(s.minCount ?? '-', 8)}   ${s.status}` +
      (s.enough === false ? '  ⚠ 数量不足' : ''),
    );
  }
  console.log('──────────────────────────────────────────────');
  console.log(`合计记录数: ${totalRecords}`);
  if (missingFiles) console.log(`缺失文件: ${missingFiles} 个（阶段 1 将补齐）`);

  if (report.errors.length) {
    console.log(`\n❌ 错误 ${report.errors.length} 条：`);
    for (const e of report.errors.slice(0, 60)) {
      const where = e.index >= 0 ? `${e.category}[${e.index}]` : e.category;
      console.log(`  • ${where} ${e.id} → ${e.field}: ${e.message}`);
    }
    if (report.errors.length > 60) {
      console.log(`  … 还有 ${report.errors.length - 60} 条，见 --json 输出`);
    }
  }

  if (report.warnings.length) {
    console.log(`\n⚠️  警告 ${report.warnings.length} 条：`);
    for (const w of report.warnings.slice(0, 30)) {
      const where = w.index >= 0 ? `${w.category}[${w.index}]` : w.category;
      console.log(`  • ${where} ${w.id} → ${w.field}: ${w.message}`);
    }
    if (report.warnings.length > 30) {
      console.log(`  … 还有 ${report.warnings.length - 30} 条`);
    }
  }

  console.log('');
  if (report.errors.length === 0) {
    console.log('✅ 校验通过：0 错误');
    process.exit(0);
  } else {
    console.log(`❌ 校验失败：${report.errors.length} 错误`);
    process.exit(1);
  }
}

try {
  main();
} catch (e) {
  console.error('脚本异常:', e);
  process.exit(2);
}
