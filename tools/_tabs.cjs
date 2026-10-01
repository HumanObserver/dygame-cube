'use strict';
// tools/_tabs.cjs — 列出所有抖音发布页 target，逐个读回 视频/标题/简介/定时发布 状态
// 用法：node tools/_tabs.cjs [--closeEmpty]
//   --closeEmpty 关掉「没有视频且标题为空」的重复发布页（上传时 SPA 有时会多开一个空表单）
const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9333', protocolTimeout: 120000 });
  const ts = browser.targets().filter((t) => t.type() === 'page' && /creator\.douyin\.com/.test(t.url()));
  const probe = [];
  for (const t of ts) {
    let p;
    try { p = await t.asPage(); } catch (e) { probe.push({ t, info: { url: t.url(), err: 'asPage: ' + e.message } }); continue; }
    const info = await p.evaluate(() => {
      const vis = (e) => !!(e.offsetWidth || e.offsetHeight);
      const q = (sel) => Array.from(document.querySelectorAll(sel)).filter(vis);
      const titleEl = q('input').find((e) => /标题/.test(e.placeholder || ''));
      const descEl = q('[contenteditable="true"]')[0];
      const dateEl = q('input,textarea').find((e) => (/日期|时间|选择/.test(e.placeholder || '') || /^\d{4}[\/-]\d{1,2}/.test((e.value || '').trim())));
      const sw = q('span,div,button,label').find((e) => (e.innerText || '').replace(/\s+/g, '') === '定时发布');
      const bt = document.body ? document.body.innerText : '';
      const vids = Array.from(document.querySelectorAll('video'));
      return {
        url: location.href,
        video: vids.map((v) => ({ src: (v.currentSrc || v.src || '').slice(0, 40), dur: Math.round((v.duration || 0) * 10) / 10 })).filter((x) => x.src),
        videoCount: vids.length,
        fileInputs: q('input[type=file]').map((e) => (e.accept || '*').slice(0, 30)),
        uploadHints: (bt.match(/[^\n]*(上传成功|重新上传|发布中|审核|封面|时长|大小)[^\n]*/g) || []).slice(0, 6),
        title: titleEl ? titleEl.value : null,
        desc: descEl ? (descEl.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60) : null,
        datePh: dateEl ? dateEl.placeholder : null,
        dateVal: dateEl ? (dateEl.value || '').trim() : null,
        scheduleEl: sw ? sw.tagName + '.' + String(sw.className).slice(0, 40) : null,
        radios: q('input[type=radio]').map((e) => {
          const lab = e.closest('label') || document.querySelector('label[for="' + e.id + '"]');
          return {
            label: (lab ? lab.innerText : (e.getAttribute('aria-label') || '')).replace(/\s+/g, ' ').trim().slice(0, 20),
            checked: !!e.checked,
            name: e.name || null,
          };
        }),
        scheduleChecked: sw ? /checked|active|selected/.test(String(sw.className)) || sw.getAttribute('aria-checked') === 'true' : null,
        toast: (bt.match(/[^\n]*(定时|上传中|解析|审核|成功)[^\n]*/g) || []).slice(0, 4),
      };
    }).catch((e) => ({ evalErr: e.message.slice(0, 120) }));
    probe.push({ t, info: Object.assign({ tab: probe.length + 1 }, info) });
  }
  console.log(JSON.stringify(probe.map((x) => x.info), null, 1));
  if (process.argv.includes('--closeEmpty')) {
    for (const x of probe) {
      const i = x.info;
      if (i.videoCount === 0 && !i.title) {
        const p = await x.t.asPage().catch(() => null);
        if (p) { console.log('[tabs] closing empty tab ' + i.tab + ' ' + i.url); await p.close().catch(() => {}); }
      }
    }
  }
  browser.disconnect();
})().catch((e) => { console.error('TABS_FAIL: ' + e.message); process.exit(1); });
