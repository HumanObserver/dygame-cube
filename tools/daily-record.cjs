/**
 * daily-record.cjs — 每日一录：从 seeds.json 种子池按日期轮换选种，
 * 调用 record.cjs 完成录制+修复+校验，输出当日视频。
 *
 * 用法：node tools/daily-record.cjs [--date YYYY-MM-DD] [--seed N 覆盖轮换]
 * 发布（抖音）为独立步骤：人工上传或等接入发布凭据后扩展 publish 部分。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const NODE = process.execPath;

function pickSeed(dateStr) {
  const pool = JSON.parse(fs.readFileSync(path.join(ROOT, 'web-preview', 'seeds.json'), 'utf8').replace(/^\uFEFF/, ''));
  const d = dateStr ? new Date(dateStr + 'T12:00:00') : new Date();
  const dayNo = Math.floor(d.getTime() / 86400000);
  const entry = pool.seeds[dayNo % pool.seeds.length];
  return { pool, entry };
}

(async () => {
  const argv = process.argv.slice(2);
  const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
  const dateStr = val('--date', null);
  const d = dateStr ? new Date(dateStr + 'T12:00:00') : new Date();
  const stamp = d.toISOString().slice(0, 10).replace(/-/g, '');

  const { pool, entry } = pickSeed(dateStr);
  const seed = val('--seed', null) ? parseInt(val('--seed', '0'), 10) : entry.seed;
  const finish = pool.finishAfterMs || 60000;
  const name = 'gravity-cube-ai-' + stamp;

  console.log('[daily] seed=' + seed + ' finish=' + finish + ' name=' + name);
  const r = spawnSync(NODE, [
    path.join(ROOT, 'web-preview', 'record.cjs'),
    '--seed', String(seed),
    '--finish', String(finish),
    '--name', name,
    '--timeout', '240000',
  ], { stdio: ['ignore', 'pipe', 'inherit'] });

  let out = (r.stdout || '').toString();
  process.stdout.write(out);
  if (r.status !== 0) { console.error('[daily] record failed code=' + r.status); process.exit(r.status || 1); }

  const line = out.trim().split('\n').filter((l) => l.startsWith('{')).pop();
  const res = line ? JSON.parse(line) : null;
  if (!res || !res.ok) { console.error('[daily] no ok summary'); process.exit(1); }
  if (res.narrationOk === false) {
    console.warn('[daily] ⚠ 实际战绩与配音数字偏差过大 → 建议重录或重生成该种子配音');
  }
  console.log('[daily] ✔ ' + res.file + ' (' + res.sizeMB + ' MB, ' + Math.round(res.durationMs / 100) / 10 + 's)');
  process.exit(0);
})().catch((e) => { console.error('[daily] fatal: ' + (e && e.stack || e)); process.exit(1); });
