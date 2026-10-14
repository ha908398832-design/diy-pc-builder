/**
 * 移除第三方派生数据，使仓库回到「仅含手工整理数据」的状态
 *
 * 背景：`data/gpu.json` 中有 191 条记录的长度数据派生自
 * docyx/pc-part-dataset（该数据集抓取自 PCPartPicker）。
 * 详见 NOTICE.md。
 *
 * 本脚本会：
 *   1. 移除所有 notes 中标注第三方来源的记录
 *   2. 同步下调 schema/fields.js 的 minCount，使门禁仍可通过
 *   3. 打印影响范围
 *
 * 用法:
 *   node tools/strip-third-party.mjs          # 执行（移除记录 + 同步 minCount）
 *   node tools/strip-third-party.mjs --dry    # 仅预览，不写入
 *   node tools/strip-third-party.mjs --keep-min  # 只移除记录，不动 minCount
 *
 * 注意：移除的记录不可恢复（除非 `git checkout data/gpu.json`）。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const dryRun = process.argv.includes('--dry');
const keepMin = process.argv.includes('--keep-min');

/** 认定「第三方派生」的判定：notes 里出现这些标记 */
const MARKERS = /PCPartDataset|PCPartPicker/i;

const CATEGORIES = [
  { cat: 'cpu', file: 'cpu.json' },
  { cat: 'motherboard', file: 'motherboard.json' },
  { cat: 'gpu', file: 'gpu.json' },
  { cat: 'memory', file: 'memory.json' },
  { cat: 'psu', file: 'psu.json' },
  { cat: 'case', file: 'case.json' },
  { cat: 'cooler', file: 'cooler.json' },
  { cat: 'storage', file: 'storage.json' },
];

console.log('═══ 移除第三方派生数据 ═══\n');
if (dryRun) console.log('（--dry 预览模式，不会写入任何文件）\n');

/** 每个品类的最终记录数，用于同步 minCount */
const finalCounts = {};
let removedTotal = 0;

for (const { cat, file } of CATEGORIES) {
  const p = join(ROOT, 'data', file);
  const list = JSON.parse(readFileSync(p, 'utf8'));
  const kept = list.filter((r) => !MARKERS.test(r.notes || ''));
  const removed = list.length - kept.length;

  finalCounts[cat] = kept.length;
  removedTotal += removed;

  const mark = removed > 0 ? '← 移除' : '';
  console.log(`  ${cat.padEnd(12)} ${String(list.length).padStart(4)} → ${String(kept.length).padStart(4)}  （移除 ${removed}）${mark}`);

  if (removed > 0 && !dryRun) {
    writeFileSync(p, JSON.stringify(kept, null, 2) + '\n', 'utf8');
  }
}

console.log(`\n  合计移除 ${removedTotal} 条`);

if (removedTotal === 0) {
  console.log('\n✅ 仓库已不含第三方派生数据，无需操作');
  process.exit(0);
}

// ── 同步 schema/fields.js 的 minCount ──
if (!keepMin) {
  const fp = join(ROOT, 'schema', 'fields.js');
  let src = readFileSync(fp, 'utf8');
  const before = src;
  const changes = [];

  for (const { cat, file } of CATEGORIES) {
    const need = finalCounts[cat];
    // 匹配该品类的 minCount 行（通过 csvFile 定位同一对象块）
    const re = new RegExp(
      `(csvFile:\\s*'${file.replace('.json', '.csv')}'[\\s\\S]{0,200}?minCount:\\s*)(\\d+)`,
    );
    const m = src.match(re);
    if (!m) continue;
    const old = Number(m[2]);
    if (old === need) continue;
    src = src.replace(re, `$1${need}`);
    changes.push(`${cat} ${old} → ${need}`);
  }

  if (src !== before) {
    console.log('\n  schema/fields.js 的 minCount 同步调整：');
    for (const c of changes) console.log(`    ${c}`);
    if (!dryRun) writeFileSync(fp, src, 'utf8');
  } else {
    console.log('\n  schema/fields.js 的 minCount 无需调整');
  }
} else {
  console.log('\n  （--keep-min）未调整 minCount —— 门禁会因数据量不足而失败');
}

console.log('\n' + '─'.repeat(46));
if (dryRun) {
  console.log('预览结束。去掉 --dry 以实际执行。');
} else {
  console.log('✅ 已移除第三方派生数据');
  console.log('\n下一步：');
  console.log('  node tools/gate.mjs      # 验证门禁仍可通过');
  console.log('  git checkout data/       # 如需撤销（回到含第三方数据的版本）');
}
