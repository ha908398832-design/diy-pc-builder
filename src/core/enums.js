/**
 * 唯一枚举定义处（PRD 附录 + 第五部分数据契约）
 *
 * 目的：避免同一个概念在不同数据文件里出现字面量变体（如 AM4 / am4 / "AM4 "），
 *      这类不统一会直接导致 E1（插槽）、E4（板型）等规则大面积误判。
 *
 * 规则：所有 data/*.json 与 CSV 模板必须以本文件的取值为准。
 *      tools/validate-data.mjs 会校验枚举越界。
 */

// ── 品类 ────────────────────────────────────────────────────────────
export const CATEGORIES = [
  'cpu',
  'motherboard',
  'gpu',
  'memory',
  'psu',
  'cooler',
  'case',
  'storage',
];

/** 中文名，用于界面与报告 */
export const CATEGORY_LABELS = {
  cpu: 'CPU',
  motherboard: '主板',
  gpu: '显卡',
  memory: '内存',
  psu: '电源',
  cooler: '散热器',
  case: '机箱',
  storage: '硬盘',
};

/** 界面左栏显示顺序（PRD 6.4） */
export const CATEGORY_ORDER = [
  'cpu',
  'motherboard',
  'gpu',
  'memory',
  'psu',
  'case',
  'cooler',
  'storage',
];

// ── CPU 插槽 ────────────────────────────────────────────────────────
// 用于 E1（CPU↔主板）、E9（散热器支持插槽）
export const SOCKETS = [
  // AMD 桌面（含二手主流）
  'AM3+',
  'FM2+',
  'AM4',
  'AM5',
  // Intel 桌面（含二手主流）
  'LGA1150',   // 4 代 Haswell / 5 代 Broadwell
  'LGA1151',   // 6/7 代 Skylake-Kaby Lake
  'LGA1151-2', // 8/9 代 Coffee Lake（针脚同为 1151 但电气不兼容，故区分）
  'LGA1155',   // 2/3 代 Sandy-Ivy Bridge
  'LGA1156',   // 1 代 Lynnfield
  'LGA1366',   // 初代 i7 至尊 / Xeon 5500
  'LGA1200',   // 10/11 代 Comet-Rocket Lake
  'LGA1700',   // 12/13/14 代
  'LGA1851',   // Core Ultra 200S
  // 二手 / 洋垃圾平台（PRD 3.1.2）
  'LGA2011',   // Xeon E5 v1/v2（初代 X79）
  'LGA2011-3', // Xeon E5 v3/v4（X99）
  'LGA2066',   // Xeon W / i9 至尊（X299）
];

/** 插槽 → 所属平台，用于 E1 文案与 I3 代际提示 */
export const SOCKET_PLATFORM = {
  AM4: 'AMD',
  AM5: 'AMD',
  'AM3+': 'AMD',
  'FM2+': 'AMD',
  LGA1200: 'Intel',
  LGA1700: 'Intel',
  LGA1851: 'Intel',
  LGA1150: 'Intel',
  LGA1151: 'Intel',
  'LGA1151-2': 'Intel',
  LGA1155: 'Intel',
  LGA1156: 'Intel',
  LGA1366: 'Intel',
  LGA2011: 'Intel',
  'LGA2011-3': 'Intel',
  LGA2066: 'Intel',
};

// ── 主板板型 ────────────────────────────────────────────────────────
// 用于 E4（主板↔机箱）；机箱 case.formFactors 取值必须来自此表
export const FORM_FACTORS = ['E-ATX', 'ATX', 'M-ATX', 'Mini-ITX'];

/** 板型尺寸（mm），仅用于展示 */
export const FORM_FACTOR_SIZE = {
  'E-ATX': { width: 305, height: 330 },
  ATX: { width: 305, height: 244 },
  'M-ATX': { width: 244, height: 244 },
  'Mini-ITX': { width: 170, height: 170 },
};

// ── 内存代数 ────────────────────────────────────────────────────────
// 用于 E2（内存↔主板）、E3（主板↔CPU）
export const MEMORY_TYPES = ['DDR4', 'DDR5', 'DDR3'];

// ── 电源规格 ────────────────────────────────────────────────────────
// 用于 E13（电源↔机箱）；机箱 case.psuFormFactors 取值必须来自此表
export const PSU_FORM_FACTORS = ['ATX', 'SFX', 'SFX-L', 'TFX'];

// ── 散热器类型 ──────────────────────────────────────────────────────
export const COOLER_TYPES = ['air', 'aio'];

export const COOLER_TYPE_LABELS = { air: '风冷', aio: '一体式水冷' };

// ── 水冷冷排规格 ────────────────────────────────────────────────────
// 用于 E8（散热器↔机箱）；机箱 case.radiatorSupport 取值必须来自此表
export const RADIATOR_SIZES = [120, 240, 280, 360, 420];

// ── 硬盘接口 ────────────────────────────────────────────────────────
// 用于 E15（硬盘数量↔主板接口数）
export const STORAGE_INTERFACES = ['NVMe', 'SATA'];

export const STORAGE_INTERFACE_LABELS = { NVMe: 'NVMe (M.2)', SATA: 'SATA' };

/** 硬盘规格 */
export const STORAGE_FORM_FACTORS = ['M.2 2280', 'M.2 2242', '2.5"', '3.5"'];

/** NAND 类型，用于 W11 */
export const NAND_TYPES = ['TLC', 'QLC', 'MLC', 'SLC'];

// ── 硬件新旧状态 ────────────────────────────────────────────────────
export const CONDITIONS = ['new', 'used', 'mining', 'oem'];

export const CONDITION_LABELS = {
  new: '全新',
  used: '二手',
  mining: '矿卡',
  oem: '洋垃圾',
};

/** 哪些状态需要在 I4 / 导出清单中提示"无保修风险" */
export const RISKY_CONDITIONS = ['used', 'mining', 'oem'];

// ── 兼容性规则级别 ──────────────────────────────────────────────────
export const LEVELS = ['error', 'warn', 'info'];

export const LEVEL_LABELS = { error: '错误', warn: '警告', info: '提示' };

export const LEVEL_ICONS = { error: '🔴', warn: '🟡', info: '🔵' };

/** 级别严重度排序（大者优先），用于状态灯汇总（PRD 4.4） */
export const LEVEL_SEVERITY = { error: 3, warn: 2, info: 1 };

/** 品类状态灯取值（PRD 4.4） */
export const STATUS_LIGHTS = ['error', 'warn', 'info', 'ok', 'invalid', 'unselected'];

/**
 * 状态灯图标
 *
 * 必须覆盖 STATUS_LIGHTS 的全部取值：规则三级（error/warn/info）
 * 加上「已选正常(ok)」「失效引用(invalid)」「未选(unselected)」。
 * 漏掉任一项会让对应品类拿到 undefined，界面显示不出图标。
 *
 * invalid 的含义：配置里记着某个型号 ID，但当前型号库里找不到它
 * （数据升级后引用了已删除型号，或用户清除了自己导入的自定义数据）。
 * 这种情况绝不能显示成绿色「正常」—— 它实际上没有任何配件。
 */
export const STATUS_ICONS = {
  error: '🔴',
  warn: '🟡',
  info: '🔵',
  ok: '🟢',
  invalid: '⚠️',
  unselected: '⚪',
};

// ── 电源 80PLUS 认证 ────────────────────────────────────────────────
export const EFFICIENCY_RATINGS = [
  '白牌',
  '铜牌',
  '银牌',
  '金牌',
  '白金牌',
  '钛金牌',
  '无认证',
];

// ── 模组化 ──────────────────────────────────────────────────────────
export const MODULAR_TYPES = ['全模组', '半模组', '非模组'];

// ── 机箱侧板 ────────────────────────────────────────────────────────
export const SIDE_PANELS = ['钢化玻璃', '网孔', '钢板', '亚克力'];

// ── PCIe 代数 ───────────────────────────────────────────────────────
// 用于 W6（显卡↔主板降速）
export const PCIE_VERSIONS = [3, 4, 5];

// ── 功耗计算常量（PRD 3.4.2）────────────────────────────────────────
// 集中定义，便于调参；power.js 必须引用此处而非硬编码
export const POWER_MODEL = {
  MOTHERBOARD_W: 40,
  MEMORY_PER_MODULE_W: 3,
  STORAGE_W: { NVMe: 8, SATA_SSD: 5, HDD_35: 9 },
  AIO_PUMP_W: 10,
  CASE_FANS_W: 10,
  /** 建议电源系数（PRD 3.4.2：峰值 × 1.4 向上取 50W 档） */
  PSU_HEADROOM_FACTOR: 1.4,
  PSU_ROUNDING_STEP: 50,
  /** CPU 缺 maxPower 时的兜底系数 */
  CPU_TDP_FALLBACK_FACTOR: 1.2,
};

// ── 阈值（W1/I1/W8/W10 用）─────────────────────────────────────────
export const THRESHOLDS = {
  /** W1：电源余量 < 20% 警告 */
  PSU_LOW_MARGIN_PCT: 20,
  /** I1：电源余量 > 50% 提示 */
  PSU_HIGH_MARGIN_PCT: 50,
  /** W8：整机峰值超过此值且风扇位偏少时警告积热 */
  HIGH_POWER_W: 400,
  MIN_FAN_MOUNTS_FOR_HIGH_POWER: 3,
  /** W10：CPU 峰值超过此值视为高端，主板供电相数偏低则警告 */
  HIGH_END_CPU_W: 120,
  MIN_VRM_PHASES_FOR_HIGH_END: 6,
};

// ── 导出格式（PRD M9-1）─────────────────────────────────────────────
export const EXPORT_FORMATS = ['xlsx', 'text', 'print'];

// ── 默认配置 ────────────────────────────────────────────────────────
export const DEFAULT_CATEGORY = 'cpu';

/** 全部枚举汇总，供校验脚本一次性取用 */
export const ENUMS = {
  category: CATEGORIES,
  socket: SOCKETS,
  formFactor: FORM_FACTORS,
  memoryType: MEMORY_TYPES,
  psuFormFactor: PSU_FORM_FACTORS,
  coolerType: COOLER_TYPES,
  radiatorSize: RADIATOR_SIZES,
  storageInterface: STORAGE_INTERFACES,
  storageFormFactor: STORAGE_FORM_FACTORS,
  nandType: NAND_TYPES,
  condition: CONDITIONS,
  level: LEVELS,
  efficiency: EFFICIENCY_RATINGS,
  modular: MODULAR_TYPES,
  sidePanel: SIDE_PANELS,
  pcieVersion: PCIE_VERSIONS,
};
