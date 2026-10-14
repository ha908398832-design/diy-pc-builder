#!/usr/bin/env node
/**
 * CSV 模板生成器（PRD T0.4 / M2-1）
 *
 * 为 8 个品类各生成一份空白 CSV 模板，表头格式：
 *   字段名[必填] (单位) 中文说明
 *
 * 设计要点：
 *   - 表头第一行是「人类可读说明」，第二行是「机器可解析的纯字段名」。
 *     导入时（M2-2）优先用第一行做自动映射，失败则回退第二行 / 顺序。
 *   - 数组字段用 ; 分隔，布尔用 是/否（PRD 5.3）。
 *   - 每份模板带 1 行示例数据，便于对照填写。
 *
 * 用法: node tools/gen-csv-templates.mjs
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ENUMS, CATEGORY_LABELS } from '../src/core/enums.js';
import { CATEGORY_LIST, CATEGORY_FIELDS, allFieldsOf } from '../schema/fields.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'csv-templates');

/** UTF-8 BOM：让 Excel 双击打开不乱码 */
const BOM = '\uFEFF';

const ARRAY_SEP = ';';

/** CSV 单元格转义 */
function cell(value) {
  const s = String(value ?? '');
  if (s === '') return '';
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

const row = (cells) => cells.map(cell).join(',');

/** 构造表头：字段名[必填] (单位) 中文说明 */
function headerFor(field) {
  const isCondRequired = !!field.requiredIf;
  const mark = field.required ? '[必填]' : isCondRequired ? '[条件必填]' : '';
  const unit = field.unit ? ` (${field.unit})` : '';
  let desc = field.label || '';

  const extras = [];
  if (field.enum) {
    const vals = ENUMS[field.enum];
    extras.push(`取值: ${vals.join(' / ')}`);
  }
  if (field.type === 'string[]' || field.type === 'number[]') {
    extras.push(`多个用 ${ARRAY_SEP} 分隔`);
  }
  if (field.type === 'boolean') {
    extras.push('填 是/否');
  }
  if (field.requiredIf) {
    extras.push(`当 ${field.requiredIf.field}=${field.requiredIf.equals} 时必填`);
  }
  if (field.p1) {
    extras.push('本期不使用，可留空');
  }

  if (extras.length) desc += `｜${extras.join('；')}`;
  return `${field.key}${mark}${unit} ${desc}`;
}

/** 构造示例值，让用户看到正确格式 */
function sampleFor(category, field) {
  const samples = {
    cpu: {
      id: 'cpu-amd-r7-7800x3d',
      category: 'cpu',
      brand: 'AMD',
      name: 'Ryzen 7 7800X3D',
      aliases: ['7800x3d', 'R7 7800X3D', '7800X3D'],
      year: 2023,
      condition: 'new',
      socket: 'AM5',
      cores: 8,
      threads: 16,
      pCores: '',
      eCores: '',
      baseClock: 4.2,
      boostClock: 5.0,
      l3Cache: 96,
      tdp: 120,
      maxPower: 162,
      memoryTypes: ['DDR5'],
      maxMemorySpeed: 5200,
      memoryChannels: 2,
      igpu: true,
      igpuName: 'Radeon Graphics',
      pcieVersion: 5,
      unlocked: false,
      gameScore: 100,
      productivityScore: 88,
      estimated: ['productivityScore'],
      notes: '3D V-Cache，游戏强；对内存频率敏感',
      price: '',
    },
    motherboard: {
      id: 'motherboard-msi-b650m-mortar',
      category: 'motherboard',
      brand: '微星',
      name: 'MAG B650M MORTAR WIFI',
      aliases: ['B650M 迫击炮', 'b650m mortar'],
      year: 2022,
      condition: 'new',
      socket: 'AM5',
      chipset: 'B650',
      formFactor: 'M-ATX',
      memoryType: 'DDR5',
      memorySlots: 4,
      maxMemory: 128,
      maxMemorySpeed: 6400,
      pcieVersion: 4,
      pcieX16Slots: 1,
      m2Slots: 2,
      sataPorts: 4,
      cpuPowerConnectors: 2,
      vrmPhases: 12,
      wifi: true,
      usbC: true,
      length_mm: 244,
      width_mm: 244,
      biosFlashback: true,
      estimated: [],
      notes: '',
      price: '',
    },
    gpu: {
      id: 'gpu-asus-rtx4070s-dual',
      category: 'gpu',
      brand: '华硕',
      name: 'DUAL-RTX4070S-O12G',
      aliases: ['4070S', 'RTX 4070 SUPER', '4070super'],
      year: 2024,
      condition: 'new',
      chipset: 'RTX 4070 SUPER',
      vram: 12,
      memoryType: 'GDDR6X',
      busWidth: 192,
      length_mm: 267,
      thicknessSlots: 2.5,
      height_mm: 134,
      tdp: 220,
      recommendedPsu: 650,
      pcie8pin: 1,
      pcie12vhpwr: 0,
      pcieVersion: 4,
      outputs: ['HDMI 2.1', 'DP 1.4a'],
      gameScore: 122,
      productivityScore: 118,
      coolerType: '双风扇',
      estimated: ['thicknessSlots'],
      notes: '',
      price: '',
    },
    memory: {
      id: 'memory-kingston-fury-ddr5-6000-16x2',
      category: 'memory',
      brand: '金士顿',
      name: 'FURY Beast DDR5-6000 16GB×2',
      aliases: ['DDR5 6000 32G', 'fury 6000'],
      year: 2022,
      condition: 'new',
      memoryType: 'DDR5',
      capacityPerModule: 16,
      modules: 2,
      speed: 6000,
      casLatency: 30,
      voltage: 1.35,
      height_mm: 34,
      ecc: false,
      rgb: false,
      xmpSupport: 'XMP 3.0 / EXPO',
      estimated: [],
      notes: '',
      price: '',
    },
    psu: {
      id: 'psu-corsair-rm650',
      category: 'psu',
      brand: '海盗船',
      name: 'RM650 2023',
      aliases: ['RM650', 'rm650 2023'],
      year: 2023,
      condition: 'new',
      wattage: 650,
      formFactor: 'ATX',
      length_mm: 140,
      pcie8pin: 4,
      pcie12vhpwr: 1,
      eps8pin: 2,
      efficiency: '金牌',
      modular: '全模组',
      atxVersion: 'ATX 3.0',
      sataConnectors: 6,
      warranty: 10,
      estimated: [],
      notes: '',
      price: '',
    },
    cooler: {
      id: 'cooler-thermalright-pa120-se',
      category: 'cooler',
      brand: '利民',
      name: 'Peerless Assassin 120 SE',
      aliases: ['PA120 SE', 'pa120se'],
      year: 2022,
      condition: 'new',
      type: 'air',
      height_mm: 155,
      radiatorSize: '',
      tdpRating: 245,
      sockets: ['AM4', 'AM5', 'LGA1700', 'LGA1200', 'LGA1851'],
      ramClearance_mm: 42,
      fanCount: 2,
      noise_dba: 25.6,
      rgb: false,
      thickness_mm: '',
      estimated: ['noise_dba'],
      notes: '',
      price: '',
    },
    case: {
      id: 'case-lianli-lancool216',
      category: 'case',
      brand: '联力',
      name: 'LANCOOL 216',
      aliases: ['216', 'lancool216'],
      year: 2023,
      condition: 'new',
      formFactors: ['E-ATX', 'ATX', 'M-ATX', 'Mini-ITX'],
      maxGpuLength: 392,
      maxGpuThickness: 3.5,
      maxCoolerHeight: 180.5,
      radiatorSupport: [120, 240, 280, 360],
      psuFormFactors: ['ATX', 'SFX', 'SFX-L'],
      maxPsuLength: 210,
      expansionSlots: 7,
      driveBays35: 2,
      driveBays25: 2,
      fanMounts: 7,
      sidePanel: '钢化玻璃',
      volume: 52,
      estimated: ['maxGpuThickness'],
      notes: '',
      price: '',
    },
    storage: {
      id: 'storage-samsung-990pro-1tb',
      category: 'storage',
      brand: '三星',
      name: '990 PRO 1TB',
      aliases: ['990pro', '990 PRO 1T'],
      year: 2022,
      condition: 'new',
      interface: 'NVMe',
      formFactor: 'M.2 2280',
      capacity: 1000,
      pcieVersion: 4,
      readSpeed: 7450,
      writeSpeed: 6900,
      nandType: 'TLC',
      dram: true,
      tbw: 600,
      heatsink: false,
      estimated: [],
      notes: '',
      price: '',
    },
  };
  const v = samples[category]?.[field.key];
  if (v === undefined) return '';
  if (Array.isArray(v)) return v.join(ARRAY_SEP);
  if (typeof v === 'boolean') return v ? '是' : '否';
  return v;
}

function generateTemplate(category) {
  const meta = CATEGORY_FIELDS[category];
  const fields = allFieldsOf(category);

  const header = fields.map(headerFor);
  const machineNames = fields.map((f) => f.key);
  const sample = fields.map((f) => sampleFor(category, f));

  const lines = [
    row(header),
    row(machineNames),   // 机器可解析行（导入时可回退使用）
    row(sample),
  ];

  return BOM + lines.join('\r\n') + '\r\n';
}

// ── 主流程 ──────────────────────────────────────────────────────────
mkdirSync(OUT_DIR, { recursive: true });

const index = [];
for (const category of CATEGORY_LIST) {
  const meta = CATEGORY_FIELDS[category];
  const content = generateTemplate(category);
  const path = join(OUT_DIR, meta.csvFile);
  writeFileSync(path, content, 'utf8');
  const fields = allFieldsOf(category);
  const requiredCount = fields.filter((f) => f.required).length;
  index.push({
    category,
    label: CATEGORY_LABELS[category],
    file: meta.csvFile,
    fields: fields.length,
    required: requiredCount,
    minCount: meta.minCount,
  });
  console.log(
    `  ✓ ${meta.csvFile.padEnd(20)} 字段 ${String(fields.length).padStart(2)} 个（必填 ${requiredCount}）  建议型号数 ≥${meta.minCount}`,
  );
}

// 生成一份说明文件
const readme = `# CSV 模板说明

本目录 8 份模板由 \`tools/gen-csv-templates.mjs\` 自动生成，请勿手工修改表头。

## 三行结构

| 行 | 内容 | 用途 |
|---|---|---|
| 第 1 行 | 人类可读表头，形如 \`字段名[必填] (单位) 中文说明\|取值: ...\` | 导入时优先用于自动字段映射 |
| 第 2 行 | 纯字段名（机器可解析） | 第 1 行映射失败时的回退 |
| 第 3 行 | 示例数据 | 参照填写，导入时会被识别为示例行 |

**填写时从第 4 行开始。**

## 填写规则

| 类型 | 规则 |
|---|---|
| 数组字段（如 \`aliases\`、\`memoryTypes\`、\`sockets\`、\`formFactors\`、\`radiatorSupport\`） | 多个值用 \`;\` 分隔，如 \`AM4;AM5;LGA1700\` |
| 布尔字段（如 \`igpu\`、\`wifi\`、\`dram\`） | 填 \`是\` 或 \`否\`（也接受 \`true\`/\`false\`、\`1\`/\`0\`） |
| 数值字段 | 只填数字，不要带单位（单位已写在表头） |
| \`price\` | **本期不使用**，可留空 |
| \`estimated\` | 列出本行中属于近似值的字段名，多个用 \`;\` 分隔，如 \`noise_dba;volume\` |
| \`condition\` | \`new\` 全新 / \`used\` 二手 / \`mining\` 矿卡 / \`oem\` 洋垃圾 |
| \`id\` | 格式 \`{category}-{brand}-{model}\`，全库唯一 |

## 校验

填好后运行：

\`\`\`bash
node tools/validate-data.mjs
\`\`\`

或经由界面「导入 CSV」功能导入（会先给出校验报告，可选择覆盖/跳过/并存重名项）。

## 各品类字段数

| 品类 | 模板文件 | 字段数 | 必填 | 建议型号数 |
|---|---|---|---|---|
${index.map((i) => `| ${i.label} | \`${i.file}\` | ${i.fields} | ${i.required} | ≥${i.minCount} |`).join('\n')}
`;

writeFileSync(join(OUT_DIR, 'README.md'), readme, 'utf8');

console.log(`\n✅ 已生成 ${index.length} 份 CSV 模板 + README.md → csv-templates/`);
