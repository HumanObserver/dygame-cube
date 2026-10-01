/**
 * _probe-douyin.cjs — 健壮探测：不 goto，只读当前 creator 标签页状态
 */
'use strict';
const puppeteer = require('puppeteer-core');

async function main() {
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9333', protocolTimeout: 20000 });
  const pages = await browser.pages();
  const page = pages.find((p) => p.url().includes('douyin.com'));
  if (!page) { console.log('NO_TAB'); process.exit(0); }
  console.log('url=' + page.url());
  const race = Promise.race([
    page.evaluate(() => ({
      ready: document.readyState,
      hasQr: /扫码登录|登录抖音|手机号登录/.test(document.body ? document.body.innerText : ''),
      nick: (document.querySelector('.account-user-name, [class*=user-name]') || {}).innerText || '',
      hasUploadEntry: /上传视频|发布视频|content\/upload/.test((document.body ? document.body.innerText : '') + document.body.innerHTML),
      head: (document.body ? document.body.innerText : '').replace(/\s+/g, ' ').slice(0, 160),
    })),
    new Promise((r) => setTimeout(() => r('EVAL_TIMEOUT'), 18000)),
  ]);
  const res = await race;
  console.log(JSON.stringify(res));
  browser.disconnect();
  process.exit(0);
}
main().catch((e) => { console.log('PROBE_FAIL ' + e.message); process.exit(1); });
