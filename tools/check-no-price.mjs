#!/usr/bin/env node
/**
 * 无价格门禁（PRD A15 / 1.5 / M9-7）
 *
 * 目的：本期明确不做价格与预算（M5），界面与导出中不得出现任何"钱"的痕迹。
 * 本脚本作为自动化门禁，扫描 UI 源码与构建产物。
 *
 * 判定原则（重要）：
 *   1. 「功耗预算」是 M4 的电源瓦数计算，PRD 明确保留 → "预算"一词本身合法
 *   2. 数据契约里保留 price 字段（P1 预留）→ 数据层与 schema 允许出现 price
 *   3. 真正要拦的是"把钱展示给用户"：¥ 符号、价格列、总价、金额、超支等
 *
 * 用法: node tools/check-no-price.mjs
 * 退出码: 0 = 通过；1 = 发现违规
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 必须干净的界面文件 */
const UI_FILES = [
  'src/ui/render.js',
  'src/ui/app.js',
  'src/ui/export.js',
  'src/styles.css',
  'templates/index.html',
  'dist/装机助手.html',
];

/** 允许出现 price 的数据/规范文件（P1 预留字段） */
const ALLOWED_PRICE_FILES = [
  'schema/fields.js',
  'schema/hardware.schema.json',
  'src/core/csv.js',
  'src/core/search.js',
  'tools/validate-data.mjs',
  'tools/gen-csv-templates.mjs',
  'tools/gen-schema.mjs',
  'tools/csv-to-json.mjs',
  'tools/gen-data-bundle.mjs',
  'src/core/store.js',
  'data/',
  'csv-templates/',
  'prd.md',
  'docs/',
  'tests/',
];

/**
 * 违规模式
 * 注意每条都要足够精确，避免误伤：
 *   - /预算/ 不能用，因为"功耗预算"合法
 */
const VIOLATIONS = [
  { re: /¥/, desc: '货币符号 ¥' },
  { re: /￥/, desc: '货币符号 ￥' },
  { re: /\bCNY\b/, desc: '货币代码 CNY' },
  { re: />\s*价格\s*</, desc: '价格列/标签' },
  { re: /总价/, desc: '总价文案' },
  { re: /预算\s*[:：]\s*[¥￥\d]/, desc: '预算输入框' },
  { re: /已用\s*[¥￥]/, desc: '已用金额' },
  { re: /超支/, desc: '超支提醒' },
  { re: /价格未填/, desc: '价格未填提示' },
  { re: /差价/, desc: '差价对比' },
  { re: /省钱/, desc: '省钱建议' },
  { re: /\d[\d,]*\s*元\b/, desc: '金额数值（如 2599 元）' },
  { re: /合计\s*[¥￥]/, desc: '金额合计' },
];

/** 数据字段名（用于拦截 UI 读取 price 字段） */
const PRICE_FIELD_RE = /\b(?:rec|record|item|it|row)\.price\b|\bprice\s*:/;

function stripComments(src, isCss = false) {
  let s = src;
  s = s.replace(/\/\*[\s\S]*?\*\//g, '');      // 块注释
  if (!isCss) s = s.replace(/(^|[^:])\/\/.*$/gm, '$1'); // 行注释（避开 http://）
  return s;
}

function checkFile(absPath, isCss = false) {
  let src = readFileSync(absPath, 'utf8');

  // 对构建产物：先剔除内联的数据模块，只检查界面代码
  // （数据里的 notes 是资料内容，如"配 12400F 最省钱"，不展示价格，属合法）
  if (absPath.endsWith('.html') && src.includes('__defs[')) {
    src = stripDataModule(src);
  }

  const body = stripComments(src, isCss);
  const hits = [];

  for (const { re, desc } of VIOLATIONS) {
    // 用全局匹配找出所有位置，便于报告
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    let m;
    while ((m = g.exec(body)) !== null) {
      const line = body.slice(0, m.index).split('\n').length;
      const snippet = body.slice(Math.max(0, m.index - 40), m.index + 40).replace(/\n/g, ' ');
      hits.push({ desc, line, snippet: snippet.trim() });
      if (hits.length > 40) break;
    }
  }

  // UI 层不得读取 price 字段
  if (!ALLOWED_PRICE_FILES.some((a) => relative(ROOT, absPath).replace(/\\/g, '/').startsWith(a))) {
    const fm = body.match(PRICE_FIELD_RE);
    if (fm) {
      const line = body.slice(0, fm.index).split('\n').length;
      hits.push({ desc: '读取 price 数据字段', line, snippet: fm[0] });
    }
  }

  return hits;
}

// ── 主流程 ──────────────────────────────────────────────────────────
console.log('══════════════════════════════════════════════');
console.log(' 无价格门禁（PRD A15）');
console.log('══════════════════════════════════════════════\n');

let failed = false;
let checked = 0;

for (const rel of UI_FILES) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) {
    console.log(`  ⚠ 跳过（不存在）: ${rel}`);
    continue;
  }
  checked++;
  const isCss = rel.endsWith('.css');
  const hits = checkFile(abs, isCss);

  if (hits.length === 0) {
    console.log(`  ✅ ${rel}`);
  } else {
    failed = true;
    console.log(`  ❌ ${rel} —— 发现 ${hits.length} 处违规：`);
    for (const h of hits.slice(0, 15)) {
      console.log(`      第 ${h.line} 行 [${h.desc}] … ${h.snippet}`);
    }
    if (hits.length > 15) console.log(`      … 还有 ${hits.length - 15} 处`);
  }
}

/**
 * 从产物中剔除内联的数据模块
 *
 * 为什么需要：产物把 data/*.json 内联为 src/data/bundle.js 模块。
 * 硬件的 notes 字段是"资料内容"（例如某主板备注"配 12400F 最省钱"），
 * 它不展示任何价格，属于合法数据。若连同数据一起扫描，
 * 会把数据文案误报为界面违规。因此只扫界面代码。
 */
function stripDataModule(code) {
  const start = code.indexOf('__defs["src/data/bundle.js"]');
  if (start < 0) return code;
  // 找到该工厂函数结束：下一个 __defs[ 或运行时函数定义
  const rest = code.slice(start);
  const nextIdx = rest.search(/\n__defs\[|__depsMeta\s*=/);
  if (nextIdx < 0) return code.slice(0, start);
  return code.slice(0, start) + code.slice(start + nextIdx);
}

// 额外验证：产物的界面代码里不得出现价格
const distPath = join(ROOT, 'dist', '装机助手.html');
if (existsSync(distPath)) {
  const dist = readFileSync(distPath, 'utf8');
  const scriptPart = dist.slice(dist.lastIndexOf('<script>'));
  const uiCode = stripDataModule(scriptPart);
  const body = stripComments(uiCode);
  for (const { re, desc } of VIOLATIONS) {
    const m = body.match(re);
    if (m) {
      failed = true;
      const line = body.slice(0, m.index).split('\n').length;
      console.log(`  ❌ 产物界面代码含${desc}（第 ${line} 行附近）: ${m[0]}`);
    }
  }
}

console.log(`\n已检查 ${checked} 个文件。`);
if (failed) {
  console.log('❌ 门禁未通过：界面中仍存在价格相关内容（PRD 1.5 要求本期不做价格）');
  process.exit(1);
} else {
  console.log('✅ 门禁通过：界面与产物中不含任何价格内容');
  console.log('   说明：「功耗预算」属 M4 电源瓦数计算，PRD 明确保留，不计为违规。');
  console.log('   说明：数据契约中的 price 字段为 P1 预留，非界面内容，不计为违规。');
  process.exit(0);
}
