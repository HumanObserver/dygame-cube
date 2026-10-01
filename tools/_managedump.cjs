'use strict';
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

function getJson(p) { return new Promise((res, rej) => { http.get('http://127.0.0.1:9333' + p, (r) => { let s = ''; r.on('data', (c) => (s += c)); r.on('end', () => { try { res(JSON.parse(s)); } catch (e) { rej(e); } }); }).on('error', rej); }); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const tabs = await getJson('/json');
  let tab = tabs.filter((t) => t.type === 'page').find((t) => /content\/manage/.test(t.url));
  if (!tab) tab = tabs.filter((t) => t.type === 'page').find((t) => /^about:blank/.test(t.url));
  if (!tab) throw new Error('no manage/blank tab');
  console.log('tab: ' + tab.url.slice(0, 80));
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => ws.on('open', r));
  let id = 0; const pend = new Map();
  ws.on('message', (m) => { const o = JSON.parse(m); if (o.id && pend.has(o.id)) { pend.get(o.id)(o); pend.delete(o.id); } });
  const send = (m, p) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
  await send('Page.enable');
  await send('Runtime.enable');
  if (/content\/manage/.test(tab.url) === false) {
    await send('Page.navigate', { url: 'https://creator.douyin.com/creator-micro/content/manage/all' });
    await sleep(16000);
  }
  const expr = 'JSON.stringify({url:location.href,head:(document.body&&document.body.innerText||"").replace(/\\s+/g," ").slice(0,700)})';
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  console.log('EVAL: ' + JSON.stringify(r).slice(0, 1400));
  const s = await send('Page.captureScreenshot', { format: 'png' });
  if (s.result && s.result.data) fs.writeFileSync(path.join(__dirname, 'douyin-manage.png'), Buffer.from(s.result.data, 'base64'));
  ws.close();
})().catch((e) => { console.log('ERR ' + e.message); process.exit(1); });
