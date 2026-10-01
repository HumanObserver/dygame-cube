'use strict';
const http = require('http');
const WebSocket = require('ws');
function getTabs() { return new Promise((res, rej) => { http.get('http://127.0.0.1:9333/json', (r) => { let s = ''; r.on('data', (c) => (s += c)); r.on('end', () => { try { res(JSON.parse(s)); } catch (e) { rej(e); } }); }).on('error', rej); }); }
(async () => {
  const tabs = await getTabs();
  const tab = tabs.filter((t) => t.type === 'page').find((t) => /content\/post/.test(t.url));
  if (!tab) throw new Error('post tab gone');
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => ws.on('open', r));
  let id = 0; const pend = new Map();
  ws.on('message', (m) => { const o = JSON.parse(m); if (o.id && pend.has(o.id)) { pend.get(o.id)(o); pend.delete(o.id); } });
  const send = (m, p) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
  await send('Runtime.enable');
  const expr = [
    'JSON.stringify((function(){',
    'var all=(document.body&&document.body.innerText||"").replace(/\\s+/g," ");',
    'var mask=[].slice.call(document.querySelectorAll("[class*=mask],[class*=overlay],[role=dialog]")).map(function(e){return (e.innerText||"").replace(/\\s+/g," ").trim()}).filter(function(x){return x.length>4}).slice(0,4);',
    'var prog=[].slice.call(document.querySelectorAll("[class*=progress],[class*=upload]")).map(function(e){return (e.innerText||"").replace(/\\s+/g," ").trim()}).filter(Boolean).slice(0,6);',
    'var pub=[].slice.call(document.querySelectorAll("button")).map(function(b){var t=b.innerText.trim();return t==="发布"?{t:t,dis:!!b.disabled,cls:(b.className||"").slice(0,40)}:null}).filter(Boolean);',
    'return {len:all.length,mask:mask,prog:prog,pub:pub,mid:all.slice(200,700)};',
    '})())',
  ].join('');
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  console.log(r.result && r.result.result && r.result.result.value ? r.result.result.value : JSON.stringify(r).slice(0, 600));
  ws.close();
})().catch((e) => { console.log('ERR ' + e.message); process.exit(1); });
