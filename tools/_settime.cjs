'use strict';
// tools/_settime.cjs — 抖音定时发布时间写入（直改 React state + 原生 value 双保险）
// 用法：node tools/_settime.cjs "2026-10-02 11:00"
const puppeteer = require('puppeteer-core');
const want = process.argv[2];
if (!want) { console.error('need time arg'); process.exit(1); }

(async () => {
  const b = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9333', protocolTimeout: 120000 });
  const ts = b.targets().filter((t) => t.type() === 'page' && /content\/post/.test(t.url()));
  let hit = null;
  for (const t of ts) {
    const p = await t.asPage().catch(() => null);
    if (!p) continue;
    const has = await p.evaluate(() => !!document.querySelector('video')).catch(() => false);
    if (has) { hit = p; break; }
    if (!hit) hit = p;
  }
  if (!hit) throw new Error('no post/video tab');
  await hit.bringToFront().catch(() => {});

  const res = await hit.evaluate((W) => {
    const vis = (e) => !!(e.offsetWidth || e.offsetHeight);
    const el = Array.from(document.querySelectorAll('input')).find(
      (e) => vis(e) && (/日期和时间|日期|时间/.test(e.placeholder || '') || /^\d{4}-\d{2}-\d{2}/.test((e.value || '').trim())));
    if (!el) return { err: 'NO_INPUT' };
    const before = el.value;
    // React 受控组件：必须用原生 setter 再派发 input 事件
    const proto = window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, W);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    // 顺带摸出 fiber key 与 onChange，供后续直接驱动组件
    const fk = Object.keys(el).find((k) => /^__reactFiber\$/.test(k));
    let onChange = null, propsPath = null;
    if (fk) {
      let f = el[fk], depth = 0;
      while (f && depth < 12) {
        const mp = f.memoizedProps;
        if (mp && typeof mp.onChange === 'function') { onChange = true; propsPath = (f.type && (f.type.name || f.type.displayName)) || String(f.type); break; }
        if (mp && typeof mp.onChange === 'function') break;
        f = f.return; depth++;
      }
    }
    return { before, after: el.value, readonly: el.readOnly, disabled: el.disabled, fiberKey: fk || null, foundOnChange: !!onChange, propsPath: propsPath || null };
  }, want);
  console.log('[settime] ' + JSON.stringify(res));

  await new Promise((r) => setTimeout(r, 2500));
  const back = await hit.evaluate((W) => {
    const vis = (e) => !!(e.offsetWidth || e.offsetHeight);
    const el = Array.from(document.querySelectorAll('input')).find((e) => vis(e) && (/日期|时间/.test(e.placeholder || '') || /^\d{4}-\d{2}-\d{2}/.test((e.value || '').trim())));
    const bt = document.body.innerText;
    return {
      value: el ? el.value : 'GONE',
      want: W,
      matches: el ? el.value === W : false,
      panelHints: (bt.match(/[^\n]*(定时|时间|日期|确定|今天|明天)[^\n]*/g) || []).slice(0, 10),
    };
  }, want);
  console.log('[settime] ' + JSON.stringify(back));
  console.log(back.matches ? 'TIME_SET' : 'TIME_NOT_SET');
  b.disconnect();
})().catch((e) => { console.error('SETTIME_FAIL: ' + e.message); process.exit(1); });
