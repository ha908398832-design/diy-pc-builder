#!/usr/bin/env node
/**
 * 临时静态服务器：仅用于在浏览器中验证构建产物（file:// 无法被浏览器工具打开）
 *
 * 注意：这不是应用的运行方式，交付物仍是可直接双击的 dist/装机助手.html。
 * 端口刻意选 8791，避免与其他本地服务（3000 / 5173 / 8080 等常用端口）冲突。
 *
 * 用法: node tools/serve-dist.mjs [port]
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2]) || 8791;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
};

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent((req.url || '/').split('?')[0]);
    if (p === '/' || p === '') p = '/dist/装机助手.html';
    const abs = join(ROOT, p);
    // 防目录穿越
    if (!abs.startsWith(ROOT)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    const data = await readFile(abs);
    res.writeHead(200, {
      'Content-Type': MIME[extname(abs)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  } catch (e) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end(`not found: ${e.message}`);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`静态服务器已启动: http://127.0.0.1:${PORT}/`);
  console.log(`产物地址: http://127.0.0.1:${PORT}/dist/装机助手.html`);
});
