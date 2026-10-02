'use strict';
// tools/_works.cjs — 只读抖音「作品管理」列表：标题 / 状态 / 时间（用于核查定时发布是否生效）
const puppeteer = require('puppeteer-core');

(async () => {
  const b = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9333', protocolTimeout: 120000 });
  const ts = b.targets().filter((t) => t.type() === 'page' && /^https?:\/\/creator\.douyin\.com/.test(t.url()));
  if (!ts.length) { console.log('NO_CREATOR_TAB'); b.disconnect(); return; }
  const p = await ts[0].asPage();
  await p.bringToFront().catch(() => {});
  await p.goto('https://creator.douyin.com/creator-micro/content/manage', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => console.log('[works] nav warn ' + e.message));
  await new Promise((r) => setTimeout(r, 9000));
  const info = await p.evaluate(() => {
    const vis = (e) => !!(e.offsetWidth || e.offsetHeight);
    const rows = Array.from(document.querySelectorAll('div,li,tr')).filter((e) => {
      const t = (e.innerText || '');
      return vis(e) && /引力方块|这局手气爆棚/.test(t) && t.length < 600;
    }).map((e) => (e.innerText || '').replace(/\s+/g, ' ').trim());
    const uniq = Array.from(new Set(rows)).sort((a, b) => a.length - b.length).slice(0, 6);
    const bt = document.body ? document.body.innerText : '';
    return {
      url: location.href,
      tabs: (bt.match(/[^\n]*(全部|已发布|审核中|未通过|定时发布|草稿)[^\n]*/g) || []).slice(0, 10),
      rows: uniq,
      workTitles: Array.from(new Set((bt.match(/[^\n]*(这局手气爆棚|引力方块)[^\n]*/g) || []))).slice(0, 8),
      newWorkFound: /这局手气爆棚|2290分/.test(bt),
      bodyHead: bt.replace(/\s+/g, ' ').slice(0, 700),
      empty: /暂无作品|暂无内容|还没有/.test(bt),
    };
  });
  console.log(JSON.stringify(info, null, 1));
  await p.screenshot({ path: 'tools/douyin-manage.png' }).catch(() => {});
  b.disconnect();
})().catch((e) => { console.error('WORKS_FAIL: ' + e.message); process.exit(1); });
