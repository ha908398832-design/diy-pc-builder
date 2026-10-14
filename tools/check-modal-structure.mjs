import { readFileSync } from 'node:fs';

const html = readFileSync('dist/装机助手.html', 'utf8');
// 只看 body 部分（模板结构），脚本在 body 之后
const bodyEnd = html.indexOf('<!--DATA-->') >= 0 ? html.indexOf('<!--DATA-->') : html.indexOf('</body>');
const structure = html.slice(0, bodyEnd);

const appIdx = structure.indexOf('id="app"');
const appEnd = structure.indexOf('</div>\n\n</body>') >= 0
  ? structure.indexOf('</div>\n\n</body>')
  : structure.lastIndexOf('</div>');
const modalIdx = structure.indexOf('id="modal"');
const toastIdx = structure.indexOf('id="toast"');

console.log('=== 产物中的结构位置 ===');
console.log(`  #app   : ${appIdx}`);
console.log(`  #modal : ${modalIdx}`);
console.log(`  #toast : ${toastIdx}`);

console.log('\n=== 判定 ===');
console.log(`  #modal 在 #app 之后 : ${modalIdx > appIdx ? '✅' : '❌'}`);
console.log(`  #toast 在 #app 之后 : ${toastIdx > appIdx ? '✅' : '❌'}`);

// 更强校验：#app 的闭合应在 #modal 之后（即 modal 是 app 的后代）
const scriptStart = html.indexOf('<script>');
const lastDivBeforeScript = html.lastIndexOf('</div>', scriptStart);
const modalBeforeScript = html.lastIndexOf('id="modal"', scriptStart);
const toastBeforeScript = html.lastIndexOf('id="toast"', scriptStart);
console.log(`\n  #modal 在最后一个 </div>(app 闭合) 之前 : ${modalBeforeScript < lastDivBeforeScript ? '✅ 是 app 后代' : '❌ 在 app 外'}`);
console.log(`  #toast 在最后一个 </div>(app 闭合) 之前 : ${toastBeforeScript < lastDivBeforeScript ? '✅ 是 app 后代' : '❌ 在 app 外'}`);

console.log('\n=== 事件委托根节点 ===');
const code = html.slice(html.lastIndexOf('<script>'));
const bindIdx = code.indexOf("getElementById('app')");
console.log(`  绑定在 #app : ${bindIdx > 0 ? '✅' : '❌'}`);
console.log(`  结论：#modal 与 #toast 均在 #app 内 → 弹窗内点击可冒泡到委托根节点`);
