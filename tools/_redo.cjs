'use strict';
/* _redo.cjs — 完整重走：上传页→选文件→盯上传→填表→发布→盯发布 API */
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const FILE = path.resolve(__dirname, '..', 'web-preview', 'videos', 'gravity-cube-20250930.mp4');
const TITLE = '第一次玩引力方块太上头，重力随机换方向！4连消撑到第2关才崩';
const DESC = '#引力方块 #抖音小游戏 #小游戏推荐 #解压小游戏';
function getTabs() { return new Promise((res, rej) => { http.get('http://127.0.0.1:9333/json', (r) => { let s = ''; r.on('data', (c) => (s += c)); r.on('end', () => { try { res(JSON.parse(s)); } catch (e) { rej(e); } }); }).on('error', rej); }); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const tabs = await getTabs();
  const tab = tabs.filter((t) => t.type === 'page').find((t) => /creator\.douyin/.test(t.url));
  const ws = new WebSocket(tab.webSocketDebuggerUrl, { maxPayload: 128 * 1024 * 1024 });
  await new Promise((r) => ws.on('open', r));
  let id = 0; const pend = new Map();
  ws.on('message', (raw) => {
    let o; try { o = JSON.parse(raw); } catch (e) { return; }
    if (o.id && pend.has(o.id)) { pend.get(o.id)(o); pend.delete(o.id); return; }
    if (o.method === 'Network.responseReceived') {
      const r = o.params.response;
      if (/vupload|\/upload|publish|submit/i.test(r.url)) console.log('[net<-] ' + r.status + ' ' + r.url.slice(0, 110));
    }
    if (o.method === 'Network.requestWillBeSent' && o.params.request.method === 'POST' && /publish|submit/i.test(o.params.request.url)) {
      console.log('[net->] POST ' + o.params.request.url.slice(0, 120));
    }
  });
  const send = (m, p, to) => new Promise((res, rej) => {
    const i = ++id;
    const t = setTimeout(() => { pend.delete(i); rej(new Error(m + ' timeout')); }, to || 30000);
    pend.set(i, (o) => { clearTimeout(t); res(o); });
    ws.send(JSON.stringify({ id: i, method: m, params: p || {} }));
  });
  /* 字符串值求值 */
  const evl = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: '(function(){try{var v=(' + expr + ');return v==null?null:String(v)}catch(e){return "EX:"+e.message}})()', returnByValue: true });
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  /* DOM 节点求值 → objectId */
  const hndl = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: '(function(){try{return (' + expr + ')||null}catch(e){return null}})()', objectGroup: 'redo' });
    return r.result && r.result.result && r.result.result.objectId ? r.result.result.objectId : null;
  };
  await send('Network.enable'); await send('Page.enable'); await send('Runtime.enable');

  console.log('[redo] navigate to upload page');
  await send('Page.navigate', { url: 'https://creator.douyin.com/creator-micro/content/upload' });
  await sleep(10000);

  /* 等 file input */
  const FIND_INPUT = '[].slice.call(document.querySelectorAll("input[type=file]")).find(function(i){var a=(i.accept||"").toLowerCase();return a.indexOf("video")>=0||a.indexOf("mp4")>=0||a==="*/*"})||[].slice.call(document.querySelectorAll("input[type=file]"))[0]';
  let inpId = null;
  for (let k = 0; k < 12 && !inpId; k++) { inpId = await hndl(FIND_INPUT); if (!inpId) await sleep(3000); }
  if (!inpId) throw new Error('no file input');
  await send('DOM.setFileInputFiles', { files: [FILE], objectId: inpId });
  console.log('[redo] file set @' + new Date().toTimeString().slice(0, 8));

  /* 等发布表单（标题框出现） */
  let ready = false;
  for (let k = 0; k < 60; k++) {
    await sleep(5000);
    const st = await evl('JSON.stringify({t:!![].slice.call(document.querySelectorAll("input,textarea,[contenteditable=true]")).find(function(e){return ((e.placeholder||e.getAttribute("data-placeholder")||"")).indexOf("标题")>=0}),u:location.href.slice(30,80)})');
    if (k % 3 === 0) console.log('[redo] ' + (k + 1) * 5 + 's ' + String(st).slice(0, 130));
    try { const o = JSON.parse(st); if (o && o.t) { ready = true; break; } } catch (e) { /**/ }
  }
  if (!ready) throw new Error('form never appeared (upload stall?)');
  console.log('[redo] form ready, filling');
  await sleep(2500);

  /* 标题 */
  const tId = await hndl('[].slice.call(document.querySelectorAll("input")).find(function(e){return (e.placeholder||"").indexOf("标题")>=0})');
  if (!tId) throw new Error('title el lost');
  await send('Runtime.callFunctionOn', { objectId: tId, functionDeclaration: 'function(){this.focus();return 1}' });
  await sleep(300);
  await send('Input.insertText', { text: TITLE });

  /* 简介 */
  const dId = await hndl('[].slice.call(document.querySelectorAll("[contenteditable=true],.zone-container,textarea")).find(function(e){var p=(e.getAttribute&&e.getAttribute("data-placeholder"))||e.placeholder||"";return p.indexOf("简介")>=0})');
  if (dId) {
    await send('Runtime.callFunctionOn', { objectId: dId, functionDeclaration: 'function(){this.focus();this.click&&this.click();return 1}' });
    await sleep(400);
    await send('Input.insertText', { text: DESC });
    console.log('[redo] desc ok');
  } else console.log('[redo] desc el not found — skip');

  await sleep(3000);
  const clk = await evl('(function(){var b=[].slice.call(document.querySelectorAll("button")).find(function(x){return x.innerText.trim()==="发布"&&!x.disabled});if(b){b.click();return "CLICKED"}return "NO_BTN"})()');
  console.log('[redo] publish click: ' + clk);

  for (let k = 0; k < 12; k++) {
    await sleep(5000);
    const u = await evl('location.href');
    const ts = await evl('[].slice.call(document.querySelectorAll("[class*=toast],[role=alert]")).map(function(e){return (e.innerText||"").trim()}).filter(Boolean).slice(0,3).join("|")');
    console.log('[redo] +' + (k + 1) * 5 + 's url=' + String(u).slice(0, 75) + ' toast=' + String(ts).slice(0, 60));
    if (/manage|success/.test(String(u)) || String(ts).indexOf('成功') >= 0) break;
  }
  const s = await send('Page.captureScreenshot', { format: 'png' }, 30000);
  if (s.result && s.result.data) fs.writeFileSync(path.join(__dirname, 'douyin-redo.png'), Buffer.from(s.result.data, 'base64'));
  console.log('[redo] done, screenshot tools/douyin-redo.png');
  ws.close();
})().catch((e) => { console.log('REDO_FAIL ' + e.message); process.exit(1); });
