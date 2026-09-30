/**
 * Node 离线仿真：真实 GameCore + 虚拟时钟驱动 autoplayer bot。
 * 用途：
 *  1) 校验规划器与游戏核心规则一致（预测消行数 vs 实际、落点格子 vs 实际）
 *  2) 批量跑种子，挑选适合录视频的「好看对局」：新特性（技能方块 / 属性牌三选一 /
 *     半侧沉降 / 过关清场）都要在镜头里出现得够多、够早
 * 运行：
 *  node web-preview/simulate.cjs                     # 默认种子 1 局 + 一致性校验
 *  node web-preview/simulate.cjs --seed 42           # 指定种子详情
 *  node web-preview/simulate.cjs --search 1..300     # 扫种子（默认 finish=85000）
 *  node web-preview/simulate.cjs --search 1..300 --write-seeds   # 扫完写 seeds.json
 */
'use strict';
const fs = require('fs');
const path = require('path');
const GameCore = require('../js/gamecore.js');
const Skills = require('../js/skills.js');
const { SHAPES } = require('../js/tetromino.js');
const AutoPlayer = require('./autoplayer.js');

const DT = 16.7; // 与浏览器 60fps 帧间隔对齐
const SEEDS_JSON = path.join(__dirname, 'seeds.json');

/* autoplayer 内置 SHAPES 与游戏一致性校验（出生点预测依赖它） */
(function checkShapes() {
  for (const t of Object.keys(SHAPES)) {
    const a = JSON.stringify(SHAPES[t]);
    const b = JSON.stringify(AutoPlayer.CONST.SHAPES[t]);
    if (a !== b) throw new Error('SHAPES 不一致: ' + t);
  }
})();

function simGame(seed, opts) {
  opts = opts || {};
  const botSeed = opts.botSeed === undefined ? 777 : opts.botSeed;
  const finishAfterMs = opts.finishAfterMs === undefined ? 85000 : opts.finishAfterMs;
  const maxLevel = opts.maxLevel === undefined ? 99 : opts.maxLevel;
  const cardHoldMs = opts.cardHoldMs === undefined ? 2200 : opts.cardHoldMs;

  let clock = 0;
  const realNow = Date.now;
  Date.now = () => clock; // gamecore 不直接用 Date.now，但保险
  try {
    const core = new GameCore({ rng: AutoPlayer.mulberry32(seed >>> 0) });

    const log = {
      clears: [],        // [{at, count, settled, lines}]
      levelups: [],      // [{at, level}]
      turrets: [],       // [{at, shots, kills, score}]
      resos: [],         // [{at, waves, cells, score}]
      cards: [],         // [{at, ids[]}]
      picks: [],         // [{at, id, name, tag}]
      pieces: 0,
      skillPieces: 0,
      mismatchClear: 0,  // 预测消行数与实际不符次数
      mismatchCells: 0,  // 无消行时落点格子与实际不符次数
      mismatchDetail: [],
      dirs: new Set(),
      maxChain: 0,
      settledCells: 0,   // 半侧沉降累计滑动格数
    };
    let pendingPlan = null;

    const bot = AutoPlayer.createBot({
      core,
      botRng: AutoPlayer.mulberry32(botSeed >>> 0),
      finishAfterMs,
      maxLevel,
      cardHoldMs,
      actRotate: () => core.rotate(),
      actMove: (s) => core.movePerp(s),
      actDrop: () => { pendingPlan = bot.plan; core.hardDrop(); },
      hooks: {
        onPiece: (piece) => {
          log.pieces++;
          log.dirs.add(piece.dir);
          if (piece.skill) log.skillPieces++;
          pendingPlan = null;
        },
        onCardOffer: (offer) => { log.cards.push({ at: Math.round(clock), ids: offer.map((o) => o.id) }); },
        onCardPick: (view) => { log.picks.push({ at: Math.round(clock), id: view.id, name: view.name, tag: view.tag }); },
      },
    });

    /* hardDrop 后校验落点（无消行时应与预测格子一致） */
    const origDrop = core.hardDrop.bind(core);
    core.hardDrop = function () {
      const plan = bot.plan;
      const hadCells = core.current ? core.cells(core.current) : null;
      const gridBefore = core.board.grid.map((r) => r.slice());
      const lvBefore = core.level;
      origDrop();
      /* 过关清场（升关＝整盘清空）／技能击落本块自身格子／共鸣级联都会让「新增格子」与预测不符，
       * 这些都是规则本身的效果，不算规划误差 → 只在「干净落子」时校验 */
      const cleanDrop = plan && plan.clears === 0 && !(plan.kills > 0) && core.level === lvBefore;
      if (cleanDrop && hadCells) {
        const diff = [];
        for (let y = 0; y < core.board.rows; y++) {
          for (let x = 0; x < core.board.cols; x++) {
            if (core.board.grid[y][x] && !gridBefore[y][x]) diff.push(x + ',' + y);
          }
        }
        const predicted = plan.finalCells.map((c) => c.x + ',' + c.y).sort().join('|');
        const actual = diff.sort().join('|');
        if (predicted !== actual) {
          log.mismatchCells++;
          log.mismatchDetail.push({
            at: Math.round(clock), predicted, actual,
            planKills: plan.kills || 0, clears: plan.clears, phase: core.phase,
          });
        }
      }
      drain();
    };

    function drain() {
      const evs = core.drainEvents();
      for (const ev of evs) {
        if (ev.type === 'clear') {
          log.clears.push({ at: Math.round(clock), count: ev.count, settled: ev.settled || 0, lines: core.lines });
          log.maxChain = Math.max(log.maxChain, ev.count);
          log.settledCells += ev.settled || 0;
          if (pendingPlan && pendingPlan.clears !== ev.count) log.mismatchClear++;
          pendingPlan = null;
        } else if (ev.type === 'levelup') {
          log.levelups.push({ at: Math.round(clock), level: ev.level });
        } else if (ev.type === 'turret') {
          let shots = 0;
          for (const s of ev.shots || []) if (s.path && s.path.length) shots++;
          log.turrets.push({ at: Math.round(clock), shots, kills: ev.count || 0, score: ev.score || 0 });
        } else if (ev.type === 'resonance') {
          log.resos.push({
            at: Math.round(clock), waves: (ev.waves || []).length,
            cells: ev.count || 0, score: ev.score || 0,
          });
        }
      }
    }

    let guard = 0;
    const MAX_MS = 300000;
    while (!core.gameOver && clock < MAX_MS && guard++ < MAX_MS / DT) {
      clock += DT;
      core.update(DT);
      drain();
      bot.tick(clock);
    }
    drain();

    const turretKills = log.turrets.reduce((a, t) => a + t.kills, 0);
    const resoCells = log.resos.reduce((a, r) => a + r.cells, 0);
    const turretHits = log.turrets.filter((t) => t.kills > 0).length; // 有战果的开火
    const resoHits = log.resos.filter((r) => r.cells > 0).length;      // 有战果的共鸣
    /* 视频总时长估算：菜单+开场 6.5s + 对局 + 结算/排行/尾部 4s */
    return {
      seed,
      playMs: Math.round(clock),
      videoMs: Math.round(clock + 27000),
      pieces: log.pieces,
      skillPieces: log.skillPieces,
      score: core.score,
      level: core.level,
      lines: core.lines,
      clearEvents: log.clears.length,
      maxChain: log.maxChain,
      levelups: log.levelups,
      turretFires: log.turrets.length,
      turretEvents: turretHits,
      turretKills,
      resoEvents: resoHits,
      resoCells,
      cards: log.cards.length,
      picks: log.picks.map((p) => p.id),
      build: core.cardPicks.slice(),
      mods: Skills.cloneMods(core.mods),
      skillKills: core.skillKills,
      skillScore: core.skillScore,
      settledCells: log.settledCells,
      mismatchClear: log.mismatchClear,
      mismatchCells: log.mismatchCells,
      mismatchDetail: log.mismatchDetail,
      dirs: [...log.dirs].length,
      over: core.gameOver,
      clears: log.clears,
      turrets: log.turrets,
      resos: log.resos,
      cardLog: log.cards,
      pickLog: log.picks,
    };
  } finally {
    Date.now = realNow;
  }
}

/* ---------- 选种评分（视频叙事取向：新特性又多又早） ---------- */
function showcaseScore(r) {
  let s = 0;
  s += Math.min(r.clearEvents, 8) * 6;
  s += Math.min(r.maxChain, 6) * 10;
  s += Math.min(r.level - 1, 5) * 14;          // 过关清场次数
  s += Math.min(r.turretEvents, 8) * 12;       // 炮台开火次数
  s += Math.min(r.turretKills, 40) * 2.5;      // 炮台实际击落格数
  s += Math.min(r.resoEvents, 6) * 16;         // 共鸣引爆次数
  s += Math.min(r.resoCells, 60) * 1.5;        // 共鸣带走格数
  s += Math.min(r.picks.length, 5) * 20;       // 属性牌三选一次数
  s += Math.min(r.settledCells, 120) * 0.25;   // 半侧沉降的滑格量（画面动感）
  /* 早出现的场面更值钱：第一关太快升关＝技能戏份不足，太慢＝镜头拖沓 */
  const firstLv = r.levelups.length ? r.levelups[0].at / 1000 : 999;
  s -= Math.max(0, firstLv - 32) * 1.2;
  s -= Math.max(0, 14 - firstLv) * 1.5;
  return s;
}

/** 达标线：新特性都要出镜，且一致性零误差、自然结束、时长合适 */
function isGood(r, opts) {
  opts = opts || {};
  const minVideo = opts.minVideo || 115000, maxVideo = opts.maxVideo || 150000;
  return !r.mismatchClear && !r.mismatchCells && r.over &&
    r.videoMs >= minVideo && r.videoMs <= maxVideo &&
    r.level >= 3 && r.lines >= 3 && r.dirs === 4 &&
    r.turretEvents >= (opts.minTurret === undefined ? 2 : opts.minTurret) &&
    r.resoEvents >= (opts.minReso === undefined ? 1 : opts.minReso) &&
    r.picks.length >= (opts.minCards === undefined ? 2 : opts.minCards) &&
    r.settledCells > 0;
}

/* ---------- CLI ---------- */
function fmt(r) {
  return `seed=${r.seed} play=${(r.playMs / 1000).toFixed(1)}s video≈${(r.videoMs / 1000).toFixed(1)}s ` +
    `pieces=${r.pieces} score=${r.score} lv=${r.level} lines=${r.lines} clears=${r.clearEvents} ` +
    `maxChain=${r.maxChain} dirs=${r.dirs}/4 over=${r.over ? 'Y' : 'N'} ` +
    `技能块=${r.skillPieces} 炮台${r.turretEvents}次/击落${r.turretKills}格 ` +
    `共鸣${r.resoEvents}次/带走${r.resoCells}格 沉降${r.settledCells}格 ` +
    `属性牌${r.picks.length}张[${r.build.join(',')}] mismatch=${r.mismatchClear}/${r.mismatchCells}` +
    (r.levelups.length ? ` lvUp@${r.levelups.map((x) => (x.at / 1000).toFixed(0) + 's→L' + x.level).join(',')}` : '');
}

const args = process.argv.slice(2);
function argVal(name) {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : null;
}
function hasFlag(name) { return args.indexOf('--' + name) >= 0; }

if (argVal('search')) {
  const [a, b] = argVal('search').split('..').map(Number);
  const fams = parseInt(argVal('finish') || '85000', 10);
  const results = [];
  for (let s = a; s <= b; s++) results.push(simGame(s, { finishAfterMs: fams }));
  const bad = results.filter((r) => r.mismatchClear || r.mismatchCells || !r.over);
  console.error(`== 一致性异常 ${bad.length} / ${results.length} ==`);
  bad.slice(0, 5).forEach((r) => console.error('BAD ' + fmt(r)));
  const good = results.filter((r) => isGood(r, {
    minVideo: parseInt(argVal('min-video') || '115000', 10),
    maxVideo: parseInt(argVal('max-video') || '150000', 10),
    minTurret: parseInt(argVal('min-turret') || '2', 10),
    minReso: parseInt(argVal('min-reso') || '1', 10),
    minCards: parseInt(argVal('min-cards') || '2', 10),
  }));
  good.forEach((r) => { r.showcase = +showcaseScore(r).toFixed(1); });
  good.sort((x, y) => y.showcase - x.showcase);
  console.error(`== 达标 ${good.length} 个 ==`);
  good.forEach((r) => console.error('  ' + fmt(r) + ' showcase=' + r.showcase));
  const out = good.map((r) => ({
    seed: r.seed, playS: +(r.playMs / 1000).toFixed(1), videoS: +(r.videoMs / 1000).toFixed(1),
    pieces: r.pieces, score: r.score, level: r.level, lines: r.lines,
    clearEvents: r.clearEvents, maxChain: r.maxChain,
    clearAt: r.clears.map((c) => +(c.at / 1000).toFixed(1)),
    levelupAt: r.levelups.map((l) => +(l.at / 1000).toFixed(1)),
    turretEvents: r.turretEvents, turretKills: r.turretKills,
    turretAt: r.turrets.map((t) => +(t.at / 1000).toFixed(1)),
    resoEvents: r.resoEvents, resoCells: r.resoCells,
    resoAt: r.resos.map((t) => +(t.at / 1000).toFixed(1)),
    cards: r.picks.length, build: r.build, settledCells: r.settledCells,
    skillKills: r.skillKills, showcase: r.showcase,
  }));
  console.log(JSON.stringify(out.slice(0, parseInt(argVal('top') || '20', 10)), null, 1));
  if (hasFlag('write-seeds')) {
    const pool = {
      generatedAt: new Date().toISOString().slice(0, 10),
      criteria: '新特性向：等级≥3、炮台≥2次、共鸣≥1次、属性牌≥2张、半侧沉降>0、时长80~118s、一致性零误差、自然结束',
      botSeed: 777,
      finishAfterMs: fams,
      primary: out.length ? out[0].seed : null,
      seeds: out.map((r) => ({
        seed: r.seed, score: r.score, level: r.level, lines: r.lines,
        videoS: r.videoS, clearEvents: r.clearEvents, maxChain: r.maxChain,
        turretEvents: r.turretEvents, turretKills: r.turretKills,
        resoEvents: r.resoEvents, resoCells: r.resoCells,
        cards: r.cards, build: r.build, settledCells: r.settledCells,
        skillKills: r.skillKills, skillScore: r.skillScore,
        clearAt: r.clearAt, levelupAt: r.levelupAt, turretAt: r.turretAt, resoAt: r.resoAt,
      })),
    };
    fs.writeFileSync(SEEDS_JSON, JSON.stringify(pool, null, 1), 'utf8');
    console.error('== seeds.json 已写入：' + pool.seeds.length + ' 个种子，primary=' + pool.primary + ' ==');
  }
} else {
  const seed = parseInt(argVal('seed') || '1', 10);
  const r = simGame(seed, { finishAfterMs: parseInt(argVal('finish') || '85000', 10) });
  console.log(fmt(r));
  console.log('clear events:', JSON.stringify(r.clears.slice(0, 30)));
  console.log('turret events:', JSON.stringify(r.turrets.slice(0, 30)));
  console.log('resonance events:', JSON.stringify(r.resos.slice(0, 30)));
  console.log('cards:', JSON.stringify(r.pickLog.slice(0, 12)));
}

module.exports = { simGame, isGood, showcaseScore };
