/**
 * 浏览器预览静态服务器：node web-preview/serve.cjs [port]
 * 启动时自动打包 bundle.js。默认端口 8737，被占用则自动 +1。
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const build = require('./build.cjs');

build();

const ROOT = __dirname;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
});

function listen(port, tries) {
  const onError = (err) => {
    if (err.code === 'EADDRINUSE' && tries > 0) {
      console.log('port ' + port + ' in use, trying ' + (port + 1));
      server.removeListener('error', onError);
      listen(port + 1, tries - 1);
    } else {
      console.error('server error:', err.message);
      process.exit(1);
    }
  };
  server.on('error', onError);
  server.listen(port, '127.0.0.1', () => {
    server.removeListener('error', onError);
    console.log('LISTENING http://127.0.0.1:' + port);
  });
}

listen(parseInt(process.argv[2], 10) || 8737, 10);
