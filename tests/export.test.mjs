/**
 * 导出模块测试（T4.4 / PRD M9-1 ~ M9-7、A11）
 *
 * 重点：
 *   1. 产出的 xlsx 必须是**结构合法的 zip**（本地头/中央目录/结束记录一致，CRC 正确）
 *   2. 导出内容含型号、数量、兼容性备注，但**绝不含价格与合计**（M9-7 / A15）
 *   3. CSV / 文本格式可用且 Excel 友好
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  crc32, zipStored, sheetXml, buildXlsxBlob, buildRows, toCsv, toText, buildExport,
} from '../src/ui/export.js';
import { checkCompatibility } from '../src/core/rules.js';
import { compatibleBuild, makeGpu, makeStorage, makeIndex, makeCpu, makeMb, makeMem, makePsu, makeCase, makeCooler } from './fixtures/hardware.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 跑一次真实检查，得到 result */
function runBuild(overrides = {}) {
  const b = compatibleBuild();
  const resolved = { ...b.resolved, ...overrides };
  const config = { ...b.config };
  const byId = makeIndex(Object.values(resolved).flat().filter(Boolean));
  const result = checkCompatibility({ resolved, config, byId });
  return { b, resolved, config, result };
}

// ══════════════════════════════════════════════════════════════════
// CRC32
// ══════════════════════════════════════════════════════════════════

test('crc32：已知向量的校验值正确', () => {
  // "123456789" 的 CRC32 = 0xCBF43926（标准测试向量）
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  assert.equal(crc32(new Uint8Array([])), 0);
  // 与 zlib 实现无关，仅验证确定性与已知值
  assert.equal(crc32(new TextEncoder().encode('a')), 0xe8b7be43);
});

// ══════════════════════════════════════════════════════════════════
// ZIP 结构
// ══════════════════════════════════════════════════════════════════

/** 解析 zip，返回条目列表（用于验证结构） */
function readZip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = [];
  let i = 0;

  // 扫描本地文件头
  while (i + 4 <= bytes.length) {
    const sig = dv.getUint32(i, true);
    if (sig === 0x04034b50) {
      const method = dv.getUint16(i + 8, true);
      const crc = dv.getUint32(i + 14, true);
      const compSize = dv.getUint32(i + 18, true);
      const uncompSize = dv.getUint32(i + 22, true);
      const nameLen = dv.getUint16(i + 26, true);
      const extraLen = dv.getUint16(i + 28, true);
      const name = new TextDecoder().decode(bytes.subarray(i + 30, i + 30 + nameLen));
      const dataStart = i + 30 + nameLen + extraLen;
      const data = bytes.subarray(dataStart, dataStart + compSize);
      entries.push({ name, method, crc, compSize, uncompSize, data, actualCrc: crc32(data) });
      i = dataStart + compSize;
      continue;
    }
    break;
  }

  // 结束记录
  let eocd = null;
  for (let j = bytes.length - 22; j >= 0; j--) {
    if (dv.getUint32(j, true) === 0x06054b50) {
      eocd = {
        count: dv.getUint16(j + 10, true),
        centralSize: dv.getUint32(j + 12, true),
        centralOffset: dv.getUint32(j + 16, true),
      };
      break;
    }
  }
  return { entries, eocd };
}

test('zipStored：产出结构合法的 zip（本地头/中央目录/EOCD 一致）', () => {
  const files = [
    { name: 'a.txt', data: new TextEncoder().encode('hello') },
    { name: 'dir/b.xml', data: new TextEncoder().encode('<x>1</x>') },
  ];
  const bytes = zipStored(files);
  const { entries, eocd } = readZip(bytes);

  assert.equal(entries.length, 2, '应有 2 个条目');
  assert.deepEqual(entries.map((e) => e.name), ['a.txt', 'dir/b.xml']);
  assert.ok(eocd, '应存在 EOCD 结束记录');
  assert.equal(eocd.count, 2, 'EOCD 条目数应匹配');
  assert.ok(eocd.centralSize > 0, '中央目录大小应 > 0');

  // 每个条目：stored 模式、大小一致、CRC 与内容匹配
  for (const e of entries) {
    assert.equal(e.method, 0, `${e.name} 应为 stored 模式`);
    assert.equal(e.compSize, e.uncompSize, `${e.name} 压缩前后大小应相同`);
    assert.equal(e.crc, e.actualCrc, `${e.name} CRC 应与内容实际 CRC 一致`);
  }
});

test('zipStored：空文件列表也能生成合法 zip', () => {
  const bytes = zipStored([]);
  const { entries, eocd } = readZip(bytes);
  assert.equal(entries.length, 0);
  assert.ok(eocd, '空 zip 也应有 EOCD');
  assert.equal(eocd.count, 0);
});

test('zipStored：二进制内容原样保留（含 0x00 与高位字节）', () => {
  const data = new Uint8Array([0, 1, 2, 255, 254, 0, 128]);
  const bytes = zipStored([{ name: 'b.bin', data }]);
  const { entries } = readZip(bytes);
  assert.deepEqual([...entries[0].data], [...data], '二进制内容不应被改动');
});

// ══════════════════════════════════════════════════════════════════
// xlsx 内容
// ══════════════════════════════════════════════════════════════════

test('buildXlsxBlob：包含 xlsx 必需的全部部件', () => {
  const bytes = buildXlsxBlob([['类别', '型号'], ['CPU', 'R7 7800X3D']]);
  const { entries } = readZip(bytes);
  const names = entries.map((e) => e.name);
  for (const required of [
    '[Content_Types].xml',
    '_rels/.rels',
    'xl/workbook.xml',
    'xl/_rels/workbook.xml.rels',
    'xl/worksheets/sheet1.xml',
  ]) {
    assert.ok(names.includes(required), `xlsx 应包含 ${required}`);
  }
});

test('buildXlsxBlob：工作表 XML 内容正确且转义', () => {
  const bytes = buildXlsxBlob([['型号', 'A&B'], ['x<y', 123]]);
  const { entries } = readZip(bytes);
  const sheet = new TextDecoder().decode(
    entries.find((e) => e.name === 'xl/worksheets/sheet1.xml').data,
  );
  assert.ok(sheet.includes('A&amp;B'), '& 应转义');
  assert.ok(sheet.includes('x&lt;y'), '< 应转义');
  assert.ok(sheet.includes('<v>123</v>'), '数字应作为数值单元格');
  assert.ok(sheet.includes('t="inlineStr"'), '文本应为 inlineStr');
});

test('sheetXml：列名从 A 递增，超过 Z 时正确进位', () => {
  const row = Array.from({ length: 28 }, (_, i) => `c${i}`);
  const xml = sheetXml([row]);
  assert.ok(xml.includes('r="A1"'), '第 1 列应为 A');
  assert.ok(xml.includes('r="Z1"'), '第 26 列应为 Z');
  assert.ok(xml.includes('r="AA1"'), '第 27 列应为 AA');
  assert.ok(xml.includes('r="AB1"'), '第 28 列应为 AB');
});

test('sheetXml：剔除 XML 非法控制字符（避免文件损坏）', () => {
  const xml = sheetXml([['正常\x00文本\x08']]);
  assert.ok(!xml.includes('\x00'), '应剔除 \\x00');
  assert.ok(!xml.includes('\x08'), '应剔除 \\x08');
  assert.ok(xml.includes('正常文本'), '正常字符应保留');
});

// ══════════════════════════════════════════════════════════════════
// 导出内容（M9-2 / M9-3 / M9-7）
// ══════════════════════════════════════════════════════════════════

test('buildRows：表头含类别/型号/品牌/数量，可含参数与兼容性备注', () => {
  const { resolved, result } = runBuild();
  const { rows } = buildRows(resolved, result, { includeParams: true, includeNotes: true });
  assert.deepEqual(rows[0].slice(0, 4), ['类别', '型号', '品牌', '数量']);
  assert.ok(rows[0].includes('关键参数'));
  assert.ok(rows[0].includes('兼容性备注'));
  assert.ok(rows.length >= 8, '8 个品类都应有行');
});

test('buildRows：8 个品类齐全且每行数量为 1', () => {
  const { resolved, result } = runBuild();
  const { rows } = buildRows(resolved, result, {});
  const body = rows.slice(1);
  assert.equal(body.length, 8, '应导出 8 行（8 个品类各一件）');
  for (const r of body) assert.equal(r[3], 1, '数量应为 1');
  const cats = body.map((r) => r[0]);
  for (const label of ['CPU', '主板', '显卡', '内存', '电源', '机箱', '散热器', '硬盘']) {
    assert.ok(cats.includes(label), `应包含 ${label}`);
  }
});

test('buildRows：含多件硬盘时逐件成行', () => {
  const b = compatibleBuild();
  const s2 = makeStorage({ id: 'ssd-2', name: '第二块盘' });
  const resolved = { ...b.resolved, storage: [b.ssd, s2] };
  const byId = makeIndex([...Object.values(resolved).flat().filter(Boolean)]);
  const result = checkCompatibility({ resolved, config: b.config, byId });
  const { rows } = buildRows(resolved, result, {});
  const hddRows = rows.slice(1).filter((r) => r[0] === '硬盘');
  assert.equal(hddRows.length, 2, '两块硬盘应两行');
  assert.ok(hddRows.some((r) => r[1] === '第二块盘'));
});

test('buildRows：未选的品类不出现在清单中', () => {
  const b = compatibleBuild();
  const resolved = { cpu: b.cpu, motherboard: b.mb, gpu: null, memory: null, psu: null, cooler: null, case: null, storage: [] };
  const result = checkCompatibility({ resolved, config: {}, byId: makeIndex([b.cpu, b.mb]) });
  const { rows } = buildRows(resolved, result, {});
  assert.equal(rows.length - 1, 2, '只应导出已选的 2 件');
  assert.ok(!rows.slice(1).some((r) => r[0] === '显卡'), '未选的显卡不应出现');
});

test('buildRows：兼容性备注带规则编号与 ⚠ 标记', () => {
  const b = compatibleBuild();
  const mbAm4 = makeMb({ id: 'mb-am4', name: 'B450M 迫击炮', socket: 'AM4', chipset: 'B450', memoryType: 'DDR4' });
  const cpuIntel = makeCpu({ id: 'cpu-intel', name: 'i5-14600KF', socket: 'LGA1700', igpu: false });
  const mem = makeMem({ id: 'mem-d4', memoryType: 'DDR4', speed: 3200 });
  const cooler = makeCooler({ id: 'c', sockets: ['AM4', 'LGA1700'] });

  const resolved = { cpu: cpuIntel, motherboard: mbAm4, memory: mem, cooler, gpu: null, psu: null, case: null, storage: [] };
  const byId = makeIndex([cpuIntel, mbAm4, mem, cooler]);
  const result = checkCompatibility({ resolved, config: {}, byId });

  const { rows } = buildRows(resolved, result, { includeNotes: true });
  const cpuRow = rows.slice(1).find((r) => r[0] === 'CPU');
  const noteIdx = rows[0].indexOf('兼容性备注');
  assert.ok(cpuRow[noteIdx].includes('E1'), 'CPU 行备注应含 E1');
  assert.ok(cpuRow[noteIdx].includes('⚠'), '应带警告标记');
});

test('buildRows：无误配置的备注为 ✅ 无冲突', () => {
  const { resolved, result } = runBuild();
  const { rows } = buildRows(resolved, result, { includeNotes: true });
  const noteIdx = rows[0].indexOf('兼容性备注');
  const cpuRow = rows.slice(1).find((r) => r[0] === 'CPU');
  // 基准配置无 error/warn（可能有 info 但不写入清单）
  assert.ok(cpuRow[noteIdx].includes('✅'), `基准配置应标无冲突，实际 ${cpuRow[noteIdx]}`);
});

test('buildRows：二手件触发风险提示（M9-5）', () => {
  const b = compatibleBuild();
  const mining = makeGpu({ id: 'gpu-mining', name: 'RX 5700XT', condition: 'mining' });
  const resolved = { ...b.resolved, gpu: mining };
  const byId = makeIndex([...Object.values(resolved).flat().filter(Boolean)]);
  const result = checkCompatibility({ resolved, config: b.config, byId });

  const { notes, usedItems } = buildRows(resolved, result, { includeUsedWarning: true });
  assert.equal(usedItems.length, 1, '应识别出 1 件二手');
  assert.ok(notes.some((n) => n.includes('风险提示')), '应生成风险提示');
  assert.ok(notes.some((n) => n.includes('矿卡')), '应说明是矿卡');
});

test('buildRows：关闭二手提示后不输出（勾选项生效）', () => {
  const b = compatibleBuild();
  const mining = makeGpu({ id: 'g', condition: 'mining' });
  const resolved = { ...b.resolved, gpu: mining };
  const byId = makeIndex([...Object.values(resolved).flat().filter(Boolean)]);
  const result = checkCompatibility({ resolved, config: b.config, byId });
  const { notes } = buildRows(resolved, result, { includeUsedWarning: false });
  assert.ok(!notes.some((n) => n.includes('风险提示')), '关闭后不应输出风险提示');
});

test('buildRows：功耗参考写入说明', () => {
  const { resolved, result } = runBuild();
  const { notes } = buildRows(resolved, result, {});
  assert.ok(notes.some((n) => n.includes('整机峰值')), '应含功耗参考');
  assert.ok(notes.some((n) => n.includes('建议电源')), '应含建议电源');
});

// ══════════════════════════════════════════════════════════════════
// A15：导出不含价格（M9-7）
// ══════════════════════════════════════════════════════════════════

test('A15：导出行与说明中不含价格、金额或合计', () => {
  const b = compatibleBuild();
  // 即使数据带 price 也不得进入导出
  const resolved = {
    cpu: { ...b.cpu, price: 2599 },
    motherboard: { ...b.mb, price: 899 },
    gpu: { ...b.gpu, price: 4299 },
    memory: { ...b.mem, price: 599 },
    psu: { ...b.psu, price: 399 },
    cooler: { ...b.cooler, price: 199 },
    case: { ...b.kase, price: 299 },
    storage: [{ ...b.ssd, price: 599 }],
  };
  const byId = makeIndex(Object.values(resolved).flat().filter(Boolean));
  const result = checkCompatibility({ resolved, config: b.config, byId });

  for (const format of ['xlsx', 'csv', 'text']) {
    const out = buildExport(resolved, result, { format });
    const text = `${out.preview}\n${out.rows.flat().join('|')}\n${out.notes.join('|')}`;
    assert.ok(!text.includes('¥'), `${format} 不应含 ¥`);
    assert.ok(!/价格|总价|合计|金额/.test(text), `${format} 不应含价格相关字样`);
    assert.ok(!text.includes('2599'), `${format} 不应把价格数值带出`);
    assert.ok(!text.includes('4299'), `${format} 不应把价格数值带出`);
  }
});

test('A15：xlsx 二进制内容也不含价格数值', () => {
  const b = compatibleBuild();
  const resolved = { ...b.resolved, cpu: { ...b.cpu, price: 8888 } };
  const byId = makeIndex(Object.values(resolved).flat().filter(Boolean));
  const result = checkCompatibility({ resolved, config: b.config, byId });
  const bytes = buildXlsxBlob(buildRows(resolved, result, {}).rows);
  const text = new TextDecoder().decode(bytes);
  assert.ok(!text.includes('8888'), 'xlsx 内容不应含价格数值');
  assert.ok(!text.includes('¥'), 'xlsx 内容不应含 ¥');
});

// ══════════════════════════════════════════════════════════════════
// 格式
// ══════════════════════════════════════════════════════════════════

test('toCsv：含 BOM、转义引号与逗号（Excel 友好）', () => {
  const csv = toCsv([['a', 'b'], ['x,y', 'say "hi"']]);
  assert.ok(csv.startsWith('\uFEFF'), '应含 BOM 便于 Excel 识别 UTF-8');
  assert.ok(csv.includes('"x,y"'), '含逗号应加引号');
  assert.ok(csv.includes('"say ""hi"""'), '引号应双写转义');
  assert.ok(csv.includes('\r\n'), '应使用 CRLF 换行');
});

test('toText：列对齐且含说明段', () => {
  const txt = toText([['类别', '型号'], ['CPU', 'R7 7800X3D']], ['说明一', '说明二']);
  assert.ok(txt.includes('装机清单'), '应有标题');
  assert.ok(txt.includes('CPU'), '应含数据');
  assert.ok(txt.includes('说明一'), '应含说明');
  assert.ok(txt.includes('-'.repeat(10)), '应有分隔线');
});

test('buildExport：三种格式都返回文件名、预览与行数据', () => {
  const { resolved, result } = runBuild();
  for (const [format, ext] of [['xlsx', '.xlsx'], ['csv', '.csv'], ['text', '.txt']]) {
    const out = buildExport(resolved, result, { format });
    assert.equal(out.format, format);
    assert.ok(out.filename.endsWith(ext), `${format} 文件名应以 ${ext} 结尾`);
    assert.ok(out.preview.length > 0, `${format} 应有预览`);
    assert.ok(Array.isArray(out.rows) && out.rows.length > 1, `${format} 应有行数据`);
    assert.ok(out.blob, `${format} 应产出 blob/字节`);
  }
});

test('buildExport：预览受行数限制（避免超长）', () => {
  const { resolved, result } = runBuild();
  const out = buildExport(resolved, result, { format: 'text' });
  const previewLines = out.preview.split('\n');
  assert.ok(previewLines.length < 30, `预览不应过长，实际 ${previewLines.length} 行`);
});

test('buildExport：xlsx 产物可被解析为合法 zip（端到端）', () => {
  const { resolved, result } = runBuild();
  const out = buildExport(resolved, result, { format: 'xlsx' });
  assert.ok(out.bytes instanceof Uint8Array, '应提供原始字节，便于校验与复用');
  const { entries, eocd } = readZip(out.bytes);
  assert.equal(entries.length, 5, `xlsx 应有 5 个部件，实际 ${entries.length}`);
  assert.ok(eocd, '应有 EOCD');
  // 每个条目的 CRC 必须自洽，否则 Excel 会报文件损坏
  for (const e of entries) {
    assert.equal(e.crc, e.actualCrc, `${e.name} CRC 不自洽，文件会被判为损坏`);
  }
});

test('buildExport：xlsx 字节可被 Blob 包成标准 MIME 类型', () => {
  const { resolved, result } = runBuild();
  const out = buildExport(resolved, result, { format: 'xlsx' });
  assert.ok(out.blob, '应产出 blob');
  const type = out.blob.type || '';
  // Node 的 Blob 也支持 type
  assert.ok(
    type.includes('spreadsheetml.sheet') || type === '',
    `MIME 类型应为 xlsx，实际 ${type}`,
  );
});

// ══════════════════════════════════════════════════════════════════
// 真实数据端到端
// ══════════════════════════════════════════════════════════════════

test('真实数据：导出一套完整配置的各格式产物都不崩溃', () => {
  const files = { cpu: 'cpu.json', motherboard: 'motherboard.json', gpu: 'gpu.json', memory: 'memory.json', psu: 'psu.json', case: 'case.json', cooler: 'cooler.json', storage: 'storage.json' };
  const db = {};
  for (const [cat, f] of Object.entries(files)) {
    const p = join(ROOT, 'data', f);
    if (!existsSync(p)) return; // 数据未生成则跳过
    db[cat] = JSON.parse(readFileSync(p, 'utf8'));
  }

  const cpu = db.cpu.find((c) => c.socket === 'AM5' && c.igpu);
  const mb = db.motherboard.find((m) => m.socket === 'AM5' && m.memoryType === 'DDR5');
  const mem = db.memory.find((m) => m.memoryType === 'DDR5' && m.modules === 2);
  const gpu = db.gpu.find((g) => g.condition === 'new');
  const psu = db.psu.find((p) => p.wattage >= 850);
  const kase = db.case.find((c) => c.maxGpuLength >= gpu.length_mm && c.formFactors.includes(mb.formFactor));
  const cooler = db.cooler.find((c) => c.sockets.includes(cpu.socket));
  const ssd = db.storage.find((s) => s.dram);

  const resolved = { cpu, motherboard: mb, gpu, memory: mem, psu, cooler, case: kase, storage: [ssd] };
  const byId = new Map();
  for (const list of Object.values(db)) for (const r of list) byId.set(r.id, r);
  const result = checkCompatibility({ resolved, config: {}, byId });

  for (const format of ['xlsx', 'csv', 'text']) {
    const out = buildExport(resolved, result, { format });
    assert.ok(out.rows.length === 9, `${format} 应有 8 件 + 表头，实际 ${out.rows.length}`);
    assert.ok(out.preview.includes(cpu.name), `${format} 预览应含 CPU 型号`);
    assert.ok(!out.preview.includes('undefined'), `${format} 预览不应含 undefined`);
    assert.ok(!out.preview.includes('¥'), `${format} 不应含价格符号`);
  }
});
