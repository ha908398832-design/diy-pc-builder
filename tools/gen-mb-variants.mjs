/**
 * 从数据集生成主板多品牌变体候选
 *
 * 与显卡生成器的关键差异（**数据可靠性设计**）：
 *
 *   数据集的 `socket` 字段**不使用** —— 它把 6/7 代（LGA1151）与 8/9 代
 *   （本项目为 LGA1151-2）都写成 `LGA1151`，无法区分，直接用会造成 E1 误判。
 *   socket 一律由**芯片组参照表**推导（芯片组唯一决定插槽）。
 *
 *   字段来源分三类：
 *     ① 数据集直接提供（可靠）：brand / name / formFactor / memorySlots / maxMemory
 *     ② 芯片组决定（确定性，不算估算）：socket / memoryType / pcieVersion
 *     ③ 因主板型号而异（**列入 estimated**，界面显示 ≈）：
 *        maxMemorySpeed / m2Slots / sataPorts / cpuPowerConnectors /
 *        vrmPhases / length_mm / width_mm / wifi / usbC / biosFlashback
 *
 * 用法:
 *   node tools/fetch-dataset.mjs motherboard   # 若未下载
 *   node tools/gen-mb-variants.mjs             # 输出 tmp-candidates-motherboard.json
 *   node tools/merge-variants.mjs motherboard  # 审阅后合并
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATEGORY_FIELDS } from '../schema/fields.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DS_PATH = join(ROOT, 'tmp-ds', 'motherboard.json');
const DATA_PATH = join(ROOT, 'data', 'motherboard.json');
const OUT_PATH = join(ROOT, 'tmp-candidates-motherboard.json');

if (!existsSync(DS_PATH)) {
  console.error('缺少数据集，请先运行: node tools/fetch-dataset.mjs motherboard');
  process.exit(1);
}

const ds = JSON.parse(readFileSync(DS_PATH, 'utf8'));
const myMb = JSON.parse(readFileSync(DATA_PATH, 'utf8'));

// ══════════════════════════════════════════════════════════════════
// 1. 芯片组参照表（来自本项目现有记录）
// ══════════════════════════════════════════════════════════════════

/** 由芯片组**唯一决定**的字段（不算估算值） */
const CHIP_DETERMINISTIC = ['socket', 'memoryType', 'pcieVersion'];

/** 因主板型号而异的字段（必须列入 estimated） */
const BOARD_VARYING = [
  'maxMemorySpeed', 'm2Slots', 'sataPorts', 'cpuPowerConnectors',
  'vrmPhases', 'length_mm', 'width_mm', 'wifi', 'usbC', 'biosFlashback',
];

/** 芯片组 → 平台规格（取现有记录中出现最多的值） */
function buildChipsetRef(records) {
  const byChip = new Map();
  for (const m of records) {
    if (!m.chipset) continue;
    if (!byChip.has(m.chipset)) byChip.set(m.chipset, []);
    byChip.get(m.chipset).push(m);
  }

  const ref = new Map();
  for (const [chip, list] of byChip) {
    const spec = {};
    for (const f of [...CHIP_DETERMINISTIC, ...BOARD_VARYING]) {
      // 取出现次数最多的值（众数）；数组字段用 JSON 比较
      const counts = new Map();
      for (const r of list) {
        const v = r[f];
        if (v === undefined || v === null) continue;
        const k = JSON.stringify(v);
        counts.set(k, (counts.get(k) || 0) + 1);
      }
      if (counts.size === 0) continue;
      const [best] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      spec[f] = JSON.parse(best);
    }
    ref.set(chip, spec);
  }
  return ref;
}

const chipRef = buildChipsetRef(myMb);
console.log(`芯片组参照表: ${chipRef.size} 个芯片组（来自本项目 ${myMb.length} 条）`);

// ══════════════════════════════════════════════════════════════════
// 2. 芯片组提取（从数据集 name）
// ══════════════════════════════════════════════════════════════════

/** 本项目已有的芯片组，作为白名单 —— 保证能查到平台规格 */
const KNOWN_CHIPSETS = [...chipRef.keys()].sort((a, b) => b.length - a.length);

function extractChipset(name) {
  const n = String(name || '').toUpperCase();
  for (const c of KNOWN_CHIPSETS) {
    const re = new RegExp(`(^|[\\s\\-_])${c.toUpperCase()}([\\s\\-_]|$)`);
    if (re.test(n)) return c;
  }
  return null;
}

// ══════════════════════════════════════════════════════════════════
// 3. 品牌与板型映射
// ══════════════════════════════════════════════════════════════════

const BRAND_MAP = [
  [/^asus|^asustek/i, '华硕'], [/^msi\b/i, '微星'], [/^gigabyte/i, '技嘉'],
  [/^asrock/i, '华擎'], [/^biostar/i, '映泰'], [/^ecs\b/i, '精英'],
  [/^evga/i, 'EVGA'], [/^intel/i, 'Intel'], [/^supermicro/i, 'Supermicro'],
  [/^jetway/i, '捷波'], [/^foxconn/i, '富士康'], [/^zotac/i, '索泰'],
  [/^nzxt/i, 'NZXT'], [/^colorful/i, '七彩虹'], [/^maxsun/i, '铭瑄'],
  [/^yeston/i, '盈通'], [/^onda/i, '昂达'], [/^soyo/i, '梅捷'],
  [/^huanan/i, '华南金牌'], [/^machinist/i, '铭速'], [/^jginvue/i, '精粤'],
  [/^jgginyue/i, '精粤'], [/^erying/i, '尔英'],
];

const brandOf = (n) => (BRAND_MAP.find(([re]) => re.test(String(n).trim())) || [])[1] || null;
const stripBrand = (n) => {
  for (const [re] of BRAND_MAP) {
    const m = String(n).match(re);
    if (m) return String(n).slice(m[0].length).trim();
  }
  return String(n).trim();
};

/** 数据集板型 → 本项目枚举（E-ATX / ATX / M-ATX / Mini-ITX） */
const FF_MAP = {
  'ATX': 'ATX',
  'Micro ATX': 'M-ATX',
  'Mini ITX': 'Mini-ITX',
  'EATX': 'E-ATX',
};

// ══════════════════════════════════════════════════════════════════
// 4. 生成
// ══════════════════════════════════════════════════════════════════

const existing = new Set(myMb.map((m) => `${m.chipset}·${m.formFactor}·${String(m.name).toLowerCase()}`));
const existingIds = new Set(myMb.map((m) => m.id));
/** 已有的 芯片组·板型·品牌 组合，避免同组同品牌重复 */
const existingCombo = new Set(myMb.map((m) => `${m.chipset}·${m.formFactor}·${m.brand}`));

const candidates = [];
const stats = { noChipset: 0, badFf: 0, noBrand: 0, dup: 0, noSpec: 0 };

for (const m of ds) {
  const chipset = extractChipset(m.name);
  if (!chipset) { stats.noChipset++; continue; }

  const formFactor = FF_MAP[m.form_factor];
  if (!formFactor) { stats.badFf++; continue; }

  const brand = brandOf(m.name);
  if (!brand) { stats.noBrand++; continue; }

  const spec = chipRef.get(chipset);
  if (!spec) { stats.noSpec++; continue; }

  const combo = `${chipset}·${formFactor}·${brand}`;
  if (existingCombo.has(combo)) { stats.dup++; continue; }

  const model = stripBrand(m.name).replace(/\s+/g, ' ').trim();
  const name = `${brand} ${model}`.trim();   // 主板约定：名称含品牌
  if (existing.has(`${chipset}·${formFactor}·${name.toLowerCase()}`)) { stats.dup++; continue; }

  const id = `motherboard-${brand}-${chipset}-${formFactor}-${model}`
    .toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-|-$/g, '');
  if (existingIds.has(id)) { stats.dup++; continue; }

  candidates.push({
    id,
    category: 'motherboard',
    brand,
    name,
    aliases: [...new Set([chipset, `${brand} ${chipset}`, `${chipset} ${formFactor}`, model.toLowerCase()])],
    year: 2021,          // 由芯片组代次推导，见下
    condition: 'new',
    // ③ 因主板型号而异的字段 → 全部标估算值
    estimated: [...BOARD_VARYING],
    notes: `芯片组与板型取自 PCPartDataset（原条目「${m.name}」）；`
      + `内存槽数与最大容量取自该数据集；其余字段为 ${chipset} 芯片组的典型值，`
      + `具体型号可能有差异，请以实物规格为准。`,

    // ② 芯片组决定（不标估算）
    chipset,
    socket: spec.socket,
    memoryType: spec.memoryType,
    pcieVersion: spec.pcieVersion,

    // ① 数据集直接提供
    formFactor,
    memorySlots: m.memory_slots,
    maxMemory: m.max_memory,

    // ③ 芯片组典型值（已列入 estimated）
    maxMemorySpeed: spec.maxMemorySpeed,
    m2Slots: spec.m2Slots,
    sataPorts: spec.sataPorts,
    cpuPowerConnectors: spec.cpuPowerConnectors,
    vrmPhases: spec.vrmPhases,
    length_mm: spec.length_mm,
    width_mm: spec.width_mm,
    wifi: /wi-?fi|wireless/i.test(String(m.name)),
    usbC: spec.usbC,
    biosFlashback: spec.biosFlashback,

    _source: m.name,
  });
}

// ── 年份按芯片组代次推导 ──
function yearOf(chipset) {
  const c = String(chipset).toUpperCase();
  if (/^(X870|X870E|B850|B840)$/.test(c)) return 2024;
  if (/^(X670|X670E|B650|B650E|A620)$/.test(c)) return 2022;
  if (/^(Z890|B860|H810)$/.test(c)) return 2024;
  if (/^(Z790|B760|H770)$/.test(c)) return 2022;
  if (/^(Z690|B660|H670|H610)$/.test(c)) return 2021;
  if (/^(Z590|B560|H510|H570)$/.test(c)) return 2021;
  if (/^(Z490|B460|H410|H470)$/.test(c)) return 2020;
  if (/^(Z390|B365|B360|H370|H310)$/.test(c)) return 2018;
  if (/^(Z370)$/.test(c)) return 2017;
  if (/^(Z270|B250|H270)$/.test(c)) return 2017;
  if (/^(Z170|B150|H110)$/.test(c)) return 2015;
  if (/^(X570|B550|A520)$/.test(c)) return 2019;
  if (/^(X470|B450)$/.test(c)) return 2018;
  if (/^(X370|B350|A320)$/.test(c)) return 2017;
  if (/^(X99)$/.test(c)) return 2014;
  if (/^(X79)$/.test(c)) return 2011;
  if (/^(X58)$/.test(c)) return 2008;
  if (/^(Z97|H97|H81|B85)$/.test(c)) return 2014;
  if (/^(Z87|H87)$/.test(c)) return 2013;
  if (/^(Z77|Z75|B75|H61)$/.test(c)) return 2012;
  if (/^(970|990FX|A88X)$/.test(c)) return 2013;
  return 2020;
}
for (const c of candidates) c.year = yearOf(c.chipset);

// ── 成色：2023 年后仍在售 ──
for (const c of candidates) c.condition = c.year >= 2023 ? 'new' : 'used';

// ══════════════════════════════════════════════════════════════════
// 4b. 选择：只取需要的数量，并优先让「分组」更有内容
// ══════════════════════════════════════════════════════════════════
//
// 数据集能产出 800+ 条主板候选，但：
//   · PRD 3.1.2 的主板目标是 130 条（minCount）
//   · 总量上限 800，全量合并会突破
//   · 派生字段（m2Slots/sataPorts 等）越多，不确定性越大
// 因此按目标数量精确选取，并优先补「变体少的芯片组·板型」，
// 使归并视图里能真正看到多品牌对比。

const TARGET = CATEGORY_FIELDS.motherboard.minCount;
const need = Math.max(0, TARGET - myMb.length);

/** 当前每个 芯片组·板型 已有多少条 */
const currentGroupCount = {};
for (const m of myMb) {
  const k = `${m.chipset}·${m.formFactor}`;
  currentGroupCount[k] = (currentGroupCount[k] || 0) + 1;
}

/** 候选按 芯片组·板型 分组 */
const candGroups = new Map();
for (const c of candidates) {
  const k = `${c.chipset}·${c.formFactor}`;
  if (!candGroups.has(k)) candGroups.set(k, []);
  candGroups.get(k).push(c);
}

/** 组内已有品牌（避免同组重复品牌） */
const groupBrands = {};
for (const m of myMb) {
  const k = `${m.chipset}·${m.formFactor}`;
  (groupBrands[k] ||= new Set()).add(m.brand);
}

// 排序优先级（决定名额花在哪里）：
//   ① 已有 1 条的组  → 补成多版本，用户能看到多品牌对比（最有价值）
//   ② 已有 2 条的组  → 继续加深
//   ③ 全新分组      → 扩大覆盖（但不会产生"多版本对比"）
//   ④ 已有 3 条的组  → 补满
//   ⑤ 已有 ≥4 条     → 不再加（GROUP_CAP）
const groupRank = (k) => {
  const n = currentGroupCount[k] || 0;
  if (n === 1) return 1;
  if (n === 2) return 2;
  if (n === 0) return 3;
  if (n === 3) return 4;
  return 99;
};

const groupKeys = [...candGroups.keys()]
  .filter((k) => groupRank(k) < 99)
  .sort((a, b) => groupRank(a) - groupRank(b) || a.localeCompare(b));
for (const k of groupKeys) {
  candGroups.get(k).sort((x, y) => {
    const bx = (groupBrands[k]?.has(x.brand) ? 1 : 0);
    const by = (groupBrands[k]?.has(y.brand) ? 1 : 0);
    return bx - by;
  });
}

/** 每组上限：让分组有对比但不至于臃肿 */
const GROUP_CAP = 4;
const picked = [];
const pickedCount = {};
const cursor = {};

// 轮转取：每轮从各组取一条，保证芯片组分布均匀
let progress = true;
while (picked.length < need && progress) {
  progress = false;
  for (const k of groupKeys) {
    if (picked.length >= need) break;
    const used = (currentGroupCount[k] || 0) + (pickedCount[k] || 0);
    if (used >= GROUP_CAP) continue;

    const list = candGroups.get(k);
    const i = cursor[k] || 0;
    if (i >= list.length) continue;

    // 跳过该组已出现过的品牌（除非没得选）
    let pick = null;
    for (let j = i; j < list.length; j++) {
      const cand = list[j];
      const seen = groupBrands[k]?.has(cand.brand);
      if (!seen) { pick = cand; cursor[k] = j + 1; break; }
    }
    if (!pick) { pick = list[i]; cursor[k] = i + 1; }
    if (!pick) continue;

    picked.push(pick);
    pickedCount[k] = (pickedCount[k] || 0) + 1;
    (groupBrands[k] ||= new Set()).add(pick.brand);
    progress = true;
  }
}

const selected = picked;
const totalAfter = myMb.length + selected.length;

writeFileSync(OUT_PATH, JSON.stringify(selected, null, 2), 'utf8');

// ══════════════════════════════════════════════════════════════════
// 5. 报告
// ══════════════════════════════════════════════════════════════════

console.log('\n═══ 生成结果 ═══\n');
console.log(`  候选池: ${candidates.length} 条`);
console.log(`  选取:   ${selected.length} 条（目标 ${TARGET} 条，当前 ${myMb.length} 条，需补 ${need} 条）`);
console.log(`  合并后: ${totalAfter} 条`);
console.log('\n  跳过统计:');
console.log(`    无法提取芯片组（不在本项目芯片组白名单）: ${stats.noChipset}`);
console.log(`    板型不支持:                              ${stats.badFf}`);
console.log(`    品牌无法识别:                            ${stats.noBrand}`);
console.log(`    同组同品牌已存在:                        ${stats.dup}`);

const byChip = {};
for (const c of selected) (byChip[c.chipset] ||= []).push(`${c.formFactor}·${c.brand}`);
console.log(`\n  覆盖芯片组: ${Object.keys(byChip).length} 个`);
console.log('\n  新增最多的芯片组:');
for (const [k, v] of Object.entries(byChip).sort((a, b) => b[1].length - a[1].length).slice(0, 10)) {
  console.log(`    ${k.padEnd(10)} +${String(v.length).padStart(2)}  ${v.slice(0, 4).join(', ')}`);
}

// 预计合并后有多少多版本分组
const afterGroups = {};
for (const m of myMb) (afterGroups[`${m.chipset}·${m.formFactor}`] ||= []).push(m.brand);
for (const c of selected) (afterGroups[`${c.chipset}·${c.formFactor}`] ||= []).push(c.brand);
const multiAfter = Object.values(afterGroups).filter((l) => l.length > 1).length;
console.log(`\n  多版本分组: ${Object.values(currentGroupCount).filter((n) => n > 1).length} → ${multiAfter}`);

console.log(`\n  输出: tmp-candidates-motherboard.json`);
console.log(`  下一步: node tools/merge-variants.mjs motherboard`);
