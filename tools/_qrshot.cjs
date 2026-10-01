/**
 * _qrshot.cjs — 一次性小工具：把当前创作者登录页的二维码截下来，方便手机扫码
 *   node tools/_qrshot.cjs [输出路径]
 * 默认输出 web-preview/frames/login-qr.png（frames/ 已被 .gitignore 忽略）。
 * 前置：Edge 以 --remote-debugging-port=9333 启动并停在 creator.douyin.com。
 */
'use strict';
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer-core');

const ROOT = path.join(__dirname, '..');

async function main() {
  const out = path.resolve(ROOT, process.argv[2] || 'web-preview/frames/login-qr.png');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9333', protocolTimeout: 30000 });
  const pages = await browser.pages();
  const page = pages.find((p) => p.url().includes('creator.douyin.com')) || pages[pages.length - 1];

  // 找二维码：常见是 img[src^=data:image] 或 canvas，尺寸 100~400
  const hit = await page.evaluate(() => {
    const cands = Array.from(document.querySelectorAll('img, canvas'));
    let best = null;
    for (const el of cands) {
      const w = el.offsetWidth || el.width || 0, h = el.offsetHeight || el.height || 0;
      if (w < 90 || h < 90 || w > 420 || h > 420) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 90 || r.height < 90) continue;
      const score = Math.min(w, h);
      if (!best || score > best.score) best = { tag: el.tagName, score };
    }
    return best ? best.tag : null;
  });

  if (hit) {
    const el = await page.evaluateHandle((tag) => {
      const list = Array.from(document.querySelectorAll(tag));
      for (const e of list) {
        const w = e.offsetWidth || e.width || 0, h = e.offsetHeight || e.height || 0;
        if (w >= 90 && w <= 420 && h >= 90 && h <= 420) return e;
      }
      return null;
    }, hit);
    const box = el && el.asElement ? await el.asElement().boundingBox() : null;
    if (box) {
      await el.asElement().screenshot({ path: out });
      console.log('QR_ELEMENT ' + out + ' ' + JSON.stringify(box));
      browser.disconnect();
      return;
    }
  }
  await page.screenshot({ path: out, fullPage: false });
  console.log('FULLPAGE ' + out);
  browser.disconnect();
  process.exit(0);
}
main().catch((e) => { console.error('QRSHOT_FAIL: ' + e.message); process.exit(1); });
