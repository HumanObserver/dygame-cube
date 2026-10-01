'use strict';
const http = require('http');
const WebSocket = require('ws');
function getTabs() { return new Promise((res, rej) => { http.get('http://127.0.0.1:9333/json', (r) => { let s = ''; r.on('data', (c) => (s += c)); r.on('end', () => { try { res(JSON.parse(s)); } catch (e) { rej(e); } }); }).on('error', rej); }); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const tabs = await getTabs();
  const tab = tabs.filter((t) => t.type === 'page').find((t) => /content\/post/.test(t.url));
  if (!tab) throw new Error('no post tab');
  const ws = new WebSocket(tab.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
  await new Promise((r) => ws.on('open', r));
  let id = 0; const pend = new Map();
  const reqs = new Map();
  ws.on('message', (m) => {
    const o = JSON.parse(m);
    if (o.id && pend.has(o.id)) { pend.get(o.id)(o); pend.delete(o.id); return; }
    if (o.method === 'Network.responseReceived') {
      const r = o.params.response;
      if (/publish|submit|create|video/i.test(r.url)) reqs.set(o.params.requestId, { url: r.url.slice(0, 120), status: r.status });
    }
    if (o.method === 'Network.loadingFinished' && reqs.has(o.params.requestId)) {
      const rec = reqs.get(o.params.requestId);
      reqs.delete(o.params.requestId);
      const bid = ++id;
      pend.set(bid, (msg) => {
        const body = msg.result && msg.result.body ? String(msg.result.body).slice(0, 400) : '(no body)';
        console.log('[api] ' + rec.status + ' ' + rec.url + ' body=' + body.replace(/\s+/g, ' '));
      });
      ws.send(JSON.stringify({ id: bid, method: 'Network.getResponseBody', params: { requestId: o.params.requestId } }));
    }
    if (o.method === 'Network.loadingFailed' && reqs.has(o.params.requestId)) {
      const rec = reqs.get(o.params.requestId);
      reqs.delete(o.params.requestId);
      console.log('[api-FAIL] ' + rec.url + ' err=' + o.params.errorText);
    }
  });
  const send = (m, p) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
  await send('Network.enable');
  await send('Runtime.enable');
  if (process.env.PASSIVE === '1') {
    const origResp = ws.onmessage;
    ws.on('message', (m2) => {
      const o2 = JSON.parse(m2);
      if (o2.method === 'Network.requestWillBeSent' && o2.params.request.method !== 'GET' && /douyin|todo|tos/i.test(o2.params.request.url)) {
        console.log('[req] ' + o2.params.request.method + ' ' + o2.params.request.url.slice(0, 110));
      }
    });
    console.log('[pub] passive listen 15s...');
    await sleep(15000);
    const toast2 = await send('Runtime.evaluate', {
      expression: 'JSON.stringify([].slice.call(document.querySelectorAll("[class*=progress],[class*=upload],[class*=percent]")).map(function(e){return (e.innerText||"").replace(/\\s+/g," ").trim()}).filter(function(x){return x&&x.length<120}).slice(0,8))',
      returnByValue: true,
    });
    console.log('[progress] ' + (toast2.result.result.value || ''));
    ws.close();
    return;
  }
  const clicked = await send('Runtime.evaluate', {
    expression: '(function(){var b=[].slice.call(document.querySelectorAll("button")).find(function(x){return x.innerText.trim()==="发布"&&!x.disabled});if(b){b.click();return "CLICKED"}return "NO_BTN"})()',
    returnByValue: true,
  });
  console.log('[pub] ' + clicked.result.result.value);
  await sleep(25000);
  const toast = await send('Runtime.evaluate', {
    expression: 'JSON.stringify([].slice.call(document.querySelectorAll("[class*=toast],[role=alert]")).map(function(e){return (e.innerText||"").replace(/\\s+/g," ")}).filter(Boolean).slice(0,4))',
    returnByValue: true,
  });
  console.log('[toast] ' + (toast.result.result.value || ''));
  const urlNow = await send('Runtime.evaluate', { expression: 'location.href', returnByValue: true });
  console.log('[url] ' + urlNow.result.result.value);
  ws.close();
})().catch((e) => { console.log('ERR ' + e.message); process.exit(1); });
