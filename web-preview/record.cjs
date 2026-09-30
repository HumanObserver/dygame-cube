/**
 * record.cjs — 一键录制：构建 bundle → 静态服务器 → headless Edge 打开 record.html
 * → 页面内 MediaRecorder 录制（1080×1920 MP4 + BGM/音效/配音）→ POST 回传保存 videos/*.mp4
 *
 * 用法：
 *   node web-preview/record.cjs --seed 15 [--finish 60000] [--name gameplay-15]
 *                               [--nobgm] [--timeout 300000] [--keep]
 * 依赖：Microsoft Edge（headless=new），Node 18+
 * 输出：stdout 最后一行为 JSON 摘要 {ok, file, ...}；退出码 0=成功
 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');
const { spawn } = require('child_process');

const ROOT = __dirname;
const VIDEOS_DIR = path.join(ROOT, 'videos');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

/* ---------- CLI ---------- */
const argv = process.argv.slice(2);
function argVal(name, dflt) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
}
const SEED = parseInt(argVal('--seed', '15'), 10);
const FINISH = parseInt(argVal('--finish', '60000'), 10);
const NAME = argVal('--name', 'gameplay-' + SEED + '-' + new Date().toISOString().slice(0, 10));
const NOBGM = argv.includes('--nobgm');
const KEEP = argv.includes('--keep');
const TIMEOUT = parseInt(argVal('--timeout', '300000'), 10);

/* ---------- 构建 bundle ---------- */
function buildBundle() {
  const build = require(path.join(ROOT, 'build.cjs')); // module.exports = build 函数
  build();
  console.error('[record] bundle built');
}

/* ---------- 静态服务器 + 回传端点 ---------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.png': 'image/png',
  '.css': 'text/css',
};

let edgeProc = null;
let savedFile = null;
let savedSummary = null;

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1');
      if (u.pathname === '/__heartbeat' && req.method === 'POST') {
        const parts0 = [];
        req.on('data', (c) => parts0.push(c));
        req.on('end', () => {
          console.error('[hb] ' + Buffer.concat(parts0).toString('utf8'));
          res.writeHead(204); res.end();
        });
        return;
      }
      if (u.pathname === '/__recording' && req.method === 'POST') {
        const parts = [];
        req.on('data', (c) => parts.push(c));
        req.on('end', () => {
          const buf = Buffer.concat(parts);
          const q = u.searchParams;
          const name = (q.get('name') || ('rec-' + Date.now())).replace(/[^a-zA-Z0-9_\-]/g, '');
          const file = path.join(VIDEOS_DIR, name + '.mp4');
          fs.mkdirSync(VIDEOS_DIR, { recursive: true });
          fs.writeFileSync(file, buf);
          /* 修复 fMP4 时长元数据（MediaRecorder timeslice 产物缺 duration） */
          try {
            const { patchFile } = require(path.join(__dirname, '..', 'tools', 'fix-mp4-duration.cjs'));
            const fixed = patchFile(file);
            if (fixed) console.error('[record] mp4 duration patched: ' + JSON.stringify(fixed));
          } catch (e) { console.error('[record] duration patch failed: ' + e.message); }
          savedFile = file;
          savedSummary = {
            ok: true,
            file,
            sizeMB: +(buf.length / 1048576).toFixed(2),
            durationMs: q.get('durationMs'),
            audioPeak: q.get('audioPeak'),
            mime: q.get('mime'),
            stats: {
              score: q.get('score'),
              level: q.get('level'),
              lines: q.get('lines'),
              pieces: q.get('pieces'),
            },
            errors: q.get('errors') || '',
          };
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('OK ' + file);
          console.error('[record] saved ' + file + ' (' + savedSummary.sizeMB + ' MB)');
          finish(0);
        });
        return;
      }
      let p = decodeURIComponent(u.pathname);
      if (p === '/') p = '/record.html';
      const file = path.normalize(path.join(ROOT, p));
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end('nf'); return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

/* ---------- Edge ---------- */
function launchEdge(port) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dyrec-'));
  const qs = new URLSearchParams({
    seed: String(SEED),
    botseed: '777',
    finish: String(FINISH),
    name: NAME,
    bgm: NOBGM ? '0' : '1',
  });
  const url = 'http://127.0.0.1:' + port + '/record.html?' + qs.toString();
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--mute-audio',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--enable-logging=stderr',
    '--v=0',
    '--window-size=540,960',
    '--force-device-scale-factor=2',
    '--user-data-dir=' + profile,
    url,
  ];
  console.error('[record] launching Edge: ' + url);
  edgeProc = spawn(EDGE, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let tail = '', head = '';
  edgeProc.stderr.on('data', (d) => {
    const s = d.toString();
    if (head.length < 6000) head += s;
    tail = (tail + s).slice(-3000);
    // 实时打印页面控制台错误（CONSOLE 行来自 --enable-logging）
    for (const line of s.split('\n')) {
      if (/CONSOLE|Uncaught|ERROR:.*\.(js|html)/i.test(line)) console.error('[edge] ' + line.trim());
    }
  });
  edgeProc.on('exit', (code) => {
    console.error('[record] edge exited code=' + code);
    if (!savedFile) {
      console.error('[record] edge stderr head:\n' + head.slice(0, 3000));
      console.error('[record] edge stderr tail:\n' + tail);
      finish(2);
    }
  });
  return profile;
}

let done = false;
function finish(code) {
  if (done) return;
  done = true;
  clearTimeout(timeoutTimer);
  try { if (edgeProc && !edgeProc.killed) edgeProc.kill(); } catch (e) { /* noop */ }
  if (!KEEP && profileDir) { try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch (e) { /* noop */ } }
  /* 与 seeds.json 期望值交叉校验（决定配音是否可信） */
  if (savedSummary) {
    try {
      const pool = JSON.parse(fs.readFileSync(path.join(ROOT, 'seeds.json'), 'utf8').replace(/^\uFEFF/, ''));
      const exp = (pool.seeds || []).find((s) => s.seed === SEED);
      if (exp && savedSummary.stats.score != null) {
        const got = parseInt(savedSummary.stats.score, 10);
        const bucketOk = Math.floor(got / 100) === Math.floor(exp.score / 100);
        savedSummary.expected = { score: exp.score, level: exp.level, lines: exp.lines };
        savedSummary.narrationOk = bucketOk && got >= exp.score - 99;
        savedSummary.levelMatch = parseInt(savedSummary.stats.level, 10) === exp.level;
        savedSummary.linesMatch = parseInt(savedSummary.stats.lines, 10) === exp.lines;
      }
    } catch (e) { /* seeds.json 缺失则跳过校验 */ }
  }
  console.log(JSON.stringify(savedSummary || { ok: false, code }));
  setTimeout(() => process.exit(savedSummary ? 0 : code), 200);
}

let profileDir = null;
let timeoutTimer = null;

/* ---------- main ---------- */
(async () => {
  buildBundle();
  const server = await startServer();
  const port = server.address().port;
  profileDir = launchEdge(port);
  timeoutTimer = setTimeout(() => {
    console.error('[record] TIMEOUT after ' + TIMEOUT + 'ms');
    finish(3);
  }, TIMEOUT);
})().catch((e) => {
  console.error('[record] fatal: ' + (e && e.stack || e));
  process.exit(1);
});
