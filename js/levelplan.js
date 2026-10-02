/**
 * 教学关脚本（第 1~6 关）—— 纯逻辑，无平台依赖，可在 Node 中测试
 *
 * 「半闯关半教学」：每一关除了合格分之外还带一个**教学门槛（gate）**。
 * 分数够了但门槛没完成 → 不升关（留在本关把动作做完）；门槛完成且分数够 → 立刻升关。
 * 这样不管玩家手气如何，六个关键动作都会亲手做一遍：
 *   1 消一行 → 2 消一行拿高分 → 3 落地技能（炮台） → 4 炮台天赋牌
 *   → 5 消除技能（共鸣） → 6 共鸣天赋牌
 * 第 7 关起脚本结束：恢复四向随机重力 + 通用属性牌节奏。
 *
 * 每关脚本字段：
 *  guide      棋盘下方常驻的教学目标文案
 *  gravity    本关固定重力方向（DIRS 下标；缺省 = 四向随机）
 *  setup      预置局面名（局面不从 0 开始，保证「一按就消除」）
 *  pieces     强制出现的方块队列 [{type}]（门槛未完成时循环补发，保证缺口一定能被填上）
 *  skill      技能格策略 {chance, kind}（覆盖 SKILL.CHANCE / SKILL.WEIGHT）
 *  card       属性牌教学触发 {score 绝对分下限, minNet 本关净增, tag 限定牌系, note, force 不可跳过}
 *  gate       过关门槛 {kind:'clear'|'turret'|'resonance'|'card', n}
 *
 * 注意：预置局面**只在开局铺一次**。以前有「每落 N 块 / 选完牌再补一次预置」的重铺机制，
 * 已删除 —— 它会把玩家已经消掉的方块凭空写回棋盘（v1.5.2 被当成「消失的方块又重现了」的 bug 提）。
 * 缺口被填掉后不用补：教学动作已经教到，剩下的落块数门槛就是「自由玩耍」的部分。
 *
 * 坐标约定：预置局面按「局部行 g（0=最上，ROWS-1=最靠重力底）+ 横向 p」书写，
 * 由 mapLocal() 折算成棋盘坐标 —— 以后想改教学关重力方向也不会写错。
 */
const { COLS, ROWS, DIRS, PERP, TUTORIAL } = require('./config.js');

const TYPES_CYCLE = ['T', 'S', 'Z', 'I', 'J', 'L', 'O'];

/** 把重力系局部坐标 (p 横向, g 纵深) 折成棋盘坐标 */
function mapLocal(dir, p, g) {
  const d = DIRS[((dir % 4) + 4) % 4];
  const q = PERP[((dir % 4) + 4) % 4];
  const ox = d.x < 0 || q.x < 0 ? COLS - 1 : 0;
  const oy = d.y < 0 || q.y < 0 ? ROWS - 1 : 0;
  return { x: ox + q.x * p + d.x * g, y: oy + q.y * p + d.y * g };
}

/** 一段连续格子（沿横向轴） */
function run(dir, g, p0, p1, type) {
  const out = [];
  for (let p = p0; p <= p1; p++) out.push(Object.assign(mapLocal(dir, p, g), { type: type }));
  return out;
}

/** 一整行（g = 行号），holes = 要留空的横向序号 */
function rowWithHoles(dir, g, holes, typeFn) {
  const out = [];
  for (let p = 0; p < COLS; p++) {
    if (holes.indexOf(p) >= 0) continue;
    out.push(Object.assign(mapLocal(dir, p, g), { type: typeFn(p, g) }));
  }
  return out;
}

function cycleType(p, g) {
  return TYPES_CYCLE[(p + g * 2) % TYPES_CYCLE.length];
}

/** 一排**坐在底行之上**的短柱：[[列, 高出底行的格数, 类型?], …]（type 缺省用 cycleType）。
 *  教学关预置只准用这种柱子摆「四面八方」，不许撒悬空单格 —— 悬空格会在下次消除时被逐列压实
 *  突然掉下来，玩家看成「消掉的方块又出现了」（v1.5.2 试玩反馈）。 */
function pillar(cells, table, type) {
  for (let i = 0; i < table.length; i++) {
    const col = table[i][0], h = table[i][1];
    const t = table[i][2] || type;
    for (let k = 1; k <= h; k++) {
      const y = ROWS - 1 - k;
      cells.push(Object.assign(mapLocal(0, col, y), { type: t || cycleType(col, y) }));
    }
  }
  return cells;
}

/** 实心墙：列 p0~p1、行 topRow~bottomRow 的整块，且 bottomRow 必须贴到地面（19）。
 *  用来给「头顶的靶」找支撑——横梁长在墙上，墙贴地面，于是整片与地面连通，
 *  既不会飘空，也不会像旧版那样在两侧留出永远喂不进方块的死洞。 */
function wall(p0, p1, topRow, bottomRow, type) {
  const out = [];
  for (let y = topRow; y <= bottomRow; y++) {
    for (let p = p0; p <= p1; p++) out.push(Object.assign(mapLocal(0, p, y), { type: type }));
  }
  return out;
}

/* ================= 预置局面 ================= */
/* 每个局面都必须留出「中央井道」：方块从出生列（p 8~11）能一路落到底行缺口。 */

const SETUP_RULES = {
  /** 第 1 关：底行只差中间 2 格 —— 发下的 O 一放就消一行。
   *
   *  两条硬规矩（v1.5.2，都是试玩反馈，违反过就被骂）：
   *   ① **不许有飘空的方块**：每一格要么在底行，要么正下方还有格子（与地面连通）。
   *      上一版撒的孤立单格会在下次消除时被逐列压实「突然掉下来」，看着像「消掉的方块又出现了」。
   *   ② **底行上方不能再来一条近乎满行**：消除行的近侧是逐列塌到消除线上的
   *      （board.settle → _compactDown），上方若是满行会原样补位，玩家看不出「少了一行」。
   *  所以底行之上只放**几根短柱**（1~3 格高，全部坐在底行上，分布在左右和中部），
   *  消完这一行：20 格没了、短柱整体下沉一格，棋盘肉眼可见地空掉，之后玩家自己继续堆。 */
  starter: {
    build() {
      const cells = [];
      cells.push.apply(cells, rowWithHoles(0, 19, [9, 10], cycleType));  // 只差这一块 → 消一行
      pillar(cells, [[1, 1], [2, 2], [5, 1], [7, 3], [12, 1], [14, 2], [16, 3], [18, 1]]);
      return cells;
    },
  },

  /** 第 2 关：底行中间正好缺 4 格，强制发横条 I，落下去就补齐一整行（100×关卡分）。
   *  同样只放落地的短柱；8~11 四列从底行到出生点全程留空当竖井，I 一定直落到位 */
  clearRow: {
    build() {
      const cells = [];
      cells.push.apply(cells, rowWithHoles(0, 19, [8, 9, 10, 11], cycleType));  // I 一横就满
      pillar(cells, [[0, 1], [3, 2], [5, 1], [6, 3], [13, 1], [14, 2], [15, 1], [19, 3]]);
      return cells;
    },
  },

  /** 第 3 / 4 关：炮台靶场 —— 铺一间「有屋顶的房子」：屋顶横跨在场地上方、由两根立柱撑到地面
   *  这版是第 3 关实测反推出来的（tools/probe-level.cjs 3）：先前那版「左右立柱 + 横跨屋顶」有两条硬伤——
   *  ① 屋顶第一发就被打掉，剩下的格子悬空 → 炮台准头随机，「击落 4 格」门槛经常凑不满；
   *  ② 立柱紧贴两侧地面，方块堆到第 8 行后把 0~2、17~19 列封成永远喂不进去的死洞 → 23 块就 Game Over。
   *  现在横梁两端各自长在实心墙上（中间被打掉几格也不产生浮空碎片）；两侧墙整列连续从地面长到墙上沿
   *  （整列无空洞 → 不死洞）；中间门洞 16 列宽、底行留缺口，正常消行能持续回收棋盘。 */
  turretRange: {
    build() {
      const cells = [];
      cells.push.apply(cells, wall(0, 1, 6, 19, 'J'));                     // 左墙：整列连续落地（不产生死洞）
      cells.push.apply(cells, wall(18, 19, 6, 19, 'J'));                   // 右墙
      cells.push.apply(cells, run(0, 5, 1, 18, 'I'));                      // 横梁：弹道命中处，两端各长在墙上
      cells.push.apply(cells, run(0, 6, 1, 18, 'Z'));
      cells.push.apply(cells, rowWithHoles(0, 19, [9, 10], function () { return 'S'; }));
      return cells;
    },
  },

  /** 第 4 关：炮台「天赋」—— 不再给现成的靶（上一关的门廊多半已被玩家打烂），
   *  改成右侧一堆实心方块：玩家自己堆的堆 + 这堆就是弹道目标，炮台落下去一定有得打。
   *  门槛只卡「落块 + 选牌」，不硬卡击落数（v1.5.2：击落数依赖准头，卡死后教学会停在第 4 关）。 */
  turretField: {
    build() {
      const cells = [];
      cells.push.apply(cells, rowWithHoles(0, 19, [9, 10], function () { return 'S'; }));
      cells.push.apply(cells, run(0, 18, 13, 17, 'Z'));                    // 右侧堆，贴地
      cells.push.apply(cells, run(0, 17, 13, 17, 'L'));
      cells.push.apply(cells, run(0, 16, 14, 17, 'J'));
      cells.push.apply(cells, run(0, 15, 15, 17, 'I'));                    // 最高 5 层，弹道有得打
      cells.push.apply(cells, run(0, 18, 2, 5, 'T'));                      // 左侧贴地堆（避开中央竖井）
      return cells;
    },
  },

  /** 第 5 / 6 关：共鸣花圃 —— 底行整行同色且挂着共鸣，补齐就引爆全场同色。
   *  「花圃」改成坐在底行上的同色短柱（不再撒漂浮单格），引爆时整片一起被带走，画面更干净 */
  resoGarden: {
    resonanceCells: true,
    build() {
      const cells = [];
      cells.push.apply(cells, rowWithHoles(0, 19, [9, 10], function () { return 'T'; }));
      pillar(cells, [[2, 2], [4, 1], [6, 1], [13, 2], [16, 3], [18, 1]], 'T');
      return cells;
    },
  },

};

/* ================= 逐关脚本 =================
 * 每关节奏统一为「自由玩耍 → 达成教学动作 → 再自由玩耍」：
 * 门槛除了本关要教的动作（消行 / 击落 / 共鸣 / 选牌），一律再加一道
 * `locks`（本关落块数），保证不可能「一块消除直接过关」；合格分也按这个节奏定。
 * 达标后不会立刻跳关：先弹「过关结算」面板（见 gamecore.pendingLevelUp / confirmLevelUp）。
 */

const PLANS = {
  1: {
    name: '初落',
    guide: '先把底部缺口补齐：填满一整行（或一整列）就会消除得分',
    gravity: 0,
    setup: 'starter',
    pieces: [{ type: 'O' }],
    gates: [{ kind: 'locks', n: 5 }, { kind: 'clear', n: 1 }],
  },
  2: {
    name: '消除',
    guide: '把横条落到缺口上 · 消除一行 = 100 × 关卡分，这一关一行值 200 分',
    gravity: 0,
    setup: 'clearRow',
    pieces: [{ type: 'I' }],
    gates: [{ kind: 'locks', n: 6 }, { kind: 'clear', n: 1 }],
  },
  3: {
    name: '落地技能',
    guide: '金色「炮台」方块一落地就向上开火 · 抬头看它打中天顶横梁，击落的方格也算分',
    gravity: 0,
    setup: 'turretRange',
    skill: { chance: 1, kind: 'turret' },
    // 门槛只卡「落块 + 消一行」：击落数依赖弹道准头（v1.5.2 实测有种子 105 块都打不满 4 格），
    // 所以横梁只当教学道具和分数添头，不当硬指标，否则教学会硬卡死。
    gates: [{ kind: 'locks', n: 5 }, { kind: 'clear', n: 1 }],
  },
  4: {
    name: '落地天赋',
    guide: '随手放几块就会弹「炮台天赋」三选一：选一张，之后的炮台都带上它',
    gravity: 0,
    setup: 'turretField',
    skill: { chance: 1, kind: 'turret' },
    card: {
      score: 400, minNet: 80, tag: 'turret', force: true,
      note: '教学：这就是落地技能（炮台）的天赋 · 选一张看看',
    },
    gates: [{ kind: 'locks', n: 5 }, { kind: 'card', n: 1 }],
  },
  5: {
    name: '消除技能',
    guide: '青色「共鸣」方块：整行消除时，全场同色的方格一起被带走',
    gravity: 0,
    setup: 'resoGarden',
    pieces: [{ type: 'O' }],
    skill: { chance: 0.5, kind: 'resonance' },
    // 消行只要求 1 行：共鸣本身就靠消行引爆（补齐底行那一块就会触发，实测一次带走 10 格），
    // 再硬卡 2 行反而会让玩家卡死——共鸣把棋盘炸得七零八落后，第二行很难在短时间内凑齐。
    gates: [{ kind: 'locks', n: 5 }, { kind: 'clear', n: 1 }, { kind: 'resonance', n: 2 }],
  },
  6: {
    name: '消除天赋',
    guide: '本关会弹「共鸣天赋」三选一：选完再消一行，看看带走一片同色的威力',
    gravity: 0,
    setup: 'resoGarden',
    pieces: [{ type: 'O' }],
    skill: { chance: 0.6, kind: 'resonance' },
    card: {
      score: 900, minNet: 120, tag: 'resonance', force: true,
      note: '教学：这就是消除技能（共鸣）的天赋 · 这一轮只有共鸣牌',
    },
    gates: [{ kind: 'locks', n: 6 }, { kind: 'card', n: 1 }, { kind: 'resonance', n: 3 }],
  },
};

/** 本关脚本；TUTORIAL.ENABLED = false 或超出教学范围 → null（回到随机四向重力 + 通用节奏） */
function planFor(level) {
  if (!TUTORIAL.ENABLED || level > TUTORIAL.MAX_LEVEL) return null;
  return PLANS[level] || null;
}

function isTutorial(level) {
  return !!planFor(level);
}

/** 关卡总数：1~6 教学 + 7~12 正式关（第 13 关起按分数曲线无限外推，选择面板只列到这里） */
const TOTAL_LEVELS = 12;

/** 中心出生区：任何预置局面都不能压在这里（否则一出生就结束） */
function spawnArea() {
  const m = {};
  const x0 = Math.floor((COLS - 4) / 2), y0 = Math.floor((ROWS - 4) / 2);
  for (let y = y0; y <= y0 + 3; y++) for (let x = x0; x <= x0 + 3; x++) m[x + ',' + y] = true;
  return m;
}

/**
 * 预置局面写入棋盘：只填空位，绝不覆盖已有方格，也不碰中心出生区。
 * @returns {{written:number, skills:number}}
 */
function applySetup(board, name, mods) {
  const Skills = require('./skills.js');
  const rule = SETUP_RULES[name];
  if (!rule) return { written: 0, skills: 0 };
  const dir = TUTORIAL.GRAVITY;
  const spawn = spawnArea();
  let written = 0;
  const cells = rule.build();
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    if (!board.inside(c.x, c.y) || board.occupied(c.x, c.y)) continue;
    if (spawn[c.x + ',' + c.y]) continue;
    board.grid[c.y][c.x] = c.type;
    written++;
  }
  let skills = 0;
  if (rule.resonanceCells) {
    // 给底行几格挂上共鸣：整行消除时它们作为种子引爆同类
    const snapshot = Skills.cloneMods(mods);
    const spots = [[8, 19], [11, 19], [15, 19]];
    for (let i = 0; i < spots.length; i++) {
      const x = spots[i][0], y = spots[i][1];
      if (!board.occupied(x, y) || board.skillAt(x, y)) continue;
      board.setSkill(x, y, { kind: 'resonance', dir: dir, mods: snapshot, own: [{ x: x, y: y }] });
      skills++;
    }
  }
  return { written: written, skills: skills };
}

/** 属性牌触发分：绝对分下限与本关净增分取较大者 */
function cardTriggerScore(level, levelStartScore) {
  const plan = planFor(level);
  if (!plan || !plan.card) return Infinity;
  return Math.max(plan.card.score, levelStartScore + plan.card.minNet);
}

/**
 * 门槛完成情况：gate 决定「分数够了也不许跳过教学」。
 * 支持一个条件（{kind,n}）或一组条件（[{kind,n},{kind,n}]，全部满足才算完成）。
 */
function gateList(level) {
  const plan = planFor(level);
  if (!plan) return null;
  const g = plan.gates || plan.gate || null;
  if (!g) return null;
  const arr = Array.isArray(g) ? g : [g];
  return arr.length ? arr : null;
}

const GATE_LABEL = { clear: '消除', turret: '用炮台击落', resonance: '用共鸣带走', card: '选天赋牌', locks: '再放' };
const GATE_UNIT = { clear: ' 行', turret: ' 个方格', resonance: ' 个方格', card: ' 张', locks: ' 块' };

function gateStatus(level, stats) {
  const arr = gateList(level);
  if (!arr) return { kind: 'score', need: 0, cur: 0, what: '', done: true, items: [] };
  const s = stats || {};
  const items = [];
  let done = true;
  for (let i = 0; i < arr.length; i++) {
    const g = arr[i];
    const field = g.kind === 'clear' ? 'clears' : g.kind === 'turret' ? 'turretKills'
      : g.kind === 'resonance' ? 'resonanceKills' : g.kind === 'card' ? 'cardPicks'
        : g.kind === 'locks' ? 'locks' : '';
    const cur = field ? (s[field] || 0) : 0;
    const need = g.n || 1;
    const left = Math.max(0, need - cur);
    if (cur < need) done = false;
    // label 展示「还差多少」（已完成则显示总量），教学条直接可用
    items.push({ kind: g.kind, need: need, cur: cur, left: left, label: GATE_LABEL[g.kind] + ' ' + (left > 0 ? left : need) + GATE_UNIT[g.kind] });
  }
  const todo = items.filter((it) => it.left > 0);
  return {
    done: done,
    items: items,
    what: todo.map((it) => it.label).join(' + '),
    left: todo.reduce((a, b) => a + b.left, 0),
    kind: items.length === 1 ? items[0].kind : 'multi',
    need: items.reduce((a, b) => a + b.need, 0),
    cur: items.reduce((a, b) => a + Math.min(b.cur, b.need), 0),
  };
}

/** 棋盘下方的常驻教学条（正式关返回 ''） */
function guideText(level, stats, target, score) {
  const plan = planFor(level);
  if (!plan) return '';
  const head = '第 ' + level + ' 关 · ' + plan.name + '：';
  const gs = gateStatus(level, stats);
  if (!gs.done) return head + plan.guide + '（还需要 ' + gs.what + '）';
  const left = Math.max(0, Math.ceil((target || 0) - (score || 0)));
  return left > 0 ? head + '动作都练到了 · 再拿 ' + left + ' 分就过关' : head + '已达标 · 准备进入过关结算';
}

module.exports = {
  TYPES_CYCLE, cycleType, mapLocal, run, rowWithHoles,
  SETUP_RULES, PLANS, TOTAL_LEVELS, TUTORIAL,
  planFor, isTutorial, spawnArea, applySetup,
  cardTriggerScore, gateStatus, guideText,
};
