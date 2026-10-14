/**
 * 测试用硬件固件（fixtures）
 *
 * 设计原则：
 *   - 不依赖 data/*.json（那些文件由阶段 1 并行生成，且会随时增补）
 *   - 用工厂函数 + 默认值，让每个测试只写与规则相关的字段
 *   - 默认值构成一套「完全兼容」的配置，测试只需改坏一个点即可验证规则
 */

const base = {
  category: 'cpu',
  condition: 'new',
  aliases: ['x'],
  brands: undefined,
};

/** CPU 工厂 */
export function makeCpu(over = {}) {
  return {
    id: over.id || `cpu-test-${Math.random().toString(36).slice(2, 8)}`,
    category: 'cpu',
    brand: 'AMD',
    name: 'Ryzen 7 7800X3D',
    aliases: ['7800x3d'],
    condition: 'new',
    socket: 'AM5',
    cores: 8,
    threads: 16,
    baseClock: 4.2,
    boostClock: 5.0,
    l3Cache: 96,
    tdp: 120,
    maxPower: 162,
    memoryTypes: ['DDR5'],
    maxMemorySpeed: 5200,
    memoryChannels: 2,
    igpu: true,
    pcieVersion: 5,
    unlocked: false,
    gameScore: 100,
    productivityScore: 88,
    ...over,
  };
}

/** 主板工厂 —— 默认与上面 CPU 兼容 */
export function makeMb(over = {}) {
  return {
    id: over.id || `motherboard-test-${Math.random().toString(36).slice(2, 8)}`,
    category: 'motherboard',
    brand: '微星',
    name: 'MAG B650M MORTAR',
    aliases: ['b650m'],
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
    biosFlashback: true,
    ...over,
  };
}

/** 显卡工厂 */
export function makeGpu(over = {}) {
  return {
    id: over.id || `gpu-test-${Math.random().toString(36).slice(2, 8)}`,
    category: 'gpu',
    brand: '华硕',
    name: 'DUAL-RTX4070S',
    aliases: ['4070s'],
    condition: 'new',
    chipset: 'RTX 4070 SUPER',
    vram: 12,
    length_mm: 267,
    thicknessSlots: 2.5,
    tdp: 220,
    recommendedPsu: 650,
    pcie8pin: 1,
    pcie12vhpwr: 0,
    pcieVersion: 4,
    gameScore: 122,
    productivityScore: 118,
    ...over,
  };
}

/** 内存工厂 */
export function makeMem(over = {}) {
  return {
    id: over.id || `memory-test-${Math.random().toString(36).slice(2, 8)}`,
    category: 'memory',
    brand: '金士顿',
    name: 'FURY DDR5-5200 16GB×2',
    aliases: ['5200'],
    condition: 'new',
    memoryType: 'DDR5',
    capacityPerModule: 16,
    modules: 2,
    // 默认与 makeCpu 的 maxMemorySpeed(5200) 和 makeMb 的 maxMemorySpeed(6400) 均兼容，
    // 使基准配置为「零警告」，便于测试逐条隔离
    speed: 5200,
    casLatency: 30,
    voltage: 1.35,
    height_mm: 34,
    ecc: false,
    rgb: false,
    ...over,
  };
}

/** 电源工厂 */
export function makePsu(over = {}) {
  return {
    id: over.id || `psu-test-${Math.random().toString(36).slice(2, 8)}`,
    category: 'psu',
    brand: '海盗船',
    name: 'RM650',
    aliases: ['rm650'],
    condition: 'new',
    wattage: 650,
    formFactor: 'ATX',
    length_mm: 140,
    pcie8pin: 4,
    pcie12vhpwr: 1,
    eps8pin: 2,
    efficiency: '金牌',
    modular: '全模组',
    ...over,
  };
}

/** 机箱工厂 */
export function makeCase(over = {}) {
  return {
    id: over.id || `case-test-${Math.random().toString(36).slice(2, 8)}`,
    category: 'case',
    brand: '联力',
    name: 'LANCOOL 216',
    aliases: ['216'],
    condition: 'new',
    formFactors: ['E-ATX', 'ATX', 'M-ATX', 'Mini-ITX'],
    maxGpuLength: 392,
    maxGpuThickness: 3.5,
    maxCoolerHeight: 180,
    radiatorSupport: [120, 240, 280, 360],
    psuFormFactors: ['ATX', 'SFX', 'SFX-L'],
    maxPsuLength: 210,
    expansionSlots: 7,
    driveBays35: 2,
    driveBays25: 2,
    fanMounts: 7,
    sidePanel: '钢化玻璃',
    ...over,
  };
}

/** 散热器工厂（默认风冷） */
export function makeCooler(over = {}) {
  return {
    id: over.id || `cooler-test-${Math.random().toString(36).slice(2, 8)}`,
    category: 'cooler',
    brand: '利民',
    name: 'Peerless Assassin 120 SE',
    aliases: ['pa120'],
    condition: 'new',
    type: 'air',
    height_mm: 155,
    tdpRating: 245,
    sockets: ['AM4', 'AM5', 'LGA1700', 'LGA1200', 'LGA1851'],
    ramClearance_mm: 42,
    fanCount: 2,
    ...over,
  };
}

/** 水冷工厂 */
export function makeAio(over = {}) {
  return makeCooler({
    name: 'Frozen Magic 360',
    type: 'aio',
    radiatorSize: 360,
    height_mm: undefined,
    ramClearance_mm: 60,
    thickness_mm: 27,
    ...over,
  });
}

/** 硬盘工厂（默认 NVMe 系统盘） */
export function makeStorage(over = {}) {
  return {
    id: over.id || `storage-test-${Math.random().toString(36).slice(2, 8)}`,
    category: 'storage',
    brand: '三星',
    name: '990 PRO 1TB',
    aliases: ['990pro'],
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
    ...over,
  };
}

/** 构造一个 ID → 记录的索引 Map */
export function makeIndex(...records) {
  const map = new Map();
  for (const r of records.flat()) {
    if (r && r.id) map.set(r.id, r);
  }
  return map;
}

/**
 * 一套「完全兼容」的基准配置
 * 用它做起点，测试只需替换其中一件即可精确触发某条规则
 */
export function compatibleBuild() {
  const cpu = makeCpu({ id: 'cpu-base' });
  const mb = makeMb({ id: 'mb-base' });
  const gpu = makeGpu({ id: 'gpu-base' });
  const mem = makeMem({ id: 'mem-base' });
  const psu = makePsu({ id: 'psu-base' });
  const kase = makeCase({ id: 'case-base' });
  const cooler = makeCooler({ id: 'cooler-base' });
  const ssd = makeStorage({ id: 'ssd-base' });

  const items = [cpu, mb, gpu, mem, psu, kase, cooler, ssd];
  const index = makeIndex(items);

  const config = {
    cpu: cpu.id,
    motherboard: mb.id,
    gpu: gpu.id,
    memory: mem.id,
    psu: psu.id,
    cooler: cooler.id,
    case: kase.id,
    storage: [ssd.id],
  };

  return {
    cpu, mb, gpu, mem, psu, kase, cooler, ssd, items, index, config,
    /**
     * 已解析对象（键名与 computePower / rules 的 ctx 一致）
     * 注意与上面的短名区分：computePower 期望 { motherboard, memory, case }，
     * 不是 { mb, mem, kase }，传错会静默漏算部件功耗。
     */
    get resolved() {
      return {
        cpu, motherboard: mb, gpu, memory: mem, psu,
        cooler, case: kase, storage: [ssd],
      };
    },
  };
}
