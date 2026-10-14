/**
 * 字段规范 —— 单一数据源（PRD 第五部分数据契约）
 *
 * 本文件是以下三者的唯一来源，避免规范漂移：
 *   1. schema/hardware.schema.json   （由 tools/gen-schema.mjs 生成，供人工查阅/外部工具）
 *   2. tools/validate-data.mjs       （数据校验）
 *   3. tools/gen-csv-templates.mjs   （CSV 模板表头）
 *
 * 字段属性说明：
 *   key        字段名（程序读取的键名）
 *   type       string | number | boolean | string[] | number[] | 'string|null' | 'number|null'
 *   required   true=必填（缺少或为空即校验失败）
 *   requiredIf 条件必填，形如 { field:'type', equals:'air' }（PRD：风冷必有高度、水冷必有冷排规格）
 *   enum       取值必须来自 enums.js 中的哪个枚举集合
 *   enumItem   true 表示数组，元素取值受 enum 约束
 *   unit       单位（展示与 CSV 表头用）
 *   label      中文名（展示与 CSV 表头用）
 *   range      { min, max } 数值合理区间
 *   rules      该字段参与哪些规则（PRD 第四部分编号），供「规则说明」弹窗展示
 *   critical   true=关键字段，必须精确（PRD 3.1.3），不允许近似
 *   p1         true=本期不读取，仅为 P1 预留
 */

// ── 通用字段（PRD 5.1）──────────────────────────────────────────────
export const COMMON_FIELDS = [
  {
    key: 'id',
    type: 'string',
    required: true,
    label: '唯一标识',
    critical: true,
    note: '格式 {category}-{brand}-{model}，全库唯一',
  },
  {
    key: 'category',
    type: 'string',
    required: true,
    enum: 'category',
    label: '品类',
    critical: true,
  },
  { key: 'brand', type: 'string', required: true, label: '品牌', critical: true },
  { key: 'name', type: 'string', required: true, label: '完整型号名', critical: true },
  {
    key: 'aliases',
    type: 'string[]',
    required: true,
    minItems: 1,
    label: '别名/简称',
    note: '至少 1 个，含常见简称（如 7800x3d、4070S、小雕）',
  },
  {
    key: 'price',
    type: 'number|null',
    required: false,
    label: '参考价',
    unit: '元',
    range: { min: 0, max: 200000 },
    p1: true,
    note: 'P1 预留字段：本期界面不展示、不参与计算与校验（见 PRD 1.5）',
  },
  {
    key: 'year',
    type: 'number',
    required: false,
    label: '发布时间',
    unit: '年',
    range: { min: 2008, max: 2030 },
  },
  {
    key: 'condition',
    type: 'string',
    required: true,
    enum: 'condition',
    label: '新旧状态',
    critical: true,
  },
  {
    key: 'estimated',
    type: 'string[]',
    required: false,
    label: '近似字段',
    note: '本记录中哪些字段是近似值（PRD 3.1.3），界面以 ≈ 呈现',
  },
  { key: 'notes', type: 'string', required: false, label: '备注' },
];

// ── 各品类专用字段（PRD 5.2）────────────────────────────────────────
export const CATEGORY_FIELDS = {
  // ── CPU ──────────────────────────────────────────────────────────
  cpu: {
    label: 'CPU',
    file: 'cpu.json',
    csvFile: 'cpu.csv',
    minCount: 80,
    fields: [
      { key: 'socket', type: 'string', required: true, enum: 'socket', label: '插槽', rules: ['E1', 'E9'], critical: true },
      { key: 'cores', type: 'number', required: true, label: '核心数', range: { min: 1, max: 128 } },
      { key: 'threads', type: 'number', required: true, label: '线程数', range: { min: 1, max: 256 } },
      { key: 'pCores', type: 'number', required: false, label: '性能核数', range: { min: 0, max: 64 } },
      { key: 'eCores', type: 'number', required: false, label: '能效核数', range: { min: 0, max: 64 } },
      { key: 'baseClock', type: 'number', required: true, unit: 'GHz', label: '基础频率', range: { min: 1, max: 7 } },
      { key: 'boostClock', type: 'number', required: true, unit: 'GHz', label: '加速频率', range: { min: 1, max: 8 } },
      { key: 'l3Cache', type: 'number', required: false, unit: 'MB', label: '三级缓存', range: { min: 0, max: 512 } },
      { key: 'tdp', type: 'number', required: true, unit: 'W', label: '标称功耗', range: { min: 5, max: 500 } },
      {
        key: 'maxPower',
        type: 'number',
        required: true,
        unit: 'W',
        label: '峰值功耗',
        range: { min: 5, max: 700 },
        rules: ['E10', 'W2', 'W10'],
        critical: true,
        note: 'PPT/PL2，功耗预算必须用它而非 tdp',
      },
      { key: 'memoryTypes', type: 'string[]', required: true, enum: 'memoryType', enumItem: true, minItems: 1, label: '支持内存代数', rules: ['E3'], critical: true },
      { key: 'maxMemorySpeed', type: 'number', required: true, unit: 'MT/s', label: '官方内存频率上限', range: { min: 1000, max: 12000 }, rules: ['W4'], critical: true },
      { key: 'memoryChannels', type: 'number', required: false, label: '内存通道数', range: { min: 1, max: 8 } },
      { key: 'igpu', type: 'boolean', required: true, label: '是否带核显', rules: ['E16'], critical: true },
      { key: 'igpuName', type: 'string', required: false, label: '核显型号' },
      { key: 'pcieVersion', type: 'number', required: false, enum: 'pcieVersion', label: 'PCIe 版本' },
      { key: 'unlocked', type: 'boolean', required: false, label: '是否可超频' },
      { key: 'gameScore', type: 'number', required: true, label: '游戏性能分', range: { min: 1, max: 300 }, note: '以 R7 7800X3D = 100 为基准' },
      { key: 'productivityScore', type: 'number', required: true, label: '生产力性能分', range: { min: 1, max: 400 }, note: '同基准换算' },
    ],
  },

  // ── 主板 ─────────────────────────────────────────────────────────
  motherboard: {
    label: '主板',
    file: 'motherboard.json',
    csvFile: 'motherboard.csv',
    minCount: 130,
    fields: [
      { key: 'socket', type: 'string', required: true, enum: 'socket', label: '插槽', rules: ['E1'], critical: true },
      { key: 'chipset', type: 'string', required: true, label: '芯片组', rules: ['W5'], critical: true },
      { key: 'formFactor', type: 'string', required: true, enum: 'formFactor', label: '板型', rules: ['E4'], critical: true },
      { key: 'memoryType', type: 'string', required: true, enum: 'memoryType', label: '内存代数', rules: ['E2', 'E3'], critical: true },
      { key: 'memorySlots', type: 'number', required: true, label: '内存槽数', range: { min: 1, max: 8 }, rules: ['E17'], critical: true },
      // 容量下限放宽到 2GB：老平台确实只支持这么大。
      // 实测公开数据集中 8GB 上限的主板 204 块、4GB 的 69 块、2GB 的 1 块
      //（如 ASRock G41M-S 8GB / Intel DG41TX 4GB，均为 LGA775 平台）。
      // 原下限 16 基于「所有主板都支持 ≥16GB」的错误假设，会误拒合法的老硬件。
      // 该字段不被任何规则使用，仅供展示。
      { key: 'maxMemory', type: 'number', required: false, unit: 'GB', label: '最大内存容量', range: { min: 2, max: 512 } },
      { key: 'maxMemorySpeed', type: 'number', required: true, unit: 'MT/s', label: '内存频率上限', range: { min: 1000, max: 12000 }, rules: ['W3'], critical: true },
      { key: 'pcieVersion', type: 'number', required: true, enum: 'pcieVersion', label: 'PCIe 版本', rules: ['W6'], critical: true },
      { key: 'pcieX16Slots', type: 'number', required: false, label: 'PCIe x16 槽数', range: { min: 0, max: 4 } },
      { key: 'm2Slots', type: 'number', required: true, label: 'M.2 接口数', range: { min: 0, max: 6 }, rules: ['E15'], critical: true },
      { key: 'sataPorts', type: 'number', required: true, label: 'SATA 接口数', range: { min: 0, max: 12 }, rules: ['E15'], critical: true },
      { key: 'cpuPowerConnectors', type: 'number', required: true, label: 'CPU 供电 8pin 数', range: { min: 1, max: 3 }, rules: ['E12'], critical: true, note: '按 8pin 等效数量计，4pin 计 0.5 时取整' },
      { key: 'vrmPhases', type: 'number', required: false, label: '供电相数', range: { min: 2, max: 30 }, rules: ['W10'] },
      { key: 'wifi', type: 'boolean', required: false, label: '是否带 WiFi' },
      { key: 'usbC', type: 'boolean', required: false, label: '是否带 USB-C' },
      { key: 'length_mm', type: 'number', required: false, unit: 'mm', label: '长度', range: { min: 100, max: 400 } },
      { key: 'width_mm', type: 'number', required: false, unit: 'mm', label: '宽度', range: { min: 100, max: 400 } },
      { key: 'biosFlashback', type: 'boolean', required: false, label: '支持无 CPU 刷 BIOS' },
    ],
  },

  // ── 显卡 ─────────────────────────────────────────────────────────
  gpu: {
    label: '显卡',
    file: 'gpu.json',
    csvFile: 'gpu.csv',
    minCount: 130,
    fields: [
      { key: 'chipset', type: 'string', required: true, label: '显示芯片', critical: true },
      { key: 'vram', type: 'number', required: true, unit: 'GB', label: '显存容量', range: { min: 1, max: 48 }, critical: true },
      { key: 'memoryType', type: 'string', required: false, label: '显存类型' },
      // 上限需容纳 HBM 显存：HBM2 位宽可达 2048bit（如 Radeon Vega 56/64、Radeon VII）
      { key: 'busWidth', type: 'number', required: false, unit: 'bit', label: '显存位宽', range: { min: 32, max: 8192 } },
      { key: 'length_mm', type: 'number', required: true, unit: 'mm', label: '显卡长度', range: { min: 100, max: 400 }, rules: ['E5'], critical: true },
      { key: 'thicknessSlots', type: 'number', required: true, unit: '槽', label: '显卡厚度', range: { min: 1, max: 5 }, rules: ['E6'], critical: true },
      { key: 'height_mm', type: 'number', required: false, unit: 'mm', label: '显卡高度', range: { min: 80, max: 200 } },
      { key: 'tdp', type: 'number', required: true, unit: 'W', label: '功耗', range: { min: 20, max: 600 }, rules: ['E10'], critical: true },
      { key: 'recommendedPsu', type: 'number', required: false, unit: 'W', label: '建议电源', range: { min: 200, max: 1600 } },
      { key: 'pcie8pin', type: 'number', required: true, label: '8pin 供电口数', range: { min: 0, max: 4 }, rules: ['E11'], critical: true },
      { key: 'pcie12vhpwr', type: 'number', required: true, label: '12VHPWR 口数', range: { min: 0, max: 2 }, rules: ['E11'], critical: true },
      { key: 'pcieVersion', type: 'number', required: true, enum: 'pcieVersion', label: 'PCIe 版本', rules: ['W6'], critical: true },
      { key: 'outputs', type: 'string[]', required: false, label: '输出接口' },
      { key: 'gameScore', type: 'number', required: true, label: '游戏性能分', range: { min: 1, max: 400 }, note: '以 R7 7800X3D = 100 为同基准' },
      { key: 'productivityScore', type: 'number', required: true, label: '生产力性能分', range: { min: 1, max: 600 } },
      { key: 'coolerType', type: 'string', required: false, label: '散热形式' },
    ],
  },

  // ── 内存 ─────────────────────────────────────────────────────────
  memory: {
    label: '内存',
    file: 'memory.json',
    csvFile: 'memory.csv',
    minCount: 55,
    fields: [
      { key: 'memoryType', type: 'string', required: true, enum: 'memoryType', label: '内存代数', rules: ['E2'], critical: true },
      { key: 'capacityPerModule', type: 'number', required: true, unit: 'GB', label: '单条容量', range: { min: 2, max: 128 }, critical: true },
      { key: 'modules', type: 'number', required: true, unit: '条', label: '套装条数', range: { min: 1, max: 8 }, rules: ['E17', 'W7'], critical: true },
      { key: 'speed', type: 'number', required: true, unit: 'MT/s', label: '频率', range: { min: 1000, max: 12000 }, rules: ['W3', 'W4'], critical: true },
      { key: 'casLatency', type: 'number', required: false, label: 'CAS 时序', range: { min: 10, max: 60 } },
      { key: 'voltage', type: 'number', required: false, unit: 'V', label: '电压', range: { min: 1, max: 1.6 } },
      { key: 'height_mm', type: 'number', required: true, unit: 'mm', label: '内存高度', range: { min: 20, max: 80 }, rules: ['W9'], critical: true },
      { key: 'ecc', type: 'boolean', required: false, label: '是否 ECC' },
      { key: 'rgb', type: 'boolean', required: false, label: '是否带灯' },
      { key: 'xmpSupport', type: 'string', required: false, label: 'XMP/EXPO 支持' },
    ],
  },

  // ── 电源 ─────────────────────────────────────────────────────────
  psu: {
    label: '电源',
    file: 'psu.json',
    csvFile: 'psu.csv',
    minCount: 50,
    fields: [
      { key: 'wattage', type: 'number', required: true, unit: 'W', label: '额定瓦数', range: { min: 200, max: 2000 }, rules: ['E10', 'W1', 'I1'], critical: true },
      { key: 'formFactor', type: 'string', required: true, enum: 'psuFormFactor', label: '电源规格', rules: ['E13'], critical: true },
      { key: 'length_mm', type: 'number', required: true, unit: 'mm', label: '电源长度', range: { min: 100, max: 250 }, rules: ['E14'], critical: true },
      { key: 'pcie8pin', type: 'number', required: true, label: 'PCIe 8pin 数', range: { min: 0, max: 10 }, rules: ['E11'], critical: true },
      { key: 'pcie12vhpwr', type: 'number', required: true, label: '12VHPWR 数', range: { min: 0, max: 2 }, rules: ['E11'], critical: true },
      { key: 'eps8pin', type: 'number', required: true, label: 'CPU 8pin 数', range: { min: 1, max: 3 }, rules: ['E12'], critical: true },
      { key: 'efficiency', type: 'string', required: true, enum: 'efficiency', label: '80PLUS 认证', critical: false },
      { key: 'modular', type: 'string', required: false, enum: 'modular', label: '模组化' },
      { key: 'atxVersion', type: 'string', required: false, label: 'ATX 版本' },
      { key: 'sataConnectors', type: 'number', required: false, label: 'SATA 供电口数', range: { min: 0, max: 16 } },
      { key: 'warranty', type: 'number', required: false, unit: '年', label: '保修', range: { min: 0, max: 15 } },
    ],
  },

  // ── 机箱 ─────────────────────────────────────────────────────────
  case: {
    label: '机箱',
    file: 'case.json',
    csvFile: 'case.csv',
    minCount: 50,
    fields: [
      { key: 'formFactors', type: 'string[]', required: true, enum: 'formFactor', enumItem: true, minItems: 1, label: '支持板型', rules: ['E4'], critical: true },
      { key: 'maxGpuLength', type: 'number', required: true, unit: 'mm', label: '显卡限长', range: { min: 150, max: 600 }, rules: ['E5'], critical: true },
      { key: 'maxGpuThickness', type: 'number', required: true, unit: '槽', label: '显卡限厚', range: { min: 1, max: 5 }, rules: ['E6'], critical: true },
      { key: 'maxCoolerHeight', type: 'number', required: true, unit: 'mm', label: '风冷限高', range: { min: 40, max: 250 }, rules: ['E7'], critical: true },
      { key: 'radiatorSupport', type: 'number[]', required: true, enum: 'radiatorSize', enumItem: true, label: '支持冷排', unit: 'mm', rules: ['E8'], critical: true, note: '无冷排位填空数组' },
      { key: 'psuFormFactors', type: 'string[]', required: true, enum: 'psuFormFactor', enumItem: true, minItems: 1, label: '支持电源规格', rules: ['E13'], critical: true },
      { key: 'maxPsuLength', type: 'number', required: true, unit: 'mm', label: '电源限长', range: { min: 100, max: 300 }, rules: ['E14'], critical: true },
      { key: 'expansionSlots', type: 'number', required: true, label: '扩展槽数', range: { min: 1, max: 10 }, critical: true },
      { key: 'driveBays35', type: 'number', required: false, label: '3.5 寸硬盘位', range: { min: 0, max: 12 } },
      { key: 'driveBays25', type: 'number', required: false, label: '2.5 寸硬盘位', range: { min: 0, max: 12 } },
      { key: 'fanMounts', type: 'number', required: true, label: '风扇位数量', range: { min: 0, max: 14 }, rules: ['W8'], critical: true },
      { key: 'sidePanel', type: 'string', required: false, enum: 'sidePanel', label: '侧板' },
      { key: 'volume', type: 'number', required: false, unit: 'L', label: '体积', range: { min: 3, max: 120 } },
    ],
  },

  // ── 散热器 ───────────────────────────────────────────────────────
  cooler: {
    label: '散热器',
    file: 'cooler.json',
    csvFile: 'cooler.csv',
    minCount: 45,
    fields: [
      { key: 'type', type: 'string', required: true, enum: 'coolerType', label: '类型', rules: ['E7', 'E8', 'W9'], critical: true },
      { key: 'height_mm', type: 'number', required: false, requiredIf: { field: 'type', equals: 'air' }, unit: 'mm', label: '风冷高度', range: { min: 20, max: 250 }, rules: ['E7'], critical: true },
      { key: 'radiatorSize', type: 'number', required: false, requiredIf: { field: 'type', equals: 'aio' }, enum: 'radiatorSize', label: '冷排规格', unit: 'mm', rules: ['E8'], critical: true },
      { key: 'tdpRating', type: 'number', required: true, unit: 'W', label: '散热能力', range: { min: 30, max: 600 }, rules: ['W2'], critical: true },
      { key: 'sockets', type: 'string[]', required: true, enum: 'socket', enumItem: true, minItems: 1, label: '支持插槽', rules: ['E9'], critical: true },
      { key: 'ramClearance_mm', type: 'number', required: false, unit: 'mm', label: '内存避让高度', range: { min: 20, max: 100 }, rules: ['W9'] },
      { key: 'fanCount', type: 'number', required: false, label: '风扇数', range: { min: 0, max: 6 } },
      { key: 'noise_dba', type: 'number', required: false, unit: 'dBA', label: '噪声', range: { min: 10, max: 60 }, note: '近似值' },
      { key: 'rgb', type: 'boolean', required: false, label: '是否带灯' },
      { key: 'thickness_mm', type: 'number', required: false, unit: 'mm', label: '冷排厚度', range: { min: 20, max: 60 } },
    ],
  },

  // ── 硬盘 ─────────────────────────────────────────────────────────
  storage: {
    label: '硬盘',
    file: 'storage.json',
    csvFile: 'storage.csv',
    minCount: 45,
    fields: [
      { key: 'interface', type: 'string', required: true, enum: 'storageInterface', label: '接口', rules: ['E15'], critical: true },
      { key: 'formFactor', type: 'string', required: true, enum: 'storageFormFactor', label: '规格', critical: true },
      { key: 'capacity', type: 'number', required: true, unit: 'GB', label: '容量', range: { min: 120, max: 30000 }, critical: true },
      { key: 'pcieVersion', type: 'number', required: false, requiredIf: { field: 'interface', equals: 'NVMe' }, enum: 'pcieVersion', label: 'PCIe 代数', note: 'NVMe 必填' },
      { key: 'readSpeed', type: 'number', required: false, unit: 'MB/s', label: '顺序读取', range: { min: 100, max: 16000 } },
      { key: 'writeSpeed', type: 'number', required: false, unit: 'MB/s', label: '顺序写入', range: { min: 100, max: 16000 } },
      { key: 'nandType', type: 'string', required: true, enum: 'nandType', label: 'NAND 类型', rules: ['W11'], critical: true },
      { key: 'dram', type: 'boolean', required: true, label: '有无独立缓存', rules: ['W11'], critical: true },
      { key: 'tbw', type: 'number', required: false, unit: 'TBW', label: '写入寿命', range: { min: 20, max: 20000 } },
      { key: 'heatsink', type: 'boolean', required: false, label: '是否带散热片' },
    ],
  },
};

// ── 派生：某品类完整字段列表（通用 + 专用）──────────────────────────
export function allFieldsOf(category) {
  const cat = CATEGORY_FIELDS[category];
  if (!cat) throw new Error(`未知品类: ${category}`);
  return [...COMMON_FIELDS, ...cat.fields];
}

/** 某品类的必填字段名（含条件必填单列） */
export function requiredKeysOf(category) {
  return allFieldsOf(category)
    .filter((f) => f.required)
    .map((f) => f.key);
}

/** 字段名 → 字段定义（某品类） */
export function fieldMapOf(category) {
  const map = {};
  for (const f of allFieldsOf(category)) map[f.key] = f;
  return map;
}

export const CATEGORY_LIST = Object.keys(CATEGORY_FIELDS);
