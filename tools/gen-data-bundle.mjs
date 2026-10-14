#!/usr/bin/env node
/**
 * 数据打包：把 data/*.json 内联为 src/data/bundle.js
 *
 * 为什么需要这一步：
 *   浏览器无法直接 import JSON（需要 import assertions，兼容性差），
 *   而单文件交付又要求数据内联。所以统一生成一个 ES 模块，
 *   开发态（templates/index.html）与最终产物（dist/装机助手.html）共用同一份。
 *
 * 用法: node tools/gen-data-bundle.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CATEGORY_LIST, CATEGORY_FIELDS } from '../schema/fields.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'src', 'data', 'bundle.js');

const chunks = [];
const stats = [];
let total = 0;
const missing = [];

for (const cat of CATEGORY_LIST) {
  const p = join(ROOT, 'data', CATEGORY_FIELDS[cat].file);
  if (!existsSync(p)) {
    missing.push(cat);
    chunks.push(`  ${cat}: [],`);
    continue;
  }
  const raw = readFileSync(p, 'utf8');
  // 校验 JSON 合法性，避免把坏数据打进产物
  let parsed;
  try {
    parsed = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
  } catch (e) {
    console.error(`✗ ${CATEGORY_FIELDS[cat].file} JSON 解析失败: ${e.message}`);
    process.exit(1);
  }
  if (!Array.isArray(parsed)) {
    console.error(`✗ ${CATEGORY_FIELDS[cat].file} 顶层不是数组`);
    process.exit(1);
  }
  total += parsed.length;
  stats.push({ cat, count: parsed.length });
  // 紧凑序列化节省体积
  chunks.push(`  ${cat}: ${JSON.stringify(parsed)},`);
}

if (missing.length) {
  console.warn(`⚠ 以下品类数据缺失，将打包为空数组: ${missing.join(', ')}`);
}

const content = `/**
 * 硬件数据包（自动生成，请勿手工编辑）
 *
 * 生成命令: node tools/gen-data-bundle.mjs
 * 数据来源: data/*.json
 * 记录总数: ${total}
 * 生成说明: 本文件把 8 个品类的 JSON 内联为 ES 模块，
 *          使浏览器在 file:// 协议下无需 fetch 也能读到全部数据（满足离线单文件要求）。
 */

export const DATA = {
${chunks.join('\n')}
};

export const DATA_STATS = ${JSON.stringify(
  Object.fromEntries(stats.map((s) => [s.cat, s.count])),
  null,
  2,
)};

export const DATA_TOTAL = ${total};

/** 全部记录（拍平为一个数组），用于构建 id 索引 */
export function allRecords(data = DATA) {
  const out = [];
  for (const list of Object.values(data)) {
    if (Array.isArray(list)) out.push(...list);
  }
  return out;
}

/** 构建 id → 记录 的索引 Map */
export function buildIndex(data = DATA) {
  const m = new Map();
  for (const r of allRecords(data)) {
    if (r && r.id) m.set(r.id, r);
  }
  return m;
}

export default DATA;
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, content, 'utf8');

const bytes = Buffer.byteLength(content, 'utf8');
console.log(`✅ 已生成 ${OUT}`);
console.log(`   记录总数 ${total}，文件大小 ${(bytes / 1024).toFixed(1)} KB`);
for (const s of stats) {
  console.log(`   · ${s.cat.padEnd(12)} ${String(s.count).padStart(3)} 条`);
}
if (missing.length) {
  console.log(`   ⚠ 缺失品类: ${missing.join(', ')}`);
  process.exit(1);
}
