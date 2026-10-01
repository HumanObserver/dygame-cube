/**
 * douyin-cdp.cjs — 原生 CDP 操作抖音创作者中心（不依赖 puppeteer，避免 attach 卡死）
 *   node tools/douyin-cdp.cjs check
 *   node tools/douyin-cdp.cjs upload --file videos/x.mp4 --title "..." --desc "..."
 *   node tools/douyin-cdp.cjs publish
 * 前置：Edge 以 --remote-debugging-port=9333 启动、已登录、creator 标签页存在。
 */
'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');
const WebSocket = require('ws');

const PORT = 9333;
const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const cmd = argv[0] || 'check';
function val(f, d) { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; }

function httpJson(p) {
  return new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:' + PORT + p, (res) => {
      let s = ''; res.on('data', (c) => (s += c)); res.on('end', () => { try { resolve(JSON.parse(s)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); }
  static async connectToCreator() {
    const tabs = await httpJson('/json');
    const pages = tabs.filter((t) => t.type === 'page' && /creator\.douyin\.com/.test(t.url));
    const tab = pages.find((t) => /content\/post/.test(t.url))
      || pages.find((t) => /content\/upload/.test(t.url))
      || pages.find((t) => /content\/manage/.test(t.url))
      || pages[0];
    if (!tab) throw new Error('creator tab not found');
    const ws = new WebSocket(tab.webSocketDebuggerUrl, { perMessageDeflate: false });
    await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); setTimeout(() => rej(new Error('ws open timeout')), 8000); });
    const cdp = new CDP(ws);
    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw); } catch (e) { return; }
      if (m.id && cdp.pending.has(m.id)) {
        const { res, rej } = cdp.pending.get(m.id); cdp.pending.delete(m.id);
        m.error ? rej(new Error(m.error.message)) : res(m.result);
      }
    });
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdp.send('DOM.enable');
    return { cdp, tab };
  }
  send(method, params, timeoutMs) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      const t = setTimeout(() => { this.pending.delete(id); rej(new Error(method + ' timeout')); }, timeoutMs || 30000);
      this.pending.set(id, { res: (v) => { clearTimeout(t); res(v); }, rej: (e) => { clearTimeout(t); rej(e); } });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }
  async evalJs(expr, objId) {
    const r = await this.send('Runtime.evaluate', {
      expression: '(function(){try{' + expr + '}catch(e){return JSON.stringify({err:String(e)})}})()',
      returnByValue: true, awaitPromise: false,
    }, 25000);
    if (r.exceptionDetails) throw new Error('eval: ' + JSON.stringify(r.exceptionDetails).slice(0, 200));
    const out = r.result && r.result.value;
    return typeof out === 'string' ? JSON.parse(out) : out;
  }
  /** 返回表达式的 RemoteObject objectId（DOM 节点引用） */
  async evalHandle(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, objectGroup: 'dy' }, 25000);
    if (!r.result || !r.result.objectId) return null;
    return r.result.objectId;
  }
  async shot(file) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' }, 30000);
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  }
  close() { try { this.ws.close(); } catch (e) { /**/ } }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const { cdp, tab } = await CDP.connectToCreator();
  console.log('[cdp] tab: ' + tab.url.slice(0, 90));

  if (cmd === 'check') {
    const st = await cdp.evalJs(
      'var t=document.body?document.body.innerText:"";' +
      'return JSON.stringify({ready:document.readyState,hasQr:/扫码登录|验证码登录/.test(t),url:location.href,head:t.replace(/\\s+/g," ").slice(0,140)})');
    console.log(JSON.stringify(st));
    console.log(st.hasQr ? 'NOT_LOGGED_IN' : 'LOGGED_IN');
    cdp.close(); return;
  }

  if (cmd === 'upload') {
    const file = path.resolve(ROOT, val('--file', 'web-preview/videos/gravity-cube-20250930.mp4'));
    const title = val('--title', '');
    const desc = val('--desc', '');
    if (!fs.existsSync(file)) throw new Error('video not found: ' + file);

    // 确保在上传页
    const onUpload = await cdp.evalJs('return JSON.stringify({u:location.href.indexOf("content/upload")>=0})');
    if (!onUpload.u) {
      await cdp.send('Page.navigate', { url: 'https://creator.douyin.com/creator-micro/content/upload' });
      await sleep(9000);
    }

    // 找视频 file input（accept 含 video 或 .mp4，或第一个）
    const inputId = await cdp.evalHandle(
      '(function(){var a=[...document.querySelectorAll("input[type=file]")];' +
      'return a.find(function(i){return /video|mp4|\\*\\//i.test(i.accept||"")})||a[0]||null})()');
    if (!inputId) throw new Error('no file input（可能未登录/页面结构变化）');
    await cdp.send('DOM.setFileInputFiles', { files: [file], objectId: inputId }, 30000);
    console.log('[cdp] file set, uploading...');

    // 等发布表单出现（标题框）
    let titleSel = null;
    const t0 = Date.now();
    while (!titleSel && Date.now() - t0 < 200000) {
      await sleep(4000);
      titleSel = await cdp.evalJs(
        'var els=[...document.querySelectorAll("textarea,input[type=text],input:not([type]),div[contenteditable=true]")];' +
        'var el=els.find(function(e){return (e.placeholder||e.getAttribute("data-placeholder")||"").includes("标题")});' +
        'return JSON.stringify({found:!!el, ph:el?(el.placeholder||el.getAttribute("data-placeholder")):"", body:(document.body.innerText||"").replace(/\\s+/g," ").slice(0,150)})');
      console.log('[cdp] wait form ' + Math.round((Date.now() - t0) / 1000) + 's ' + JSON.stringify(titleSel).slice(0, 220));
      if (titleSel && titleSel.err) titleSel = null;
      if (titleSel && titleSel.found) break;
    }
    if (!titleSel || !titleSel.found) throw new Error('title input timeout');

    // 填标题
    const titleEl = await cdp.evalHandle(
      '(function(){var els=[...document.querySelectorAll("textarea,input[type=text],input:not([type]),div[contenteditable=true]")];' +
      'return els.find(function(e){return (e.placeholder||e.getAttribute("data-placeholder")||"").includes("标题")})})()');
    if (!titleEl) throw new Error('title element lost');
    await cdp.send('Runtime.callFunctionOn', {
      objectId: titleEl, functionDeclaration: 'function(){this.focus();this.click&&this.click();return 1}',
    }, 15000);
    await sleep(400);
    if (title) await cdp.send('Input.insertText', { text: title });

    // 填简介（另一个可见 textarea/contenteditable，placeholder 含 简介/描述/添加/正文/@ 之一，或标题后的第一个不同元素）
    if (desc) {
      const descEl = await cdp.evalHandle(
        '(function(){var els=[...document.querySelectorAll("textarea,div[contenteditable=true]")];' +
        'return els.find(function(e){var p=(e.placeholder||e.getAttribute("data-placeholder")||"");' +
        'return e!==document.activeElement&&/简介|描述|添加|正文|作品声明|话题/.test(p)})||null})()');
      if (descEl) {
        await cdp.send('Runtime.callFunctionOn', { objectId: descEl, functionDeclaration: 'function(){this.focus();return 1}' }, 15000);
        await sleep(400);
        await cdp.send('Input.insertText', { text: desc });
      } else console.log('[cdp] desc box not found, skip');
    }

    await sleep(4000);
    await cdp.shot(path.join(ROOT, 'tools', 'douyin-form.png'));
    const st2 = await cdp.evalJs('var el=[...document.querySelectorAll("textarea,input")].find(function(e){return (e.placeholder||"").includes("标题")});return JSON.stringify({titleVal:el?el.value||el.innerText:"",btns:[...document.querySelectorAll("button")].map(function(b){return b.innerText.trim()}).filter(Boolean).join("|").slice(0,120)})');
    console.log('[cdp] ' + JSON.stringify(st2));
    console.log('FORM_READY (截图: tools/douyin-form.png)');
    cdp.close(); return;
  }

  if (cmd === 'fill') {
    // 诊断所有输入区并填简介/话题
    const dump = await cdp.evalJs(
      'var els=[...document.querySelectorAll("textarea,[contenteditable=true],input")];' +
      'return JSON.stringify(els.map(function(e,i){return {i:i,tag:e.tagName,ph:(e.placeholder||e.getAttribute("data-placeholder")||"").slice(0,24),cls:(e.className||"").toString().slice(0,30),vis:!!(e.offsetWidth||e.offsetHeight),val:(e.value||e.innerText||"").slice(0,20)}}).filter(function(x){return x.vis}).slice(0,12))');
    console.log('[cdp] boxes: ' + JSON.stringify(dump));
    const desc = val('--desc', '');
    if (desc) {
      const el = await cdp.evalHandle(
        '(function(){var els=[...document.querySelectorAll("textarea,[contenteditable=true]")];' +
        'return els.find(function(e){var p=(e.placeholder||e.getAttribute("data-placeholder")||e.innerText||"");' +
        'return (e.offsetWidth||e.offsetHeight)&&/作品描述|简介|描述/.test(p)&&!/标题/.test(p)})||null})()');
      if (el) {
        await cdp.send('Runtime.callFunctionOn', { objectId: el, functionDeclaration: 'function(){this.focus();this.click();return 1}' }, 15000);
        await sleep(500);
        await cdp.send('Input.insertText', { text: desc });
        console.log('[cdp] desc filled');
      } else console.log('[cdp] desc box still not found');
    }
    await sleep(2500);
    await cdp.shot(path.join(ROOT, 'tools', 'douyin-form.png'));
    console.log('FILL_DONE');
    cdp.close(); return;
  }

  if (cmd === 'state') {
    // 关闭 Edge 权限弹窗等杂散 target
    const all = await httpJson('/json');
    for (const t of all) {
      if (t.type === 'page' && /^(edge|chrome):\/\//.test(t.url)) {
        try { await httpJson('/json/close/' + t.id); console.log('[cdp] closed stray target ' + t.url.slice(0, 40)); } catch (e) { /**/ }
      }
    }
    const st = await cdp.evalJs(
      'var toasts=[...document.querySelectorAll("[class*=toast],[class*=Toast],[role=alert],[class*=semi-modal],[class*=dialog]")].map(function(e){return (e.innerText||"").replace(/\\s+/g," ").trim()}).filter(Boolean).slice(0,6);' +
      'var btns=[...document.querySelectorAll("button,div[role=button]")].map(function(b){return b.innerText.trim()}).filter(Boolean);' +
      'var errs=[...document.querySelectorAll("[class*=error],[class*=Error]")].map(function(e){return (e.innerText||"").trim()}).filter(function(x){return x&&x.length<60}).slice(0,5);' +
      'return JSON.stringify({url:location.href,ready:document.readyState,toasts:toasts,errs:errs,btns:btns.slice(0,25)})');
    console.log(JSON.stringify(st, null, 1));
    await cdp.shot(path.join(ROOT, 'tools', 'douyin-state.png'));
    cdp.close(); return;
  }

  if (cmd === 'clicktext') {
    const want = val('--text', '');
    const r = await cdp.evalJs(
      'var bs=[...document.querySelectorAll("button,div[role=button],span,a")];' +
      'var b=bs.find(function(x){return x.innerText&&x.innerText.trim()==="' + want + '"&&(x.offsetWidth||x.offsetHeight)});' +
      'if(!b)return JSON.stringify({clicked:false});b.click();return JSON.stringify({clicked:true,tag:b.tagName})');
    console.log('[cdp] clicktext ' + want + ': ' + JSON.stringify(r));
    await sleep(6000);
    const st = await cdp.evalJs('return JSON.stringify({url:location.href,head:(document.body?document.body.innerText:"").replace(/\\s+/g," ").slice(0,200)})');
    console.log(JSON.stringify(st));
    await cdp.shot(path.join(ROOT, 'tools', 'douyin-state.png'));
    cdp.close(); return;
  }

  if (cmd === 'publish') {
    const found = await cdp.evalJs(
      'var bs=[...document.querySelectorAll("button,div[role=button]")];' +
      'var b=bs.find(function(x){return x.innerText.trim()==="发布"&&!x.disabled&&!!(x.offsetWidth||x.offsetHeight)});' +
      'if(!b)return JSON.stringify({clicked:false,all:bs.map(function(x){return x.innerText.trim()}).filter(Boolean).slice(0,20)});' +
      'b.click();return JSON.stringify({clicked:true})');
    console.log('[cdp] publish: ' + JSON.stringify(found));
    if (!found.clicked) { await cdp.shot(path.join(ROOT, 'tools', 'douyin-blocked.png')); cdp.close(); return; }
    await sleep(15000);
    const st = await cdp.evalJs('return JSON.stringify({url:location.href,head:(document.body?document.body.innerText:"").replace(/\\s+/g," ").slice(0,200)})');
    await cdp.shot(path.join(ROOT, 'tools', 'douyin-published.png'));
    console.log(JSON.stringify(st));
    console.log(/发布成功|content-management|管理/.test((st.url || '') + (st.head || '')) ? 'PUBLISHED' : 'CHECK_SCREENSHOT tools/douyin-published.png');
    cdp.close(); return;
  }

  console.log('unknown cmd ' + cmd); cdp.close();
})().catch((e) => { console.error('CDP_FAIL: ' + e.message); process.exit(1); });
