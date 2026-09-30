/**
 * 配音生成工具：msedge-tts 神经网络中文 TTS → web-preview/media/narration/*.mp3
 * 同时输出 clips.json 清单（id → {file, text}），录制页据此播放配音并烧录字幕。
 *
 * 用法：
 *  node tools/gen-narration.cjs --base                 # 生成全部静态配音
 *  node tools/gen-narration.cjs --seed 15              # 按 seeds.json 中该种子的战绩生成 gameover-15.mp3
 *  node tools/gen-narration.cjs --base --seed 15       # 两者
 *  node tools/gen-narration.cjs --base --seed all      # 静态 + 种子池全部 gameover 配音
 *  可选：--voice zh-CN-YunxiNeural --rate +10%
 */
'use strict';
if (typeof globalThis.crypto === 'undefined') {
  globalThis.crypto = require('crypto').webcrypto; // Node 18 需要
}
const fs = require('fs');
const path = require('path');
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');

const OUT_DIR = path.join(__dirname, '..', 'web-preview', 'media', 'narration');
const SEEDS_JSON = path.join(__dirname, '..', 'web-preview', 'seeds.json');
const MANIFEST = path.join(OUT_DIR, 'clips.json');

/* ---------- 中文数字 ---------- */
const DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
function cn2(n) { // 0..99
  if (n < 10) return DIGITS[n];
  const t = Math.floor(n / 10), o = n % 10;
  return (t > 1 ? DIGITS[t] : '') + '十' + (o ? DIGITS[o] : '');
}
function scoreTalk(score) { // 1289 → 一千两百多分
  const h = Math.floor(score / 100) * 100;
  if (h >= 1000) {
    const q = Math.floor(h / 1000), rem = Math.floor((h % 1000) / 100);
    let s = cn2(q) + '千';
    if (rem) s += cn2(rem) + '百';
    return s + '多分';
  }
  if (h >= 100) return cn2(Math.floor(h / 100)) + '百多分';
  return cn2(h) + '多分';
}

/* ---------- 配音脚本 ---------- */
const BASE_CLIPS = [
  { id: 'intro', text: '方块居然从棋盘正中间往下掉，重力还会随机变方向！我是AI玩家，今天来挑战这款引力方块，看看我能打到什么程度！' },
  { id: 'rules', text: '规则很简单：跟着箭头提示走，填满一整行或者一整列就能消除。累计分数过关升级，速度会越来越快！' },
  { id: 'clear1', text: '漂亮！消掉一行！' },
  { id: 'clear2', text: '双消！这波可以啊！' },
  { id: 'clear3', text: '又消了，根本停不下来！' },
  { id: 'clear4', text: '哇，连锁消除！棋盘直接清空一大片！' },
  { id: 'levelup', text: '升级啦！下落速度变快了，看好了！' },
  { id: 'danger', text: '哎呀，中间快被堵住了，有点危险！' },
  { id: 'rank', text: '这个分数直接冲上排行榜！你觉得你能打得过我吗？' },
  { id: 'outro', text: '关注我，每天一局AI新挑战，我们明天见！' },
];

function gameoverClip(seed, stats) {
  return {
    id: 'gameover-' + seed,
    text: `哎呀，还是被堵住了！这局拿了${scoreTalk(stats.score)}，撑到第${cn2(stats.level)}关，消了${cn2(stats.lines)}行，表现还不错吧！`,
  };
}

/* ---------- TTS ---------- */
async function synth(voice, rate, clip) {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  const file = path.join(OUT_DIR, clip.id + '.mp3');
  try {
    const { audioFilePath } = await tts.toFile(OUT_DIR, clip.text, { rate });
    fs.renameSync(audioFilePath, file);
    const size = fs.statSync(file).size;
    console.log('OK ' + clip.id + ' (' + size + ' B)');
    return { id: clip.id, file: clip.id + '.mp3', text: clip.text };
  } finally {
    tts.close();
  }
}

function loadManifest() {
  try { return JSON.parse(fs.readFileSync(MANIFEST, 'utf8')); } catch (e) { return { clips: {} }; }
}
function saveManifest(m) {
  fs.writeFileSync(MANIFEST, JSON.stringify(m, null, 2), 'utf8');
}

(async () => {
  const args = process.argv.slice(2);
  const has = (f) => args.includes(f);
  const val = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
  const voice = val('--voice', 'zh-CN-YunxiNeural');
  const rate = val('--rate', '+10%');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const manifest = loadManifest();
  manifest.voice = voice;
  manifest.rate = rate;

  if (!has('--base') && !has('--seed')) {
    console.log('nothing to do (use --base / --seed)');
    process.exit(0);
  }

  if (has('--base')) {
    for (const clip of BASE_CLIPS) {
      const rec = await synth(voice, rate, clip);
      manifest.clips[clip.id] = rec;
      saveManifest(manifest);
    }
  }

  const seedArg = val('--seed', null);
  if (seedArg) {
    // PowerShell 写出的 JSON 可能带 UTF-8 BOM，需剥离
    const raw = fs.readFileSync(SEEDS_JSON, 'utf8').replace(/^\uFEFF/, '');
    const pool = JSON.parse(raw);
    const seeds = seedArg === 'all' ? pool.seeds : [{ seed: parseInt(seedArg, 10) }];
    for (const s of seeds) {
      const entry = pool.seeds.find((x) => x.seed === s.seed) || s;
      if (entry.score === undefined) { console.log('SKIP seed ' + s.seed + ' (no stats in seeds.json)'); continue; }
      const clip = gameoverClip(entry.seed, entry);
      const rec = await synth(voice, rate, clip);
      manifest.clips[clip.id] = rec;
      saveManifest(manifest);
    }
  }
  console.log('manifest saved:', MANIFEST);
  process.exit(0);
})().catch((e) => { console.error('TTS FAIL:', e && e.message); process.exit(1); });
