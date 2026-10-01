/**
 * douyin-publish.cjs — 通过 CDP 操作已打开的 Edge（--remote-debugging-port=9333）
 * 在抖音创作者中心完成：上传视频 → 填写标题/简介/话题 → 截图确认 →（--go）点击发布
 *
 * 用法：
 *   node tools/douyin-publish.cjs check                       # 检查登录状态
 *   node tools/douyin-publish.cjs upload --file videos/x.mp4 \
 *        --title "..." --desc "..."                            # 上传并填表，截图 douyin-form.png
 *   node tools/douyin-publish.cjs publish                     # 确认后点最终发布按钮
 * 前置：Edge 已以调试端口启动且用户在窗口内扫码登录。
 */
'use strict';
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer-core');

const PORT = 9333;
const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const cmd = argv[0] || 'check';
function val(f, d) { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; }

async function getPage(browser) {
  const pages = await browser.pages();
  let page = pages.find((p) => p.url().includes('creator.douyin.com'));
  if (!page) {
    page = await browser.newPage();
  }
  return page;
}

async function main() {
  const browser = await puppeteer.connect({
    browserURL: 'http://127.0.0.1:' + PORT, protocolTimeout: 180000,
  });
  const page = await getPage(browser);

  if (cmd === 'check') {
    if (!page.url().includes('creator.douyin.com')) {
      await page.goto('https://creator.douyin.com/creator-micro/home', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await new Promise((r) => setTimeout(r, 4000));
    }
    const info = await page.evaluate(() => {
      const text = document.body ? document.body.innerText.slice(0, 600) : '';
      return { url: location.href, hasQr: /扫码登录|手机号登录|登录抖音/.test(text), head: text.slice(0, 200) };
    });
    console.log(JSON.stringify(info, null, 1));
    console.log(info.hasQr || /login/.test(info.url) ? 'NOT_LOGGED_IN' : 'LOGGED_IN');
    browser.disconnect();
    return;
  }

  if (cmd === 'upload') {
    const file = path.resolve(ROOT, val('--file', 'web-preview/videos/gravity-cube-ai-20250930.mp4'));
    const title = val('--title', '第一次玩引力方块太上头了，重力随机换方向！4次消行撑到第2关才崩');
    const desc = val('--desc', '');
    if (!fs.existsSync(file)) throw new Error('video not found: ' + file);

    if (!page.url().includes('content/upload')) {
      try {
        await page.goto('https://creator.douyin.com/creator-micro/content/upload', { waitUntil: 'domcontentloaded', timeout: 45000 });
      } catch (e) { console.log('[pub] nav warn: ' + e.message + '（继续探测页面）'); }
    }
    await new Promise((r) => setTimeout(r, 4000));

    // 找文件输入框（上传视频入口）
    const inputs = await page.$$('input[type=file]');
    if (!inputs.length) throw new Error('no file input — 可能未登录或页面结构变化');
    // 视频上传 input：accept 含 video 或 mp4
    let target = null;
    for (const inp of inputs) {
      const acc = await page.evaluate((el) => el.accept || '', inp);
      if (/video|mp4|\*\//.test(acc)) { target = inp; break; }
    }
    target = target || inputs[0];
    await target.uploadFile(file);
    console.log('[pub] file injected, waiting for form...');

    // 等待发布表单出现（标题输入框）
    let titleEl = null;
    const t0 = Date.now();
    while (!titleEl && Date.now() - t0 < 150000) {
      await new Promise((r) => setTimeout(r, 3000));
      const cands = await page.$$('textarea, input[type=text], input:not([type])');
      for (const el of cands) {
        const meta = await page.evaluate((e) => ({
          ph: e.placeholder || '',
          cls: (e.className || '').toString().slice(0, 80),
          vis: !!(e.offsetWidth || e.offsetHeight),
        }), el);
        if (meta.vis && /标题|请输入标题/.test(meta.ph)) { titleEl = el; break; }
      }
      if (!titleEl) {
        // 新版 UI：contenteditable 标题
        const ce = await page.$('[contenteditable="true"]');
        if (ce) {
          const isTop = await page.evaluate((e) => /标题|title/i.test((e.className || '') + (e.getAttribute('data-placeholder') || '')), ce);
          if (isTop) titleEl = ce;
        }
      }
      console.log('[pub] waiting form... ' + Math.round((Date.now() - t0) / 1000) + 's');
    }
    if (!titleEl) throw new Error('title input not found after 150s');

    await titleEl.click();
    await titleEl.type(title, { delay: 12 });

    // 简介/正文框（另一个 textarea 或第二个 contenteditable）
    if (desc) {
      const boxes = await page.$$('textarea, [contenteditable="true"]');
      for (const b of boxes) {
        const same = await page.evaluate((e, t) => e === t, b, titleEl).catch(() => false);
        if (same) continue;
        const vis = await page.evaluate((e) => !!(e.offsetWidth || e.offsetHeight), b);
        const ph = await page.evaluate((e) => (e.placeholder || e.getAttribute('data-placeholder') || ''), b);
        if (vis && /简介|描述|添加|正文/.test(ph)) { await b.click(); await b.type(desc, { delay: 12 }); break; }
      }
    }

    await new Promise((r) => setTimeout(r, 3000));
    const shot = path.join(ROOT, 'tools', 'douyin-form.png');
    await page.screenshot({ path: shot, fullPage: false });
    console.log('[pub] form filled, screenshot saved: ' + shot);
    console.log('FORM_READY');
    browser.disconnect();
    return;
  }

  if (cmd === 'publish') {
    // 找到“发布”按钮（排除“定时发布/存草稿”）
    const btns = await page.$$('button, div[role=button]');
    let hit = null;
    for (const b of btns) {
      const t = await page.evaluate((e) => ({
        text: (e.innerText || '').trim(),
        vis: !!(e.offsetWidth || e.offsetHeight),
        dis: e.disabled || e.getAttribute('aria-disabled') === 'true',
      }), b).catch(() => null);
      if (t && t.vis && t.text === '发布' && !t.dis) { hit = b; break; }
    }
    if (!hit) throw new Error('publish button not found/enabled');
    await hit.click();
    console.log('[pub] clicked 发布, waiting...');
    await new Promise((r) => setTimeout(r, 12000));
    const after = await page.evaluate(() => ({
      url: location.href,
      head: document.body ? document.body.innerText.slice(0, 300) : '',
    }));
    const shot = path.join(ROOT, 'tools', 'douyin-published.png');
    await page.screenshot({ path: shot });
    console.log(JSON.stringify(after));
    console.log(/content-management|发布成功|管理/.test(after.url + after.head) ? 'PUBLISHED?' : 'CHECK_SCREENSHOT');
    browser.disconnect();
    return;
  }

  console.log('unknown cmd: ' + cmd);
  browser.disconnect();
}

main().catch((e) => { console.error('PUB_FAIL: ' + e.message); process.exit(1); });
