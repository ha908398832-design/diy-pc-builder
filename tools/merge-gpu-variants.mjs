/**
 * 把显卡变体候选合并进 data/gpu.json
 *
 * 安全设计：写入前做 5 项自检，任一项不过即**拒绝写入**（退出码 1）
 *   1. 现有记录**零改动**（逐条 JSON 比对）
 *   2. id 无重复
 *   3. 必填字段无缺失
 *   4. 枚举合法（pcieVersion ∈ {3,4,5}；condition ∈ {new,used,mining,oem}）
 *   5. 不含 price 字段（本期不做价格，PRD 1.5）
 *
 * 用法:
 *   node tools/gen-gpu-variants.mjs     # 先生成候选
 *   node tools/merge-gpu-variants.mjs   # 审阅 tmp-candidates.json 后合并
 *
 * 先 dry-run 看看会加多少：
 *   node tools/merge-gpu-variants.mjs --dry
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = join(ROOT, 'data', 'gpu.json');
const CAND = join(ROOT, 'tmp-candidates.json');
const dryRun = process.argv.includes('--dry');

if (!existsSync(CAND)) {
  console.error('缺少候选文件，请先运行: node tools/gen-gpu-variants.mjs');
  process.exit(1);
}

const before = JSON.parse(readFileSync(FILE, 'utf8'));
const cand = JSON.parse(readFileSync(CAND, 'utf8'));

/** 必填字段（与 schema/fields.js 的 gpu 品类一致） */
const REQUIRED = [
  'id', 'category', 'brand', 'name', 'chipset', 'length_mm',
  'thicknessSlots', 'vram', 'tdp', 'pcie8pin', 'pcie12vhpwr',
];
const PCIE_VERSIONS = [3, 4, 5];
const CONDITIONS = ['new', 'used', 'mining', 'oem'];

console.log('═══ 显卡变体合并 ═══\n');
console.log(`  现有: ${before.length} 条`);
console.log(`  候选: ${cand.length} 条`);

// ── 清洗：去内部字段、修正别名、去重 ──
const existingIds = new Set(before.map((g) => g.id));
const existingNames = new Set(before.map((g) => String(g.name).toLowerCase()));
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
const ids = merged.map((g) => g.id);
const dup = [...new Set(ids.filter((v, i) => ids.indexOf(v) !== i))];
console.log(`  2. id 重复: ${dup.length} ${dup.length === 0 ? '✅' : '❌ ' + dup.slice(0, 3).join(', ')}`);
if (dup.length) problems.push(`id 重复 ${dup.length} 个`);

// 3. 必填字段
const miss = [];
for (const g of merged) {
  for (const f of REQUIRED) {
    if (g[f] === undefined || g[f] === null || g[f] === '') miss.push(`${g.id}.${f}`);
  }
}
console.log(`  3. 必填字段缺失: ${miss.length} ${miss.length === 0 ? '✅' : '❌ ' + miss.slice(0, 3).join(', ')}`);
if (miss.length) problems.push(`必填字段缺失 ${miss.length} 处`);

// 4. 枚举合法
const badEnum = [];
for (const g of merged) {
  if (g.pcieVersion !== undefined && !PCIE_VERSIONS.includes(g.pcieVersion)) {
    badEnum.push(`${g.id}.pcieVersion=${g.pcieVersion}`);
  }
  if (!CONDITIONS.includes(g.condition)) {
    badEnum.push(`${g.id}.condition=${g.condition}`);
  }
}
console.log(`  4. 枚举越界: ${badEnum.length} ${badEnum.length === 0 ? '✅' : '❌ ' + badEnum.slice(0, 3).join(', ')}`);
if (badEnum.length) problems.push(`枚举越界 ${badEnum.length} 处`);

// 5. 不含 price
const withPrice = merged.filter((g) => 'price' in g).length;
console.log(`  5. 含 price 字段: ${withPrice} ${withPrice === 0 ? '✅' : '❌'}`);
if (withPrice) problems.push(`${withPrice} 条含 price`);

// ── 写入 ──
if (problems.length) {
  console.log(`\n❌ 自检未通过，未写入:\n   ${problems.join('\n   ')}`);
  process.exit(1);
}

if (dryRun) {
  console.log(`\n✅ 自检通过（--dry 模式，未写入）`);
  console.log(`   将变为: ${before.length} → ${merged.length} 条`);
  process.exit(0);
}

writeFileSync(FILE, JSON.stringify(merged, null, 2) + '\n', 'utf8');
console.log(`\n✅ 已写入 data/gpu.json：${before.length} → ${merged.length} 条`);

// ── 统计 ──
const brands = new Set(merged.map((g) => g.brand));
const chips = new Set(merged.map((g) => g.chipset));
const byChip = {};
for (const g of merged) (byChip[g.chipset] ||= []).push(g.length_mm);
const multi = Object.values(byChip).filter((l) => l.length > 1);
const withDiff = multi.filter((l) => new Set(l).size > 1);

console.log('\n─── 合并后统计 ───\n');
console.log(`  总条数:   ${merged.length}`);
console.log(`  品牌数:   ${brands.size}`);
console.log(`  芯片数:   ${chips.size}`);
console.log(`  二手/矿卡: ${merged.filter((g) => g.condition !== 'new').length}`);
console.log(`  多变体芯片: ${multi.length}`);
console.log(`  长度有区分度: ${withDiff.length}  ← 用户能看到"不同品牌长度不同"`);
console.log(`\n  下一步: node tools/validate-data.mjs gpu && node tools/gate.mjs`);
