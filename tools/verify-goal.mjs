/**
 * 目标验收核对（一次性验证脚本，用于交付前逐条核对）
 *
 * 逐条核对本轮三个子目标：
 *   (1) 方案可删除（含重命名管理界面）
 *   (2) 补全二手主流硬件数据，总量 300~500，重点覆盖指定插槽与矿卡
 *   (3) 每项改动配套自动化测试
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATEGORY_LIST, CATEGORY_FIELDS } from '../schema/fields.js';
import { CATEGORY_LABELS } from '../src/core/enums.js';
import { Store } from '../src/core/store.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = (c) => JSON.parse(readFileSync(join(ROOT, 'data', CATEGORY_FIELDS[c].file), 'utf8'));
const DB = Object.fromEntries(CATEGORY_LIST.map((c) => [c, load(c)]));

let failures = 0;
const line = (ok, text) => { if (!ok) failures++; console.log(`  ${ok ? '✅' : '❌'} ${text}`); };

console.log('════════ 目标 2：数据总量与二手覆盖 ════════\n');

let total = 0;
for (const c of CATEGORY_LIST) total += DB[c].length;
line(total >= 300 && total <= 500, `总量 ${total}（要求 300~500）`);

console.log('\n各品类数量 / 二手数：');
for (const c of CATEGORY_LIST) {
  const n = DB[c].length;
  const u = DB[c].filter((r) => r.condition && r.condition !== 'new').length;
  const need = CATEGORY_FIELDS[c].minCount;
  line(n >= need, `${(CATEGORY_LABELS[c] || c).padEnd(4)} ${n}/${need}  二手 ${u}${u > 0 ? '' : ' ⚠二手为0'}`);
}

console.log('\n--- 目标点名的二手平台（CPU/主板/散热器 三者齐全）---');
for (const s of ['LGA1150', 'LGA1155', 'LGA1151', 'LGA2011', 'LGA2011-3', 'AM4']) {
  const cpus = DB.cpu.filter((c) => c.socket === s && c.condition !== 'new').length;
  const mbs = DB.motherboard.filter((m) => m.socket === s && m.condition !== 'new').length;
  const cools = DB.cooler.filter((c) => (c.sockets || []).includes(s)).length;
  line(cpus > 0 && mbs > 0 && cools > 0,
    `${s.padEnd(11)} 二手CPU ${cpus}  二手主板 ${mbs}  散热器 ${cools}`);
}

const mining = DB.gpu.filter((g) => g.condition === 'mining');
console.log('\n--- 矿卡 ---');
line(mining.length >= 10, `矿卡 ${mining.length} 张`);
console.log(`     ${mining.slice(0, 6).map((g) => g.name).join('、')}`);

console.log('\n--- 三种二手类型 ---');
for (const cond of ['used', 'mining', 'oem']) {
  const n = CATEGORY_LIST.reduce((a, c) => a + DB[c].filter((r) => r.condition === cond).length, 0);
  line(n > 0, `${cond} ${n} 条`);
}

console.log('\n\n════════ 目标 1：方案可删除 ════════\n');
const appSrc = readFileSync(join(ROOT, 'src/ui/app.js'), 'utf8');
const renderSrc = readFileSync(join(ROOT, 'src/ui/render.js'), 'utf8');

line(/store\.deleteScheme\(/.test(appSrc), 'app.js 调用 store.deleteScheme');
line(/store\.renameScheme\(/.test(appSrc), 'app.js 调用 store.renameScheme');
line(/function openSchemeManager/.test(appSrc), 'app.js 实现 openSchemeManager');
line(/t\.dataset\.schemeDelete/.test(appSrc), '绑定 schemeDelete 事件');
line(/t\.dataset\.schemeRename/.test(appSrc), '绑定 schemeRename 事件');
line(/t\.dataset\.schemeLoad/.test(appSrc), '绑定 schemeLoad 事件');
line(/function promptDeleteScheme[\s\S]{0,400}confirm\(/.test(appSrc), '删除有二次确认');
line(/export function renderSchemeManager/.test(renderSrc), 'render.js 导出 renderSchemeManager');
line(/data-action="scheme-manage"/.test(renderSrc), '顶部栏有「管理」入口');
line(/data-scheme-delete=/.test(renderSrc), '渲染删除按钮');
line(/data-scheme-rename=/.test(renderSrc), '渲染重命名按钮');

const mem = (() => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
})();
const store = new Store({ storage: mem, autoSave: false });
store.select('cpu', 'c1'); store.saveScheme('方案甲');
store.select('cpu', 'c2'); store.saveScheme('方案乙');
const before = store.schemeNames().length;
store.deleteScheme('方案甲');
const after = store.schemeNames().length;
line(before === 2 && after === 1, `删除实测：${before} 套 → ${after} 套`);
store.renameScheme('方案乙', '方案丙');
line(store.schemeNames()[0] === '方案丙', `重命名实测：${JSON.stringify(store.schemeNames())}`);

console.log('\n\n════════ 目标 3：测试配套 ════════\n');
for (const f of ['scheme.test.mjs', 'secondhand.test.mjs', 'compat.test.mjs', 'acceptance.test.mjs', 'artifact.test.mjs']) {
  line(existsSync(join(ROOT, 'tests', f)), `tests/${f}`);
}

console.log(`\n\n${failures === 0 ? '✅ 全部核对通过' : `❌ ${failures} 项未通过`}`);
process.exit(failures === 0 ? 0 : 1);