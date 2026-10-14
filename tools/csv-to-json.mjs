#!/usr/bin/env node
/**
 * CSV → JSON 转换（PRD T2.10 的数据侧；阶段 1 用它把 CSV 数据批量入库）
 *
 * 支持本项目的模板三行结构：
 *   第 1 行 人类可读表头（含 [必填]/(单位)/说明）
 *   第 2 行 纯字段名
 *   第 3 行 示例数据（自动跳过）
 *   第 4 行起 真实数据
 *
 * 也支持普通 CSV（只有一行表头）。
 *
 * 用法:
 *   node tools/csv-to-json.mjs cpu                     # 读 csv-templates/cpu.csv → data/cpu.json
 *   node tools/csv-to-json.mjs cpu --in some.csv       # 指定输入
 *   node tools/csv-to-json.mjs cpu --out data/cpu.json # 指定输出
 *   node tools/csv-to-json.mjs cpu --dry               # 只校验不写文件
 *   node tools/csv-to-json.mjs --all                   # 全部品类
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CATEGORY_LABELS } from '../src/core/enums.js';
import { CATEGORY_LIST, CATEGORY_FIELDS, allFieldsOf } from '../schema/fields.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const ARRAY_FIELDS_CACHE = new Map();
function arrayFieldKeys(category) {
  if (!ARRAY_FIELDS_CACHE.has(category)) {
    ARRAY_FIELDS_CACHE.set(
      category,
      new Set(allFieldsOf(category).filter((f) => f.type.endsWith('[]')).map((f) => f.key)),
    );
  }
  return ARRAY_FIELDS_CACHE.get(category);
}

function numberFieldKeys(category) {
  const key = `n:${category}`;
  if (!ARRAY_FIELDS_CACHE.has(key)) {
    ARRAY_FIELDS_CACHE.set(
      key,
      new Set(
        allFieldsOf(category)
          .filter((f) => f.type === 'number' || f.type === 'number[]' || f.type === 'number|null')
          .map((f) => f.key),
      ),
    );
  }
  return ARRAY_FIELDS_CACHE.get(key);
}

function booleanFieldKeys(category) {
  const key = `b:${category}`;
  if (!ARRAY_FIELDS_CACHE.has(key)) {
    ARRAY_FIELDS_CACHE.set(
      key,
      new Set(allFieldsOf(category).filter((f) => f.type === 'boolean').map((f) => f.key)),
    );
  }
  return ARRAY_FIELDS_CACHE.get(key);
}

/** 解析 CSV 文本为二维数组（支持引号、双引号转义、CRLF） */
export function parseCsv(text) {
  // 去 BOM
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\r') {
      // 忽略，等 \n
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  // 末行
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // 丢弃全空行
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** 从表头单元格提取纯字段名（兼容三行结构的第一行） */
export function extractKey(headerCell) {
  let s = String(headerCell).trim();
  // 去掉 ｜ 之后的说明
  s = s.split('｜')[0];
  // 去掉 [必填] / [条件必填]
  s = s.replace(/\[(必填|条件必填)\]/g, '');
  // 去掉 (单位)
  s = s.replace(/\([^)]*\)/g, '');
  // 去掉中文说明：字段名是 ASCII 字母数字下划线连字符
  const m = s.match(/^[A-Za-z_][A-Za-z0-9_-]*/);
  return m ? m[0] : s.trim();
}

/** 标量值转换 */
function convertScalar(raw, field, category) {
  const s = String(raw ?? '').trim();

  if (s === '') {
    // 空 → null（可选字段）；必填由校验脚本负责报错
    return null;
  }

  if (booleanFieldKeys(category).has(field)) {
    const t = s.toLowerCase();
    if (['是', 'true', '1', 'yes', 'y', '有'].includes(t)) return true;
    if (['否', 'false', '0', 'no', 'n', '无'].includes(t)) return false;
    return s; // 交给校验脚本报类型错误，保留原值便于定位
  }

  if (numberFieldKeys(category).has(field)) {
    const n = Number(s);
    return Number.isFinite(n) ? n : s; // 非数字原样保留，交给校验报错
  }

  return s;
}

/** 把一行转成记录对象 */
function rowToRecord(cells, keys, category) {
  const arrays = arrayFieldKeys(category);
  const rec = {};

  keys.forEach((key, i) => {
    if (!key) return;
    const raw = cells[i];
    const field = key;

    if (arrays.has(field)) {
      const s = String(raw ?? '').trim();
      if (s === '') {
        rec[field] = [];
      } else {
        const isNum = numberFieldKeys(category).has(field);
        rec[field] = s
          .split(';')
          .map((x) => x.trim())
          .filter((x) => x !== '')
          .map((x) => (isNum ? (Number.isFinite(Number(x)) ? Number(x) : x) : x));
      }
    } else {
      const v = convertScalar(raw, field, category);
      if (v !== null) rec[field] = v;
      else if (['estimated', 'outputs', 'aliases'].includes(field)) rec[field] = [];
    }
  });

  return rec;
}

/** 解析一个 CSV 文本，返回 { keys, records } */
export function csvToRecords(text, category, options = {}) {
  const { keepSample = false } = options;
  const rows = parseCsv(text);
  if (rows.length === 0) return { keys: [], records: [] };

  const first = rows[0].map((c) => String(c).trim());
  let keys = first.map(extractKey);

  // 判断是否为三行结构：第 2 行是否像「纯字段名列表」
  const validKeys = new Set(allFieldsOf(category).map((f) => f.key));
  const second = rows[1] ? rows[1].map((c) => String(c).trim()) : null;
  const secondLooksLikeKeys =
    second &&
    second.filter((c) => validKeys.has(c)).length >= Math.max(3, Math.floor(second.length * 0.6));

  let dataStart;
  if (secondLooksLikeKeys) {
    keys = second.map((c) => c.trim());
    // 模板结构：1=表头 2=字段名 3=示例行 4+=真实数据
    // 示例行必须跳过，否则会把示例产品混进用户数据（PRD 5.3 / README 已如此约定）
    dataStart = keepSample ? 2 : 3;
    if (!keepSample && rows.length <= 3) {
      // 只有表头+字段名+示例行，无真实数据
      return { keys, records: [] };
    }
  } else {
    dataStart = 1;
  }

  const records = [];
  for (let i = dataStart; i < rows.length; i++) {
    const rec = rowToRecord(rows[i], keys, category);
    if (Object.keys(rec).length === 0) continue;
    // 确保 category 正确
    rec.category = category;
    records.push(rec);
  }

  return { keys, records };
}

// ── CLI ─────────────────────────────────────────────────────────────
function main() {
  const argv = process.argv.slice(2);
  const getArg = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : null;
  };
  const dry = argv.includes('--dry');
  const all = argv.includes('--all');
  const targets = all
    ? CATEGORY_LIST
    : argv.filter((a) => !a.startsWith('--') && a !== getArg('--in') && a !== getArg('--out'));

  if (targets.length === 0) {
    console.error('用法: node tools/csv-to-json.mjs <品类|--all> [--in f.csv] [--out f.json] [--dry]');
    process.exit(2);
  }

  let totalAll = 0;

  for (const category of targets) {
    if (!CATEGORY_LIST.includes(category)) {
      console.error(`未知品类: ${category}`);
      process.exit(2);
    }
    const meta = CATEGORY_FIELDS[category];
    const inPath = getArg('--in') || join(ROOT, 'csv-templates', meta.csvFile);
    const outPath = getArg('--out') || join(ROOT, 'data', meta.file);

    if (!existsSync(inPath)) {
      console.warn(`  ⚠ ${CATEGORY_LABELS[category]}: 输入不存在 ${inPath}，跳过`);
      continue;
    }

    const text = readFileSync(inPath, 'utf8');
    const { records } = csvToRecords(text, category);

    // 过滤掉示例行（三行结构已在 dataStart 跳过；这里再兜底过滤注释/空 id）
    const clean = records.filter((r) => r.id && String(r.id).trim() !== '');

    console.log(`  ✓ ${CATEGORY_LABELS[category]}: ${clean.length} 条记录`);
    totalAll += clean.length;

    if (!dry) {
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, JSON.stringify(clean, null, 2) + '\n', 'utf8');
      console.log(`    → ${outPath}`);
    }
  }

  console.log(`\n合计 ${totalAll} 条${dry ? '（dry-run，未写文件）' : '，已写入 data/'}`);
}

// 仅在直接执行时跑 CLI
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` ||
    process.argv[1]?.endsWith('csv-to-json.mjs')) {
  main();
}
