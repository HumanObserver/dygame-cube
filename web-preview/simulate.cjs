/**
 * Node 离线仿真：真实 GameCore + 虚拟时钟驱动 autoplayer bot。
 * 用途：
 *  1) 校验规划器与游戏核心规则一致（预测消行数 vs 实际、落点格子 vs 实际）
 *  2) 批量跑种子，挑选适合录视频的「好看对局」（时长/消行/升级/自然结束）
 * 运行：
 *  node web-preview/simulate.cjs                 # 默认种子 1 局 + 一致性校验
 *  node web-preview/simulate.cjs --search 1..200 # 扫种子
 *  node web-preview/simulate.cjs --seed 42       # 指定种子详情
 */
'use strict';
const GameCore = require('../js/gamecore.js');
const { SHAPES } = require('../js/tetromino.js');
const AutoPlayer = require('./autoplayer.js');

const DT = 16.7; // 与浏览器 60fps 帧间隔对齐

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
  const finishAfterMs = opts.finishAfterMs === undefined ? 60000 : opts.finishAfterMs;
  const maxLevel = opts.maxLevel === undefined ? 99 : opts.maxLevel;

  let clock = 0;
  const realNow = Date.now;
  Date.now = () => clock; // gamecore 不直接用 Date.now，但保险
  try {
    const core = new GameCore({ rng: AutoPlayer.mulberry32(seed >>> 0) });

    const log = {
      clears: [],        // [{at, count, cumulativeLines}]
      levelups: [],      // [{at, level}]
      pieces: 0,
      mismatchClear: 0,  // 预测消行数与实际不符次数
      mismatchCells: 0,  // 无消行时落点格子与实际不符次数
      dirs: new Set(),
      maxChain: 0,
    };
    let pendingPlan = null;

    const bot = AutoPlayer.createBot({
      core,
      botRng: AutoPlayer.mulberry32(botSeed >>> 0),
      finishAfterMs,
      maxLevel,
      actRotate: () => core.rotate(),
      actMove: (s) => core.movePerp(s),
      actDrop: () => { pendingPlan = bot.plan; core.hardDrop(); },
      hooks: {
        onPiece: (piece) => { log.pieces++; log.dirs.add(piece.dir); pendingPlan = null; },
      },
    });

    /* hardDrop 后校验落点（无消行时应与预测格子一致） */
    const origDrop = core.hardDrop.bind(core);
    core.hardDrop = function () {
      const plan = bot.plan;
      const hadCells = core.current ? core.cells(core.current) : null;
      const gridBefore = core.board.grid.map((r) => r.slice());
      origDrop();
      if (plan && plan.clears === 0 && hadCells) {
        /* 计算落点：drop 前的 ghost 即 finalCells；比对 grid diff */
        const diff = [];
        for (let y = 0; y < core.board.rows; y++) {
          for (let x = 0; x < core.board.cols; x++) {
            if (core.board.grid[y][x] && !gridBefore[y][x]) diff.push(x + ',' + y);
          }
        }
        /* 注意：hardDrop 可能因连锁沉降改变格子（无消行时无沉降） */
        const predicted = plan.finalCells.map((c) => c.x + ',' + c.y).sort().join('|');
        const actual = diff.sort().join('|');
        if (predicted !== actual) log.mismatchCells++;
      }
      drain();
    };

    function drain() {
      const evs = core.drainEvents();
      for (const ev of evs) {
        if (ev.type === 'clear') {
          log.clears.push({ at: Math.round(clock), count: ev.count, lines: core.lines });
          log.maxChain = Math.max(log.maxChain, ev.count);
          if (pendingPlan && pendingPlan.clears !== ev.count) log.mismatchClear++;
          pendingPlan = null;
        } else if (ev.type === 'levelup') {
          log.levelups.push({ at: Math.round(clock), level: ev.level });
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

    /* 视频总时长估算：菜单 2.2s + 对局 + 结算 2.8s + 排行 4s + 尾菜单 1.5s */
    return {
      seed,
      playMs: Math.round(clock),
      videoMs: Math.round(clock + 10500),
      pieces: log.pieces,
      score: core.score,
      level: core.level,
      lines: core.lines,
      clearEvents: log.clears.length,
      maxChain: log.maxChain,
      levelups: log.levelups,
      mismatchClear: log.mismatchClear,
      mismatchCells: log.mismatchCells,
      dirs: [...log.dirs].length,
      over: core.gameOver,
      clears: log.clears,
    };
  } finally {
    Date.now = realNow;
  }
}

/* ---------- CLI ---------- */
function fmt(r) {
  return `seed=${r.seed} play=${(r.playMs / 1000).toFixed(1)}s video≈${(r.videoMs / 1000).toFixed(1)}s ` +
    `pieces=${r.pieces} score=${r.score} lv=${r.level} lines=${r.lines} clears=${r.clearEvents} ` +
    `maxChain=${r.maxChain} dirs=${r.dirs}/4 over=${r.over ? 'Y' : 'N'} ` +
    `mismatch=${r.mismatchClear}/${r.mismatchCells}` +
    (r.levelups.length ? ` lvUp@${r.levelups.map((x) => (x.at / 1000).toFixed(0) + 's→L' + x.level).join(',')}` : '');
}

const args = process.argv.slice(2);
function argVal(name) {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : null;
}

if (argVal('search')) {
  const [a, b] = argVal('search').split('..').map(Number);
  const fams = parseInt(argVal('finish') || '60000', 10);
  const results = [];
  for (let s = a; s <= b; s++) results.push(simGame(s, { finishAfterMs: fams }));
  const bad = results.filter((r) => r.mismatchClear || r.mismatchCells || !r.over);
  console.error(`== 一致性异常 ${bad.length} / ${results.length} ==`);
  bad.slice(0, 5).forEach((r) => console.error('BAD ' + fmt(r)));
  /* 选种标准（视频叙事）：
   *  - 一致性零误差、自然打到 gameover
   *  - 视频总长 72~100s
   *  - 收尾前至少 2 次消除事件、升到 2 关
   *  - 最好有 ≥2 连锁 */
  const good = results.filter((r) =>
    !r.mismatchClear && !r.mismatchCells && r.over &&
    r.videoMs >= 70000 && r.videoMs <= 102000 &&
    r.clearEvents >= 2 && r.level >= 2 && r.dirs === 4);
  good.sort((x, y) =>
    (y.clearEvents + y.maxChain * 3 + y.level * 2) - (x.clearEvents + x.maxChain * 3 + x.level * 2));
  console.error(`== 达标 ${good.length} 个 ==`);
  const out = good.map((r) => ({
    seed: r.seed, playS: +(r.playMs / 1000).toFixed(1), videoS: +(r.videoMs / 1000).toFixed(1),
    pieces: r.pieces, score: r.score, level: r.level, lines: r.lines,
    clearEvents: r.clearEvents, maxChain: r.maxChain,
    clearAt: r.clears.map((c) => +(c.at / 1000).toFixed(1)),
    levelupAt: r.levelups.map((l) => +(l.at / 1000).toFixed(1)),
  }));
  console.log(JSON.stringify(out, null, 1));
} else {
  const seed = parseInt(argVal('seed') || '1', 10);
  const r = simGame(seed);
  console.log(fmt(r));
  console.log('clear events:', JSON.stringify(r.clears.slice(0, 30)));
}

module.exports = { simGame };
