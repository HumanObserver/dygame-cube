'use strict';
/* _mouse.cjs — 真实鼠标事件点发布 + 监听全部 XHR/Fetch */
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
function getTabs() { return new Promise((res, rej) => { http.get('http://127.0.0.1:9333/json', (r) => { let s = ''; r.on('data', (c) => (s += c)); r.on('end', () => { try { res(JSON.parse(s)); } catch (e) { rej(e); } }); }).on('error', rej); }); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const tabs = await getTabs();
  const tab = tabs.filter((t) => t.type === 'page').find((t) => /content\/post/.test(t.url));
  if (!tab) throw new Error('no post tab');
  const ws = new WebSocket(tab.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
  await new Promise((r) => ws.on('open', r));
  let id = 0; const pend = new Map(); const meta = new Map();
  ws.on('message', (raw) => {
    let o; try { o = JSON.parse(raw); } catch (e) { return; }
    if (o.id && pend.has(o.id)) { pend.get(o.id)(o); pend.delete(o.id); return; }
    if (o.method === 'Network.requestWillBeSent' && (o.params.type === 'XHR' || o.params.type === 'Fetch')) {
      meta.set(o.params.requestId, { url: o.params.request.url, method: o.params.request.method });
    }
    if (o.method === 'Network.responseReceived' && meta.has(o.params.requestId)) {
      const m = meta.get(o.params.requestId);
      if (!/log|report|monitor|verify|mssdk|security|ttwid|zlink/i.test(m.url)) {
        console.log('[xhr] ' + o.params.response.status + ' ' + m.url.slice(0, 125));
      }
    }
  });
  const send = (m, p, to) => new Promise((res, rej) => {
    const i = ++id;
    const t = setTimeout(() => { pend.delete(i); rej(new Error(m + ' timeout')); }, to || 25000);
    pend.set(i, (o) => { clearTimeout(t); res(o); });
    ws.send(JSON.stringify({ id: i, method: m, params: p || {} }));
  });
  const evl = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: '(function(){try{var v=(' + expr + ');return v==null?null:String(v)}catch(e){return "EX:"+e.message}})()', returnByValue: true });
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  await send('Network.enable'); await send('Page.enable'); await send('Runtime.enable');
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 300, y: 300 });

  // 发布按钮坐标（滚动到可见）
  const rect = await evl('(function(){var b=[].slice.call(document.querySelectorAll("button")).find(function(x){return x.innerText.trim()==="发布"});if(!b)return "NOBTN";b.scrollIntoView({block:"center"});var r=b.getBoundingClientRect();return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height,t:b.innerText.trim(),dis:!!b.disabled})})()');
  console.log('[m] btn rect: ' + rect);
  const rb = JSON.parse(rect);
  if (!rb || !rb.x) throw new Error('rect fail');

  // 真实点击三连
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x: rb.x, y: rb.y, button: 'left', clickCount: 2, buttons: type === 'mousePressed' ? 1 : 0, timestamp: Date.now() / 1000 });
  }
  console.log('[m] mouse-clicked 发布, listening 40s...');
  for (let k = 0; k < 8; k++) {
    await sleep(5000);
    const u = await evl('location.href');
    if (k % 2 === 0) console.log('[m] +' + (k + 1) * 5 + 's url=' + String(u).slice(30, 90));
    if (/manage|success/.test(String(u))) break;
  }
  const s = await send('Page.captureScreenshot', { format: 'png' }, 30000);
  if (s.result && s.result.data) fs.writeFileSync(path.join(__dirname, 'douyin-mouse.png'), Buffer.from(s.result.data, 'base64'));
  console.log('[m] done shot douyin-mouse.png');
  ws.close();
})().catch((e) => { console.log('M_FAIL ' + e.message); process.exit(1); });
