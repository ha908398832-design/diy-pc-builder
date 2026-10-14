/**
 * CSV 导入逻辑测试（T2.10 / PRD M2-1 ~ M2-7）
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseCsv, extractFieldKey, autoMapColumns, convertValue, rowToRecord,
  validateRecord, buildImportReport, mergeRecords, stripCustom, buildTemplateCsv,
} from '../src/core/csv.js';
import { allFieldsOf, requiredKeysOf } from '../schema/fields.js';
import { makeCpu, makeMb } from './fixtures/hardware.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ══════════════════════════════════════════════════════════════════
// 解析
// ══════════════════════════════════════════════════════════════════

test('parseCsv：处理引号、逗号、换行、BOM、CRLF', () => {
  const rows = parseCsv('\uFEFFa,b,c\r\n1,"x,y",3\r\n"l1\nl2",2,3\r\n');
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], ['a', 'b', 'c']);
  assert.deepEqual(rows[1], ['1', 'x,y', '3']);
  assert.deepEqual(rows[2], ['l1\nl2', '2', '3']);
});

test('parseCsv：双引号转义与空行过滤', () => {
  const rows = parseCsv('a,b\n"say ""hi""",2\n\n,,\n');
  assert.equal(rows.length, 2);
  assert.equal(rows[1][0], 'say "hi"');
});

test('extractFieldKey：从可读表头提取字段名', () => {
  assert.equal(extractFieldKey('socket[必填] 插槽｜取值: AM4 / AM5'), 'socket');
  assert.equal(extractFieldKey('height_mm[条件必填] (mm) 风冷高度'), 'height_mm');
  assert.equal(extractFieldKey('price (元) 参考价｜本期不使用，可留空'), 'price');
});

// ══════════════════════════════════════════════════════════════════
// 列映射（M2-2）
// ══════════════════════════════════════════════════════════════════

test('autoMapColumns：识别三行模板结构（用第 2 行字段名）', () => {
  const csv = [
    'id[必填] 标识,category[必填] 品类,socket[必填] 插槽',
    'id,category,socket',
    'cpu-x,cpu,AM5',
  ].join('\n');
  const rows = parseCsv(csv);
  const { mapping, hasSampleRow } = autoMapColumns(rows, 'cpu');
  assert.deepEqual(mapping, ['id', 'category', 'socket']);
  assert.equal(hasSampleRow, true, '应识别出有示例行');
});

test('autoMapColumns：普通 CSV（仅一行表头）也能映射', () => {
  const csv = [
    'id,category,socket,cores',
    'cpu-x,cpu,AM5,8',
  ].join('\n');
  const rows = parseCsv(csv);
  const { mapping, hasSampleRow } = autoMapColumns(rows, 'cpu');
  assert.deepEqual(mapping, ['id', 'category', 'socket', 'cores']);
  assert.equal(hasSampleRow, false);
});

test('autoMapColumns：无法识别的列映射为 null', () => {
  const csv = [
    'id,category,socket,我的自定义列',
    'cpu-x,cpu,AM5,xxx',
  ].join('\n');
  const { mapping } = autoMapColumns(parseCsv(csv), 'cpu');
  assert.equal(mapping[3], null, '未知列应为 null');
});

test('autoMapColumns：用中文 label 兜底匹配', () => {
  const csv = [
    'id,category,插槽,核心数',
    'cpu-x,cpu,AM5,8',
  ].join('\n');
  const { mapping } = autoMapColumns(parseCsv(csv), 'cpu');
  assert.equal(mapping[2], 'socket', '"插槽" 应映射到 socket');
  assert.equal(mapping[3], 'cores', '"核心数" 应映射到 cores');
});

// ══════════════════════════════════════════════════════════════════
// 值转换
// ══════════════════════════════════════════════════════════════════

test('convertValue：布尔支持 是/否、true/false、1/0', () => {
  const def = { type: 'boolean' };
  assert.equal(convertValue('是', 'igpu', def), true);
  assert.equal(convertValue('否', 'igpu', def), false);
  assert.equal(convertValue('true', 'igpu', def), true);
  assert.equal(convertValue('FALSE', 'igpu', def), false);
  assert.equal(convertValue('1', 'igpu', def), true);
  assert.equal(convertValue('0', 'igpu', def), false);
  // 无法识别时返回错误标记而非静默 false
  const bad = convertValue('也许', 'igpu', def);
  assert.ok(bad.__error, '无法识别的布尔值应报错');
});

test('convertValue：数组用分号分隔（字符串数组与数字数组）', () => {
  assert.deepEqual(convertValue('AM4;AM5;LGA1700', 'sockets', { type: 'string[]' }), ['AM4', 'AM5', 'LGA1700']);
  assert.deepEqual(convertValue('120;240;360', 'radiatorSupport', { type: 'number[]' }), [120, 240, 360]);
  assert.deepEqual(convertValue('', 'sockets', { type: 'string[]' }), []);
});

test('convertValue：数字与非法数字', () => {
  assert.equal(convertValue('120', 'tdp', { type: 'number' }), 120);
  assert.equal(convertValue('4.2', 'baseClock', { type: 'number' }), 4.2);
  const bad = convertValue('一百', 'tdp', { type: 'number' });
  assert.ok(bad.__error, '非数字应报错');
});

test('rowToRecord：整行转换', () => {
  const mapping = ['id', 'category', 'socket', 'igpu', 'memoryTypes'];
  const cells = ['cpu-x', 'cpu', 'AM5', '是', 'DDR5;DDR4'];
  const { record, errors } = rowToRecord(cells, mapping, 'cpu');
  assert.equal(record.id, 'cpu-x');
  assert.equal(record.category, 'cpu');
  assert.equal(record.socket, 'AM5');
  assert.equal(record.igpu, true);
  assert.deepEqual(record.memoryTypes, ['DDR5', 'DDR4']);
  assert.deepEqual(errors, []);
});

// ══════════════════════════════════════════════════════════════════
// 记录校验（M2-3）
// ══════════════════════════════════════════════════════════════════

test('validateRecord：完整合法记录无错', () => {
  const rec = makeCpu({ id: 'cpu-ok' });
  const { errors } = validateRecord(rec, 'cpu');
  assert.deepEqual(errors, [], `合法 CPU 不应报错: ${errors.join('; ')}`);
});

test('validateRecord：缺必填字段报错', () => {
  const rec = makeCpu({ id: 'cpu-x' });
  delete rec.socket;
  const { errors } = validateRecord(rec, 'cpu');
  assert.ok(errors.some((e) => e.includes('socket')), `应报 socket 缺失，实际: ${errors.join('; ')}`);
});

test('validateRecord：枚举越界报错', () => {
  const rec = makeCpu({ id: 'cpu-x', socket: 'am5' });
  const { errors } = validateRecord(rec, 'cpu');
  assert.ok(errors.some((e) => e.includes('不合法')), '应报枚举越界');
});

test('validateRecord：数值越界报错', () => {
  const rec = makeCpu({ id: 'cpu-x', cores: 999 });
  const { errors } = validateRecord(rec, 'cpu');
  assert.ok(errors.some((e) => e.includes('超出范围')), '应报数值越界');
});

test('validateRecord：未知字段仅警告不报错', () => {
  const rec = makeCpu({ id: 'cpu-x', 我的字段: 1 });
  const { errors, warnings } = validateRecord(rec, 'cpu');
  assert.deepEqual(errors, []);
  assert.ok(warnings.some((w) => w.includes('未知字段')));
});

// ══════════════════════════════════════════════════════════════════
// 导入报告（M2-3）
// ══════════════════════════════════════════════════════════════════

/**
 * CPU 的全部必填字段（顺序固定），用于拼装合法 CSV 行
 * 显式列出，避免测试数据漏字段导致「测的是数据错误而不是逻辑」
 */
const CPU_COLS = [
  'id', 'category', 'brand', 'name', 'aliases', 'condition',
  'socket', 'cores', 'threads', 'baseClock', 'boostClock',
  'tdp', 'maxPower', 'memoryTypes', 'maxMemorySpeed',
  'igpu', 'gameScore', 'productivityScore',
];

/** 生成一行合法的 CPU CSV（可覆盖任意列） */
function cpuCsvRow(over = {}) {
  const base = {
    id: 'cpu-x', category: 'cpu', brand: '测试', name: '测试CPU',
    aliases: 'test;测试', condition: 'new',
    socket: 'AM5', cores: 8, threads: 16, baseClock: 4.2, boostClock: 5.0,
    tdp: 120, maxPower: 162, memoryTypes: 'DDR5', maxMemorySpeed: 5200,
    igpu: '是', gameScore: 100, productivityScore: 88,
  };
  const merged = { ...base, ...over };
  return CPU_COLS.map((c) => merged[c]).join(',');
}

/** 生成完整 CPU CSV 文本 */
function cpuCsv(...rows) {
  return [CPU_COLS.join(','), ...rows].join('\n');
}

test('buildImportReport：区分可用/非法记录', () => {
  const csv = cpuCsv(
    cpuCsvRow({ id: 'cpu-good' }),
    cpuCsvRow({ id: 'cpu-bad', socket: 'am5wrong' }),      // 枚举越界
    cpuCsvRow({ id: 'cpu-missing', cores: '', threads: '' }), // 缺必填
  );

  const report = buildImportReport(csv, 'cpu');
  assert.equal(report.summary.valid, 1, `应有 1 条可用，实际 ${report.summary.valid}（invalid=${JSON.stringify(report.invalid.map(i => i.errors))}）`);
  assert.equal(report.summary.invalid, 2, `应有 2 条非法，实际 ${report.summary.invalid}`);
  assert.equal(report.valid[0].id, 'cpu-good');
  assert.ok(
    report.invalid.some((i) => i.errors.some((e) => e.includes('不合法'))),
    '应有一条报枚举越界',
  );
  assert.ok(
    report.invalid.some((i) => i.errors.some((e) => e.includes('缺必填'))),
    '应有一条报缺必填',
  );
});

test('buildImportReport：检出与现有库的重名', () => {
  const existing = [makeCpu({ id: 'cpu-existing' })];
  const csv = cpuCsv(
    cpuCsvRow({ id: 'cpu-existing' }),
    cpuCsvRow({ id: 'cpu-new' }),
  );

  const report = buildImportReport(csv, 'cpu', existing);
  assert.equal(report.summary.duplicate, 1, '应检出 1 条重名');
  assert.equal(report.summary.valid, 1, '应有 1 条可用');
  assert.equal(report.duplicates[0].id, 'cpu-existing');
  assert.equal(report.duplicates[0].inFile, false, '应标记为与库重名而非文件内重复');
});

test('buildImportReport：检出文件内部重复', () => {
  const csv = cpuCsv(
    cpuCsvRow({ id: 'cpu-dup' }),
    cpuCsvRow({ id: 'cpu-dup' }),
  );
  const report = buildImportReport(csv, 'cpu');
  assert.equal(report.summary.duplicate, 1);
  assert.equal(report.duplicates[0].inFile, true);
});

test('buildImportReport：三行模板结构下示例行不被当成数据', () => {
  // 表头 + 字段名 + 示例行 + 一条真实数据
  const csv = [
    CPU_COLS.join(','),
    CPU_COLS.join(','),
    cpuCsvRow({ id: 'cpu-sample' }),
    cpuCsvRow({ id: 'cpu-real' }),
  ].join('\n');

  const report = buildImportReport(csv, 'cpu');
  assert.equal(report.summary.total, 1, `应只识别 1 条真实数据，实际 ${report.summary.total}`);
  assert.equal(report.valid[0].id, 'cpu-real');
  assert.equal(
    report.valid.some((r) => r.id === 'cpu-sample'), false,
    '示例行不应被导入',
  );
});

test('buildImportReport：空 CSV 不崩溃', () => {
  const report = buildImportReport('', 'cpu');
  assert.equal(report.summary.total, 0);
  assert.ok(report.warnings.length > 0);
});

test('buildImportReport：未映射列会给出提示', () => {
  const csv = [
    [...CPU_COLS, '莫名其妙的列'].join(','),
    cpuCsvRow() + ',zzz',
  ].join('\n');
  const report = buildImportReport(csv, 'cpu');
  assert.ok(
    report.warnings.some((w) => w.includes('未匹配')),
    `应提示未匹配列，实际: ${report.warnings.join('; ')}`,
  );
});

test('buildImportReport：使用项目真实模板时不会把示例行当成数据', () => {
  const p = join(ROOT, 'csv-templates', 'cpu.csv');
  if (!existsSync(p)) return;
  const report = buildImportReport(readFileSync(p, 'utf8'), 'cpu');
  assert.equal(report.summary.total, 0, '模板只有示例行，不应产出任何记录');
});

// ══════════════════════════════════════════════════════════════════
// 合并策略（M2-4 / M2-5）
// ══════════════════════════════════════════════════════════════════

function reportWithOneDuplicate() {
  const existing = [makeCpu({ id: 'cpu-dup', name: '原型号' })];
  const csv = cpuCsv(
    cpuCsvRow({ id: 'cpu-new' }),
    cpuCsvRow({ id: 'cpu-dup' }),
  );
  return { existing, report: buildImportReport(csv, 'cpu', existing) };
}

test('mergeRecords：skip 策略跳过重名', () => {
  const { existing, report } = reportWithOneDuplicate();
  const { merged, added, skipped } = mergeRecords(existing, report, 'skip');
  assert.equal(added, 1, '应新增 1 条');
  assert.equal(skipped, 1, '应跳过 1 条重名');
  assert.equal(merged.length, 2);
  assert.equal(merged.find((r) => r.id === 'cpu-dup').name, '原型号', '原记录应保持');
});

test('mergeRecords：overwrite 策略覆盖重名', () => {
  const { existing, report } = reportWithOneDuplicate();
  const { merged, overwritten } = mergeRecords(existing, report, 'overwrite');
  assert.equal(overwritten, 1, '应覆盖 1 条');
  assert.equal(merged.length, 2, '总数不应增加');
  const dup = merged.find((r) => r.id === 'cpu-dup');
  assert.equal(dup.custom, true, '覆盖后应标记为自定义');
  assert.notEqual(dup.name, '原型号', '应被导入值替换');
});

test('mergeRecords：keep-both 策略重命名并存', () => {
  const { existing, report } = reportWithOneDuplicate();
  const { merged, renamed, added, overwritten } = mergeRecords(existing, report, 'keep-both');
  assert.equal(renamed, 1, '应重命名 1 条');
  // 新增 = 1 条无冲突记录 + 1 条改名的并存副本
  assert.equal(added, 2, '并存副本与无冲突记录都算新增');
  assert.equal(overwritten, 0, '并存策略不应覆盖任何记录');
  assert.equal(merged.length, 3, '原记录 + 新记录 + 并存副本');
  const copy = merged.find((r) => r.id.startsWith('cpu-dup-'));
  assert.ok(copy, '应存在带后缀的副本');
  assert.notEqual(copy.id, 'cpu-dup', '副本 id 必须不同');
  assert.equal(merged.find((r) => r.id === 'cpu-dup').name, '原型号', '原记录应保留');
});

test('mergeRecords：keep-both 多次导入时 id 不冲突', () => {
  const existing = [makeCpu({ id: 'cpu-dup' })];
  const csv = cpuCsv(cpuCsvRow({ id: 'cpu-dup' }));

  const r1 = buildImportReport(csv, 'cpu', existing);
  const m1 = mergeRecords(existing, r1, 'keep-both').merged;
  const r2 = buildImportReport(csv, 'cpu', m1);
  const m2 = mergeRecords(m1, r2, 'keep-both').merged;

  const ids = m2.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, `多次并存后 id 仍应唯一: ${ids.join(', ')}`);
  assert.equal(m2.length, 3, '共 3 条：原记录 + 两次副本');
});

test('mergeRecords：导入的记录都带 custom 标记（M2-5）', () => {
  const csv = cpuCsv(cpuCsvRow({ id: 'cpu-new' }));
  const report = buildImportReport(csv, 'cpu', []);
  const { merged } = mergeRecords([], report, 'skip');
  assert.equal(merged[0].custom, true);
  assert.ok(stripCustom(merged).length === 0, 'stripCustom 应移除自定义记录');
});

test('mergeRecords：导入的数据能直接参与规则判断（M2-6）', async () => {
  const { checkCompatibility } = await import('../src/core/rules.js');
  const existing = [makeMb({ id: 'mb-real', socket: 'AM5', memoryType: 'DDR5' })];
  const csv = cpuCsv(cpuCsvRow({ id: 'cpu-imported', socket: 'LGA1700' }));
  const report = buildImportReport(csv, 'cpu', []);
  const { merged } = mergeRecords([], report, 'skip');

  const byId = new Map();
  for (const r of [...existing, ...merged]) byId.set(r.id, r);

  const res = checkCompatibility({
    config: { cpu: 'cpu-imported', motherboard: 'mb-real' },
    byId,
  });
  assert.ok(
    res.findings.some((f) => f.id === 'E1'),
    '导入的 CPU（LGA1700）配 AM5 主板应触发 E1，证明导入数据参与兼容判断',
  );
});

test('mergeRecords：空报告不改变原库', () => {
  const existing = [makeCpu({ id: 'cpu-a' })];
  const report = buildImportReport('', 'cpu', existing);
  const { merged, added } = mergeRecords(existing, report, 'skip');
  assert.equal(added, 0);
  assert.equal(merged.length, 1);
});

// ══════════════════════════════════════════════════════════════════
// 模板生成（M2-1）
// ══════════════════════════════════════════════════════════════════

test('buildTemplateCsv：表头含字段名、[必填] 标记与单位', () => {
  const csv = buildTemplateCsv('cpu');
  const rows = parseCsv(csv);
  assert.equal(rows.length, 2, '空白模板应只有表头 + 字段名两行');
  const fields = allFieldsOf('cpu');
  assert.equal(rows[0].length, fields.length);
  assert.deepEqual(rows[1], fields.map((f) => f.key));
  const requiredCount = requiredKeysOf('cpu').length;
  assert.equal(rows[0].filter((h) => h.includes('[必填]')).length, requiredCount);
});

test('buildTemplateCsv：8 个品类都能生成且可被自己解析', () => {
  for (const cat of ['cpu', 'motherboard', 'gpu', 'memory', 'psu', 'case', 'cooler', 'storage']) {
    const csv = buildTemplateCsv(cat);
    const rows = parseCsv(csv);
    assert.equal(rows.length, 2, `${cat} 模板行数异常`);
    const { mapping } = autoMapColumns(rows, cat);
    const fields = allFieldsOf(cat);
    assert.deepEqual(mapping, fields.map((f) => f.key), `${cat} 模板字段名与 fields.js 不一致`);
    // 空模板导入不应产生记录
    const report = buildImportReport(csv, cat);
    assert.equal(report.summary.total, 0, `${cat} 空模板不应产出记录`);
  }
});

test('buildTemplateCsv：生成的模板与仓库中的模板字段一致', () => {
  for (const cat of ['cpu', 'motherboard', 'gpu', 'memory', 'psu', 'case', 'cooler', 'storage']) {
    const fileName = { cpu: 'cpu.csv', motherboard: 'motherboard.csv', gpu: 'gpu.csv', memory: 'memory.csv', psu: 'psu.csv', case: 'case.csv', cooler: 'cooler.csv', storage: 'storage.csv' }[cat];
    const p = join(ROOT, 'csv-templates', fileName);
    if (!existsSync(p)) continue;
    const disk = parseCsv(readFileSync(p, 'utf8'));
    const gen = parseCsv(buildTemplateCsv(cat));
    assert.deepEqual(gen[1], disk[1], `${cat} 字段名行应与仓库模板一致`);
  }
});
