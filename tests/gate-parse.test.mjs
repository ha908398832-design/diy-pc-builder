import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTestCounts } from '../tools/parse-test-output.mjs';

// 回归背景：gate.mjs 原先只写 /^ℹ pass (\d+)/m，在 Node 22 上取不到数，
// 门禁会打印「undefined 项通过」。这里把两种真实格式都钉死。

test('G1：解析 Node 24 的汇总格式（ℹ 前缀）', () => {
  const out = 'TAP version 13\nok 1 - x\nℹ tests 493\nℹ pass 493\nℹ fail 0\n';
  assert.deepEqual(parseTestCounts(out), { pass: 493, fail: 0 });
});

test('G2：解析 Node 22 的汇总格式（# 前缀）', () => {
  const out = 'TAP version 13\nok 1 - x\n# tests 493\n# pass 493\n# fail 0\n';
  assert.deepEqual(parseTestCounts(out), { pass: 493, fail: 0 });
});

test('G3：失败计数不为 0 时如实返回', () => {
  for (const p of ['ℹ', '#']) {
    const out = `${p} tests 10\n${p} pass 7\n${p} fail 3\n`;
    assert.deepEqual(parseTestCounts(out), { pass: 7, fail: 3 });
  }
});

test('G4：Windows 换行（CRLF）也能解析', () => {
  const out = '# tests 5\r\n# pass 5\r\n# fail 0\r\n';
  assert.deepEqual(parseTestCounts(out), { pass: 5, fail: 0 });
});

test('G5：解析不到计数时返回 null（不得静默当作通过）', () => {
  assert.equal(parseTestCounts(''), null);
  assert.equal(parseTestCounts(null), null);
  assert.equal(parseTestCounts(undefined), null);
  assert.equal(parseTestCounts('TAP version 13\nok 1 - x\n'), null);
  // 只有 pass 没有 fail，同样算解析失败
  assert.equal(parseTestCounts('# pass 5\n'), null);
  // 假造的近似行不应被误认
  assert.equal(parseTestCounts('1..1\n# tests 1\n'), null);
});

test('G6：不被 TAP 计划行与用例行干扰', () => {
  const out = [
    'TAP version 13',
    '# Subtest: A1：产物为单文件',
    'ok 1 - A1：产物为单文件',
    '    ---',
    "    duration_ms: 10.4",
    '    ...',
    'not ok 2 - A2：应该失败',
    '1..2',
    '# tests 2',
    '# pass 1',
    '# fail 1',
  ].join('\n');
  assert.deepEqual(parseTestCounts(out), { pass: 1, fail: 1 });
});

test('G7：数字带前导空格也认（TAP 缩进容错）', () => {
  assert.deepEqual(parseTestCounts('ℹ   pass   12\nℹ   fail   0\n'), { pass: 12, fail: 0 });
});
