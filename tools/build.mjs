#!/usr/bin/env node
/**
 * 构建：把 CSS + 全部 ES 模块 + 数据内联成单个 HTML（PRD NF1/NF2/NF3）
 *
 * 为什么自己写打包器：
 *   项目要求"零安装、单文件、断网可用"。引入 Rollup/esbuild 会带来
 *   node_modules 依赖，与零依赖约束冲突。本项目的模块图很小，
 *   一个支持命名导入/默认导入/重导出的迷你打包器足够，且完全可控。
 *
 * 支持的语法（本项目实际用到的）：
 *   import { a, b as c } from './x.js'
 *   import Default from './x.js'
 *   import * as ns from './x.js'
 *   export const/let/function/class NAME
 *   export { a, b as c }
 *   export default EXPR
 *
 * 产物结构：
 *   <script> 一段 IIFE，内部维护模块注册表，按依赖顺序求值
 *
 * 用法: node tools/build.mjs [--out dist/装机助手.html] [--no-minify]
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = join(ROOT, 'src', 'ui', 'app.js');
const TEMPLATE = join(ROOT, 'templates', 'index.html');

const args = process.argv.slice(2);
const outArgIdx = args.indexOf('--out');
const OUT = outArgIdx >= 0
  ? resolve(ROOT, args[outArgIdx + 1])
  : join(ROOT, 'dist', '装机助手.html');

// ══════════════════════════════════════════════════════════════════
// 1. 解析模块
// ══════════════════════════════════════════════════════════════════

const IMPORT_RE = /^\s*import\s+(?:([\w$]+)\s*,\s*)?(?:\{([^}]*)\}|\*\s+as\s+([\w$]+)|([\w$]+))\s+from\s+['"]([^'"]+)['"]\s*;?/gm;
const BARE_IMPORT_RE = /^\s*import\s+['"]([^'"]+)['"]\s*;?/gm;

/**
 * 解析一个模块，返回 { path, deps, body, exports, defaultExport }
 */
function parseModule(absPath) {
  const src = readFileSync(absPath, 'utf8');
  const deps = [];   // { path, bindings: [{imported, local}] }
  const exportNames = new Set();
  let defaultExport = null;

  // ── import 语句 ────────────────────────────────────────────────
  let body = src.replace(IMPORT_RE, (m, defaultWithNamed, named, star, defOnly, spec) => {
    const bindings = [];
    let hasDefault = false;

    if (defaultWithNamed) { bindings.push({ imported: 'default', local: defaultWithNamed }); hasDefault = true; }
    if (defOnly) { bindings.push({ imported: 'default', local: defOnly }); hasDefault = true; }
    if (named) {
      for (const piece of named.split(',')) {
        const t = piece.trim();
        if (!t) continue;
        const [imported, local] = t.split(/\s+as\s+/).map((x) => x.trim());
        bindings.push({ imported, local: local || imported });
      }
    }
    if (star) bindings.push({ imported: '*', local: star });

    deps.push({ spec, bindings });
    return ''; // 删除该行
  });

  body = body.replace(BARE_IMPORT_RE, () => '');

  // ── export default ─────────────────────────────────────────────
  body = body.replace(/^\s*export\s+default\s+([\s\S]*?);?\s*$/m, (m, expr) => {
    const trimmed = expr.trim().replace(/;$/, '');
    // 标识符形式（如 `export default RULES;`）直接引用；表达式则赋给临时变量
    if (/^[A-Za-z_$][\w$]*$/.test(trimmed)) {
      defaultExport = trimmed;
      return '';
    }
    defaultExport = '__default__';
    return `const __default__ = ${trimmed};`;
  });

  // ── export { a, b as c } ───────────────────────────────────────
  body = body.replace(/^\s*export\s*\{([^}]*)\}\s*;?\s*$/gm, (m, names) => {
    for (const piece of names.split(',')) {
      const t = piece.trim();
      if (!t) continue;
      const [local, exported] = t.split(/\s+as\s+/).map((x) => x.trim());
      exportNames.add(exported || local);
    }
    return '';
  });

  // ── export const/let/var/function/class/async function ─────────
  body = body.replace(
    /^(\s*)export\s+(async\s+function|function|class|const|let|var)\s+([\w$]+)/gm,
    (m, indent, kind, name) => {
      exportNames.add(name);
      return `${indent}${kind} ${name}`;
    },
  );

  // 剩余的 `export ` 前缀（如 export {x} from '...'）本项目未使用，若出现则报错提示
  const leftover = body.match(/^\s*export\s+/m);
  if (leftover) {
    throw new Error(`${relative(ROOT, absPath)} 含未支持的 export 语法：${leftover[0].trim()}`);
  }

  return { absPath, deps, body, exports: [...exportNames], defaultExport };
}

/** 递归收集模块图（后序 = 依赖在前） */
function collectGraph(entry) {
  const modules = new Map(); // absPath -> parsed
  const order = [];
  const visiting = new Set();

  function visit(absPath) {
    if (modules.has(absPath)) return;
    if (visiting.has(absPath)) throw new Error(`检测到循环依赖: ${relative(ROOT, absPath)}`);
    if (!existsSync(absPath)) throw new Error(`模块不存在: ${absPath}`);

    visiting.add(absPath);
    const parsed = parseModule(absPath);
    modules.set(absPath, parsed);

    for (const dep of parsed.deps) {
      if (!dep.spec.startsWith('.')) {
        throw new Error(`${relative(ROOT, absPath)} 引用了裸模块 "${dep.spec}"，单文件构建不支持`);
      }
      const depPath = resolve(dirname(absPath), dep.spec);
      visit(depPath);
      dep.absPath = depPath;
    }

    visiting.delete(absPath);
    order.push(absPath);
  }

  visit(entry);
  return { modules, order };
}

/** 生成模块 id（相对 ROOT，正斜杠） */
const idOf = (absPath) => relative(ROOT, absPath).replace(/\\/g, '/');

// ══════════════════════════════════════════════════════════════════
// 2. 生成打包代码
// ══════════════════════════════════════════════════════════════════

function buildScript() {
  const { modules, order } = collectGraph(ENTRY);

  const parts = [];
  parts.push('(function(){');
  parts.push('"use strict";');
  parts.push('var __defs = {}, __cache = {};');

  // 每个模块包装为工厂函数，依赖以参数注入
  for (const absPath of order) {
    const mod = modules.get(absPath);
    const id = idOf(absPath);

    const depIds = mod.deps.map((d) => JSON.stringify(idOf(d.absPath)));
    const destructure = mod.deps
      .map((d) => {
        const binds = d.bindings.map((b) => {
          if (b.imported === '*') return `var ${b.local} = __deps[${JSON.stringify(idOf(d.absPath))}];`;
          if (b.imported === 'default') return `var ${b.local} = __deps[${JSON.stringify(idOf(d.absPath))}].default;`;
          return `var ${b.local} = __deps[${JSON.stringify(idOf(d.absPath))}].${b.imported};`;
        }).join('\n');
        return binds;
      })
      .join('\n');

    const exportList = mod.exports.map((n) => `${JSON.stringify(n)}: ${n}`).join(', ');
    const defEntry = mod.defaultExport
      ? `${exportList ? exportList + ', ' : ''}"default": ${mod.defaultExport}`
      : exportList;

    parts.push(`__defs[${JSON.stringify(id)}] = function(__deps){`);
    if (destructure) parts.push(destructure);
    parts.push(mod.body);
    parts.push(`return { ${defEntry} };`);
    parts.push('};');
  }

  // 运行时：按需实例化（处理模块间引用顺序）
  parts.push(`
function __require(id, stack) {
  if (__cache[id]) return __cache[id];
  stack = stack || [];
  if (stack.indexOf(id) >= 0) throw new Error('循环依赖: ' + id);
  var factory = __defs[id];
  if (!factory) throw new Error('模块未注册: ' + id);
  var __deps = {};
  __depsMeta[id].forEach(function (depId) {
    __deps[depId] = __require(depId, stack.concat([id]));
  });
  var mod = factory(__deps) || {};
  __cache[id] = mod;
  return mod;
}`);

  // 依赖元数据（运行时才知道谁是依赖，故单独列出）
  const meta = order.map((absPath) => {
    const mod = modules.get(absPath);
    const deps = mod.deps.map((d) => JSON.stringify(idOf(d.absPath))).join(', ');
    return `${JSON.stringify(idOf(absPath))}: [${deps}]`;
  }).join(',\n  ');
  parts.push(`var __depsMeta = {\n  ${meta}\n};`);

  // 入口：app.js 内部会在 DOMContentLoaded 时 start()
  parts.push(`__require(${JSON.stringify(idOf(ENTRY))});`);
  parts.push('})();');

  return { code: parts.join('\n'), moduleCount: order.length, order: order.map(idOf) };
}

// ══════════════════════════════════════════════════════════════════
// 3. 组装 HTML
// ══════════════════════════════════════════════════════════════════

function main() {
  if (!existsSync(TEMPLATE)) {
    console.error(`✗ 模板不存在: ${TEMPLATE}`);
    process.exit(1);
  }

  const { code, moduleCount, order } = buildScript();
  const css = readFileSync(join(ROOT, 'src', 'styles.css'), 'utf8');
  const tpl = readFileSync(TEMPLATE, 'utf8');

  // 安全检查：产物不得含外部引用（NF1 断网可用）
  const externalRefs = [];
  for (const re of [
    /<script[^>]+src=/i,
    /<link[^>]+rel=["']stylesheet["']/i,
    /@import\s+url/i,
    /https?:\/\/(?!schemas\.openxmlformats|www\.w3\.org|json-schema)/i,
  ]) {
    const m = `${css}\n${code}\n${tpl}`.match(re);
    if (m) externalRefs.push(m[0]);
  }
  if (externalRefs.length) {
    console.error('✗ 检测到外部引用，违反离线要求:');
    for (const r of externalRefs) console.error(`   ${r}`);
    process.exit(1);
  }

  // 注意：必须用「函数形式」的替换值！
  // String.replace(pattern, string) 会把替换串里的 $$ 当作转义的 $，
  // 而源码里存在 `const $$ = ...` 这类写法，用字符串替换会被悄悄改成 `$`，
  // 导致产物出现重复声明（SyntaxError）。函数形式不做任何 $ 转义处理。
  const html = tpl
    .replace('<!--CSS-->', () => `<style>\n${css}\n</style>`)
    .replace('<!--TOPBAR-->', () => '')
    .replace('<!--LEFT-->', () => '')
    .replace('<!--CENTER-->', () => '')
    .replace('<!--RIGHT-->', () => '')
    .replace('<!--DATA-->', () => '')
    .replace('<!--APP-->', () => `<script>\n${code}\n</script>`);

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, html, 'utf8');

  const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
  console.log('✅ 构建完成');
  console.log(`   产物: ${relative(ROOT, OUT)}`);
  console.log(`   大小: ${kb} KB`);
  console.log(`   模块: ${moduleCount} 个`);
  for (const m of order) console.log(`     · ${m}`);
}

try {
  main();
} catch (e) {
  console.error('✗ 构建失败:', e.message);
  process.exit(1);
}
