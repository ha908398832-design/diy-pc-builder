#!/usr/bin/env node
/**
 * JSON Schema 生成器（PRD T0.2）
 *
 * 从 schema/fields.js（单一数据源）生成 schema/hardware.schema.json。
 * 该文件供人工查阅与外部工具使用；本项目自身的校验由 tools/validate-data.mjs 完成
 * （它直接读 fields.js，因此不会出现"Schema 与实际校验不一致"的问题）。
 *
 * 用法: node tools/gen-schema.mjs
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ENUMS, CATEGORY_LABELS } from '../src/core/enums.js';
import {
  CATEGORY_LIST,
  CATEGORY_FIELDS,
  COMMON_FIELDS,
  allFieldsOf,
} from '../schema/fields.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'schema', 'hardware.schema.json');

/** 字段定义 → JSON Schema 属性 */
function toJsonSchemaProperty(f, defs) {
  const prop = {};

  switch (f.type) {
    case 'string':
      prop.type = 'string';
      if (f.enum) prop.enum = ENUMS[f.enum];
      break;
    case 'number':
      prop.type = 'number';
      if (f.enum) prop.enum = ENUMS[f.enum];
      break;
    case 'boolean':
      prop.type = 'boolean';
      break;
    case 'string[]':
      prop.type = 'array';
      prop.items = { type: 'string' };
      if (f.enum) prop.items.enum = ENUMS[f.enum];
      break;
    case 'number[]':
      prop.type = 'array';
      prop.items = { type: 'number' };
      if (f.enum) prop.items.enum = ENUMS[f.enum];
      break;
    case 'number|null':
      prop.type = ['number', 'null'];
      break;
    case 'string|null':
      prop.type = ['string', 'null'];
      break;
    default:
      prop.type = 'string';
  }

  if (f.range) {
    prop.minimum = f.range.min;
    prop.maximum = f.range.max;
  }
  if (f.minItems) prop.minItems = f.minItems;

  // 注释信息（title/description 供文档工具使用）
  prop.title = f.label || f.key;
  const desc = [];
  if (f.unit) desc.push(`单位: ${f.unit}`);
  if (f.critical) desc.push('【关键字段】必须精确，不允许近似');
  if (f.p1) desc.push('【P1 预留】本期不读取');
  if (f.rules?.length) desc.push(`参与规则: ${f.rules.join(', ')}`);
  if (f.note) desc.push(f.note);
  if (f.requiredIf) desc.push(`条件必填: 当 ${f.requiredIf.field} = ${f.requiredIf.equals}`);
  if (desc.length) prop.description = desc.join('；');

  return prop;
}

/** 构造某品类的 schema 片段 */
function buildCategorySchema(category) {
  const fields = allFieldsOf(category);
  const properties = {};
  const required = [];
  const allOf = [];

  for (const f of fields) {
    properties[f.key] = toJsonSchemaProperty(f);
    if (f.required) required.push(f.key);
    // 条件必填 → if/then
    if (f.requiredIf) {
      allOf.push({
        if: {
          properties: { [f.requiredIf.field]: { const: f.requiredIf.equals } },
          required: [f.requiredIf.field],
        },
        then: { required: [f.key] },
      });
    }
  }
  // category 固定为该品类
  properties.category = { type: 'string', const: category, title: '品类' };
  if (!required.includes('category')) required.push('category');

  const schema = {
    title: `${CATEGORY_LABELS[category]}（${category}）`,
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  };
  if (allOf.length) schema.allOf = allOf;
  return schema;
}

// ── 生成 ────────────────────────────────────────────────────────────
const schemas = {};
for (const category of CATEGORY_LIST) {
  schemas[category] = buildCategorySchema(category);
}

const doc = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://local/zhuangji/hardware.schema.json',
  title: '装机助手 · 硬件数据规范',
  description:
    '本文件由 tools/gen-schema.mjs 从 schema/fields.js 自动生成，请勿手工编辑。' +
    '唯一数据源是 schema/fields.js；实际校验逻辑在 tools/validate-data.mjs。',
  'x-generated-by': 'tools/gen-schema.mjs',
  'x-source-of-truth': 'schema/fields.js',
  'x-categories': CATEGORY_LIST.map((c) => ({
    key: c,
    label: CATEGORY_LABELS[c],
    file: CATEGORY_FIELDS[c].file,
    csvFile: CATEGORY_FIELDS[c].csvFile,
    minCount: CATEGORY_FIELDS[c].minCount,
    fieldCount: allFieldsOf(c).length,
    requiredCount: allFieldsOf(c).filter((f) => f.required).length,
  })),
  definitions: {
    commonFields: {
      title: '通用字段（所有品类共有）',
      type: 'object',
      properties: Object.fromEntries(
        COMMON_FIELDS.map((f) => [f.key, toJsonSchemaProperty(f)]),
      ),
      required: COMMON_FIELDS.filter((f) => f.required).map((f) => f.key),
    },
    enums: ENUMS,
  },
  oneOf: CATEGORY_LIST.map((c) => ({ $ref: `#/definitions/${c}` })),
};

for (const [c, s] of Object.entries(schemas)) {
  doc.definitions[c] = s;
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(doc, null, 2) + '\n', 'utf8');

console.log(`✅ 已生成 ${OUT}`);
console.log(`   品类 ${CATEGORY_LIST.length} 个，枚举集合 ${Object.keys(ENUMS).length} 个`);
for (const c of CATEGORY_LIST) {
  const f = allFieldsOf(c);
  console.log(
    `   · ${CATEGORY_LABELS[c].padEnd(4)} ${String(f.length).padStart(2)} 字段 / 必填 ${String(f.filter((x) => x.required).length).padStart(2)}`,
  );
}
