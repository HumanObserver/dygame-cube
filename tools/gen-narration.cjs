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
function scoreTalk(score) { // 1289 → 一千两百多分 ／ 2768 → 两千七百多分
  const h = Math.floor(score / 100) * 100;
  const say = (n) => (n === 2 ? '两' : DIGITS[n]); // 口语里量词前的 2 读「两」
  if (h >= 1000) {
    const q = Math.floor(h / 1000), rem = Math.floor((h % 1000) / 100);
    let s = say(q) + '千';
    if (rem) s += say(rem) + '百';
    return s + '多分';
  }
  if (h >= 100) return say(Math.floor(h / 100)) + '百多分';
  return cn2(h) + '多分';
}

/* ---------- 配音脚本 ----------
 * 人设：真人玩家视角（画面与配音都不出现「AI/机器人」字样）；短句、口语化，便于烧录字幕。
 * 触发点（见 web-preview/recorder.js 的事件导演）：
 *   intro 菜单 → rules 开局 → settle 首次半侧沉降 → levelup 过关清场 → skillintro 技能登场
 *   → turret/turretBig 炮台开火 → resonance 共鸣引爆 → cards 三选一 → card* 选牌结果
 *   → danger 转收尾 → gameover-<seed> 结算战绩 → rank 排行榜 → outro 结尾
 */
const BASE_CLIPS = [
  { id: 'intro', text: '方块游戏更新版本了！这次炮台、共鸣、属性牌全上线，直接开打！' },
  { id: 'rules', text: '老规则：方块从正中间出生、重力随机变，填满一行或一列就消除，分数达标就过关！' },
  { id: 'settle', text: '注意看沉降：只有贴近消除线的那一半滑过去压实，另一半原地不动！' },
  { id: 'skillintro', text: '第二关起方块带技能徽章！金色是炮台，落地开火；青色是共鸣，消掉就引爆！' },
  { id: 'turret', text: '炮台开火！能量弹顺着反重力方向一路把方块打穿！' },
  { id: 'turretBig', text: '这一发直接带走一整排，太解压了！' },
  { id: 'resonance', text: '共鸣引爆！同色方块被一起带走，还连锁着继续炸！' },
  { id: 'cards', text: '攒够一千分弹属性牌三选一，这是本局永久生效的构筑，我走炮台流！' },
  { id: 'cardTurret', text: '拿了炮台系的牌，后面所有技能方块都带上这份加成！' },
  { id: 'cardReso', text: '这张是共鸣系的牌，同层同列一起炸，场面直接失控！' },
  { id: 'cardCommon', text: '通用牌，技能方块出现得更频繁，后面满屏都是花样！' },
  { id: 'clear1', text: '漂亮！消掉一行！' },
  { id: 'clear2', text: '双消！这波可以啊！' },
  { id: 'clear3', text: '又消了，根本停不下来！' },
  { id: 'clear4', text: '哇，连锁消除！棋盘直接清空一大片！' },
  { id: 'levelup', text: '过关！棋盘整个清空重开，但分数不清零，速度更快、提示更短！' },
  { id: 'danger', text: '哎呀，中间快被堵住了，有点危险！' },
  { id: 'rank', text: '这个分数直接冲上排行榜！新版本你也来试试，看能不能打过我？' },
  { id: 'outro', text: '关注我，每天带你解锁一个好玩的抖音小游戏，我们明天见！' },
];

function cn2y(n) { // 量词前的口语数字：2 → 两
  return n === 2 ? '两' : cn2(n);
}

function gameoverClip(seed, stats) {
  const parts = [`被堵住啦！${scoreTalk(stats.score)}、第${cn2(stats.level)}关、消${cn2(stats.lines)}行`];
  if (stats.skillKills > 0) parts.push(`，技能带走${cn2y(Math.min(stats.skillKills, 99))}格`);
  if (stats.cards > 0) parts.push(`、拿到${cn2y(stats.cards)}张属性牌`);
  parts.push('，这构筑越打越顺！');
  return { id: 'gameover-' + seed, text: parts.join('') };
}

/* ---------- TTS ---------- */
async function synth(voice, rate, clip) {
  /* Edge TTS 走 websocket，偶发「Stream closed before the synthesis completed」
   * → 指数退避重试，录制流水线不该因为一条配音失败就整体重跑 */
  const file = path.join(OUT_DIR, clip.id + '.mp3');
  let lastErr = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const tts = new MsEdgeTTS();
    try {
      await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
      const { audioFilePath } = await tts.toFile(OUT_DIR, clip.text, { rate });
      fs.renameSync(audioFilePath, file);
      const size = fs.statSync(file).size;
      console.log('OK ' + clip.id + ' (' + size + ' B)' + (attempt > 1 ? ' [retry' + attempt + ']' : ''));
      return { id: clip.id, file: clip.id + '.mp3', text: clip.text };
    } catch (e) {
      lastErr = e;
      console.log('RETRY ' + clip.id + ' #' + attempt + ': ' + (e && e.message));
      await new Promise((r) => setTimeout(r, 800 * attempt));
    } finally {
      try { tts.close(); } catch (e) { /* noop */ }
    }
  }
  throw lastErr;
}

/** 已存在且文案未变 → 可跳过（--missing） */
function needSynth(manifest, clip) {
  const rec = manifest.clips[clip.id];
  if (!rec || rec.text !== clip.text) return true;
  return !fs.existsSync(path.join(OUT_DIR, clip.file || (clip.id + '.mp3')));
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
  const SKIP_EXISTING = has('--missing');
  const emit = async (clip) => {
    if (SKIP_EXISTING && !needSynth(manifest, clip)) { console.log('SKIP ' + clip.id + ' (已有且文案未变)'); return; }
    const rec = await synth(voice, rate, clip);
    manifest.clips[clip.id] = rec;
    saveManifest(manifest);
  };

  if (!has('--base') && !has('--seed')) {
    console.log('nothing to do (use --base / --seed)');
    process.exit(0);
  }

  if (has('--base')) {
    for (const clip of BASE_CLIPS) await emit(clip);
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
      const clip = gameoverClip(entry.seed, {
        score: entry.score, level: entry.level, lines: entry.lines,
        skillKills: entry.skillKills || 0, cards: entry.cards || (entry.build ? entry.build.length : 0),
      });
      await emit(clip);
    }
  }

  /* --prune：清掉种子池里已经不存在的 gameover-<seed> 配音（换池后避免留下战绩过期的死文件） */
  if (has('--prune')) {
    const raw = fs.readFileSync(SEEDS_JSON, 'utf8').replace(/^\uFEFF/, '');
    const keep = new Set(JSON.parse(raw).seeds.map((x) => 'gameover-' + x.seed));
    let removed = 0;
    for (const id of Object.keys(manifest.clips)) {
      if (!/^gameover-\d+$/.test(id) || keep.has(id)) continue;
      const file = path.join(OUT_DIR, manifest.clips[id].file || (id + '.mp3'));
      try { fs.unlinkSync(file); } catch (e) { /* 文件本来就不在 */ }
      delete manifest.clips[id];
      removed++;
    }
    saveManifest(manifest);
    console.log('pruned ' + removed + ' stale gameover clips');
  }
  console.log('manifest saved:', MANIFEST);
  process.exit(0);
})().catch((e) => { console.error('TTS FAIL:', e && e.message); process.exit(1); });
