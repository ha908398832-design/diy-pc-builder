/**
 * 构建可复现性检查
 *
 * 背景：曾经出现过「源码数据已修正，但内联数据包（src/data/bundle.js）
 * 仍是修正前的旧版本」的情况 —— 因为 bundle.js 是生成物，
 * 若不在同一次提交里重新生成，就会把过期数据打进交付产物。
 * （实测：该次提交里 PSU 型号名把 550W 写成了 500W，只出现在 bundle.js 中）
 *
 * 本脚本的职责：
 *   1. 重新生成 bundle.js 与产物
 *   2. 与提交前版本逐字节比对
 *   3. 不一致即报错，提示"生成物与源码不同步"
 *
 * 用法:
 *   node tools/check-reproducible.mjs            # 检查当前工作区
 *   node tools/check-reproducible.mjs --staged   # 检查暂存区（提交前用）
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const staged = process.argv.includes('--staged');
const read = (rel) => (staged ? 'staged' : 'worktree');

/** 读取当前版本与暂存区版本的字节 */
function getBytes(rel) {
  const out = execFileSync('git', ['show', `:${rel}`], { cwd: ROOT, maxBuffer: 1 << 28 });
  return out;
}

function run(args) {
  return execFileSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
}

console.log('════════ 构建可复现性检查 ════════\n');

// 记录当前内容
const before = {};
for (const rel of ['src/data/bundle.js', 'dist/装机助手.html', 'schema/hardware.schema.json']) {
  const p = join(ROOT, rel);
  before[rel] = existsSync(p) ? readFileSync(p) : null;
}

// 用当前源码重新生成
run(['tools/gen-schema.mjs']);
run(['tools/gen-data-bundle.mjs']);
run(['tools/build.mjs']);

// 重新比对
let mismatched = 0;
for (const rel of Object.keys(before)) {
  const p = join(ROOT, rel);
  if (!existsSync(p)) continue;
  const after = readFileSync(p);
  const prev = before[rel];
  if (!prev) continue;

  const same = prev.length === after.length && prev.equals(after);
  const verdict = same ? '✅ 一致' : '❌ 不一致（生成物与源码不同步）';
  console.log(`  ${verdict}  ${rel}  (${after.length} 字节)`);
  if (!same) {
    mismatched++;
    console.log(`     重新生成后内容发生变化 —— 说明提交的生成物是过期的`);
    // 打印首个差异位置，便于定位
    const minLen = Math.min(prev.length, after.length);
    let firstDiff = -1;
    for (let i = 0; i < minLen; i++) {
      if (prev[i] !== after[i]) { firstDiff = i; break; }
    }
    if (firstDiff >= 0) {
      const s = Math.max(0, firstDiff - 50), e = Math.min(after.length, firstDiff + 50);
      console.log(`     首个差异位置: ${firstDiff}`);
      console.log(`     旧: ...${prev.slice(s, e).toString('utf8')}...`);
      console.log(`     新: ...${after.slice(s, e).toString('utf8')}...`);
    }
  }
}

console.log();
if (mismatched > 0) {
  console.log(`❌ ${mismatched} 个生成物与源码不同步。`);
  console.log('   请把重新生成的结果一并提交（生成物必须与源数据同批次提交）。');
  process.exit(1);
} else {
  console.log('✅ 所有生成物与源码同步（构建可复现）');
  process.exit(0);
}