/**
 * 技能方块 + 属性牌（纯逻辑，无平台依赖，可在 Node 中测试）
 *
 * 两类技能格：
 *  - 炮台（落地技能）：方块落地瞬间沿「反重力方向」发射能量弹，
 *    子弹命中的方格被击落消失（其余方格保持原位，不引发沉降），消失方格计分；
 *    若击落的方格带「共鸣」，会当场把共鸣也引爆（被击落同样算释放）。
 *  - 共鸣（消除技能）：方格被消除或被击落时，与它同类（默认同颜色，可扩展同层/同列）
 *    的方格一同消失，并按「消失方式」（爆炸 / 横激光 / 竖激光 / 十字激光）向外扩散。
 *
 * 技能格的具体数值来自属性牌（每达到 CARD.INTERVAL 分三选一），
 * 落地时把当时的属性快照写进格子（skill.mods），后续效果按快照结算。
 */
const { DIRS, SKILL, CARD } = require('./config.js');

/* ================= 技能定义（名称 / 文案 / 配色） ================= */

const KINDS = {
  turret: {
    key: 'turret',
    name: '炮台',
    kindLabel: '落地技能',
    desc: '落地瞬间发射能量弹，击落命中的方格',
    accent: SKILL.ACCENT.turret,
  },
  resonance: {
    key: 'resonance',
    name: '共鸣',
    kindLabel: '消除技能',
    desc: '被消除或被击落时，同类方格一同共鸣消失',
    accent: SKILL.ACCENT.resonance,
  },
};

const PATTERN_NAMES = { none: '仅自身', bomb: '爆破', laserH: '横激光', laserV: '竖激光', cross: '十字激光' };
const SCOPE_NAMES = { color: '同色', row: '同层', col: '同列' };
/** 属性牌分类标签（渲染与提示共用） */
const TAG_LABEL = { turret: '炮台', resonance: '共鸣', common: '通用' };

/** 默认属性（第 2 关刚出现技能格时） */
function defaultMods() {
  return {
    bullets: 1,       // 炮台每次落地发射的子弹数（弹道方向数）
    pierce: 0,        // 子弹穿透层数（可击落格数 = 1 + pierce）
    bounce: 0,        // 子弹撞墙反弹次数
    cellBonus: 0,     // 技能消失方格的每格附加分
    scope: ['color'], // 共鸣匹配维度：同色（可扩展同层/同列）
    pattern: 'none',  // 共鸣方格消失方式
    chanceLevel: 0,   // 技能方块出现概率加成层数
  };
}

function cloneMods(m) {
  const src = m || defaultMods();
  return {
    bullets: src.bullets, pierce: src.pierce, bounce: src.bounce, cellBonus: src.cellBonus,
    scope: src.scope.slice(), pattern: src.pattern, chanceLevel: src.chanceLevel,
  };
}

/** 技能方块出现概率（含属性牌加成） */
function skillChance(mods) {
  const lv = (mods && mods.chanceLevel) || 0;
  return Math.min(SKILL.CHANCE_MAX, SKILL.CHANCE + lv * SKILL.CHANCE_STEP);
}

/** 抽取一个技能种类（按权重），null = 本块不带技能 */
function rollKind(rng) {
  const total = SKILL.WEIGHT.turret + SKILL.WEIGHT.resonance;
  return rng() < (SKILL.WEIGHT.turret / total) ? 'turret' : 'resonance';
}

/** 技能消失方格的每格得分（×关卡由调用方乘） */
function cellScore(mods) {
  return SKILL.BASE_CELL_SCORE + ((mods && mods.cellBonus) || 0);
}

/* ================= 炮台：子弹 ================= */

/** 屏幕坐标系（y 向下）顺时针旋转 90° */
function turnCW(dx, dy) {
  return { x: -dy, y: dx };
}

/**
 * 弹道方向：先沿反重力方向（即方块落下来的来路），再两个侧向，最后重力方向。
 * 子弹数 1..4 依次取前 N 个方向。
 */
function shotDirs(dir) {
  const anti = (dir + 2) % 4;
  const perpA = (dir + 3) % 4;
  const perpB = (dir + 1) % 4;
  return [anti, perpA, perpB, dir];
}

/**
 * 单颗子弹飞行：从 (x,y) 沿 dirIdx 方向逐格前进，
 * 每命中一个方格就把它计入 hits（可击落 1 + pierce 格），
 * 撞墙时若还有反弹次数则顺时针转 90° 继续飞。
 * 返回 { path: [{x,y}...], hits: [{x,y,type,skill}...] }（path 为途经格顺序，用于动画）
 */
function travelBullet(board, x, y, dirIdx, mods) {
  const budget = 1 + Math.max(0, mods.pierce | 0);
  let bounce = Math.max(0, mods.bounce | 0);
  let d = DIRS[((dirIdx % 4) + 4) % 4];
  let dx = d.x, dy = d.y;
  let px = x, py = y;
  const path = [], hits = [];
  let guard = 0;
  while (guard++ < 240) {
    let nx = px + dx, ny = py + dy;
    if (!board.inside(nx, ny)) {
      if (bounce <= 0) break;
      bounce--;
      let turned = false;
      for (let k = 0; k < 3; k++) {
        const t = turnCW(dx, dy);
        dx = t.x; dy = t.y;
        nx = px + dx; ny = py + dy;
        if (board.inside(nx, ny)) { turned = true; break; }
      }
      if (!turned) break;
    }
    px = nx; py = ny;
    path.push({ x: px, y: py });
    if (board.occupied(px, py)) {
      const cell = board.remove(px, py);
      if (cell) cell.step = path.length - 1; // 命中发生在第几步（动画用）
      hits.push(cell);
      if (hits.length >= budget) break; // 击落数用完，子弹消散
    }
  }
  return { path, hits };
}

/**
 * 炮台格落地开火（会把击落的方格从棋盘移除）
 * 返回 { origin, shots: [{dir, path, hits}] }
 */
function fireTurret(board, x, y, dir, mods) {
  const n = Math.max(1, Math.min(4, mods.bullets | 0));
  const dirs = shotDirs(dir).slice(0, n);
  const shots = [];
  for (let i = 0; i < dirs.length; i++) {
    const r = travelBullet(board, x, y, dirs[i], mods);
    shots.push({ dir: dirs[i], path: r.path, hits: r.hits });
  }
  return { origin: { x, y }, dir: dir, shots };
}

/* ================= 共鸣：同类方格一同消失 ================= */

/**
 * 共鸣波及的方格（不含共鸣格本身）：
 *  - 匹配维度 mods.scope：color 同色 / row 同层(同一行) / col 同列
 *  - 消失方式 mods.pattern：bomb 周围 8 格 / laserH 左右各 2 格 / laserV 上下各 2 格 / cross 十字各 2 格
 * 返回 [{x, y}]（去重、不含 origin）
 */
function resonanceTargets(board, x, y, type, mods) {
  const out = [];
  const seen = {};
  const push = (nx, ny) => {
    if (!board.inside(nx, ny) || !board.occupied(nx, ny)) return;
    const k = nx + ',' + ny;
    if (seen[k] || (nx === x && ny === y)) return;
    seen[k] = true;
    out.push({ x: nx, y: ny });
  };
  const scope = (mods && mods.scope) || ['color'];
  if (scope.indexOf('color') >= 0 && type) {
    for (let r = 0; r < board.rows; r++) {
      for (let c = 0; c < board.cols; c++) if (board.grid[r][c] === type) push(c, r);
    }
  }
  if (scope.indexOf('row') >= 0) {
    for (let c = 0; c < board.cols; c++) push(c, y);
  }
  if (scope.indexOf('col') >= 0) {
    for (let r = 0; r < board.rows; r++) push(x, r);
  }
  const pattern = (mods && mods.pattern) || 'none';
  if (pattern === 'bomb') {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) push(x + dx, y + dy);
  } else if (pattern === 'laserH') {
    for (let k = 1; k <= 2; k++) { push(x - k, y); push(x + k, y); }
  } else if (pattern === 'laserV') {
    for (let k = 1; k <= 2; k++) { push(x, y - k); push(x, y + k); }
  } else if (pattern === 'cross') {
    for (let k = 1; k <= 2; k++) { push(x - k, y); push(x + k, y); push(x, y - k); push(x, y + k); }
  }
  return out;
}

/**
 * 共鸣级联结算：seeds 为「刚刚消失」的格子（含 type/skill 快照，已从棋盘移除）。
 * 其中带共鸣技能的格子会波及同类方格，被波及的格子若也带共鸣会继续引爆（有上限）。
 * 返回 { destroyed: [{x,y,type,skill}], waves: [{origin, pattern, scope, cells}] }
 */
function cascadeResonance(board, seeds, limit) {
  const cap = limit || SKILL.CASCADE_LIMIT;
  const destroyed = [];
  const waves = [];
  const fired = {};
  let queue = (seeds || []).slice();
  let round = 0;
  while (queue.length && round++ < 48) {
    const next = [];
    for (let i = 0; i < queue.length; i++) {
      const s = queue[i];
      if (!s || !s.skill || s.skill.kind !== 'resonance') continue;
      const key = s.x + ',' + s.y;
      if (fired[key]) continue;
      fired[key] = true;
      const mods = s.skill.mods || defaultMods();
      const targets = resonanceTargets(board, s.x, s.y, s.type, mods);
      const removed = [];
      for (let j = 0; j < targets.length && destroyed.length < cap; j++) {
        const cell = board.remove(targets[j].x, targets[j].y);
        if (cell) {
          removed.push(cell);
          destroyed.push(cell);
        }
      }
      if (removed.length) {
        waves.push({
          origin: { x: s.x, y: s.y }, kind: 'resonance',
          pattern: mods.pattern || 'none', scope: mods.scope.slice(), cells: removed,
        });
        for (let j = 0; j < removed.length; j++) next.push(removed[j]);
      }
    }
    queue = next;
  }
  return { destroyed, waves };
}

/* ================= 属性牌 ================= */

/** 数值型属性牌（可叠加、有上限） */
function statCard(id, tag, name, desc, key, max, step) {
  step = step === undefined ? 1 : step;
  return {
    id: id, tag: tag, name: name, desc: desc, key: key, max: max,
    cur: (m) => m[key],
    maxed: (m) => m[key] >= max,
    apply: (m) => { m[key] = Math.min(max, m[key] + step); },
    valueText: (m) => (m[key] >= max ? '已满级 ' + max : m[key] + ' → ' + (m[key] + step)),
  };
}

/** 「共鸣维度」类：给 scope 追加一个匹配维度（一次性） */
function scopeCard(id, name, desc, dim) {
  return {
    id: id, tag: 'resonance', name: name, desc: desc, dim: dim,
    maxed: (m) => m.scope.indexOf(dim) >= 0,
    apply: (m) => { if (m.scope.indexOf(dim) < 0) m.scope.push(dim); },
    valueText: (m) => scopeText(m.scope) + ' → ' + scopeText(m.scope.concat([dim])),
  };
}

/** 「消失方式」类：设置 pattern（互相替换） */
function patternCard(id, name, desc, pattern) {
  return {
    id: id, tag: 'resonance', name: name, desc: desc, pattern: pattern,
    maxed: (m) => m.pattern === pattern,
    apply: (m) => { m.pattern = pattern; },
    valueText: (m) => PATTERN_NAMES[m.pattern] + ' → ' + PATTERN_NAMES[pattern],
  };
}

function scopeText(scope) {
  return scope.map((s) => SCOPE_NAMES[s] || s).join('+');
}

const CARD_POOL = [
  statCard('turret_bullets', 'turret', '双联炮管', '炮台每次落地多发射 1 发能量弹（弹道方向 +1）', 'bullets', 4),
  statCard('bullet_pierce', 'turret', '穿甲弹头', '子弹穿透 +1 层，可多击落 1 个方格', 'pierce', 5),
  statCard('bullet_bounce', 'turret', '折射挡板', '子弹撞墙反弹 +1 次，拐个弯继续飞', 'bounce', 3),
  statCard('bullet_power', 'turret', '高能弹药', '技能消失的方格每格额外 +' + SKILL.CELL_SCORE_STEP + ' 分', 'cellBonus', 4, SKILL.CELL_SCORE_STEP),
  scopeCard('reso_row', '同层共鸣', '共鸣额外带走同一行（层）的全部方格', 'row'),
  scopeCard('reso_col', '同列共鸣', '共鸣额外带走同一列的全部方格', 'col'),
  patternCard('reso_bomb', '爆破共鸣', '共鸣格消失时引爆周围 8 格', 'bomb'),
  patternCard('reso_laser_h', '横刃激光', '共鸣格消失时横向贯穿左右各 2 格', 'laserH'),
  patternCard('reso_laser_v', '竖刃激光', '共鸣格消失时纵向贯穿上下各 2 格', 'laserV'),
  patternCard('reso_cross', '十字激光', '共鸣格消失时十字方向各贯穿 2 格', 'cross'),
  statCard('skill_chance', 'common', '灵能灌注', '技能方块出现概率 +' + Math.round(SKILL.CHANCE_STEP * 100) + '%', 'chanceLevel', 5),
];

function cardById(id) {
  for (let i = 0; i < CARD_POOL.length; i++) if (CARD_POOL[i].id === id) return CARD_POOL[i];
  return null;
}

/** 当前可出现的牌（已满级 / 已装备的排除） */
function availableCards(mods) {
  return CARD_POOL.filter((c) => !c.maxed(mods));
}

/** 随机抽 n 张可选择的牌（不足则返回全部可用；池子见底返回空数组＝跳过） */
function offerCards(rng, mods, n) {
  const count = n === undefined ? CARD.CHOICES : n;
  const pool = availableCards(mods).slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = pool[i];
    pool[i] = pool[j];
    pool[j] = t;
  }
  return pool.slice(0, count).map((card) => viewOf(card, mods));
}

/** 牌面展示数据（含当前值→新值），供渲染与选择面板复用 */
function viewOf(card, mods) {
  return {
    id: card.id, tag: card.tag, name: card.name, desc: card.desc,
    value: card.valueText(mods || defaultMods()),
  };
}

/** 应用一张属性牌（按 id），返回被应用的牌；未知 id 返回 null */
function applyCard(mods, id) {
  const card = cardById(id);
  if (!card) return null;
  card.apply(mods);
  return card;
}

/** 构筑摘要（HUD 技能条用）：[{label, text, accent}] */
function buildSummary(mods) {
  const m = mods || defaultMods();
  return [
    { label: '炮台', text: '弹' + m.bullets + ' · 穿' + m.pierce + ' · 弹' + m.bounce, accent: SKILL.ACCENT.turret },
    { label: '共鸣', text: scopeText(m.scope) + ' · ' + PATTERN_NAMES[m.pattern], accent: SKILL.ACCENT.resonance },
  ];
}

module.exports = {
  KINDS, PATTERN_NAMES, SCOPE_NAMES, TAG_LABEL, CARD_POOL,
  defaultMods, cloneMods, skillChance, rollKind, cellScore,
  shotDirs, travelBullet, fireTurret,
  resonanceTargets, cascadeResonance,
  availableCards, offerCards, cardById, applyCard, buildSummary, scopeText,
};
