/**
 * 阶段 0 回归测试：字段规范 / 校验脚本 / CSV 模板 / 转换器
 *
 * 目的：把「四者必须一致」这条约束固化成可自动执行的测试，
 *      避免后续改字段时出现规范漂移。
 *
 * 运行: node --test tests/
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { ENUMS, CATEGORY_LABELS, SOCKETS, FORM_FACTORS, PSU_FORM_FACTORS, RADIATOR_SIZES } from '../src/core/enums.js';
import {
  CATEGORY_LIST,
  CATEGORY_FIELDS,
  COMMON_FIELDS,
  allFieldsOf,
  requiredKeysOf,
} from '../schema/fields.js';
import { parseCsv, extractKey, csvToRecords } from '../tools/csv-to-json.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NODE = process.execPath;

// ══════════════════════════════════════════════════════════════════
// 1. 字段规范完整性
// ══════════════════════════════════════════════════════════════════

test('字段规范：8 个品类齐备且与 enums 品类一致', () => {
  assert.equal(CATEGORY_LIST.length, 8);
  assert.deepEqual([...CATEGORY_LIST].sort(), [...ENUMS.category].sort());
  for (const c of CATEGORY_LIST) {
    assert.ok(CATEGORY_FIELDS[c].label, `${c} 缺 label`);
    assert.ok(CATEGORY_FIELDS[c].file, `${c} 缺 file`);
    assert.ok(CATEGORY_FIELDS[c].csvFile, `${c} 缺 csvFile`);
    assert.ok(CATEGORY_FIELDS[c].minCount >= 30, `${c} minCount 应 ≥30（PRD A2）`);
  }
});

test('字段规范：每个品类都有必填字段，且键名唯一', () => {
  for (const c of CATEGORY_LIST) {
    const keys = allFieldsOf(c).map((f) => f.key);
    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
    assert.deepEqual(dupes, [], `${c} 存在重复字段名: ${dupes}`);
    assert.ok(requiredKeysOf(c).length > 0, `${c} 没有必填字段`);
  }
});

test('字段规范：枚举引用都真实存在于 enums.js', () => {
  for (const c of CATEGORY_LIST) {
    for (const f of allFieldsOf(c)) {
      if (f.enum) {
        assert.ok(
          ENUMS[f.enum],
          `${c}.${f.key} 引用了不存在的枚举集合 "${f.enum}"`,
        );
      }
      if (f.requiredIf) {
        const keys = allFieldsOf(c).map((x) => x.key);
        assert.ok(
          keys.includes(f.requiredIf.field),
          `${c}.${f.key} 的 requiredIf 引用了不存在的字段 "${f.requiredIf.field}"`,
        );
      }
    }
  }
});

test('字段规范：范围区间合法（min < max）', () => {
  for (const c of CATEGORY_LIST) {
    for (const f of allFieldsOf(c)) {
      if (f.range) {
        assert.ok(
          f.range.min < f.range.max,
          `${c}.${f.key} range 非法: ${f.range.min} ~ ${f.range.max}`,
        );
      }
    }
  }
});

test('字段规范：参与 PRD 规则的关键字段都已标注 rules', () => {
  // PRD 第四部分的核心判定字段，缺一个都会让规则引擎无从取值
  const mustHaveRules = {
    cpu: ['socket', 'maxPower', 'memoryTypes', 'maxMemorySpeed', 'igpu'],
    motherboard: ['socket', 'formFactor', 'memoryType', 'memorySlots', 'maxMemorySpeed', 'pcieVersion', 'm2Slots', 'sataPorts', 'cpuPowerConnectors'],
    gpu: ['length_mm', 'thicknessSlots', 'tdp', 'pcie8pin', 'pcie12vhpwr', 'pcieVersion'],
    memory: ['memoryType', 'modules', 'speed', 'height_mm'],
    psu: ['wattage', 'formFactor', 'length_mm', 'pcie8pin', 'pcie12vhpwr', 'eps8pin'],
    case: ['formFactors', 'maxGpuLength', 'maxGpuThickness', 'maxCoolerHeight', 'radiatorSupport', 'psuFormFactors', 'maxPsuLength', 'fanMounts'],
    cooler: ['type', 'tdpRating', 'sockets'],
    storage: ['interface', 'nandType', 'dram'],
  };
  for (const [cat, keys] of Object.entries(mustHaveRules)) {
    const map = Object.fromEntries(allFieldsOf(cat).map((f) => [f.key, f]));
    for (const k of keys) {
      assert.ok(map[k], `${cat}.${k} 字段缺失`);
      assert.ok(
        Array.isArray(map[k].rules) && map[k].rules.length > 0,
        `${cat}.${k} 应标注 rules（PRD 规则会用到它）`,
      );
    }
  }
});

test('字段规范：price 标记为 P1 预留（PRD 1.5 本期不用）', () => {
  const price = COMMON_FIELDS.find((f) => f.key === 'price');
  assert.ok(price, '通用字段缺 price');
  assert.equal(price.p1, true, 'price 必须标记 p1:true');
  // 且不应是必填，否则用户不填价格就无法通过校验
  assert.notEqual(price.required, true, 'price 不应为必填');
});

// ══════════════════════════════════════════════════════════════════
// 2. 枚举自身一致性
// ══════════════════════════════════════════════════════════════════

test('枚举：插槽列表含 PRD 要求的平台，且无重复', () => {
  const need = ['AM4', 'AM5', 'LGA1700', 'LGA1851'];
  for (const n of need) assert.ok(SOCKETS.includes(n), `插槽缺 ${n}`);
  assert.equal(new Set(SOCKETS).size, SOCKETS.length, '插槽有重复');
});

test('枚举：板型/电源规格/冷排规格无重复且取值非空', () => {
  for (const [name, arr] of [['FORM_FACTORS', FORM_FACTORS], ['PSU_FORM_FACTORS', PSU_FORM_FACTORS], ['RADIATOR_SIZES', RADIATOR_SIZES]]) {
    assert.ok(arr.length > 0, `${name} 为空`);
    assert.equal(new Set(arr).size, arr.length, `${name} 有重复`);
    assert.ok(arr.every((x) => x !== '' && x != null), `${name} 含空值`);
  }
});

test('枚举：LEVELS 与状态灯映射完整', async () => {
  const m = await import('../src/core/enums.js');
  for (const lv of ENUMS.level) {
    assert.ok(m.LEVEL_ICONS[lv], `LEVEL_ICONS 缺 ${lv}`);
    assert.ok(m.LEVEL_LABELS[lv], `LEVEL_LABELS 缺 ${lv}`);
    assert.ok(typeof m.LEVEL_SEVERITY[lv] === 'number', `LEVEL_SEVERITY 缺 ${lv}`);
  }
  for (const s of m.STATUS_LIGHTS) {
    assert.ok(m.STATUS_ICONS[s], `STATUS_ICONS 缺 ${s}`);
  }
});

// ══════════════════════════════════════════════════════════════════
// 3. CSV 模板生成与四者一致性
// ══════════════════════════════════════════════════════════════════

test('CSV 模板：8 份模板均已生成，且三行结构正确', () => {
  for (const c of CATEGORY_LIST) {
    const p = join(ROOT, 'csv-templates', CATEGORY_FIELDS[c].csvFile);
    assert.ok(existsSync(p), `模板缺失: ${p}`);

    const rows = parseCsv(readFileSync(p, 'utf8'));
    assert.ok(rows.length >= 3, `${c} 模板应至少 3 行`);

    const fields = allFieldsOf(c);

    // 第 1 行：可读表头，字段数一致
    assert.equal(rows[0].length, fields.length, `${c} 第 1 行列数与字段数不符`);

    // 第 2 行：纯字段名，必须与 fields.js 完全一致
    const machineKeys = rows[1].map((x) => String(x).trim());
    assert.deepEqual(
      machineKeys,
      fields.map((f) => f.key),
      `${c} 第 2 行字段名与 fields.js 不一致`,
    );

    // 第 3 行：示例行字段数一致
    assert.equal(rows[2].length, fields.length, `${c} 示例行列数不符`);
  }
});

test('CSV 模板：表头含 [必填] 标记与单位说明', () => {
  for (const c of CATEGORY_LIST) {
    const p = join(ROOT, 'csv-templates', CATEGORY_FIELDS[c].csvFile);
    const rows = parseCsv(readFileSync(p, 'utf8'));
    const header = rows[0].map(String);
    const requiredCount = allFieldsOf(c).filter((f) => f.required).length;
    const marked = header.filter((h) => h.includes('[必填]')).length;
    assert.equal(marked, requiredCount, `${c} [必填] 标记数(${marked}) 应为 ${requiredCount}`);
  }
});

test('CSV 模板：示例行能被解析成合法记录并通过结构检查', () => {
  for (const c of CATEGORY_LIST) {
    const p = join(ROOT, 'csv-templates', CATEGORY_FIELDS[c].csvFile);
    // keepSample 打开，用于取出示例行验证其格式正确
    const { records } = csvToRecords(readFileSync(p, 'utf8'), c, { keepSample: true });
    assert.equal(records.length, 1, `${c} 应解析出 1 条示例记录`);
    const rec = records[0];
    assert.ok(rec.id, `${c} 示例缺 id`);
    assert.equal(rec.category, c, `${c} 示例 category 错误`);
    // 必填字段都必须有值，否则示例本身就不合法
    for (const key of requiredKeysOf(c)) {
      assert.ok(
        rec[key] !== undefined && rec[key] !== null && rec[key] !== '',
        `${c} 示例行缺必填字段 ${key}`,
      );
    }
    // 布尔字段必须解析为 boolean（验证 是/否 转换生效）
    const boolFields = allFieldsOf(c).filter((f) => f.type === 'boolean');
    for (const f of boolFields) {
      if (rec[f.key] !== undefined) {
        assert.equal(typeof rec[f.key], 'boolean', `${c}.${f.key} 未转为布尔值`);
      }
    }
    // 数组字段必须是数组
    const arrFields = allFieldsOf(c).filter((f) => f.type.endsWith('[]'));
    for (const f of arrFields) {
      if (rec[f.key] !== undefined) {
        assert.ok(Array.isArray(rec[f.key]), `${c}.${f.key} 未转为数组`);
      }
    }
  }
});

test('CSV 模板：三行结构的示例行不会被当成真实数据', () => {
  for (const c of CATEGORY_LIST) {
    const p = join(ROOT, 'csv-templates', CATEGORY_FIELDS[c].csvFile);
    const { records } = csvToRecords(readFileSync(p, 'utf8'), c);
    assert.equal(records.length, 0, `${c} 模板只有示例行，不应产出真实数据`);
  }
});

// ══════════════════════════════════════════════════════════════════
// 4. CSV 解析器
// ══════════════════════════════════════════════════════════════════

test('parseCsv：处理引号、逗号、换行与 BOM', () => {
  const csv = '\uFEFFa,b,c\r\n1,"x,y",3\r\n"line\nbreak",2,3\r\n';
  const rows = parseCsv(csv);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], ['a', 'b', 'c']);
  assert.deepEqual(rows[1], ['1', 'x,y', '3']);
  assert.deepEqual(rows[2], ['line\nbreak', '2', '3']);
});

test('parseCsv：处理双引号转义与空行', () => {
  const rows = parseCsv('a,b\n"say ""hi""",2\n\n,,\n');
  assert.equal(rows.length, 2);
  assert.equal(rows[1][0], 'say "hi"');
});

test('extractKey：从可读表头提取字段名', () => {
  assert.equal(extractKey('socket[必填] 插槽｜取值: AM4 / AM5'), 'socket');
  assert.equal(extractKey('height_mm[条件必填] (mm) 风冷高度'), 'height_mm');
  assert.equal(extractKey('price (元) 参考价｜本期不使用，可留空'), 'price');
  assert.equal(extractKey('gameScore[必填] 游戏性能分'), 'gameScore');
});

test('csvToRecords：日期/数字/布尔/数组混合解析', () => {
  const csv = [
    'id[必填] 标识,igpu[必填] 核显,memoryTypes[必填] 代数,cores[必填] 核心,estimated 近似',
    'id,igpu,memoryTypes,cores,estimated',
    'cpu-x,是,DDR5,8,x',
    'cpu-a,否,DDR4;DDR5,6,gameScore;cores',
  ].join('\n');
  const { records } = csvToRecords(csv, 'cpu');
  assert.equal(records.length, 1);
  assert.equal(records[0].id, 'cpu-a');
  assert.equal(records[0].igpu, false);
  assert.deepEqual(records[0].memoryTypes, ['DDR4', 'DDR5']);
  assert.equal(records[0].cores, 6);
  assert.deepEqual(records[0].estimated, ['gameScore', 'cores']);
});

// ══════════════════════════════════════════════════════════════════
// 5. 校验脚本：正向与负向
// ══════════════════════════════════════════════════════════════════

function runValidator(args, cwd, scriptPath) {
  const script = scriptPath || join(ROOT, 'tools', 'validate-data.mjs');
  try {
    const out = execFileSync(NODE, [script, ...args], {
      cwd: cwd || ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') };
  }
}

/** 搭建一个自带 schema/src/tools 的临时工程目录，返回其校验脚本路径 */
function makeSandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'zj-sandbox-'));
  for (const sub of ['schema/fields.js', 'src/core/enums.js', 'tools/validate-data.mjs']) {
    const dst = join(dir, sub);
    mkdirSync(dirname(dst), { recursive: true });
    writeFileSync(dst, readFileSync(join(ROOT, sub), 'utf8'), 'utf8');
  }
  mkdirSync(join(dir, 'data'), { recursive: true });
  return dir;
}

test('校验脚本：data 目录不存在时优雅跳过（退出码 0，不崩溃）', () => {
  const dir = makeSandbox();
  try {
    rmSync(join(dir, 'data'), { recursive: true, force: true });
    const r = runValidator(['cpu'], dir, join(dir, 'tools', 'validate-data.mjs'));
    assert.equal(r.code, 0, `应优雅跳过，实际输出:\n${r.out}`);
    assert.match(r.out, /data\/ 目录尚不存在/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('校验脚本：能抓到 8 类错误（负向测试）', () => {
  const dir = makeSandbox();
  try {
    const bad = [
      {
        id: 'cpu-a',
        category: 'cpu',
        brand: 'A',
        name: 'N',
        aliases: ['x'],
        condition: 'new',
        socket: 'am5',                       // 枚举大小写错误
        cores: 8,
        threads: 16,
        baseClock: 4.2,
        boostClock: 5.0,
        tdp: 120,
        maxPower: 162,
        memoryTypes: ['DDR9'],               // 数组元素枚举越界
        maxMemorySpeed: 5200,
        igpu: 'yes',                         // 类型错误
        gameScore: 100,
        productivityScore: 88,
        typoField: 1,                        // 未知字段
      },
      { id: 'cpu-a', category: 'gpu', aliases: [], condition: 'zzz' }, // 重复 id + category 不符 + 缺必填 + 枚举错
    ];
    writeFileSync(join(dir, 'data', 'cpu.json'), JSON.stringify(bad), 'utf8');

    const r = runValidator(['cpu'], dir, join(dir, 'tools', 'validate-data.mjs'));
    assert.equal(r.code, 1, `有错误时应退出码 1，实际输出:\n${r.out}`);
    assert.match(r.out, /枚举越界/, '应报告枚举越界');
    assert.match(r.out, /类型错误/, '应报告类型错误');
    assert.match(r.out, /必填字段缺失/, '应报告缺必填');
    assert.match(r.out, /id 重复/, '应报告 id 重复');
    assert.match(r.out, /未知字段/, '应报告未知字段');
    assert.match(r.out, /category: 应为 "cpu"，实际 "gpu"/, '应报告 category 不符');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('校验脚本：合法数据通过（正向测试）', () => {
  const dir = makeSandbox();
  try {
    // 用模板示例行构造一批真实数据（8 品类各 1 条）
    for (const c of CATEGORY_LIST) {
      const p = join(ROOT, 'csv-templates', CATEGORY_FIELDS[c].csvFile);
      const { records } = csvToRecords(readFileSync(p, 'utf8'), c, { keepSample: true });
      writeFileSync(join(dir, 'data', CATEGORY_FIELDS[c].file), JSON.stringify(records, null, 2), 'utf8');
    }
    const r = runValidator([], dir, join(dir, 'tools', 'validate-data.mjs'));
    assert.equal(r.code, 0, `示例数据应通过校验，实际输出:\n${r.out}`);
    assert.match(r.out, /校验通过：0 错误/);
    assert.match(r.out, /合计记录数: 8/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('校验脚本：BOM 容忍（Windows 常见）', () => {
  const dir = makeSandbox();
  try {
    writeFileSync(join(dir, 'data', 'cpu.json'), '\uFEFF' + JSON.stringify([]), 'utf8');
    const r = runValidator(['cpu'], dir, join(dir, 'tools', 'validate-data.mjs'));
    assert.equal(r.code, 0, `带 BOM 的 JSON 不应报错，实际输出:\n${r.out}`);
    assert.doesNotMatch(r.out, /JSON 解析失败/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('校验脚本：条件必填生效（风冷必有高度、水冷必有冷排规格）', () => {
  const dir = makeSandbox();
  try {
    const base = {
      id: 'cooler-x', category: 'cooler', brand: 'A', name: 'N',
      aliases: ['x'], condition: 'new', tdpRating: 200, sockets: ['AM5'],
    };
    // 风冷缺 height_mm → 应报错
    writeFileSync(join(dir, 'data', 'cooler.json'),
      JSON.stringify([{ ...base, type: 'air', radiatorSize: 240 }]), 'utf8');
    let r = runValidator(['cooler'], dir, join(dir, 'tools', 'validate-data.mjs'));
    assert.equal(r.code, 1, '风冷缺 height_mm 应报错');
    assert.match(r.out, /height_mm: 必填字段缺失（当 type = air 时必填）/);

    // 水冷缺 radiatorSize → 应报错
    writeFileSync(join(dir, 'data', 'cooler.json'),
      JSON.stringify([{ ...base, type: 'aio', height_mm: 150 }]), 'utf8');
    r = runValidator(['cooler'], dir, join(dir, 'tools', 'validate-data.mjs'));
    assert.equal(r.code, 1, '水冷缺 radiatorSize 应报错');
    assert.match(r.out, /radiatorSize: 必填字段缺失（当 type = aio 时必填）/);

    // 两者都齐 → 通过
    writeFileSync(join(dir, 'data', 'cooler.json'),
      JSON.stringify([
        { ...base, id: 'cooler-a', type: 'air', height_mm: 155 },
        { ...base, id: 'cooler-b', type: 'aio', radiatorSize: 240 },
      ]), 'utf8');
    r = runValidator(['cooler'], dir, join(dir, 'tools', 'validate-data.mjs'));
    assert.equal(r.code, 0, `字段齐备应通过，实际:\n${r.out}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('校验脚本：空数组语义正确（无 minItems 时合法，有 minItems 时视为缺失）', () => {
  const dir = makeSandbox();
  try {
    const caseRec = {
      id: 'case-t', category: 'case', brand: '测试', name: '无冷排位机箱',
      aliases: ['t'], condition: 'new',
      formFactors: ['Mini-ITX'], maxGpuLength: 200, maxGpuThickness: 2,
      maxCoolerHeight: 70, psuFormFactors: ['SFX'], maxPsuLength: 150,
      expansionSlots: 2, fanMounts: 2,
    };

    // radiatorSupport 未声明 minItems → [] 表示「该机箱不支持水冷」，必须合法
    writeFileSync(join(dir, 'data', 'case.json'),
      JSON.stringify([{ ...caseRec, radiatorSupport: [] }]), 'utf8');
    let r = runValidator(['case'], dir, join(dir, 'tools', 'validate-data.mjs'));
    assert.equal(r.code, 0,
      `radiatorSupport: [] 应合法（语义为"无冷排位"），实际:\n${r.out}`);

    // aliases 声明了 minItems:1 → [] 应报缺失
    const cpuRec = {
      id: 'cpu-t', category: 'cpu', brand: '测试', name: 'N',
      condition: 'new', socket: 'AM5', cores: 8, threads: 16,
      baseClock: 4.2, boostClock: 5.0, tdp: 120, maxPower: 162,
      memoryTypes: ['DDR5'], maxMemorySpeed: 5200, igpu: true,
      gameScore: 100, productivityScore: 88,
    };
    writeFileSync(join(dir, 'data', 'cpu.json'),
      JSON.stringify([{ ...cpuRec, aliases: [] }]), 'utf8');
    r = runValidator(['cpu'], dir, join(dir, 'tools', 'validate-data.mjs'));
    assert.equal(r.code, 1, 'aliases: [] 应报必填缺失（该字段有 minItems）');
    assert.match(r.out, /aliases: 必填字段缺失/);

    // formFactors 也声明了 minItems → [] 应报
    writeFileSync(join(dir, 'data', 'case.json'),
      JSON.stringify([{ ...caseRec, formFactors: [], radiatorSupport: [] }]), 'utf8');
    r = runValidator(['case'], dir, join(dir, 'tools', 'validate-data.mjs'));
    assert.equal(r.code, 1, 'formFactors: [] 应报必填缺失（该字段有 minItems）');
    assert.match(r.out, /formFactors: 必填字段缺失/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ══════════════════════════════════════════════════════════════════
// 6. JSON Schema 生成
// ══════════════════════════════════════════════════════════════════

test('JSON Schema：已生成且覆盖全部品类与字段', () => {
  const p = join(ROOT, 'schema', 'hardware.schema.json');
  assert.ok(existsSync(p), 'hardware.schema.json 未生成，请运行 node tools/gen-schema.mjs');
  const doc = JSON.parse(readFileSync(p, 'utf8'));
  assert.ok(doc.definitions.commonFields, '缺 commonFields');
  for (const c of CATEGORY_LIST) {
    assert.ok(doc.definitions[c], `Schema 缺品类 ${c}`);
    const props = Object.keys(doc.definitions[c].properties);
    for (const f of allFieldsOf(c)) {
      assert.ok(props.includes(f.key), `Schema ${c} 缺字段 ${f.key}`);
    }
  }
  assert.deepEqual(doc['x-categories'].length, 8);
});

test('JSON Schema：字段数与 fields.js 一致（防止规范漂移）', () => {
  const doc = JSON.parse(readFileSync(join(ROOT, 'schema', 'hardware.schema.json'), 'utf8'));
  for (const c of CATEGORY_LIST) {
    const expected = allFieldsOf(c).length;
    const actual = Object.keys(doc.definitions[c].properties).length;
    // properties 里 category 被覆盖为 const，不额外增数
    assert.equal(actual, expected, `${c} 字段数不一致: schema=${actual} fields.js=${expected}`);
  }
});
