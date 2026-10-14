/**
 * 从数据集生成显卡多品牌变体候选
 *
 * 用途：把 PCPartDataset 里的**真实板卡长度**转成本项目的数据格式，
 *       解决「同一芯片不同品牌长度不同」的问题（用户核心诉求）。
 *
 * 设计要点
 *   1. 芯片级字段（tdp/vram/pcieVersion/memoryType/gameScore/pcie8pin…）
 *      从本项目**现有数据的芯片参照表**带出，保证与已有记录一致
 *      （实测多品牌芯片的这些字段 7/7 完全一致）
 *   2. 品牌 + 型号 + 真实长度 取自数据集
 *   3. 每个芯片挑「长度有区分度」的 2~5 个变体，避免变体都是同一尺寸
 *   4. 无法核实到来源的字段（thicknessSlots / height_mm / outputs）
 *      **一律列入 estimated**，界面会显示 ≈ 并提示以实物为准（PRD 3.1.3）
 *
 * 用法:
 *   node tools/fetch-dataset.mjs gpu        # 先下载（若未下载）
 *   node tools/gen-gpu-variants.mjs         # 生成候选到 tmp-candidates.json
 *   node tools/merge-variants.mjs gpu       # 审阅后合并进 data/gpu.json
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DS_PATH = join(ROOT, 'tmp-ds', 'video-card.json');
const DATA_PATH = join(ROOT, 'data', 'gpu.json');

if (!existsSync(DS_PATH)) {
  console.error('缺少数据集，请先运行: node tools/fetch-dataset.mjs gpu');
  process.exit(1);
}

const ds = JSON.parse(readFileSync(DS_PATH, 'utf8'));
const myGpu = JSON.parse(readFileSync(DATA_PATH, 'utf8'));

// ══════════════════════════════════════════════════════════════════
// 1. 芯片参照表（来自本项目现有数据）
// ══════════════════════════════════════════════════════════════════

/** 这些字段是**芯片级**的，同芯片所有品牌一致，可从现有数据安全带出 */
const CHIP_LEVEL_FIELDS = [
  'vram', 'memoryType', 'busWidth', 'tdp', 'recommendedPsu',
  'pcie8pin', 'pcie12vhpwr', 'pcieVersion', 'outputs',
  'gameScore', 'productivityScore', 'coolerType',
];

function buildChipRef(records) {
  const ref = new Map();
  for (const g of records) {
    if (!ref.has(g.chipset)) {
      const r = {};
      for (const f of CHIP_LEVEL_FIELDS) r[f] = g[f];
      ref.set(g.chipset, r);
    }
  }
  return ref;
}

const chipRef = buildChipRef(myGpu);

// ══════════════════════════════════════════════════════════════════
// 2. 芯片名归一化（数据集命名与本项目不同，需对齐）
// ══════════════════════════════════════════════════════════════════

/**
 * 归一化芯片名，便于跨数据源匹配
 * 处理：去厂商前缀、显存后缀（6GB/12G）、显存类型后缀（GDDR6）
 */
export function normChip(s) {
  let t = String(s || '')
    .replace(/^GeForce\s+/i, '')
    .replace(/^Radeon\s+/i, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
  t = t.replace(/\s*\d{1,2}\s*GB\b/g, '');      // 6GB / 12 GB
  t = t.replace(/\s+\d{1,2}G\b/g, '');          // 6G / 12G
  t = t.replace(/\s*GDDR\d+X?\b/g, '');         // GDDR6 / GDDR6X
  return t.replace(/\s+/g, ' ').trim();
}

/**
 * 芯片别名映射：本项目 chipset → 数据集里的多种写法
 * 用于归一化仍匹配不上的情况（如 GTX 1650 在数据集里分 G5/G6 两个版本）
 */
const CHIP_ALIASES = {
  'GTX 1650': ['GTX 1650 G5', 'GTX 1650 G6'],
  'GTX 1060': ['GTX 1060 6GB', 'GTX 1060 3GB'],
  'RTX 3060': ['RTX 3060 12GB', 'RTX 3060 8GB'],
  'RTX 3050': ['RTX 3050 8GB', 'RTX 3050 6GB'],
};

// ══════════════════════════════════════════════════════════════════
// 3. 品牌识别
// ══════════════════════════════════════════════════════════════════

const BRAND_MAP = [
  [/^asus|^asustek/i, '华硕'], [/^msi\b|^micro-star/i, '微星'], [/^gigabyte/i, '技嘉'],
  [/^evga/i, 'EVGA'], [/^zotac/i, '索泰'], [/^sapphire/i, '蓝宝石'],
  [/^powercolor/i, '撼讯'], [/^xfx/i, '讯景'], [/^pny/i, 'PNY'],
  [/^gainward/i, '耕升'], [/^palit/i, '同德'], [/^inno3d/i, '映众'],
  [/^colorful/i, '七彩虹'], [/^galax|^kfa2/i, '影驰'], [/^manli/i, '万丽'],
  [/^his\b/i, 'HIS'], [/^yeston/i, '盈通'], [/^maxsun/i, '铭瑄'],
  [/^asrock/i, '华擎'], [/^biostar/i, '映泰'], [/^sparkle/i, 'Sparkle'],
  [/^leadtek/i, '丽台'], [/^elsa/i, 'ELSA'], [/^gunnir/i, '蓝戟'],
  [/^onda/i, '昂达'], [/^intel/i, 'Intel'], [/^nvidia/i, 'NVIDIA'],
  [/^visiontek/i, 'VisionTek'], [/^diamond/i, 'Diamond'], [/^acer/i, '宏碁'],
];

const brandOf = (n) => (BRAND_MAP.find(([re]) => re.test(String(n).trim())) || [])[1] || null;
const stripBrand = (n) => {
  for (const [re] of BRAND_MAP) {
    const m = String(n).match(re);
    if (m) return String(n).slice(m[0].length).trim();
  }
  return String(n).trim();
};

// ══════════════════════════════════════════════════════════════════
// 4. 年份与成色推导
// ══════════════════════════════════════════════════════════════════

function yearOf(chip) {
  const c = String(chip).toUpperCase();
  if (/RTX 50|RX 90[0-9]0/.test(c)) return 2025;
  if (/RTX 40|RX 7[0-9]00/.test(c)) return 2023;
  if (/RTX 30|RX 6[0-9]00/.test(c)) return 2021;
  if (/RTX 20|RX 5[0-9]00|GTX 16/.test(c)) return 2019;
  if (/GTX 10|RX 5[0-9]0\b|RX VEGA/.test(c)) return 2017;
  if (/GTX 9|GTX 7/.test(c)) return 2015;
  if (/ARC/.test(c)) return 2023;
  return 2020;
}

/** 成色：2023 年后的卡仍在零售；更早的基本只有二手流通 */
const condOf = (year) => (year >= 2023 ? 'new' : 'used');

// ══════════════════════════════════════════════════════════════════
// 5. 变体挑选：优先保留**长度有区分度**的样本
// ══════════════════════════════════════════════════════════════════

/** 优先选这些品牌（本项目已有 / 用户熟悉度高） */
const PREFERRED_BRANDS = [
  '华硕', '微星', '技嘉', '七彩虹', '影驰', '索泰', '蓝宝石', '撼讯',
  '铭瑄', '盈通', '映众', '耕升', '华擎', 'PNY', '万丽', '讯景', 'EVGA',
];

function pickVariants(list) {
  // 按长度分组，每组取品牌优先度最高的
  const byLen = new Map();
  for (const g of list) {
    const b = brandOf(g.name);
    if (!b) continue;
    if (!byLen.has(g.length)) byLen.set(g.length, []);
    byLen.get(g.length).push({ ...g, brand: b });
  }
  const lens = [...byLen.keys()].sort((a, b) => a - b);
  if (lens.length === 0) return [];

  const bestAt = (len) => {
    const arr = [...byLen.get(len)];
    arr.sort((a, b) => {
      const ia = PREFERRED_BRANDS.indexOf(a.brand);
      const ib = PREFERRED_BRANDS.indexOf(b.brand);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    return arr[0];
  };

  // 取最短 / 最长 + 中间分位点，保证展示出尺寸跨度
  const idxs = new Set([0, lens.length - 1]);
  if (lens.length >= 3) idxs.add(Math.floor(lens.length * 0.35));
  if (lens.length >= 5) idxs.add(Math.floor(lens.length * 0.65));

  // 同芯片尽量不同品牌（否则用户看不出"不同品牌"）
  const out = []; const usedBrands = new Set();
  for (const i of [...idxs].sort((a, b) => a - b)) {
    const c = bestAt(lens[i]);
    if (usedBrands.has(c.brand)) continue;
    usedBrands.add(c.brand);
    out.push(c);
  }
  return out;
}

// ══════════════════════════════════════════════════════════════════
// 6. 生成
// ══════════════════════════════════════════════════════════════════

const dsByChip = new Map();
for (const g of ds) {
  if (!(g.length > 0)) continue;   // 只保留有真实长度的
  const k = normChip(g.chipset);
  if (!dsByChip.has(k)) dsByChip.set(k, []);
  dsByChip.get(k).push(g);
}

/** 取某芯片在数据集中的全部候选（含别名回退） */
function listFor(chip) {
  const keys = [normChip(chip), ...(CHIP_ALIASES[chip] || []).map(normChip)];
  const out = [];
  for (const k of keys) out.push(...(dsByChip.get(k) || []));
  return out;
}

const existing = new Set(myGpu.map((g) => `${normChip(g.chipset)}|${g.length_mm}`));
const existingNames = new Set(myGpu.map((g) => String(g.name).toLowerCase()));

const candidates = [];
const skipped = [];

for (const [chip, ref] of chipRef) {
  const list = listFor(chip);
  if (list.length === 0) { skipped.push(chip); continue; }

  const year = yearOf(chip);
  const condition = condOf(year);

  for (const p of pickVariants(list)) {
    if (existing.has(`${normChip(chip)}|${p.length}`)) continue;

    const brand = p.brand;
    const model = stripBrand(p.name).replace(/\s+/g, ' ').trim();
    // 名称约定：**不含品牌前缀**，用「芯片 + 厂商型号」。
    // 与现有数据一致（如原有记录 "RTX 2060 VENTUS XS 6G OC"、brand="微星"），
    // 品牌由 brand 字段承载，界面单独渲染徽章，避免出现「微星 微星 RTX 2060」。
    const name = `${chip}${model ? ' ' + model : ''}`.trim();
    if (existingNames.has(name.toLowerCase())) continue;

    const id = `gpu-${brand}-${chip}-${p.length}mm`.toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
      .replace(/^-|-$/g, '');

    candidates.push({
      id,
      category: 'gpu',
      brand,
      name,
      aliases: [chip, `${brand} ${chip}`, chip.toLowerCase()],
      year,
      condition,
      // 无法核实到来源的字段一律标注为估算值（PRD 3.1.3）
      estimated: ['thicknessSlots', 'height_mm', 'outputs'],
      notes: `长度 ${p.length}mm 取自 PCPartDataset（原条目「${p.name}」）；厚度与输出接口为估算值。`,
      chipset: chip,
      length_mm: p.length,
      // 由长度粗估，无真实来源 → 已列入 estimated
      thicknessSlots: p.length <= 200 ? 2 : p.length <= 270 ? 2.5 : 3,
      height_mm: 120,
      ...ref,
    });
  }
}

const OUT = join(ROOT, 'tmp-candidates-gpu.json');
writeFileSync(OUT, JSON.stringify(candidates, null, 2), 'utf8');

console.log('═══ 显卡变体生成 ═══\n');
console.log(`  芯片参照表: ${chipRef.size} 个芯片`);
console.log(`  数据集索引: ${dsByChip.size} 个芯片`);
console.log(`  生成候选:   ${candidates.length} 条`);
if (skipped.length) console.log(`  数据集无覆盖的芯片 (${skipped.length}): ${skipped.join(', ')}`);

const conds = {};
for (const c of candidates) conds[c.condition] = (conds[c.condition] || 0) + 1;
console.log(`  成色分布: ${JSON.stringify(conds)}`);
console.log(`\n   输出: tmp-candidates-gpu.json`);
console.log(`   下一步: node tools/merge-variants.mjs gpu`);
