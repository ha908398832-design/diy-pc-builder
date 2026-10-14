/**
 * 从 docyx/pc-part-dataset 下载硬件数据集
 *
 * 用途：为数据扩充提供**真实规格**（尤其是显卡板卡长度 length）。
 * 数据源：https://github.com/docyx/pc-part-dataset（MIT 覆盖代码；
 *         数据抓取自 PCPartPicker，个人自用，公开发布需注明来源）
 *
 * 关键：必须带 `Accept: application/vnd.github.raw` 头。
 *       用 contents API 默认的 base64 编码取 1MB 文件会 60s 超时，
 *       换成 raw 后 25s 完成 —— 这是方法问题，不是网络问题。
 *
 * 用法:
 *   node tools/fetch-dataset.mjs              # 下载全部品类（约 2.5 分钟，6.7MB）
 *   node tools/fetch-dataset.mjs gpu          # 只下显卡
 *   node tools/fetch-dataset.mjs --check      # 只检查已下载的情况
 *
 * 输出: tmp-ds/*.json（被 .gitignore 的 tmp-* 覆盖，不会提交）
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'tmp-ds');

/** 品类 → 数据集文件名 */
export const DATASET_FILES = {
  gpu: 'video-card.json',
  motherboard: 'motherboard.json',
  cpu: 'cpu.json',
  memory: 'memory.json',
  psu: 'power-supply.json',
  case: 'case.json',
  cooler: 'cpu-cooler.json',
  storage: 'internal-hard-drive.json',
};

const API = 'https://api.github.com/repos/docyx/pc-part-dataset/contents/data/json';

/** 取单个数据集文件的本地路径 */
export function datasetPath(category) {
  return join(OUT, DATASET_FILES[category]);
}

/** 读已下载的数据集（未下载则返回 null） */
export function readDataset(category) {
  const p = datasetPath(category);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8'));
}

async function download(file) {
  const res = await fetch(`${API}/${file}`, {
    headers: {
      'User-Agent': 'diy-build-assistant',
      // 关键：raw 格式避免 base64 膨胀与超时
      Accept: 'application/vnd.github.raw',
    },
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// ── CLI ──
const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const only = args.filter((a) => !a.startsWith('--'));

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const targets = only.length ? only : Object.keys(DATASET_FILES);
let ok = 0; let fail = 0;

console.log('═══ 硬件数据集下载 ═══\n');

for (const cat of targets) {
  const file = DATASET_FILES[cat];
  if (!file) { console.log(`  ⚠ ${cat} 不是已知品类，跳过`); continue; }

  const p = join(OUT, file);
  if (existsSync(p)) {
    const arr = JSON.parse(readFileSync(p, 'utf8'));
    console.log(`  ⏭  ${cat.padEnd(12)} 已存在 ${String(arr.length).padStart(6)} 条`);
    ok++;
    continue;
  }
  if (checkOnly) { console.log(`  ✗  ${cat.padEnd(12)} 未下载`); fail++; continue; }

  const t0 = Date.now();
  try {
    const text = await download(file);
    const arr = JSON.parse(text);
    writeFileSync(p, text, 'utf8');
    console.log(`  ✅ ${cat.padEnd(12)} ${String(arr.length).padStart(6)} 条  ${(text.length / 1024).toFixed(0)}KB  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    ok++;
  } catch (e) {
    console.log(`  ❌ ${cat.padEnd(12)} ${e.name}: ${e.message.slice(0, 40)}`);
    fail++;
  }
}

console.log(`\n完成: ${ok} 成功, ${fail} 失败`);
console.log(`位置: tmp-ds/（已 gitignore，不会提交）`);
if (fail > 0) process.exit(1);
