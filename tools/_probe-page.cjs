'use strict';
// tools/_probe-page.cjs — 短超时读当前抖音页面的 url + 正文片段（用于探测 JS 对话框/卡死）
const puppeteer = require('puppeteer-core');

(async () => {
  const b = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9333', protocolTimeout: 8000 });
  const ts = b.targets().filter((t) => t.type() === 'page' && /creator\.douyin\.com/.test(t.url()));
  console.log('targets=' + ts.length);
  for (const t of ts) {
    const p = await t.asPage().catch((e) => { console.log('asPage err ' + e.message); return null; });
    if (!p) continue;
    p.on('dialog', async (d) => { console.log('DIALOG ' + d.type() + ' ' + JSON.stringify(d.message()).slice(0, 120)); await d.dismiss().catch(() => {}); });
    const r = await p.evaluate(() => ({
      url: location.href,
      head: (document.body ? document.body.innerText : '').replace(/\s+/g, ' ').slice(0, 400),
      modals: Array.from(document.querySelectorAll('[class*=modal],[class*=dialog],[role=dialog]')).filter((e) => e.offsetWidth).map((e) => (e.innerText || '').replace(/\s+/g, ' ').slice(0, 80)).slice(0, 5),
    })).catch((e) => ({ err: e.message.slice(0, 100) }));
    console.log(JSON.stringify(r, null, 1));
  }
  b.disconnect();
})().catch((e) => { console.error('PROBE_FAIL: ' + e.message); process.exit(1); });
