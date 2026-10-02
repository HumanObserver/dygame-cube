/**
 * 教学关（第 1~6 关）+ 关卡存档 单元测试
 * 运行：node --test test/
 */
const test = require('node:test');
const assert = require('node:assert');

const GameCore = require('../js/gamecore.js');
const Board = require('../js/board.js');
const Skills = require('../js/skills.js');
const LevelPlan = require('../js/levelplan.js');
const progress = require('../js/progress.js');
const { SHAPES } = require('../js/tetromino.js');
const { COLS, ROWS, LEVEL_TARGETS, LEVEL_CLIMB, LEVEL_CLIMB_STEP, TUTORIAL, SKILL, CARD } = require('../js/config.js');

function constRng(v) { return function () { return v; }; }

/** 造一个处于可控状态的核心（教学关默认开启） */
function coreAt(level, rngValue) {
  const core = new GameCore({ rng: constRng(rngValue === undefined ? 0.5 : rngValue) });
  core.startLevel(level);
  core.phase = 'fall';
  return core;
}

/* ================= 数值曲线与脚本表 ================= */

test('config：合格分曲线递增，且单靠一次消除冲不过教学关', () => {
  assert.deepStrictEqual(LEVEL_TARGETS.slice(0, 6), [150, 400, 720, 1150, 2400, 3600]);
  for (let i = 1; i < LEVEL_TARGETS.length; i++) assert.ok(LEVEL_TARGETS[i] > LEVEL_TARGETS[i - 1]);
  // 反「一块过关」：每关净增分都高于「该关一次消除」的收入 100×关卡数（第 7 关起持平即可）
  for (let lv = 1; lv <= LEVEL_TARGETS.length; lv++) {
    const net = lv === 1 ? LEVEL_TARGETS[0] : LEVEL_TARGETS[lv - 1] - LEVEL_TARGETS[lv - 2];
    const one = 100 * lv;
    if (lv <= 6) assert.ok(net > one, '第 ' + lv + ' 关净增 ' + net + ' 应高过一次消除 ' + one);
    else assert.ok(net >= one, '第 ' + lv + ' 关净增 ' + net + ' 不应低于一次消除 ' + one);
  }
  // 兜底：每个教学关还各有一道落块闸门（≥5 块），分数被跨过去也过不了关
  for (let lv = 1; lv <= 6; lv++) {
    const g = LevelPlan.PLANS[lv].gates.filter((x) => x.kind === 'locks');
    assert.strictEqual(g.length, 1, '第 ' + lv + ' 关应有一道落块闸门');
    assert.ok(g[0].n >= 5, '第 ' + lv + ' 关注落块数太少：' + g[0].n);
  }
  assert.strictEqual(TUTORIAL.MAX_LEVEL, 6);
  assert.strictEqual(SKILL.START_LEVEL, 3, '技能方块推迟到第 3 关（教炮台）');
  assert.strictEqual(CARD.INTERVAL, 700, '通用属性牌节奏收紧到 700 分');
});

test('levelplan：只有第 1~6 关有教学脚本', () => {
  for (let lv = 1; lv <= TUTORIAL.MAX_LEVEL; lv++) {
    const p = LevelPlan.planFor(lv);
    assert.ok(p && p.name && p.guide && p.setup, '第 ' + lv + ' 关应有脚本');
    assert.strictEqual(p.gravity, 0, '教学关重力固定向下');
    assert.ok(LevelPlan.isTutorial(lv));
  }
  assert.strictEqual(LevelPlan.planFor(7), null);
  assert.strictEqual(LevelPlan.planFor(99), null);
  assert.ok(!LevelPlan.isTutorial(7));
});

test('levelplan：预置局面绝不堵死中心出生点', () => {
  const area = LevelPlan.spawnArea();
  assert.strictEqual(area['8,8'], true);
  assert.strictEqual(area['11,11'], true);
  assert.strictEqual(area['7,7'], undefined);
  assert.strictEqual(area['12,8'], undefined);
  for (const name of Object.keys(LevelPlan.SETUP_RULES)) {
    const b = new Board(COLS, ROWS);
    const r = LevelPlan.applySetup(b, name, Skills.defaultMods());
    assert.ok(r.written > 0, name + ' 应写入方格');
    for (let y = area.y0; y <= area.y1; y++) {
      for (let x = area.x0; x <= area.x1; x++) {
        assert.strictEqual(b.grid[y][x], null, name + ' 堵住了出生点 ' + x + ',' + y);
      }
    }
  }
});

test('levelplan：门槛支持多条件，未完成时 guideText 给出还差什么', () => {
  const gs = LevelPlan.gateStatus(4, { locks: 2, clears: 0, turretKills: 1, resonanceKills: 0, cardPicks: 0 });
  assert.strictEqual(gs.done, false);
  assert.strictEqual(gs.items.length, 2, '第 4 关有两个条件（落块 + 选牌）');
  assert.ok(/再放 3 块/.test(gs.what), '落块门槛应显示还差几块：' + gs.what);
  assert.ok(/选天赋牌 1 张/.test(gs.what), gs.what);
  const ok = LevelPlan.gateStatus(4, { locks: 5, clears: 0, turretKills: 4, resonanceKills: 0, cardPicks: 1 });
  assert.strictEqual(ok.done, true);
  const guide = LevelPlan.guideText(4, { locks: 0, clears: 0, turretKills: 0, resonanceKills: 0, cardPicks: 0 }, 1150, 300);
  assert.ok(/第 4 关/.test(guide) && /还需要/.test(guide), guide);
  const guide2 = LevelPlan.guideText(4, { locks: 5, clears: 0, turretKills: 4, resonanceKills: 0, cardPicks: 1 }, 1150, 700);
  assert.ok(/再拿 450 分/.test(guide2), '动作齐了但分数不够 → 提示还差多少分：' + guide2);
  assert.strictEqual(LevelPlan.guideText(9, {}, 6000, 0), '', '正式关没有教学条');
});

/* ================= 逐关教学效果 ================= */

test('第 1 关：强制 O + 固定向下重力，第一块消一行，但绝不「一块过关」', () => {
  const core = coreAt(1);
  for (let i = 0; i < 5; i++) {
    const p = core._drawNext();
    assert.strictEqual(p.type, 'O', '第 1 关缺角由 O 补');
    assert.strictEqual(p.dir, 0, '重力恒向下');
    assert.strictEqual(p.skill, null, '第 1 关不出现技能方块');
  }
  assert.strictEqual(core.current.type, 'O');
  core.hardDrop();
  assert.strictEqual(core.lines, 1, '第一块就该消除一行');
  assert.strictEqual(core.levelStats.clears, 1);
  assert.strictEqual(core.level, 1, '一块消除不该直接跳关');
  assert.strictEqual(core.pendingLevelUp, null, '落块数门槛没满 → 还不弹结算');
  assert.ok(/再放 4 块/.test(core.guideText()), core.guideText());

  // 继续自由玩耍：直到门槛（5 块 + 消 1 行）与合格分都满足
  let guard = 0;
  while (!core.pendingLevelUp && !core.gameOver && guard++ < 14) core.hardDrop();
  assert.ok(core.pendingLevelUp, '几块之后应弹过关结算');
  assert.ok(core.locksInLevel >= 5, '过关至少放了 5 块，实际=' + core.locksInLevel);
  assert.ok(core.score >= LEVEL_TARGETS[0], '结算时分数已达标：' + core.score);
  assert.strictEqual(core.level, 1, '确认之前一直停在第 1 关');

  core.confirmLevelUp();
  assert.strictEqual(core.level, 2);
  assert.strictEqual(core.plan.setup, 'clearRow');
  assert.strictEqual(core.next.type, 'I', '第 2 关发横条补缺口');
  assert.strictEqual(core.levelStats.clears, 0, '新关卡门槛重新计数');
  assert.strictEqual(core.levelStats.locks, 0);
  assert.strictEqual(core.locksInLevel, 0);
});

test('第 2 关：横条补齐缺口 → 消除计分，放满 6 块才过关', () => {
  const core = coreAt(2);
  assert.strictEqual(core.current.type, 'I');
  core.hardDrop();
  assert.strictEqual(core.lines, 1);
  assert.strictEqual(core.levelStats.clears, 1);
  assert.strictEqual(core.pendingLevelUp, null, '只放一块 → 落块闸门还没过');
  let guard = 0;
  while (!core.pendingLevelUp && !core.gameOver && guard++ < 14) core.hardDrop();
  assert.ok(core.pendingLevelUp, '继续玩几块后应弹结算');
  assert.ok(core.levelStats.clears >= 1, '门槛要求消除，实际=' + core.levelStats.clears);
  assert.ok(core.locksInLevel >= 6, '实际落块=' + core.locksInLevel);
  core.confirmLevelUp();
  assert.strictEqual(core.level, 3, '确认后进入第 3 关');
});

test('过关结算只推进一关：确认前不会连弹面板', () => {
  const core = coreAt(2);
  core.levelStats.locks = 6;
  core.levelStats.clears = 1;
  core.score = 99999; // 分数一次跨过好几条线
  core._syncLevel();
  assert.ok(core.pendingLevelUp);
  assert.strictEqual(core.pendingLevelUp.next, 3, '结算面板一次只承诺下一关');
  core.confirmLevelUp();
  assert.strictEqual(core.level, 3);
  assert.strictEqual(core.pendingLevelUp, null, '第 3 关门槛未完成 → 不再连弹');
});

test('门槛未完成时不升关（分数早就够了也不行）', () => {
  const core = coreAt(2);
  core.score = 99999;
  core._syncLevel();
  assert.strictEqual(core.level, 2, '没消过行 → 卡在第 2 关');
  assert.strictEqual(core.pendingLevelUp, null, '门槛没满不该弹结算');
  core.levelStats.clears = 1;
  core._syncLevel();
  assert.strictEqual(core.pendingLevelUp, null, '落块数还不够');
  core.levelStats.locks = 5;
  core._syncLevel();
  assert.strictEqual(core.pendingLevelUp, null, '落块闸门是 6 块，5 块还不满');
  core.levelStats.locks = 6;
  core._syncLevel();
  assert.ok(core.pendingLevelUp, '门槛补齐 → 弹过关结算');
  assert.strictEqual(core.level, 2, '确认之前不升关');
  core.confirmLevelUp();
  assert.strictEqual(core.level, 3, '补上门槛并确认 → 进入第 3 关');
  assert.strictEqual(core.level, 3, '第 3 关门槛未完成 → 不会连升到第 4 关');
});

test('第 3 关：炮台方块落地开火，击落头顶预置的靶面并计入门槛', () => {
  const core = coreAt(3);
  assert.strictEqual(core.plan.skill.kind, 'turret');
  assert.strictEqual(core.current.skill.kind, 'turret', '教学关每块都带技能格');
  const before = core.board.allCells().length;
  core.hardDrop();
  assert.ok(core.levelStats.turretKills >= 1, '应击落靶面方格');
  assert.ok(core.board.allCells().length < before + 4, '被击落的方格抵消了本块落下的 4 格');
  assert.strictEqual(core.level, 3, '击落 1 格还没满足「击落 3 格」的门槛');
});

test('第 4 关：本关净拿 80 分弹「炮台天赋」牌，且不可跳过', () => {
  const core = coreAt(4);
  const trigger = LevelPlan.cardTriggerScore(4, core.levelStartScore);
  assert.strictEqual(trigger, Math.max(400, core.levelStartScore + 80));
  core.score = trigger - 1;
  core._syncCards();
  assert.ok(!core.pendingCards, '没到触发分不发牌');
  core.score = trigger;
  core._syncCards();
  assert.ok(core.pendingCards && core.pendingCards.length === CARD.CHOICES, '到分弹三张牌');
  core.pendingCards.forEach((c) => assert.strictEqual(c.tag, 'turret', '教学牌只出炮台系'));
  assert.strictEqual(core.pendingCardsMeta.tutorial, true);
  assert.strictEqual(core.pendingCardsMeta.force, true);
  assert.strictEqual(core.skipCards(), false, '教学牌必须选一张');
  assert.strictEqual(core.level, 4, '没选牌之前不升关');
  core.pickCard(core.pendingCards[0].id);
  assert.strictEqual(core.levelStats.cardPicks, 1);
  assert.strictEqual(core.pendingCards, null);
});

/* ---------- v1.5.2 试玩反馈的两条回归：不许飘空、不许「重现」 ---------- */

/** 预置局面里的每一格要么坐在底行上，要么与底行四邻连通（桥面靠立柱连着地面也算），
 *  绝不允许「孤立浮空块」——它们会在下次消除时被逐列压实突然掉下来，玩家看成消掉的方块重现。 */
test('教学关预置局面：没有孤立飘空的方块（每格都与底行连通）', () => {
  const rules = LevelPlan.SETUP_RULES;
  for (const name of Object.keys(rules)) {
    const cells = rules[name].build();
    assert.ok(cells.length > 0, name + ' 应铺出格子');
    const has = {};
    cells.forEach((c) => { has[c.x + ',' + c.y] = true; });
    // 从底行所有格子出发 BFS
    const seen = {};
    const q = [];
    cells.forEach((c) => {
      if (c.y === ROWS - 1) { q.push(c); seen[c.x + ',' + c.y] = true; }
    });
    while (q.length) {
      const c = q.shift();
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach((d) => {
        const k = (c.x + d[0]) + ',' + (c.y + d[1]);
        if (has[k] && !seen[k]) { seen[k] = true; q.push({ x: c.x + d[0], y: c.y + d[1] }); }
      });
    }
    const floating = cells.filter((c) => !seen[c.x + ',' + c.y]);
    assert.deepStrictEqual(floating, [], name + ' 有飘空且与地面不连通的格子：' +
      floating.map((c) => c.x + ',' + c.y).join(' '));
  }
});

/** 落一块最多只增加 4 格；格子数突然暴涨 = 有东西被「凭空补回来」（旧 retryEvery 重铺机制的病灶） */
test('教学关 1~6 全程落块：被消除 / 被击落的方块不会被系统写回棋盘', () => {
  for (let lv = 1; lv <= 6; lv++) {
    const core = coreAt(lv);
    for (let i = 0; i < 14 && core.level === lv && !core.gameOver; i++) {
      if (core.pendingCards) { core.pickCard(core.pendingCards[0].id); continue; }
      if (core.pendingLevelUp) break;
      const before = core.board.allCells().length;
      core.hardDrop();
      const after = core.board.allCells().length;
      assert.ok(after <= before + 4,
        '第 ' + lv + ' 关第 ' + (i + 1) + ' 块后格子数从 ' + before + ' 涨到 ' + after + '，超出本块 4 格 —— 有方块被凭空写回');
    }
  }
});

test('第 5 关：整行同色 + 共鸣格，消行时把散落的同色方格一起带走', () => {
  const core = coreAt(5);
  assert.strictEqual(core.plan.setup, 'resoGarden');
  assert.ok(core.board.skillAt(8, 19), '底行埋着共鸣种子');
  assert.strictEqual(core.board.grid[19][9], null, '底行留了缺口等玩家补');
  assert.strictEqual(core.board.grid[18][2], 'T', '花圃：与底行连通的同色短柱');
  const before = core.board.allCells().length;
  core.levelTarget = () => Infinity; // 只看共鸣本身，避免升关清场把棋盘重铺
  core.hardDrop();
  assert.strictEqual(core.lines, 1, 'O 补齐底行 → 消除');
  assert.ok(core.levelStats.resonanceKills >= 1, '共鸣计入教学门槛');
  assert.ok(core.skillKills >= 1, '共鸣应带走同色方格');
  assert.strictEqual(core.board.grid[18][2], null, '同色短柱被共鸣一起带走');
  assert.ok(core.board.allCells().length < before, '格子总数下降（落块 +4 远小于被带走）');
  assert.strictEqual(core.level, 5, '合格分被屏蔽 → 仍留在第 5 关');
});

test('第 6 关：净拿 120 分只出共鸣系天赋牌', () => {
  const core = coreAt(6);
  core.score = LevelPlan.cardTriggerScore(6, core.levelStartScore);
  core._syncCards();
  assert.ok(core.pendingCards, '应弹出天赋牌');
  core.pendingCards.forEach((c) => assert.strictEqual(c.tag, 'resonance'));
  assert.match(core.pendingCardsMeta.note, /共鸣/);
});

test('教学关不发通用节奏牌：通用分数线顺延到第 7 关之后', () => {
  const core = coreAt(3);
  core.cardTarget = CARD.INTERVAL;
  core.score = CARD.INTERVAL + 10; // 已经跨过一条通用线，但第 3 关没有教学牌
  core._syncCards();
  assert.ok(!core.pendingCards, '教学关内不打断');
  assert.strictEqual(core.cardTarget, CARD.INTERVAL * 2, '通用线被顺延，不会一进正式关就连环补牌');
});

/* ================= 输入与关卡参数 ================= */

test('moveDir 按屏幕绝对方向移动，与重力方向无关', () => {
  const core = new GameCore({ rng: constRng(0.5), tutorial: false });
  core.phase = 'fall';
  core.current = { type: 'O', matrix: SHAPES.O, dir: 1, x: 9, y: 9 }; // 重力向左，按键仍按屏幕方向
  const y0 = core.current.y;
  assert.strictEqual(core.moveDir(0), true, '下');
  assert.strictEqual(core.current.y, y0 + 1);
  assert.strictEqual(core.moveDir(2), true, '上');
  assert.strictEqual(core.current.y, y0);
  assert.strictEqual(core.moveDir(1), true, '左');
  assert.strictEqual(core.current.x, 8);
  assert.strictEqual(core.moveDir(3), true, '右');
  assert.strictEqual(core.current.x, 9);
});

test('第 7 关起叠加「本关净增分」下限，一次爆分不会连着跨多关', () => {
  const core = new GameCore({ rng: constRng(0.5) });
  core.startLevel(7);
  assert.ok(!core.plan, '第 7 关不是教学关');
  assert.strictEqual(core.levelStartScore, LEVEL_TARGETS[6 - 1]);
  assert.strictEqual(core.levelTarget(7), Math.max(LEVEL_TARGETS[6], core.levelStartScore + LEVEL_CLIMB),
    '第 7 关取「曲线表」与「净增分下限」的较大值');
  assert.strictEqual(core.levelTarget(8, 9000), 9000 + LEVEL_CLIMB + LEVEL_CLIMB_STEP,
    '入场分很高时净增下限接管下一关（预览传入届时入场分）');
  core.score = 99999;
  core.phase = 'fall';
  core._syncLevel();
  assert.ok(core.pendingLevelUp, '第 7 关达标同样先弹结算');
  core.confirmLevelUp();
  assert.strictEqual(core.level, 8, '分数溢出只多升一关（下一关门槛按净增分重算）');
  assert.strictEqual(core.pendingLevelUp, null, '下一关合格线被抬到当前分之上 → 不连弹');
  assert.ok(core.levelTarget(8) > core.score - 1, '新关合格线高于当前分');
});

/* ================= 断点存档 ================= */

test('snapshot / restoreLevel 往返：关卡、分数、构筑、发牌记录都能接上', () => {
  const core = coreAt(4);
  core.score = 777;
  core.lines = 9;
  Skills.applyCard(core.mods, 'turret_pierce');
  core.cardPicks.push('turret_pierce');
  core.cardGiven[4] = true;
  const snap = core.snapshot();
  assert.strictEqual(snap.level, 4);
  assert.strictEqual(snap.tutorial, true);

  const fresh = new GameCore({ rng: constRng(0.5) });
  fresh.restoreLevel(snap);
  assert.strictEqual(fresh.level, 4);
  assert.strictEqual(fresh.score, 777);
  assert.strictEqual(fresh.lines, 9);
  assert.strictEqual(fresh.mods.pierce, core.mods.pierce, '属性构筑沿用');
  assert.deepStrictEqual(fresh.cardPicks, ['turret_pierce']);
  assert.strictEqual(fresh.cardGiven[4], true, '本关教学牌已发过，不会重复弹');
  assert.strictEqual(fresh.plan.setup, 'turretField', '棋盘按本关脚本重建');
  assert.ok(fresh.board.allCells().length > 0);
  assert.strictEqual(fresh.current.dir, 0, '教学关重力向下');
});

test('progress：开局断点的存 / 读 / 清 + 最高关卡（无 tt 环境走内存降级）', () => {
  progress.clear();
  assert.strictEqual(progress.load(), null);
  const rec = progress.save({ level: 5, score: 1234, lines: 3, cardPicks: ['a'], mods: Skills.defaultMods() });
  assert.ok(rec && rec.ts);
  const back = progress.load();
  assert.strictEqual(back.level, 5);
  assert.strictEqual(back.score, 1234);
  assert.deepStrictEqual(back.cardPicks, ['a']);
  assert.strictEqual(progress.maxLevel(), 5, '存档会记录到过的最高关');
  progress.save({ level: 2, score: 1 });
  assert.strictEqual(progress.maxLevel(), 5, '最高关只增不减');
  assert.strictEqual(progress.load().level, 2, '但断点跟着最新开局走');
  progress.clear();
  assert.strictEqual(progress.load(), null);
});

test('startLevel(n)：从第 n 关开局，分数取上一关合格分', () => {
  const core = new GameCore({ rng: constRng(0.5) });
  core.startLevel(6);
  assert.strictEqual(core.level, 6);
  assert.strictEqual(core.score, LEVEL_TARGETS[5 - 1], '第 6 关从第 5 关合格分起算');
  assert.strictEqual(core.plan && core.plan.card.tag, 'resonance');
  core.startLevel(1);
  assert.strictEqual(core.score, 0);
  assert.strictEqual(core.level, 1);
});
