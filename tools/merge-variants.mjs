/**
 * 变体数据合并工具（通用：显卡 / 主板）
 *
 * 把 `tmp-candidates-<cat>.json` 里的候选记录合并进 `data/<cat>.json`。
 *
 * 安全设计：写入前做 5 项自检，任一项不过即**拒绝写入**（退出码 1）
 *   1. 现有记录**零改动**（逐条 JSON 比对）
 *   2. id 无重复
 *   3. 必填字段无缺失（必填清单取自 schema/fields.js，不硬编码）
 *   4. 枚举合法（pcieVersion ∈ {3,4,5}；condition ∈ {new,used,mining,oem}）
 *   5. 不含 price 字段（本期不做价格，PRD 1.5）
 *
 * 用法:
 *   node tools/gen-gpu-variants.mjs && node tools/merge-variants.mjs gpu
 *   node tools/gen-mb-variants.mjs  && node tools/merge-variants.mjs motherboard
 *   node tools/merge-variants.mjs gpu --dry     # 只自检不写入
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATEGORY_FIELDS, requiredKeysOf } from '../schema/fields.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── 参数 ──
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const dryRun = process.argv.includes('--dry');
const cat = args[0];

if (!cat || !CATEGORY_FIELDS[cat]) {
  console.error('用法: node tools/merge-variants.mjs <gpu|motherboard> [--dry]');
  console.error(`可用品类: ${Object.keys(CATEGORY_FIELDS).join(', ')}`);
  process.exit(1);
}

const meta = CATEGORY_FIELDS[cat];
const DATA = join(ROOT, 'data', meta.file);
const CAND = join(ROOT, `tmp-candidates-${cat}.json`);

if (!existsSync(CAND)) {
  console.error(`缺少候选文件 ${CAND}`);
  console.error(`请先运行: node tools/gen-${cat === 'gpu' ? 'gpu' : 'mb'}-variants.mjs`);
  process.exit(1);
}

const before = JSON.parse(readFileSync(DATA, 'utf8'));
const cand = JSON.parse(readFileSync(CAND, 'utf8'));

/** 必填字段：从 schema 取，避免硬编码后与规范脱节 */
const REQUIRED = requiredKeysOf(cat);
const PCIE_VERSIONS = [3, 4, 5];
const CONDITIONS = ['new', 'used', 'mining', 'oem'];

console.log(`═══ ${meta.label} 变体合并 ═══\n`);
console.log(`  现有: ${before.length} 条`);
console.log(`  候选: ${cand.length} 条`);
console.log(`  必填字段（取自 schema）: ${REQUIRED.length} 个\n`);

// ── 清洗：去内部字段、修正别名、去重 ──
const existingIds = new Set(before.map((r) => r.id));
const existingNames = new Set(before.map((r) => String(r.name).toLowerCase()));
const clean = [];
const rejected = [];

for (const c of cand) {
  const rec = { ...c };
  delete rec._source;

  // 别名去重且去掉空值
  rec.aliases = [...new Set((rec.aliases || []).filter(Boolean))];

  if (existingIds.has(rec.id)) { rejected.push(`${rec.id}（id 冲突）`); continue; }
  if (existingNames.has(String(rec.name).toLowerCase())) { rejected.push(`${rec.name}（重名）`); continue; }

  clean.push(rec);
  existingIds.add(rec.id);
  existingNames.add(String(rec.name).toLowerCase());
}

console.log(`  可用: ${clean.length} 条`);
if (rejected.length) {
  console.log(`  被拒: ${rejected.length} 条`);
  for (const r of rejected.slice(0, 5)) console.log(`    ${r}`);
}

const merged = [...before, ...clean];

// ── 自检 ──
console.log('\n─── 写入前自检 ───\n');
const problems = [];

// 1. 现有记录未被改动
let changed = 0;
for (let i = 0; i < before.length; i++) {
  if (JSON.stringify(before[i]) !== JSON.stringify(merged[i])) changed++;
}
console.log(`  1. 现有记录被改动: ${changed} ${changed === 0 ? '✅' : '❌'}`);
if (changed > 0) problems.push(`现有 ${changed} 条被改动`);

// 2. id 唯一
const ids = merged.map((r) => r.id);
const dup = [...new Set(ids.filter((v, i) => ids.indexOf(v) !== i))];
console.log(`  2. id 重复: ${dup.length} ${dup.length === 0 ? '✅' : '❌ ' + dup.slice(0, 3).join(', ')}`);
if (dup.length) problems.push(`id 重复 ${dup.length} 个`);

// 3. 必填字段
const miss = [];
for (const r of merged) {
  for (const f of REQUIRED) {
    const v = r[f];
    if (v === undefined || v === null || v === '') miss.push(`${r.id}.${f}`);
  }
}
console.log(`  3. 必填字段缺失: ${miss.length} ${miss.length === 0 ? '✅' : '❌ ' + miss.slice(0, 3).join(', ')}`);
if (miss.length) problems.push(`必填字段缺失 ${miss.length} 处`);

// 4. 枚举合法
const badEnum = [];
for (const r of merged) {
  if (r.pcieVersion !== undefined && !PCIE_VERSIONS.includes(r.pcieVersion)) {
    badEnum.push(`${r.id}.pcieVersion=${r.pcieVersion}`);
  }
  if (!CONDITIONS.includes(r.condition)) {
    badEnum.push(`${r.id}.condition=${r.condition}`);
  }
}
console.log(`  4. 枚举越界: ${badEnum.length} ${badEnum.length === 0 ? '✅' : '❌ ' + badEnum.slice(0, 3).join(', ')}`);
if (badEnum.length) problems.push(`枚举越界 ${badEnum.length} 处`);

// 5. 不含 price
const withPrice = merged.filter((r) => 'price' in r).length;
console.log(`  5. 含 price 字段: ${withPrice} ${withPrice === 0 ? '✅' : '❌'}`);
if (withPrice) problems.push(`${withPrice} 条含 price`);

// ── 写入 ──
if (problems.length) {
  console.log(`\n❌ 自检未通过，未写入:\n   ${problems.join('\n   ')}`);
  process.exit(1);
}

if (dryRun) {
  console.log(`\n✅ 自检通过（--dry，未写入）`);
  console.log(`   将变为: ${before.length} → ${merged.length} 条`);
  process.exit(0);
}

writeFileSync(DATA, JSON.stringify(merged, null, 2) + '\n', 'utf8');
console.log(`\n✅ 已写入 data/${meta.file}：${before.length} → ${merged.length} 条`);

// ── 统计 ──
const brands = new Set(merged.map((r) => r.brand));
const groups = {};
for (const r of merged) {
  const key = cat === 'motherboard' ? `${r.chipset}·${r.formFactor}` : r.chipset;
  (groups[key] ||= []).push(r);
}
const multi = Object.entries(groups).filter(([, l]) => l.length > 1);

console.log('\n─── 合并后统计 ───\n');
console.log(`  总条数:    ${merged.length}`);
console.log(`  品牌数:    ${brands.size}`);
console.log(`  分组数:    ${Object.keys(groups).length}`);
console.log(`  多版本组:  ${multi.length}`);
console.log(`  二手/矿卡/洋垃圾: ${merged.filter((r) => r.condition !== 'new').length}`);
console.log(`\n  下一步: node tools/gen-data-bundle.mjs && node tools/gate.mjs`);
