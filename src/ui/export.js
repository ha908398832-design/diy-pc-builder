/**
 * 导出模块（PRD M9）
 *
 * 格式：xlsx / csv / text
 * 内容：型号、数量、兼容性备注、关键参数摘要、二手风险提示
 *
 * ⚠️ 本期**不含价格与合计**（PRD M9-7 / 1.5 / A11）
 *
 * XLSX 实现说明：
 *   纯 JS 生成最小合法 xlsx（zip 的 stored 模式 + CRC32），不引入任何第三方库，
 *   以维持单文件/零依赖约束。按已确认的决策，若某些软件打不开可降级为 CSV，
 *   因此界面上同时提供 CSV 选项。
 *
 * 本模块不接触 DOM（下载动作单独放在 downloadBlob，由 app.js 调用），
 * 便于在 Node 中单测产物内容与 zip 结构。
 */

import { CATEGORY_ORDER, CATEGORY_LABELS, CONDITION_LABELS } from '../core/enums.js';
import { detailValue } from './render.js';

// ══════════════════════════════════════════════════════════════════
// CRC32（xlsx 需要）
// ══════════════════════════════════════════════════════════════════

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

const utf8 = (s) => new TextEncoder().encode(s);

// ══════════════════════════════════════════════════════════════════
// 最小 ZIP（stored，无压缩）
// ══════════════════════════════════════════════════════════════════

function u16(n) { return [n & 0xff, (n >>> 8) & 0xff]; }
function u32(n) { return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]; }

/**
 * 打包为 zip（stored 模式）
 * @param {Array<{name:string, data:Uint8Array}>} files
 * @returns {Uint8Array}
 */
export function zipStored(files) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const f of files) {
    const nameBytes = utf8(f.name);
    const crc = crc32(f.data);
    const size = f.data.length;

    // 本地文件头
    const local = new Uint8Array([
      ...u32(0x04034b50), // signature
      ...u16(20),         // version needed
      ...u16(0),          // flags
      ...u16(0),          // method 0 = stored
      ...u16(0), ...u16(0), // time/date
      ...u32(crc),
      ...u32(size),       // compressed size
      ...u32(size),       // uncompressed size
      ...u16(nameBytes.length),
      ...u16(0),          // extra length
    ]);
    chunks.push(local, nameBytes, f.data);

    // 中央目录项
    central.push(new Uint8Array([
      ...u32(0x02014b50),
      ...u16(20), ...u16(20),
      ...u16(0), ...u16(0),
      ...u16(0), ...u16(0),
      ...u32(crc),
      ...u32(size), ...u32(size),
      ...u16(nameBytes.length),
      ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(0),          // external attrs
      ...u32(offset),     // local header offset
    ]), nameBytes);

    offset += local.length + nameBytes.length + size;
  }

  const centralStart = offset;
  let centralSize = 0;
  for (const c of central) centralSize += c.length;

  const end = new Uint8Array([
    ...u32(0x06054b50),
    ...u16(0), ...u16(0),
    ...u16(files.length), ...u16(files.length),
    ...u32(centralSize),
    ...u32(centralStart),
    ...u16(0),
  ]);

  const all = [...chunks, ...central, end];
  const total = all.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of all) { out.set(c, p); p += c.length; }
  return out;
}

// ══════════════════════════════════════════════════════════════════
// xlsx 生成
// ══════════════════════════════════════════════════════════════════

const xmlEsc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
  // 去掉 XML 1.0 不允许的控制字符
  .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');

/** 列号 → 字母（0 → A） */
function colName(i) {
  let s = '';
  let n = i;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/** 生成工作表 XML */
export function sheetXml(rows) {
  const body = rows.map((row, r) => {
    const cells = row.map((val, c) => {
      const ref = `${colName(c)}${r + 1}`;
      if (val === null || val === undefined || val === '') return '';
      if (typeof val === 'number' && Number.isFinite(val)) {
        return `<c r="${ref}"><v>${val}</v></c>`;
      }
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(val)}</t></is></c>`;
    }).join('');
    return `<row r="${r + 1}">${cells}</row>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

/** 生成 xlsx 文件字节 */
export function buildXlsxBlob(rows) {
  const files = [
    {
      name: '[Content_Types].xml',
      data: utf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`),
    },
    {
      name: '_rels/.rels',
      data: utf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    },
    {
      name: 'xl/workbook.xml',
      data: utf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="装机清单" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: utf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`),
    },
    { name: 'xl/worksheets/sheet1.xml', data: utf8(sheetXml(rows)) },
  ];
  return zipStored(files);
}

// ══════════════════════════════════════════════════════════════════
// 组装导出内容
// ══════════════════════════════════════════════════════════════════

/**
 * 把已选配置整理为导出行
 *
 * @param {object} resolved  已解析的已选配件 { cpu, motherboard, ..., storage: [] }
 * @param {object} result    checkCompatibility 的结果（用于兼容性备注）
 * @param {object} opts      { includeParams, includeNotes, includeUsedWarning }
 * @returns {{ rows: Array<Array>, notes: Array<string>, usedItems: Array<object> }}
 */
export function buildRows(resolved, result, opts = {}) {
  const {
    includeParams = true,
    includeNotes = true,
    includeUsedWarning = true,
  } = opts;

  // 兼容性备注按品类归集
  const notesByCat = {};
  if (includeNotes && result?.findings) {
    for (const f of result.findings) {
      if (f.level === 'info') continue; // 提示级不写进购物清单
      for (const c of f.categories || []) {
        (notesByCat[c] ||= []).push(`${f.id} ${f.title}`);
      }
    }
  }

  const header = ['类别', '型号', '品牌', '数量'];
  if (includeParams) header.push('关键参数');
  header.push('新旧');
  if (includeNotes) header.push('兼容性备注');

  const rows = [header];
  const usedItems = [];

  for (const cat of CATEGORY_ORDER) {
    const v = resolved?.[cat];
    const items = Array.isArray(v) ? v.filter(Boolean) : v ? [v] : [];
    if (items.length === 0) continue;

    for (const rec of items) {
      const cond = rec.condition && rec.condition !== 'new'
        ? (CONDITION_LABELS[rec.condition] || rec.condition)
        : '全新';
      if (rec.condition && rec.condition !== 'new') usedItems.push(rec);

      const row = [CATEGORY_LABELS[cat], rec.name, rec.brand || '', 1];
      if (includeParams) row.push(paramsSummary(rec));
      row.push(cond);
      if (includeNotes) {
        const ns = notesByCat[cat] || [];
        row.push(ns.length ? `⚠ ${ns.join('；')}` : '✅ 无冲突');
      }
      rows.push(row);
    }
  }

  const notes = [];
  if (includeUsedWarning && usedItems.length) {
    notes.push(`风险提示：本清单含 ${usedItems.length} 件非全新配件（${usedItems.map((r) => `${r.name}（${CONDITION_LABELS[r.condition] || r.condition}）`).join('、')}），通常无官方保修，请注意验货。`);
  }
  if (result?.power) {
    notes.push(`功耗参考：整机峰值 ${result.power.peak}W，建议电源 ≥${result.power.recommendedPsu}W${result.power.psuWattage ? `，当前所选 ${result.power.psuWattage}W` : ''}。`);
  }

  return { rows, notes, usedItems };
}

/** 关键参数摘要（一行文本） */
function paramsSummary(rec) {
  const keys = {
    cpu: ['socket', 'cores', 'threads', 'maxPower'],
    motherboard: ['socket', 'chipset', 'formFactor', 'memoryType'],
    gpu: ['vram', 'length_mm', 'tdp'],
    memory: ['memoryType', 'capacityPerModule', 'modules', 'speed'],
    psu: ['wattage', 'efficiency'],
    case: ['maxGpuLength', 'maxCoolerHeight'],
    cooler: ['type', 'tdpRating'],
    storage: ['interface', 'capacity', 'nandType'],
  }[rec.category] || [];

  return keys
    .filter((k) => rec[k] !== undefined && rec[k] !== null)
    .map((k) => detailValue(rec, k))
    .join(' / ');
}

/** CSV 文本（含 BOM 便于 Excel 打开） */
export function toCsv(rows) {
  const cell = (v) => {
    const s = String(v ?? '');
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '\uFEFF' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

/** 纯文本清单 */
export function toText(rows, notes = []) {
  const lines = ['装机清单', '='.repeat(40), ''];
  const header = rows[0];
  // 找出各列最大宽度
  const widths = header.map((_, i) => Math.max(...rows.map((r) => String(r[i] ?? '').length)));
  rows.forEach((r, idx) => {
    const line = r.map((v, i) => String(v ?? '').padEnd(widths[i])).join('  ');
    lines.push(line);
    if (idx === 0) lines.push('-'.repeat(line.length));
  });
  if (notes.length) {
    lines.push('', '说明：');
    for (const n of notes) lines.push(`· ${n}`);
  }
  return lines.join('\n') + '\n';
}

/**
 * 生成导出产物
 *
 * @returns {{ filename:string, blob:Blob|Uint8Array|string, bytes:Uint8Array|null,
 *             preview:string, rows:Array, notes:Array, format:string }}
 *
 * 同时返回 blob 与原始 bytes：
 *   - 浏览器用 blob 触发下载
 *   - 测试/非 DOM 环境用 bytes 校验内容（Node 也有全局 Blob，
 *     仅凭 blob 无法可靠取回字节，故显式提供）
 */
export function buildExport(resolved, result, opts = {}) {
  const format = opts.format || 'xlsx';
  const { rows, notes } = buildRows(resolved, result, opts);

  const previewLines = rows.slice(0, 12).map((r, i) =>
    i === 0 ? r.join(' | ') : `${i}. ${r.join(' | ')}`);
  const preview = [...previewLines, '', ...notes.map((n) => `· ${n}`)].join('\n');

  const hasBlob = typeof Blob !== 'undefined';
  let blob;
  let bytes = null;
  let filename;

  if (format === 'xlsx') {
    bytes = buildXlsxBlob(rows);
    blob = hasBlob ? new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }) : bytes;
    filename = '装机清单.xlsx';
  } else if (format === 'csv') {
    const text = toCsv(rows);
    blob = hasBlob ? new Blob([text], { type: 'text/csv;charset=utf-8' }) : text;
    filename = '装机清单.csv';
  } else {
    const text = toText(rows, notes);
    blob = hasBlob ? new Blob([text], { type: 'text/plain;charset=utf-8' }) : text;
    filename = '装机清单.txt';
  }

  return { filename, blob, bytes, preview, rows, notes, format };
}

/**
 * 触发浏览器下载（唯一接触 DOM/BOM 的函数）
 */
export function downloadBlob(filename, blob) {
  if (typeof document === 'undefined') return false;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
