/**
 * 界面美化相关测试（概览数字条 / 主题切换 / 冲突提示收敛）
 *
 * 对应 v1.3 的三项界面决策：
 *   1. 极简黑白（Linear/shadcn 取向）
 *   2. 冲突提示收敛：行首细色边 + 行内小标记，详细说明 hover 展开
 *   3. 顶部「配置概览」数字条
 *   4. 浅色 / 深色主题切换
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  renderOverview, renderTopBar, renderTable, renderLeftPanel,
} from '../src/ui/render.js';
import { computePower } from '../src/core/power.js';
import { compatibleBuild, makeCpu, makeGpu } from './fixtures/hardware.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ══════════════════════════════════════════════════════════════════
// 1. 配置概览数字条
// ══════════════════════════════════════════════════════════════════

test('概览：四个数据格（已选/兼容性/峰值/建议电源）齐全', () => {
  const b = compatibleBuild();
  const power = computePower(b.resolved);
  const html = renderOverview({
    summary: { selected: 8, total: 8, unselected: 0 },
    counts: { error: 0, warn: 1, info: 2 },
    power,
    onSuggestPsu: true,
  });

  assert.ok(html.includes('ov-label'), '应有数字条容器');
  for (const label of ['已选配件', '兼容性', '整机峰值功耗', '建议电源']) {
    assert.ok(html.includes(label), `应含「${label}」`);
  }
  assert.ok(html.includes('8'), '应显示已选数量');
  assert.ok(html.includes(`${power.peak}`), '应显示整机峰值');
  assert.ok(html.includes(`≥${power.recommendedPsu}`), '应显示建议电源');
});

test('概览：兼容性数量按级别着色（error 红 / warn 黄 / 全通过绿）', () => {
  const power = computePower(compatibleBuild().resolved);

  const errHtml = renderOverview({
    summary: { selected: 4, total: 8, unselected: 4 },
    counts: { error: 2, warn: 0, info: 0 },
    power,
  });
  assert.ok(errHtml.includes('data-level="error"'), '有错误时应标 error');

  const warnHtml = renderOverview({
    summary: { selected: 4, total: 8, unselected: 4 },
    counts: { error: 0, warn: 3, info: 0 },
    power,
  });
  assert.ok(warnHtml.includes('data-level="warn"'), '只有警告时应标 warn');

  const okHtml = renderOverview({
    summary: { selected: 8, total: 8, unselected: 0 },
    counts: { error: 0, warn: 0, info: 0 },
    power,
  });
  assert.ok(okHtml.includes('data-level="ok"'), '无问题时应标 ok');
  assert.ok(okHtml.includes('无冲突'), '无问题时应显示"无冲突"');
});

test('概览：未选电源时给出跳转链接；已选时显示余量', () => {
  const b = compatibleBuild();
  const power = computePower({ ...b.resolved, psu: null });

  const noPsu = renderOverview({
    summary: { selected: 7, total: 8, unselected: 1 }, counts: { error: 0, warn: 0, info: 0 },
    power, onSuggestPsu: true,
  });
  assert.ok(noPsu.includes('data-action="suggest-psu"'), '未选电源应提供跳转入口');
  assert.ok(noPsu.includes(`data-watts="${power.recommendedPsu}"`), '跳转应带上建议瓦数');

  const withPsu = renderOverview({
    summary: { selected: 8, total: 8, unselected: 0 }, counts: { error: 0, warn: 0, info: 0 },
    power: computePower({ ...b.resolved, psu: { name: 'P', wattage: 1200 } }),
    onSuggestPsu: true,
  });
  assert.ok(withPsu.includes('余量'), '已选电源应显示余量');
  assert.ok(withPsu.includes('1200W'), '应显示当前电源瓦数');
});

test('概览：空配置不崩溃（显示风扇基线功耗）', () => {
  // computePower 对空配置会给出机箱风扇估算基线（10W），
  // 而不是 null —— 概览应如实显示这个数值
  const power = computePower({});
  const html = renderOverview({
    summary: { selected: 0, total: 8, unselected: 8 },
    counts: { error: 0, warn: 0, info: 0 },
    power,
    onSuggestPsu: true,
  });
  assert.ok(html.includes('整机峰值功耗'), '应正常渲染');
  assert.ok(html.includes(String(power.peak)), `应显示基线功耗 ${power.peak}W`);
  assert.ok(html.includes('suggest-psu'), '未选电源时应给出跳转入口');
});

test('概览：power 为 null 时也不崩溃（占位符兜底）', () => {
  const html = renderOverview({
    summary: { selected: 0, total: 8, unselected: 8 },
    counts: { error: 0, warn: 0, info: 0 },
    power: null,
    onSuggestPsu: true,
  });
  assert.ok(html.includes('整机峰值功耗'), '应正常渲染');
  assert.ok(html.includes('—'), '无功耗数据时用破折号占位');
  assert.ok(html.includes('建议电源'), '建议电源标签仍在');
});

// ══════════════════════════════════════════════════════════════════
// 2. 冲突提示收敛
// ══════════════════════════════════════════════════════════════════

test('冲突：行内改为小标记 + 色边，不再每行铺红底', () => {
  const gpu = makeGpu({ id: 'g1', name: '冲突显卡' });
  const html = renderTable({
    category: 'gpu',
    items: [gpu],
    checkCandidate: () => ({
      level: 'error',
      findings: [{ reason: '插槽不匹配', refs: [] }],
    }),
    isSelected: () => false,
  });

  // 行首色边（CSS 类）
  assert.ok(html.includes('is-conflict'), '行应有冲突类（配合 CSS 左侧色边）');
  // 型号单元格内的小标记
  assert.ok(html.includes('row-flag'), '型号旁应有冲突小标记');
  // 详情仍存在但默认隐藏（靠 CSS tr.conflict-row{display:none}）
  assert.ok(html.includes('conflict-row'), '详情行仍保留（hover 展开）');
});

test('冲突：小标记带 title 说明原因（hover 可见）', () => {
  const gpu = makeGpu({ id: 'g1', name: 'X' });
  const html = renderTable({
    category: 'gpu',
    items: [gpu],
    checkCandidate: () => ({
      level: 'error',
      findings: [{ reason: '电源接口不足', refs: [] }],
    }),
    isSelected: () => false,
  });
  assert.ok(html.includes('title="电源接口不足"'), '小标记 title 应含冲突原因');
});

test('冲突：警告级用不同的类名与标记（warn）', () => {
  const gpu = makeGpu({ id: 'g1' });
  const html = renderTable({
    category: 'gpu',
    items: [gpu],
    checkCandidate: () => ({ level: 'warn', findings: [{ reason: '余量不足', refs: [] }] }),
    isSelected: () => false,
  });
  assert.ok(html.includes('data-level="warn"'), '警告级应标 warn');
});

test('冲突：无冲突的型号没有小标记', () => {
  const gpu = makeGpu({ id: 'g1' });
  const html = renderTable({
    category: 'gpu',
    items: [gpu],
    checkCandidate: () => ({ level: 'ok', findings: [] }),
    isSelected: () => false,
  });
  assert.ok(!html.includes('row-flag'), '无冲突不应有小标记');
});

test('冲突：仍然可以点选（只提示不拦截，PRD M3-4）', () => {
  const gpu = makeGpu({ id: 'g1' });
  const html = renderTable({
    category: 'gpu',
    items: [gpu],
    checkCandidate: () => ({ level: 'error', findings: [{ reason: 'x', refs: [] }] }),
    isSelected: () => false,
  });
  assert.ok(html.includes('data-pick="g1"'), '冲突型号仍须有可选按钮');
  assert.ok(!/\bdisabled\b/.test(html), '不得禁用');
});

// ══════════════════════════════════════════════════════════════════
// 3. 主题切换
// ══════════════════════════════════════════════════════════════════

test('主题：顶栏有切换按钮且标签随当前主题变化', () => {
  const dark = renderTopBar({ schemes: [], theme: 'dark' });
  assert.ok(dark.includes('data-action="toggle-theme"'), '应有主题切换按钮');
  assert.ok(dark.includes('深色'), '深色主题下应提示可切到深色（或显示当前）');

  const light = renderTopBar({ schemes: [], theme: 'light' });
  assert.ok(light.includes('data-action="toggle-theme"'), '浅色主题下也应有按钮');
  assert.ok(light.includes('浅色'), '浅色主题按钮标签应变化');
  assert.notEqual(
    dark.match(/toggle-theme[\s\S]{0,200}?<\/button>/)[0],
    light.match(/toggle-theme[\s\S]{0,200}?<\/button>/)[0],
    '两种主题下按钮内容应不同',
  );
});

test('主题：app.js 实现读取、应用与持久化', () => {
  const src = readFileSync(join(ROOT, 'src', 'ui', 'app.js'), 'utf8');
  assert.ok(/function getTheme\(/.test(src), '应有 getTheme');
  assert.ok(/function applyTheme\(/.test(src), '应有 applyTheme');
  assert.ok(/function toggleTheme\(/.test(src), '应有 toggleTheme');
  assert.ok(/case 'toggle-theme'/.test(src), '应绑定切换动作');
  assert.ok(/zhuangji:theme/.test(src), '应持久化主题偏好');
  assert.ok(/data-theme/.test(src), '应通过 data-theme 应用主题');
  assert.ok(/applyTheme\(getTheme\(\)\)/.test(src), '启动时应应用主题');
});

test('主题：CSS 同时定义深色与浅色令牌', () => {
  const css = readFileSync(join(ROOT, 'src', 'styles.css'), 'utf8');
  assert.ok(/:root\s*\{/.test(css), '应有默认（深色）令牌');
  assert.ok(/:root\[data-theme="light"\]/.test(css), '应定义浅色主题');
  // 关键令牌在两个主题里都要有定义
  for (const token of ['--bg', '--surface', '--fg', '--error', '--ok', '--accent']) {
    const count = (css.match(new RegExp(token.replace(/[-]/g, '\\-'), 'g')) || []).length;
    assert.ok(count >= 2, `${token} 应在深浅两套主题中都有定义`);
  }
  assert.ok(/color-scheme:\s*dark/.test(css), '应声明深色 color-scheme');
  assert.ok(/color-scheme:\s*light/.test(css), '应声明浅色 color-scheme');
});

// ══════════════════════════════════════════════════════════════════
// 4. 左栏结构（层级更清晰）
// ══════════════════════════════════════════════════════════════════

test('左栏：品类名与型号分两行，状态灯独立在右上', () => {
  const b = compatibleBuild();
  const html = renderLeftPanel({
    config: { cpu: b.cpu.id },
    byId: b.index,
    lights: { cpu: 'ok' },
    active: 'cpu',
    summary: { selected: 1, total: 8, unselected: 7 },
  });
  assert.ok(html.includes('cat-head'), '应有标题行容器');
  assert.ok(html.includes('cat-name'), '应有品类名');
  assert.ok(html.includes('cat-value'), '应有型号值');
  assert.ok(html.includes('cat-light'), '应有状态灯');
  assert.ok(!html.includes('cat-mark'), '冗余的圆点符号应移除');
});

test('左栏：失效引用显示「型号已失效」而非「未选」', () => {
  const html = renderLeftPanel({
    config: { cpu: 'cpu-已删除' },
    byId: new Map(),
    lights: { cpu: 'invalid' },
    active: 'cpu',
    summary: { selected: 1, total: 8, unselected: 7 },
  });
  assert.ok(html.includes('型号已失效'), '应明确提示失效');
  assert.ok(html.includes('is-invalid'), '应有失效样式类');
});

// ══════════════════════════════════════════════════════════════════
// 5. 无价格（回归：A15 门禁在美化后仍成立）
// ══════════════════════════════════════════════════════════════════

test('回归：新增的概览与主题按钮不含价格内容（A15）', () => {
  const b = compatibleBuild();
  const power = computePower(b.resolved);
  const overview = renderOverview({
    summary: { selected: 8, total: 8, unselected: 0 },
    counts: { error: 0, warn: 0, info: 0 }, power, onSuggestPsu: true,
  });
  const topbar = renderTopBar({ schemes: [], theme: 'dark' });

  for (const [name, html] of [['概览', overview], ['顶栏', topbar]]) {
    assert.ok(!html.includes('¥'), `${name}不应含 ¥`);
    assert.ok(!/总价|价格|超支/.test(html), `${name}不应含价格文案`);
  }
  // 功耗是允许的（电压/瓦数）
  assert.ok(overview.includes('W'), '概览应保留功耗信息');
});