'use strict';
/* _unblock.cjs — 清弹窗 + 填自主声明 + 再发布 + 盯请求 */
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
function getTabs() { return new Promise((res, rej) => { http.get('http://127.0.0.1:9333/json', (r) => { let s = ''; r.on('data', (c) => (s += c)); r.on('end', () => { try { res(JSON.parse(s)); } catch (e) { rej(e); } }); }).on('error', rej); }); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const tabs = await getTabs();
  const tab = tabs.filter((t) => t.type === 'page').find((t) => /content\/post|content\/upload/.test(t.url));
  if (!tab) throw new Error('no post tab');
  const ws = new WebSocket(tab.webSocketDebuggerUrl, { maxPayload: 128 * 1024 * 1024 });
  await new Promise((r) => ws.on('open', r));
  let id = 0; const pend = new Map();
  ws.on('message', (raw) => {
    let o; try { o = JSON.parse(raw); } catch (e) { return; }
    if (o.id && pend.has(o.id)) { pend.get(o.id)(o); pend.delete(o.id); return; }
    if (o.method === 'Network.responseReceived') {
      const r = o.params.response;
      if (/publish|submit|create_video|aweme\/v1\/web/i.test(r.url) && !/limit_app_groups|suggestion|report|log|verify/i.test(r.url)) {
        console.log('[net<-] ' + r.status + ' ' + r.url.slice(0, 130));
        const rid = o.params.requestId;
        const bid = ++id;
        pend.set(bid, (m) => {
          const body = m.result && m.result.body ? String(m.result.body).replace(/\s+/g, ' ').slice(0, 500) : '(no body)';
          console.log('[net<-body] ' + body);
        });
        ws.send(JSON.stringify({ id: bid, method: 'Network.getResponseBody', params: { requestId: rid } }));
      }
    }
    if (o.method === 'Network.requestWillBeSent' && o.params.request.method === 'POST' && /publish|create/i.test(o.params.request.url) && !/limit_app_groups/.test(o.params.request.url)) {
      console.log('[net->] POST ' + o.params.request.url.slice(0, 130));
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

  // 1) 关闭所有引导弹窗
  let dismiss = 0;
  for (let k = 0; k < 3; k++) {
    const r = await evl('[].slice.call(document.querySelectorAll("button,[role=button],span")).filter(function(x){return x.offsetWidth&&(x.innerText||"").trim()==="我知道了"}).map(function(x){x.click();return 1}).length');
    dismiss += Number(r || 0);
    await sleep(800);
  }
  console.log('[ub] dismissed dialogs: ' + dismiss);

  // 2) 打开自主声明 select
  const opened = await evl('(function(){var els=[].slice.call(document.querySelectorAll("*")).filter(function(e){return e.offsetWidth&&(e.innerText||"").trim()==="请选择自主声明"&&e.children.length<=1});if(!els.length)return "NO_TRIGGER";els[0].click();return "OPENED"})()');
  console.log('[ub] declaration select: ' + opened);
  await sleep(2000);
  const opts = await evl('[].slice.call(document.querySelectorAll("[class*=option],[role=option],[class*=semi-select] li,li")).map(function(e){return (e.innerText||"").trim()}).filter(function(x){return x&&x.length<50}).slice(0,25).join(" § ")');
  console.log('[ub] options: ' + String(opts).slice(0, 700));

  // 3) 选一个合适项（优先 真人拍摄/原创/自行拍摄/游戏 之类，排除 AI 生成）
  const picked = await evl('(function(){var want=/原创|实拍|拍摄|自制|自己|游戏/;var bad=/AI|虚拟|营销|广告/;var els=[].slice.call(document.querySelectorAll("[role=option],[class*=option],li")).filter(function(e){var t=(e.innerText||"").trim();return e.offsetWidth&&t&&t.length<50&&want.test(t)&&!bad.test(t)});if(!els.length)return "NO_MATCH";els[0].click();return "PICKED:"+els[0].innerText.trim()})()');
  console.log('[ub] ' + picked);
  await sleep(1500);

  // 4) dump 当前所有红色/校验文本（看还有什么拦着）
  const warns = await evl('[].slice.call(document.querySelectorAll("[class*=error],[class*=warn],[class*=tip],[class*=inspect]")).map(function(e){return (e.innerText||"").replace(/\\s+/g," ").trim()}).filter(function(x){return x&&x.length<80}).slice(0,12).join(" § ")');
  console.log('[ub] warns: ' + String(warns).slice(0, 500));

  // 5) 再点发布
  const clk = await evl('(function(){var b=[].slice.call(document.querySelectorAll("button")).find(function(x){return x.innerText.trim()==="发布"&&!x.disabled});if(b){b.click();return "CLICKED"}return "NO_BTN"})()');
  console.log('[ub] publish click: ' + clk);

  // 6) 监听 40s
  for (let k = 0; k < 8; k++) {
    await sleep(5000);
    const u = await evl('location.href');
    console.log('[ub] +' + (k + 1) * 5 + 's url=' + String(u).slice(30, 95));
    if (/manage|success/.test(String(u))) { console.log('[ub] REDIRECTED — looks published'); break; }
  }
  const s = await send('Page.captureScreenshot', { format: 'png' }, 30000);
  if (s.result && s.result.data) fs.writeFileSync(path.join(__dirname, 'douyin-unblock.png'), Buffer.from(s.result.data, 'base64'));
  ws.close();
})().catch((e) => { console.log('UB_FAIL ' + e.message); process.exit(1); });
