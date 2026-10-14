/**
 * CSV 解析与合并（PRD M2）
 *
 * 与 tools/csv-to-json.mjs 的分工：
 *   - tools/csv-to-json.mjs 是构建期脚本（把 CSV 转成本地 data/*.json）
 *   - 本模块是运行期逻辑（界面「导入 CSV」弹窗用），复用同一套解析规则
 *
 * 需求对应（PRD 3.2）：
 *   M2-1 模板表头含字段名 + 单位 + 是否必填   → schema/fields.js + gen-csv-templates
 *   M2-2 自动匹配列名到系统字段，允许手改     → autoMapColumns()
 *   M2-3 导入前给出校验报告                  → buildImportReport()
 *   M2-4 重名处理：覆盖 / 跳过 / 并存        → mergeRecords()
 *   M2-5 合并进库并显示「自定义」标记
 *   M2-6 导入数据同样参与兼容判断、功耗、导出
 *   M2-7 持久化（由 store 负责，本模块只产出结果）
 *
 * 纯函数模块，不接触 DOM。
 */

import { ENUMS } from '../core/enums.js';
import { allFieldsOf, fieldMapOf } from '../../schema/fields.js';

// ══════════════════════════════════════════════════════════════════
// CSV 解析
// ══════════════════════════════════════════════════════════════════

/**
 * 解析 CSV 文本为二维数组
 * 支持：引号包裹、双引号转义、字段内换行、CRLF、UTF-8 BOM
 */
export function parseCsv(text) {
  let s = String(text ?? '');
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);

  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < s.length; i++) {
    const c = s[i];

    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
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

    if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r') { /* 等 \n */ }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

/**
 * 从可读表头单元格提取字段名
 * 兼容形如：'socket[必填] (mm) 插槽｜取值: AM4 / AM5'
 */
export function extractFieldKey(headerCell) {
  let s = String(headerCell ?? '').trim();
  s = s.split('｜')[0];
  s = s.replace(/\[(必填|条件必填)\]/g, '');
  s = s.replace(/\([^)]*\)/g, '');
  const m = s.match(/^[A-Za-z_][A-Za-z0-9_-]*/);
  return m ? m[0] : s.trim();
}

// ══════════════════════════════════════════════════════════════════
// 列映射（M2-2）
// ══════════════════════════════════════════════════════════════════

/**
 * 自动把 CSV 列映射到系统字段
 *
 * 策略（按优先级）：
 *   1. 第 2 行是纯字段名列表 → 直接采用（本项目模板的标准结构）
 *   2. 第 1 行可读表头提取出的字段名命中系统字段 → 采用
 *   3. 表头与字段中文名/label 完全一致 → 采用
 *
 * @returns {{ mapping: Array<string|null>, hasSampleRow: boolean, headerRow: string[] }}
 *          mapping[i] = 该列对应的字段名，null 表示忽略该列
 */
export function autoMapColumns(rows, category) {
  const valid = new Set(allFieldsOf(category).map((f) => f.key));
  const byLabel = new Map();
  for (const f of allFieldsOf(category)) {
    if (f.label) byLabel.set(String(f.label).trim(), f.key);
  }

  const first = (rows[0] || []).map((c) => String(c).trim());
  const second = (rows[1] || []).map((c) => String(c).trim());

  // 判断第 2 行是否像纯字段名行
  const secondHits = second.filter((c) => valid.has(c)).length;
  const secondLooksLikeKeys =
    second.length > 0 && secondHits >= Math.max(3, Math.floor(second.length * 0.6));

  let headerRow;
  let mapping;
  let hasSampleRow;

  if (secondLooksLikeKeys) {
    // 标准三行模板结构
    headerRow = second;
    mapping = second.map((c) => (valid.has(c) ? c : null));
    hasSampleRow = true;
  } else {
    headerRow = first;
    mapping = first.map((cell) => {
      const key = extractFieldKey(cell);
      if (valid.has(key)) return key;
      // 用中文 label 兜底
      if (byLabel.has(cell)) return byLabel.get(cell);
      return null;
    });
    hasSampleRow = false;
  }

  return { mapping, hasSampleRow, headerRow };
}

// ══════════════════════════════════════════════════════════════════
// 值转换
// ══════════════════════════════════════════════════════════════════

const TRUE_TOKENS = new Set(['是', 'true', '1', 'yes', 'y', '有', '支持']);
const FALSE_TOKENS = new Set(['否', 'false', '0', 'no', 'n', '无', '不支持']);

/** 按字段类型转换单元格值 */
export function convertValue(raw, field, fieldDef) {
  const s = String(raw ?? '').trim();

  if (fieldDef?.type === 'boolean') {
    if (s === '') return undefined;
    const t = s.toLowerCase();
    if (TRUE_TOKENS.has(t)) return true;
    if (FALSE_TOKENS.has(t)) return false;
    return { __error: `无法识别为布尔值："${s}"（应为 是/否）` };
  }

  if (fieldDef?.type === 'string[]' || fieldDef?.type === 'number[]') {
    if (s === '') return [];
    const parts = s.split(';').map((x) => x.trim()).filter((x) => x !== '');
    if (fieldDef.type === 'number[]' || fieldDef.enum === 'radiatorSize') {
      return parts.map((x) => (Number.isFinite(Number(x)) ? Number(x) : x));
    }
    return parts;
  }

  if (fieldDef?.type === 'number' || fieldDef?.type === 'number|null') {
    if (s === '') return undefined;
    const n = Number(s);
    return Number.isFinite(n) ? n : { __error: `无法识别为数字："${s}"` };
  }

  if (s === '') return undefined;
  return s;
}

/**
 * 把一行 CSV 转成记录对象
 * @returns {{ record: object|null, errors: string[] }}
 */
export function rowToRecord(cells, mapping, category) {
  const fmap = fieldMapOf(category);
  const record = { category };
  const errors = [];

  mapping.forEach((key, i) => {
    if (!key) return;
    const def = fmap[key];
    const v = convertValue(cells[i], key, def);
    if (v && typeof v === 'object' && v.__error) {
      errors.push(`${key}: ${v.__error}`);
      return;
    }
    if (v !== undefined) record[key] = v;
    else if (def?.type === 'string[]' || def?.type === 'number[]') record[key] = [];
  });

  return { record, errors };
}

// ══════════════════════════════════════════════════════════════════
// 记录校验（M2-3）
// ══════════════════════════════════════════════════════════════════

/**
 * 校验一条记录（与 tools/validate-data.mjs 同源规则）
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function validateRecord(rec, category) {
  const errors = [];
  const warnings = [];
  const fields = allFieldsOf(category);
  const known = new Set(fields.map((f) => f.key));

  for (const k of Object.keys(rec)) {
    if (!known.has(k)) warnings.push(`未知字段 "${k}"`);
  }

  for (const f of fields) {
    const v = rec[f.key];

    let required = !!f.required;
    if (!required && f.requiredIf) required = rec[f.requiredIf.field] === f.requiredIf.equals;

    const missing =
      v === undefined || v === null || v === '' ||
      (Array.isArray(v) && v.length === 0 && !!f.minItems);

    if (required && missing) {
      const cond = f.requiredIf ? `（当 ${f.requiredIf.field} = ${f.requiredIf.equals} 时必填）` : '';
      errors.push(`缺必填字段 ${f.key}${cond}`);
      continue;
    }
    if (missing) continue;

    // 枚举
    if (f.enum) {
      const allowed = ENUMS[f.enum];
      if (f.enumItem) {
        for (const item of v) {
          if (!allowed.includes(item)) errors.push(`${f.key} 取值 "${item}" 不合法（允许: ${allowed.join('/')}）`);
        }
      } else if (!allowed.includes(v)) {
        errors.push(`${f.key} 取值 "${v}" 不合法（允许: ${allowed.join('/')}）`);
      }
    }

    // 数值范围
    if (f.range && typeof v === 'number' && (v < f.range.min || v > f.range.max)) {
      errors.push(`${f.key} 数值 ${v} 超出范围 ${f.range.min}~${f.range.max}`);
    }

    // 类型粗查
    if (f.type === 'number' && typeof v !== 'number') errors.push(`${f.key} 应为数字`);
    if (f.type === 'boolean' && typeof v !== 'boolean') errors.push(`${f.key} 应为布尔值`);
    if (f.type.endsWith('[]') && !Array.isArray(v)) errors.push(`${f.key} 应为数组`);
  }

  if (!rec.id) errors.push('缺必填字段 id');

  return { errors, warnings };
}

// ══════════════════════════════════════════════════════════════════
// 导入报告（M2-3）
// ══════════════════════════════════════════════════════════════════

/**
 * 生成导入前的校验报告
 *
 * @param {string} csvText
 * @param {string} category
 * @param {Array}  existing  现有库中该品类的记录（用于检测重名）
 * @returns {{
 *   mapping: Array<string|null>,
 *   headerRow: string[],
 *   hasSampleRow: boolean,
 *   valid: Array<object>,        // 可用记录
 *   invalid: Array<{ row:number, errors:string[] }>,
 *   duplicates: Array<{ row:number, id:string, existingId:string, record:object }>,
 *   warnings: string[],
 *   summary: { total:number, valid:number, invalid:number, duplicate:number }
 * }}
 */
export function buildImportReport(csvText, category, existing = []) {
  const rows = parseCsv(csvText);
  if (rows.length === 0) {
    return {
      mapping: [], headerRow: [], hasSampleRow: false,
      valid: [], invalid: [], duplicates: [], warnings: ['CSV 无内容'],
      summary: { total: 0, valid: 0, invalid: 0, duplicate: 0 },
    };
  }

  const { mapping, hasSampleRow, headerRow } = autoMapColumns(rows, category);

  // 未映射的列给出提示，便于用户手动调整
  const warnings = [];
  const unmapped = mapping
    .map((m, i) => (m === null && String(headerRow[i] ?? '').trim() !== '' ? headerRow[i] : null))
    .filter(Boolean);
  if (unmapped.length) {
    warnings.push(`有 ${unmapped.length} 列未匹配到系统字段，已忽略：${unmapped.join('、')}`);
  }

  const existingIds = new Set(existing.map((r) => r.id));
  const dataStart = hasSampleRow ? 2 : 1;

  const valid = [];
  const invalid = [];
  const duplicates = [];
  const seenInFile = new Set();

  for (let i = dataStart; i < rows.length; i++) {
    const rowNo = i + 1; // 1-based，便于用户对照
    const { record, errors: convErrors } = rowToRecord(rows[i], mapping, category);
    if (!record || Object.keys(record).length <= 1) continue; // 只有 category 说明是空行

    // 跳过示例行：三行结构下 dataStart 已跳过；这里额外兜底
    if (hasSampleRow && i === 2) continue;

    const { errors: valErrors, warnings: valWarnings } = validateRecord(record, category);
    const allErrors = [...convErrors, ...valErrors];
    warnings.push(...valWarnings.map((w) => `第 ${rowNo} 行: ${w}`));

    if (allErrors.length > 0) {
      invalid.push({ row: rowNo, errors: allErrors, record });
      continue;
    }

    // 文件内部重复
    if (seenInFile.has(record.id)) {
      duplicates.push({ row: rowNo, id: record.id, existingId: record.id, record, inFile: true });
      continue;
    }
    seenInFile.add(record.id);

    // 与现有库重名
    if (existingIds.has(record.id)) {
      duplicates.push({ row: rowNo, id: record.id, existingId: record.id, record, inFile: false });
      continue;
    }

    valid.push(record);
  }

  return {
    mapping, headerRow, hasSampleRow, valid, invalid, duplicates, warnings,
    summary: {
      total: valid.length + invalid.length + duplicates.length,
      valid: valid.length,
      invalid: invalid.length,
      duplicate: duplicates.length,
    },
  };
}

// ══════════════════════════════════════════════════════════════════
// 合并（M2-4 / M2-5）
// ══════════════════════════════════════════════════════════════════

/**
 * 合并导入数据到现有库
 *
 * @param {Array} existing   现有记录
 * @param {object} report    buildImportReport 的结果
 * @param {'overwrite'|'skip'|'keep-both'} strategy  重名策略
 * @returns {{ merged: Array, added: number, overwritten: number, skipped: number, renamed: number }}
 */
export function mergeRecords(existing, report, strategy = 'skip') {
  const result = existing.slice();
  const indexById = new Map(result.map((r, i) => [r.id, i]));

  let added = 0;
  let overwritten = 0;
  let skipped = 0;
  let renamed = 0;

  const put = (rec) => {
    if (indexById.has(rec.id)) {
      const i = indexById.get(rec.id);
      result[i] = rec;
      overwritten++;
    } else {
      indexById.set(rec.id, result.length);
      result.push(rec);
      added++;
    }
  };

  // 先放入无冲突的有效记录
  for (const rec of report.valid) {
    // 标记为自定义来源（M2-5 界面显示「自定义」小标）
    put({ ...rec, custom: true });
  }

  // 再按策略处理重名
  for (const d of report.duplicates) {
    const rec = { ...d.record, custom: true };
    if (strategy === 'overwrite') {
      // 覆盖：替换现有记录
      if (indexById.has(rec.id)) {
        result[indexById.get(rec.id)] = rec;
        overwritten++;
      } else {
        put(rec);
      }
    } else if (strategy === 'keep-both') {
      // 并存：加后缀保证 id 唯一
      let n = 2;
      let newId = `${rec.id}-custom`;
      while (indexById.has(newId)) {
        newId = `${rec.id}-custom${n++}`;
      }
      rec.id = newId;
      rec.notes = rec.notes ? `${rec.notes}（导入副本）` : '导入副本';
      indexById.set(newId, result.length);
      result.push(rec);
      renamed++;
      added++;
    } else {
      // skip
      skipped++;
    }
  }

  return { merged: result, added, overwritten, skipped, renamed };
}

/**
 * 从库中移除全部自定义记录（供界面「清除自定义数据」用）
 */
export function stripCustom(records) {
  return records.filter((r) => !r.custom);
}

/**
 * 生成空白 CSV 模板文本（供界面「下载空白模板」，M2-1 / 6.7.3）
 */
export function buildTemplateCsv(category) {
  const fields = allFieldsOf(category);
  const header = fields.map((f) => {
    const mark = f.required ? '[必填]' : f.requiredIf ? '[条件必填]' : '';
    const unit = f.unit ? ` (${f.unit})` : '';
    return `${f.key}${mark}${unit} ${f.label || ''}`;
  });
  const keys = fields.map((f) => f.key);
  const cell = (v) => {
    const s = String(v ?? '');
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '\uFEFF' + [header, keys, []].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
