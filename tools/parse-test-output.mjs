/**
 * 解析 `node --test` 的 TAP 汇总输出，返回 `{ pass, fail }`。
 *
 * 为什么单独成模块：Node 的汇总行格式**随版本变化**，而门禁依赖它报数。
 *   Node 24 → `ℹ pass 493`  /  `ℹ fail 0`
 *   Node 22 → `# pass 493`  /  `# fail 0`
 * 早期版本只认 `ℹ`，导致在 Node 22 上计数变成 `undefined`
 * （好在失败仍会被非零退出码捕获，但显示会错，且掩盖了「格式已变」这件事）。
 *
 * 约定：解析不到时返回 `null`，由调用方显式判为失败 —— **不得静默当作通过**。
 *
 * @param {string} output `node --test` 的完整 stdout
 * @returns {{ pass: number, fail: number } | null}
 */
export function parseTestCounts(output) {
  const num = (re) => {
    const m = String(output ?? '').match(re);
    return m ? Number(m[1]) : null;
  };
  const pass = num(/^[ℹ#]\s*pass\s+(\d+)/m);
  const fail = num(/^[ℹ#]\s*fail\s+(\d+)/m);
  if (pass === null || fail === null) return null;
  return { pass, fail };
}
