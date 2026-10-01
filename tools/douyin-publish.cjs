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
  // 抖音创作者中心常同时开着多个 content/post/video 标签（上传时 SPA 会多开一个空表单），
  // 所以不能只按 URL 挑：优先选「页面里已有 <video> 预览」的那个，避免把字填进空表单。
  // 另外 Edge 的原生权限弹窗（edge://permission-request-dialog）不是正常 tab，
  // puppeteer 对它下发 Emulation.setDeviceMetricsOverride 会报
  // "Target does not support metrics override"，因此这里只从 http(s) 目标里选。
  const cands = browser.targets().filter((t) => t.type() === 'page' && /^https?:\/\/creator\.douyin\.com/.test(t.url()));
  let fallback = null;
  for (const t of (cands.length ? cands : browser.targets().filter((t) => t.type() === 'page' && /^https?:/.test(t.url())))) {
    const p = await t.asPage().catch(() => null);
    if (!p) continue;
    if (!fallback) fallback = p;
    const hasVideo = await p.evaluate(() => !!document.querySelector('video')).catch(() => false);
    if (hasVideo) { await p.bringToFront().catch(() => {}); return p; }
  }
  if (fallback) { await fallback.bringToFront().catch(() => {}); return fallback; }
  const pages = await browser.pages();
  let page = pages.find((p) => p.url().includes('creator.douyin.com'));
  if (!page) page = await browser.newPage();
  return page;
}

async function main() {
  const browser = await puppeteer.connect({
    browserURL: 'http://127.0.0.1:' + PORT, protocolTimeout: 600000,
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
    // 把填好的标题/简介从 DOM 读回来（截图看不见时靠这个校验）
    const filled = await page.evaluate(() => {
      const vis = (e) => !!(e.offsetWidth || e.offsetHeight);
      return Array.from(document.querySelectorAll('input,textarea,[contenteditable="true"]')).filter(vis)
        .map((e) => ({
          tag: e.tagName,
          ph: (e.placeholder || e.getAttribute('data-placeholder') || '').replace(/\s+/g, ' ').slice(0, 24),
          val: (e.value || e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 130),
        }))
        .filter((x) => x.val);
    });
    console.log('[pub] FILLED ' + JSON.stringify(filled));
    const shot = path.join(ROOT, 'tools', 'douyin-form.png');
    await page.screenshot({ path: shot, fullPage: false });
    console.log('[pub] form filled, screenshot saved: ' + shot);
    console.log('FORM_READY');
    browser.disconnect();
    return;
  }

  if (cmd === 'fill') {
    // 只填表单（视频已在发布页 content/post/video）：不重新上传，避免重复投稿
    const title = val('--title', '');
    const desc = val('--desc', '');
    const cands = await page.$$('textarea, input[type=text], input:not([type]), [contenteditable="true"]');
    const metas = [];
    for (const el of cands) {
      const m = await page.evaluate((e) => ({
        vis: !!(e.offsetWidth || e.offsetHeight),
        dis: e.disabled === true,
        ce: e.getAttribute('contenteditable') === 'true',
        tag: e.tagName,
        ph: (e.placeholder || e.getAttribute('data-placeholder') || e.getAttribute('aria-placeholder') || '').replace(/\s+/g, ' ').trim(),
        val: (e.value || e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40),
      }), el).catch(() => null);
      if (m && m.vis && !m.dis) metas.push({ el, m });
    }
    console.log('[pub] fill candidates ' + JSON.stringify(metas.map((x) => x.m)));
    const titleC = metas.find((x) => /标题/.test(x.m.ph) || /标题/.test(x.m.val));
    let descC = metas.find((x) => x.el !== titleC && /简介|描述|添加作品|正文/.test(x.m.ph));
    if (!descC) descC = metas.find((x) => x.el !== titleC && (x.m.ce || x.m.tag === 'TEXTAREA'));
    if (title && titleC) {
      await titleC.el.click();
      await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
      await page.keyboard.press('Delete');
      await titleC.el.type(title, { delay: 12 });
      console.log('[pub] typed title');
    } else if (title) console.log('[pub] TITLE_NOT_FOUND');
    if (desc && descC) {
      await descC.el.click();
      await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
      await page.keyboard.press('Delete');
      await descC.el.type(desc, { delay: 12 });
      console.log('[pub] typed desc');
    } else if (desc) console.log('[pub] DESC_NOT_FOUND');
    await new Promise((r) => setTimeout(r, 2500));
    const filled = await page.evaluate(() => {
      const vis = (e) => !!(e.offsetWidth || e.offsetHeight);
      return Array.from(document.querySelectorAll('input,textarea,[contenteditable="true"]')).filter(vis)
        .map((e) => ({
          tag: e.tagName,
          ph: (e.placeholder || e.getAttribute('data-placeholder') || '').replace(/\s+/g, ' ').slice(0, 20),
          val: (e.value || e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 140),
        }))
        .filter((x) => x.val && x.val !== '​');
    });
    console.log('[pub] FILLED ' + JSON.stringify(filled));
    const shot = path.join(ROOT, 'tools', 'douyin-form.png');
    await page.screenshot({ path: shot, fullPage: false });
    console.log('FILL_DONE shot=' + shot);
    browser.disconnect();
    return;
  }

  if (cmd === 'state') {
    // 只读当前页面结构：按钮 / 输入框 / 有没有「定时发布」，不做任何点击
    const info = await page.evaluate(() => {
      const vis = (e) => !!(e.offsetWidth || e.offsetHeight);
      const txt = (e) => (e.innerText || e.value || e.getAttribute('placeholder') || e.getAttribute('data-placeholder') || '')
        .replace(/\s+/g, ' ').trim().slice(0, 70);
      const btns = Array.from(document.querySelectorAll('button,div[role=button],span,label,[role=radio],[role=switch]'))
        .filter(vis).map(txt)
        .filter((t) => t && /发布|定时|可见|草稿|取消|确定|保存|权限|仅自己|朋友|高级设置|封面|合集/.test(t));
      const inputs = Array.from(document.querySelectorAll('input,textarea,[contenteditable="true"]')).filter(vis)
        .map((e) => ({ tag: e.tagName, type: e.type || '', ph: txt(e), val: (e.value || e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60) }))
        .filter((x) => x.ph || x.val);
      const bt = document.body ? document.body.innerText : '';
      return {
        url: location.href,
        hasSchedule: /定时发布/.test(bt),
        hints: (bt.match(/[^\n]*(上传|解析|审核|发布中|完成|定时)[^\n]*/g) || []).slice(0, 8),
        buttons: Array.from(new Set(btns)).slice(0, 30),
        inputs: inputs.slice(0, 20),
      };
    });
    console.log(JSON.stringify(info, null, 1));
    browser.disconnect();
    return;
  }

  if (cmd === 'schedule') {
    // 打开「定时发布」并填时间：默认只填不提交（打印 SCHEDULE_FILLED），加 --go 才点最终按钮
    const at = val('--at', '');
    if (!at) throw new Error('schedule 需要 --at "YYYY/MM/DD HH:mm"');
    const go = argv.includes('--go');

    const toggle = await page.evaluate(() => {
      const vis = (e) => !!(e.offsetWidth || e.offsetHeight);
      const all = Array.from(document.querySelectorAll('label,span,div,button,[role=radio],[role=switch],[role=tab]'));
      for (const e of all) {
        if (!vis(e)) continue;
        if ((e.innerText || '').replace(/\s+/g, '') === '定时发布') {
          e.click();
          return { tag: e.tagName, cls: (e.className || '').toString().slice(0, 80) };
        }
      }
      return null;
    });
    console.log('[pub] 定时发布 toggle: ' + JSON.stringify(toggle));
    await new Promise((r) => setTimeout(r, 2000));

    const pickers = await page.$$('input, [contenteditable="true"]');
    let box = null, boxInfo = null;
    for (const el of pickers) {
      const m = await page.evaluate((e) => ({
        vis: !!(e.offsetWidth || e.offsetHeight),
        ph: e.placeholder || e.getAttribute('data-placeholder') || '',
        val: (e.value || e.innerText || '').trim(),
        dis: e.disabled === true,
      }), el).catch(() => null);
      if (m && m.vis && !m.dis && (/日期|时间|选择/.test(m.ph) || /^\d{4}[\/-]\d{1,2}/.test(m.val))) { box = el; boxInfo = m; break; }
    }
    if (!box) { console.log('PICKER_NOT_FOUND — 先看 state 输出'); browser.disconnect(); return; }
    await box.click();
    await new Promise((r) => setTimeout(r, 600));
    await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
    await page.keyboard.press('Delete');
    await page.keyboard.type(at, { delay: 30 });
    await page.keyboard.press('Enter');
    await new Promise((r) => setTimeout(r, 1500));
    const readBack = await page.evaluate((e) => ({ ph: e.placeholder || '', val: (e.value || e.innerText || '').trim() }), box).catch(() => 'DETACHED');
    console.log('[pub] picker ' + JSON.stringify(boxInfo) + ' -> ' + JSON.stringify(readBack));

    if (!go) { console.log('SCHEDULE_FILLED'); browser.disconnect(); return; }

    const btns = await page.$$('button, div[role=button]');
    let hit = null;
    for (const b of btns) {
      const t = await page.evaluate((e) => ({
        text: (e.innerText || '').replace(/\s+/g, '').trim(),
        vis: !!(e.offsetWidth || e.offsetHeight),
        dis: e.disabled || e.getAttribute('aria-disabled') === 'true',
      }), b).catch(() => null);
      if (t && t.vis && t.text === '定时发布' && !t.dis) { hit = b; break; }
    }
    if (!hit) throw new Error('定时发布 按钮未找到或未启用');
    await hit.click();
    console.log('[pub] clicked 定时发布, waiting...');
    await new Promise((r) => setTimeout(r, 12000));
    const after = await page.evaluate(() => ({ url: location.href, head: (document.body ? document.body.innerText : '').replace(/\s+/g, ' ').slice(0, 300) }));
    await page.screenshot({ path: path.join(ROOT, 'tools', 'douyin-published.png') });
    console.log(JSON.stringify(after));
    console.log(/定时发布成功|发布成功|内容管理|定时/.test(after.url + after.head) ? 'SCHEDULED?' : 'CHECK_SCREENSHOT');
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
