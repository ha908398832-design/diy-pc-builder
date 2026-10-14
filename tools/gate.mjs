#!/usr/bin/env node
/**
 * 全量门禁：一条命令跑完所有检查（对应 PRD 第八部分阶段 6）
 *
 * 步骤：
 *   1. 生成 Schema 与 CSV 模板（保证规范与模板同步）
 *   2. 生成数据包（保证产物用最新数据）
 *   3. 校验 8 品类数据（0 错误、数量达标、交叉一致性）
 *   4. 构建单文件产物
 *   5. 无价格门禁（A15）
 *   6. 全量单元/集成/产物测试
 *
 * 用法: node tools/gate.mjs [--skip-tests]
 * 退出码: 0 = 全部通过
 */

import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NODE = process.execPath;
const skipTests = process.argv.includes('--skip-tests');

const steps = [
  { name: '生成 JSON Schema', cmd: ['tools/gen-schema.mjs'], quiet: true },
  { name: '生成 CSV 模板', cmd: ['tools/gen-csv-templates.mjs'], quiet: true },
  { name: '生成数据包', cmd: ['tools/gen-data-bundle.mjs'], quiet: true },
  { name: '校验硬件数据', cmd: ['tools/validate-data.mjs'], quiet: false, expectLast: /校验通过：0 错误/ },
  { name: '构建单文件产物', cmd: ['tools/build.mjs'], quiet: true },
  { name: '构建可复现性', cmd: ['tools/check-reproducible.mjs'], quiet: false, expectLast: /构建可复现/ },
  { name: '无价格门禁 (A15)', cmd: ['tools/check-no-price.mjs'], quiet: false, expectLast: /门禁通过/ },
];

let failed = 0;
const results = [];

for (const step of steps) {
  process.stdout.write(`[门禁] ${step.name} ... `);
  try {
    const out = execFileSync(NODE, step.cmd.map((c) => join(ROOT, c)), {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (step.expectLast) {
      const tail = out.trim().split('\n').slice(-6).join('\n');
      if (!step.expectLast.test(out)) {
        console.log('❌');
        console.log(tail);
        failed++;
        results.push({ name: step.name, ok: false });
        continue;
      }
    }
    console.log('✅');
    results.push({ name: step.name, ok: true });
    if (!step.quiet) {
      const tail = out.trim().split('\n').filter((l) => l.trim()).slice(-3);
      for (const l of tail) console.log(`         ${l}`);
    }
  } catch (e) {
    console.log('❌');
    const out = `${e.stdout || ''}${e.stderr || ''}`.trim();
    console.log(out.split('\n').slice(-15).map((l) => `         ${l}`).join('\n'));
    failed++;
    results.push({ name: step.name, ok: false });
  }
}

if (!skipTests) {
  process.stdout.write('[门禁] 全量测试 ... ');
  try {
    // 找不到文件时 execFileSync 会抛错，这里显式列出测试文件
    const files = readdirSync(join(ROOT, 'tests'))
      .filter((f) => f.endsWith('.test.mjs'))
      .map((f) => join(ROOT, 'tests', f));
    const out = execFileSync(NODE, ['--test', ...files], {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    const pass = (out.match(/^ℹ pass (\d+)/m) || [])[1];
    const fail = (out.match(/^ℹ fail (\d+)/m) || [])[1];
    if (Number(fail) > 0) {
      console.log('❌');
      console.log(out.split('\n').filter((l) => /✖|fail/.test(l)).slice(0, 20).map((l) => `         ${l}`).join('\n'));
      failed++;
      results.push({ name: '全量测试', ok: false });
    } else {
      console.log(`✅  ${pass} 项通过`);
      results.push({ name: '全量测试', ok: true, pass: Number(pass) });
    }
  } catch (e) {
    console.log('❌');
    const out = `${e.stdout || ''}${e.stderr || ''}`;
    console.log(out.split('\n').filter((l) => /✖|Error|fail/.test(l)).slice(0, 25).map((l) => `         ${l}`).join('\n'));
    failed++;
    results.push({ name: '全量测试', ok: false });
  }
}

console.log('\n' + '═'.repeat(50));
if (failed === 0) {
  console.log('✅ 全部门禁通过');
  for (const r of results) {
    console.log(`   ✅ ${r.name}${r.pass ? `（${r.pass} 项）` : ''}`);
  }
  process.exit(0);
} else {
  console.log(`❌ ${failed} 个门禁未通过`);
  for (const r of results) {
    console.log(`   ${r.ok ? '✅' : '❌'} ${r.name}`);
  }
  process.exit(1);
}
