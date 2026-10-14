import { readFileSync } from 'node:fs';

const html = readFileSync('dist/装机助手.html', 'utf8');
const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));

console.log('=== 问题1：详情区与列表区的视觉分隔 ===\n');
const detailRule = css.match(/\.detail-zone\s*\{[\s\S]*?\n\}/);
if (detailRule) {
  console.log('.detail-zone 规则：');
  for (const line of detailRule[0].split('\n').map((l) => l.trim()).filter(Boolean)) {
    console.log('   ' + line);
  }
}

const pick = (block, name) => (block.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'i')) || [])[1];
const darkBlock = css.match(/:root\s*\{[\s\S]*?\n\}/)[0];
const lightBlock = css.match(/:root\[data-theme="light"\]\s*\{[\s\S]*?\n\}/)[0];

console.log('\n背景令牌对比：');
for (const [name, block] of [['深色', darkBlock], ['浅色', lightBlock]]) {
  const bg = pick(block, '--bg');
  const surface = pick(block, '--surface');
  const ok = bg && surface && bg !== surface;
  console.log(`   ${name}: --bg=${bg}  --surface=${surface}  ${ok ? '✅ 不同' : '❌ 相同'}`);
}

console.log('\n=== 问题2：列表滚动位置保持 ===\n');
const code = html.slice(html.lastIndexOf('<script>'));
const checks = [
  ['function readScroll(', '读取滚动位置的辅助函数'],
  ['function restoreScroll(', '恢复滚动位置的辅助函数'],
  ["readScroll(centerEl, '.list-wrap')", '渲染前保存列表区位置'],
  ["readScroll(centerEl, '.detail-zone')", '渲染前保存详情区位置'],
  ["restoreScroll($('.list-wrap'", '渲染后恢复列表区位置'],
  ["restoreScroll($('.detail-zone'", '渲染后恢复详情区位置'],
  ['requestAnimationFrame', '下一帧补一次（内容未撑开时）'],
  ['.scrollTop = top', '实际设置 scrollTop'],
];
for (const [needle, desc] of checks) {
  const n = code.split(needle).length - 1;
  console.log(`   ${n > 0 ? '✅' : '❌'} ${desc.padEnd(34)} (${n} 处)`);
}

// 顺序校验：保存必须早于 innerHTML 赋值，赋值必须早于恢复
const assign = code.indexOf('centerEl.innerHTML = ');
const save = code.lastIndexOf('readScroll(', assign);
const restore = code.indexOf('restoreScroll(', assign);
console.log(`\n   顺序：保存(${save}) < 中栏赋值(${assign}) < 恢复(${restore})  ${save < assign && restore > assign ? '✅' : '❌'}`);
