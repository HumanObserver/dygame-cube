/**
 * verify.cjs — 用 headless Edge 解码录好的 MP4，抽取关键帧 PNG + 读取元数据（时长/分辨率）
 * 用法：node web-preview/verify.cjs --file videos/xxx.mp4 --times 5,30,60,90 [--scale 0.5]
 * 输出：frames/<basename>-t<N>.png；stdout JSON {ok, w, h, dur, frames}
 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');
const { spawn } = require('child_process');

const ROOT = __dirname;
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const argv = process.argv.slice(2);
function argVal(name, dflt) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
}
const FILE = argVal('--file', 'videos/_smoke.mp4');
const TIMES = argVal('--times', '5,30,60');
const SCALE = argVal('--scale', '0.5');
const TIMEOUT = parseInt(argVal('--timeout', '90000'), 10);

const absFile = path.isAbsolute(FILE) ? FILE : path.join(ROOT, FILE);
if (!fs.existsSync(absFile)) { console.log(JSON.stringify({ ok: false, err: 'file not found' })); process.exit(1); }
const base = path.basename(absFile, '.mp4');
const framesDir = path.join(ROOT, 'frames');
fs.mkdirSync(framesDir, { recursive: true });

let meta = null;
const frames = [];
let edgeProc = null, profileDir = null, done = false, timer = null;

function finish(code) {
  if (done) return;
  done = true;
  clearTimeout(timer);
  try { if (edgeProc && !edgeProc.killed) edgeProc.kill(); } catch (e) { /* noop */ }
  if (profileDir) { try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch (e) { /* noop */ } }
  console.log(JSON.stringify({ ok: code === 0, meta, frames }));
  setTimeout(() => process.exit(code), 150);
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  if (u.pathname === '/__meta') {
    meta = { w: u.searchParams.get('w'), h: u.searchParams.get('h'), dur: u.searchParams.get('dur') };
    res.writeHead(204); res.end(); return;
  }
  if (u.pathname === '/__frame' && req.method === 'POST') {
    const parts = [];
    req.on('data', (c) => parts.push(c));
    req.on('end', () => {
      const t = u.searchParams.get('t');
      const f = path.join(framesDir, base + '-t' + t.replace('.', '_') + '.png');
      fs.writeFileSync(f, Buffer.concat(parts));
      frames.push(f);
      console.error('[px] t=' + t + ' mean=' + (u.searchParams.get('mean') || '?') +
        ' chroma=' + (u.searchParams.get('chroma') || '?') + ' sub=' + (u.searchParams.get('sub') || '?'));
      res.writeHead(204); res.end();
    });
    return;
  }
  if (u.pathname === '/__fail') {
    console.error('[verify] page fail: ' + decodeURIComponent(u.search.slice(1)));
    res.writeHead(204); res.end(); finish(4); return;
  }
  if (u.pathname === '/__done') { res.writeHead(204); res.end(); finish(0); return; }
  if (u.pathname === '/video.mp4') {
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'none' });
    fs.createReadStream(absFile).pipe(res);
    return;
  }
  let p = u.pathname === '/' ? '/verify.html' : decodeURIComponent(u.pathname);
  const f = path.normalize(path.join(ROOT, p));
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': p.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});

server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dyver-'));
  const url = 'http://127.0.0.1:' + port + '/verify.html?file=' + encodeURIComponent('/video.mp4') +
    '&times=' + encodeURIComponent(TIMES) + '&scale=' + SCALE +
    '&mode=' + encodeURIComponent(argVal('--mode', 'seek')) + '&rate=' + argVal('--rate', '8');
  edgeProc = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--mute-audio', '--no-first-run', '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required', '--window-size=560,980',
    '--user-data-dir=' + profileDir, url,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderrTail = '';
  edgeProc.stderr.on('data', (d) => { stderrTail = (stderrTail + d).toString().slice(-2000); });
  edgeProc.on('exit', (code) => {
    // 页面完成后自行结束前，等 frames 全部落盘：给 1s 宽限
    setTimeout(() => {
      if (!done) { console.error('[verify] edge exited early code=' + code + '\n' + stderrTail); finish(2); }
    }, 1200);
  });
  // 页面把 title 设为 FRAMES-DONE 后无回调 → 用轮询 frames 数量判定完成
  const expect = TIMES.split(',').length;
  const poll = setInterval(() => {
    if (frames.length >= expect) { clearInterval(poll); finish(0); }
  }, 500);
  timer = setTimeout(() => { console.error('[verify] timeout, got ' + frames.length + '/' + expect); finish(3); }, TIMEOUT);
});
