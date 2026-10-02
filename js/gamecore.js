/**
 * 游戏核心逻辑（纯 JS，无平台依赖，可在 Node 中单元测试）
 *
 * 相位机：idle → hint(下落前提示) → fall(下落中) → 锁定 → 落地技能 → 消行+共鸣+半侧沉降 → 生成下一个
 * 方块从棋盘中心生成，重力方向随机（下/左/上/右），填满整行或整列即消除。
 *
 * 关卡：累计分数达到「合格分」+ 完成本关门槛 → 弹「过关结算」面板（本关成绩 + 下一关预告），
 *  玩家点「进入下一关」才棋盘清场、新关卡重新开局（积分继续累加）。
 * 教学关：第 1~6 关带「预置局面 + 教学门槛」（见 js/levelplan.js）——
 *  分数够了但门槛没完成（没消过行 / 没用过炮台 / 没选天赋牌…）就不升关，
 *  保证新手每一关都亲手做一次关键动作；第 7 关起恢复四向随机重力。
 * 技能方块：第 3 关起方块上会出现技能格（炮台＝落地释放 / 共鸣＝被消除或被击落时释放）。
 * 属性牌：分数每跨过 CARD.INTERVAL 分弹三张牌三选一，选中后本局后续技能方块都带上该属性
 * （第 1~6 关的发牌时机由脚本决定：第 4 关教炮台天赋、第 6 关教共鸣天赋）。
 */
const {
  COLS, ROWS, DIRS, PERP, TYPES,
  HINT_BASE, HINT_MIN, HINT_STEP,
  FALL_BASE, FALL_MIN, FALL_STEP,
  levelTarget: configLevelTarget,
  LEVEL_CLIMB, LEVEL_CLIMB_STEP, TUTORIAL_NET_RATIO,
  SCORE_TABLE, SCORE_EXTRA,
  SOFT_DROP_SCORE, HARD_DROP_SCORE,
  TUTORIAL, SKILL, CARD,
} = require('./config.js');
const { SHAPES, rotateCW, cellsOf, cloneMatrix } = require('./tetromino.js');
const Board = require('./board.js');
const Skills = require('./skills.js');
const LevelPlan = require('./levelplan.js');

// 旋转时依次尝试的踢墙偏移
const KICKS = [
  { x: 0, y: 0 }, { x: -1, y: 0 }, { x: 1, y: 0 },
  { x: 0, y: -1 }, { x: 0, y: 1 },
  { x: -2, y: 0 }, { x: 2, y: 0 }, { x: 0, y: -2 }, { x: 0, y: 2 },
];

class GameCore {
  constructor(opts) {
    opts = opts || {};
    this.rng = opts.rng || Math.random; // 可注入随机源，便于测试
    // 教学关脚本开关（测试与非教学场景可传 tutorial:false 回到纯随机四向重力）
    this.tutorialOn = opts.tutorial !== false;
    this.events = [];                   // 事件队列：lock / clear / turret / resonance / levelup / cards / gameover
    this.board = new Board(COLS, ROWS);
    this.reset();
  }

  /**
   * 开新局。
   * @param startLevel 从第几关开局（关卡选择用）；分数按该关的入场基准分起算
   */
  reset(startLevel) {
    const from = Math.max(1, Math.floor(startLevel || 1));
    this.board.reset();
    this.level = from;
    this.score = from > 1 ? Math.max(0, configLevelTarget(from - 1)) : 0;
    this.lines = 0;
    this.gameOver = false;
    // 本局构筑（属性牌）与技能统计
    this.mods = Skills.defaultMods();
    this.cardPicks = [];
    this.pendingCards = null;
    this.pendingCardsMeta = null;
    this.cardTarget = CARD.INTERVAL > 0 ? CARD.INTERVAL : Infinity;
    this.skillKills = 0;
    this.skillScore = 0;
    this._initTutorial();
    this._beginLevel();
    this.bag = [];
    this.next = this._drawNext();
    this.current = null;
    this.phase = 'idle';
    this.hintTimer = 0;
    this.fallTimer = 0;
    this.spawn();
  }

  /* ---------- 教学关（js/levelplan.js） ---------- */

  /** 与关卡无关的教学状态（每局重置一次） */
  _initTutorial() {
    this.plan = null;
    this.cardGiven = {};   // {level: true} 该关的「教学属性牌」是否已经发过
    this.locksInLevel = 0;
    this.forceIdx = 0;
    this.forceQueue = [];
    this.levelStartScore = this.score;
    this.levelStartTime = Date.now();
    this.pendingLevelUp = null; // 过关结算面板待确认（见 _syncLevel / confirmLevelUp）
    this.levelStats = { clears: 0, turretKills: 0, resonanceKills: 0, cardPicks: 0, locks: 0 };
  }

  /** 本关脚本（tutorialOn=false 或第 7 关起 → null） */
  planFor() {
    if (!this.tutorialOn) return null;
    return LevelPlan.planFor(this.level);
  }

  /** 进入本关：清掉上一关的教学状态，铺预置局面、装强制块队列 */
  _beginLevel() {
    this.plan = this.planFor();
    this.levelStartScore = this.score;
    this.levelStartTime = Date.now();
    this.locksInLevel = 0;
    this.forceIdx = 0;
    this.forceQueue = this.plan && this.plan.pieces ? this.plan.pieces.map((p) => ({ type: p.type })) : [];
    this.levelStats = { clears: 0, turretKills: 0, resonanceKills: 0, cardPicks: 0, locks: 0 };
    // 预置局面只在开局铺一次：没有「隔几块再补一次」的重铺机制（那会把已消掉的方块写回来）
    if (this.plan && this.plan.setup) LevelPlan.applySetup(this.board, this.plan.setup, this.mods);
  }

  /** 教学门槛是否完成（没脚本 = 永远完成；条件见 levelplan 的 gates 字段） */
  gateStatus() {
    if (!this.plan) return { kind: 'score', need: 0, cur: 0, what: '', done: true, items: [] };
    return LevelPlan.gateStatus(this.level, this.levelStats);
  }

  /** 棋盘下方的教学条文案（正式关为空串） */
  guideText() {
    if (!this.plan) return '';
    return LevelPlan.guideText(this.level, this.levelStats, this.levelTarget(this.level), this.score);
  }

  /** 本关属性牌触发分（没有教学牌 = Infinity） */
  cardTriggerScore() {
    if (!this.plan || !this.plan.card || this.cardGiven[this.level]) return Infinity;
    return LevelPlan.cardTriggerScore(this.level, this.levelStartScore);
  }

  /* ---------- 随机出块：7-bag（每 7 个一块袋，袋内洗牌）+ 技能格 ---------- */

  _drawType() {
    if (this.bag.length === 0) {
      this.bag = TYPES.slice();
      for (let i = this.bag.length - 1; i > 0; i--) {
        const j = Math.floor(this.rng() * (i + 1));
        const t = this.bag[i];
        this.bag[i] = this.bag[j];
        this.bag[j] = t;
      }
    }
    return this.bag.pop();
  }

  /**
   * 为本块抽一个技能格：从 START_LEVEL 关起按概率出现，
   * 命中后记录「局部矩阵坐标 + 当时的属性快照」（旋转/移动后仍能对上同一格）。
   * 教学关由脚本覆盖概率与种类（第 3/4 关必出炮台，第 5/6 关高频共鸣）。
   */
  _rollSkill(type) {
    const plan = this.plan;
    let chance = null, kind = null;
    if (plan && plan.skill) {
      chance = plan.skill.chance;
      kind = plan.skill.kind;
    } else if (plan) {
      return null; // 教学关里脚本没写 skill = 本关不出现技能格（第 1~2 关专心的消行）
    } else if (this.level < SKILL.START_LEVEL) {
      return null;
    }
    if (chance === null) chance = Skills.skillChance(this.mods);
    if (this.rng() >= chance) return null;
    if (!kind) kind = Skills.rollKind(this.rng);
    const cells = cellsOf(SHAPES[type]);
    const pick = cells[Math.floor(this.rng() * cells.length) % cells.length];
    return { kind, mx: pick.x, my: pick.y, mods: Skills.cloneMods(this.mods) };
  }

  _drawNext() {
    // 教学关：强制块队列优先（缺口一定能被填上）；门槛没完成时按脚本循环补发
    let forced = null;
    if (this.forceQueue && this.forceQueue.length) forced = this.forceQueue.shift();
    else if (this.plan && this.plan.pieces && !this.gateStatus().done) {
      forced = this.plan.pieces[this.forceIdx++ % this.plan.pieces.length];
    }
    const type = forced ? forced.type : this._drawType();
    const dir = this.plan && this.plan.gravity !== undefined && this.plan.gravity !== null
      ? this.plan.gravity
      : Math.floor(this.rng() * 4);
    return { type: type, dir: dir, skill: this._rollSkill(type) };
  }

  /* ---------- 关卡参数 ---------- */

  /**
   * 第 level 关的合格分（累计分数目标）；缺省为当前关。
   * 光有「累计表值」不够：第 3 关的门廊连锁、第 5、6 关的共鸣一炸就是上千分，进本关时分数早已
   * 越过下一关的表值 —— 合格分形同虚设，HUD 进度条全程满格，又退回「一块方块就过关」那个毛病。
   * 所以两道下限：教学关（1~6）要求本关至少净拿「表值净增 × TUTORIAL_NET_RATIO」，
   * 正式关（7 起）要求本关至少净拿 LEVEL_CLIMB + LEVEL_CLIMB_STEP × (关卡 - 7)。
   * 干净开局（入场分正好是上一关表值）时这两个下限都低于表值，及格线一字不变，只有超收才接管。
   * @param startScore 该关的入场分数（预览下一关时传入当前分；缺省用本关入场分）
   */
  levelTarget(level, startScore) {
    const lv = level === undefined ? this.level : level;
    const base = configLevelTarget(lv);
    const from = startScore === undefined ? this.levelStartScore : startScore;
    if (lv <= TUTORIAL.MAX_LEVEL) {
      if (!this.tutorialOn || !isFinite(from)) return base; // 关掉教学脚本：表值即及格线
      const net = base - (lv > 1 ? configLevelTarget(lv - 1) : 0);
      return Math.max(base, from + Math.round(net * TUTORIAL_NET_RATIO));
    }
    if (!isFinite(from)) return base;
    const climb = LEVEL_CLIMB + LEVEL_CLIMB_STEP * (lv - TUTORIAL.MAX_LEVEL - 1);
    return Math.max(base, from + climb);
  }

  hintTime() {
    return Math.max(HINT_MIN, HINT_BASE - (this.level - 1) * HINT_STEP);
  }

  fallInterval() {
    return Math.max(FALL_MIN, FALL_BASE - (this.level - 1) * FALL_STEP);
  }

  /**
   * 合格判定：累计分数达到当前关合格分 + 教学门槛完成 → **停下开「过关结算」**，
   * 由玩家点「进入下一关」才真正清场开局（见 confirmLevelUp）。
   * 结算期间棋盘保持原样、对局冻结，避免「一消除就直接跳到第二关」的突兀感。
   * 教学关门槛（消行 / 落块 / 炮台击落 / 共鸣带走 / 选天赋牌）没完成就不算过关，
   * 于是「分数早就够了」也不会把教学关一步跨过去。
   */
  _syncLevel() {
    if (this.gameOver || this.pendingLevelUp || this.pendingCards) return;
    if (this.score < this.levelTarget(this.level)) return;
    if (!this.gateStatus().done) return;
    const next = this.level + 1;
    this.pendingLevelUp = {
      level: this.level,
      name: this.plan ? this.plan.name : '',
      target: this.levelTarget(this.level),
      score: this.score,
      gained: this.score - this.levelStartScore,
      locks: this.locksInLevel,
      lines: this.levelStats ? this.levelStats.clears : 0,
      turret: this.levelStats ? this.levelStats.turretKills : 0,
      resonance: this.levelStats ? this.levelStats.resonanceKills : 0,
      cardPicks: this.levelStats ? this.levelStats.cardPicks : 0,
      ms: Math.max(0, Date.now() - this.levelStartTime),
      speed: FALL_BASE - FALL_STEP * (this.level - 1) > FALL_MIN ? FALL_BASE - FALL_STEP * (this.level - 1) : FALL_MIN,
      next: next,
      nextTarget: this.levelTarget(next, this.score),
      nextName: this.planForNext() ? this.planForNext().name : '',
      nextGuide: this.guideTextFor(next),
      nextTutorial: !!(this.tutorialOn && LevelPlan.planFor(next)),
      nextSkills: this.tutorialOn ? !!(LevelPlan.planFor(next) && LevelPlan.planFor(next).skill) : next >= SKILL.START_LEVEL,
    };
    this.events.push({ type: 'levelclear', report: this.pendingLevelUp });
  }

  /** 下一关的脚本（不切换状态，只查询） */
  planForNext() {
    return this.tutorialOn ? LevelPlan.planFor(this.level + 1) : null;
  }

  /** 指定关卡的教学条文案（结算面板预告下一关目标用，按「届时入场分」估算） */
  guideTextFor(level) {
    if (!this.tutorialOn || !LevelPlan.planFor(level)) return '';
    const zero = { clears: 0, turretKills: 0, resonanceKills: 0, cardPicks: 0, locks: 0 };
    return LevelPlan.guideText(level, zero, this.levelTarget(level, this.score), this.score);
  }

  /**
   * 结算面板点「进入下一关」：清场 + 铺本关脚本 + 推入 levelup 事件。
   * 若一次爆分同时跨过了多条合格线，后续关卡在同一次确认里并进（不再连弹面板），
   * 教学门槛会自然把连升拦在「动作没做完」的那一关。
   */
  confirmLevelUp() {
    const rep = this.pendingLevelUp;
    if (!rep) return null;
    this.pendingLevelUp = null;
    this.level = rep.next;
    this._startLevel();
    let guard = 0;
    while (guard++ < 12 && !this.gameOver && !this.pendingLevelUp
      && this.score >= this.levelTarget(this.level) && this.gateStatus().done) {
      this.level++;
      this._startLevel();
    }
    this._syncCards(); // 过关期间压着的属性牌线，进新关后补判一次
    return rep;
  }

  /** 新关卡开局：清场 + 铺本关教学脚本 + 推入 levelup 事件（随后的 spawn 由 update/_lock 负责） */
  _startLevel() {
    const cells = this.board.allCells();
    this.board.reset();
    this.current = null;
    this.phase = 'idle';
    this.hintTimer = 0;
    this.fallTimer = 0;
    this._beginLevel();
    // 升关时把「下一个」也换成新关脚本抽的块：预置局面的缺口与强制方块必须配对
    this.next = this._drawNext();
    this.events.push({
      type: 'levelup',
      level: this.level,
      target: this.levelTarget(this.level),
      cells: cells,
      skills: this.plan ? !!this.plan.skill : this.level >= SKILL.START_LEVEL,
      tutorial: !!this.plan,
      guide: this.guideText(),
    });
  }

  /**
   * 属性牌判定：两个来源取更早到的那个
   *  - 通用节奏：分数每跨过 cardTarget（CARD.INTERVAL 的整数倍）
   *  - 教学脚本：本关净增到 plan.card.minNet（且不低于 plan.card.score）时，只发某个系的牌
   * 教学关（第 1~6 关）内**只发脚本牌**：把跨过的通用分数线顺延掉，避免和教学抢镜头，
   * 也不会一进第 7 关就连环补牌。选择前游戏暂停（update / canControl 均被 pendingCards 挡住）。
   */
  _syncCards() {
    if (this.gameOver) return;
    if (this.plan) {
      if (CARD.INTERVAL > 0 && isFinite(this.cardTarget) && this.score >= this.cardTarget) {
        this.cardTarget = CARD.INTERVAL * (Math.floor(this.score / CARD.INTERVAL) + 1);
      }
      const planDue = this.cardTriggerScore();
      if (isFinite(planDue) && this.score >= planDue) {
        this.cardGiven[this.level] = true;
        this._offerCards(this.plan.card);
      }
      return;
    }
    while (CARD.INTERVAL > 0 && this.score >= this.cardTarget) {
      this.cardTarget += CARD.INTERVAL;
      if (this.gameOver) return;
      this._offerCards(null);
    }
  }

  /** 发一轮三选一：spec = 教学脚本里的 card 配置（限定牌系 + 文案 + 不可跳过） */
  _offerCards(spec) {
    const tag = spec && spec.tag;
    const offer = Skills.offerCards(this.rng, this.mods, CARD.CHOICES, tag);
    const meta = spec
      ? { tutorial: true, tag: tag, note: spec.note || '', force: !!spec.force, level: this.level }
      : { tutorial: false, tag: null, note: '', force: false, level: this.level };
    this.events.push({ type: 'cards', cards: offer, meta: meta });
    if (!offer.length) {
      this.pendingCards = null;
      this.pendingCardsMeta = null;
      return; // 牌池见底：教学牌也算「已经过了一道」，不卡关卡
    }
    this.pendingCards = offer;
    this.pendingCardsMeta = meta;
  }

  /** 选择一张属性牌（牌面 id），立即生效并恢复游戏；返回选中的牌 */
  pickCard(id) {
    if (!this.pendingCards) return null;
    let view = null;
    for (let i = 0; i < this.pendingCards.length; i++) if (this.pendingCards[i].id === id) view = this.pendingCards[i];
    if (!view) return null;
    const card = Skills.applyCard(this.mods, id);
    const meta = this.pendingCardsMeta;
    this.pendingCards = null;
    this.pendingCardsMeta = null;
    this.cardPicks.push(id);
    if (this.levelStats) this.levelStats.cardPicks++;
    this.events.push({
      type: 'cardpick', id: id, tag: view.tag, name: view.name,
      tutorial: !!(meta && meta.tutorial),
    });
    this._syncLevel(); // 教学门槛可能因此完成 → 立刻检查能否升关
    return card;
  }

  /** 放弃本次三选一（教学关的「必选」牌不可跳过） */
  skipCards() {
    if (!this.pendingCards) return false;
    if (this.pendingCardsMeta && this.pendingCardsMeta.force) return false;
    this.pendingCards = null;
    this.pendingCardsMeta = null;
    this.events.push({ type: 'cardskip' });
    return true;
  }

  /* ---------- 坐标换算 ---------- */

  /** 某个方块占据的绝对格子坐标 */
  cells(piece) {
    piece = piece || this.current;
    if (!piece) return [];
    const local = cellsOf(piece.matrix);
    const out = [];
    for (let i = 0; i < local.length; i++) {
      out.push({ x: local[i].x + piece.x, y: local[i].y + piece.y });
    }
    return out;
  }

  /** 当前方块沿重力方向的落点（幽灵方块） */
  ghostCells() {
    if (!this.current) return [];
    const d = DIRS[this.current.dir];
    let gx = this.current.x;
    let gy = this.current.y;
    for (;;) {
      const cand = this._moved(this.current, d.x, d.y);
      cand.x = gx + d.x;
      cand.y = gy + d.y;
      if (this.board.collides(this.cells(cand))) break;
      gx = cand.x;
      gy = cand.y;
    }
    const local = cellsOf(this.current.matrix);
    const out = [];
    for (let i = 0; i < local.length; i++) out.push({ x: local[i].x + gx, y: local[i].y + gy });
    return out;
  }

  _moved(piece, dx, dy, matrix) {
    return {
      type: piece.type,
      matrix: matrix || piece.matrix,
      dir: piece.dir,
      x: piece.x + dx,
      y: piece.y + dy,
      skill: piece.skill || null, // 技能格跟着方块一起走
    };
  }

  /* ---------- 生成与相位 ---------- */

  spawn() {
    const n = this.next;
    this.next = this._drawNext();
    const matrix = cloneMatrix(SHAPES[n.type]);
    const piece = {
      type: n.type,
      matrix,
      dir: n.dir,
      skill: n.skill || null,
      // 棋盘中心生成
      x: Math.floor((COLS - matrix.length) / 2),
      y: Math.floor((ROWS - matrix.length) / 2),
    };
    if (this.board.collides(this.cells(piece))) {
      // 中心被堵住 → 游戏结束
      this.current = piece;
      this.phase = 'over';
      this.gameOver = true;
      this.pendingCards = null;
      this.events.push({ type: 'gameover' });
      return;
    }
    this.current = piece;
    this.phase = 'hint';
    this.hintTimer = this.hintTime();
    this.fallTimer = 0;
  }

  canControl() {
    return !this.gameOver && !this.pendingCards && !this.pendingLevelUp
      && !!this.current && (this.phase === 'hint' || this.phase === 'fall');
  }

  /** 主循环驱动：dt 为毫秒 */
  update(dt) {
    if (this.gameOver || this.pendingCards || this.pendingLevelUp) return;
    if (!this.current) {
      // 过关清场等情况下方块作废：立即补一块
      if (this.phase !== 'over') this.spawn();
      return;
    }
    if (this.phase === 'hint') {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0) this.phase = 'fall';
      return;
    }
    if (this.phase === 'fall') {
      this.fallTimer += dt;
      const iv = this.fallInterval();
      let guard = 0;
      while (this.fallTimer >= iv && guard++ < 64) {
        this.fallTimer -= iv;
        if (!this._stepGravity(true)) break; // 落底锁定
        if (!this.current) break;            // 过关清场（升关）导致方块作废
      }
      if (!this.current && !this.gameOver && !this.pendingCards && !this.pendingLevelUp) this.spawn();
    }
  }

  /** 沿重力方向前进一格；无法前进则锁定。返回是否移动成功 */
  _stepGravity(withSoftScore) {
    const d = DIRS[this.current.dir];
    const moved = this._moved(this.current, d.x, d.y);
    if (this.board.collides(this.cells(moved))) {
      this._lock();
      return false;
    }
    this.current = moved;
    if (withSoftScore) {
      this.score += SOFT_DROP_SCORE;
      this._syncLevel(); // 软降分同样计入合格进度
      this._syncCards(); // 也计入属性牌分数线（含教学关的触发分）
    }
    return true;
  }

  /* ---------- 玩家操作 ---------- */

  /**
   * 沿与重力垂直的轴移动，sign = -1 / +1。
   * 若重力轴向本身就是玩家要的方向（例如重力向下时按「下」），退化成沿该轴前进一格。
   */
  movePerp(sign) {
    if (!this.canControl()) return false;
    const p = PERP[this.current.dir];
    let dx = p.x * sign, dy = p.y * sign;
    if (dx === 0 && dy === 0) {
      const d = DIRS[this.current.dir];
      dx = d.x * sign; dy = d.y * sign;
    }
    return this._shift(dx, dy);
  }

  /**
   * 按「屏幕绝对方向」移动一格：dir 用 DIRS 下标（0=下 1=左 2=上 3=右）。
   * 五个固定按键走这里 —— 按键含义永远不变，不跟着重力方向转。
   */
  moveDir(dir) {
    if (!this.canControl()) return false;
    const d = DIRS[((dir % 4) + 4) % 4];
    return this._shift(d.x, d.y);
  }

  _shift(dx, dy) {
    const moved = this._moved(this.current, dx, dy);
    if (this.board.collides(this.cells(moved))) return false;
    this.current = moved;
    return true;
  }

  /** 顺时针旋转（带踢墙） */
  rotate() {
    if (!this.canControl()) return false;
    if (this.current.type === 'O') return true; // O 旋转无意义
    const m = rotateCW(this.current.matrix);
    for (let i = 0; i < KICKS.length; i++) {
      const cand = this._moved(this.current, KICKS[i].x, KICKS[i].y, m);
      if (!this.board.collides(this.cells(cand))) {
        this.current = cand;
        return true;
      }
    }
    return false;
  }

  /** 快速降落：沿重力方向直接落底锁定 */
  hardDrop() {
    if (!this.canControl()) return;
    this.phase = 'fall';
    let dist = 0;
    while (this.current && this._stepGravity(false)) dist++;
    if (!this.current) return; // 锁定过程中已过关清场
    this.score += dist * HARD_DROP_SCORE;
    this._syncLevel();
    this._syncCards();
  }

  /* ---------- 锁定 / 技能 / 消行 / 沉降 ---------- */

  /** 技能消失方格的计分（每格基础分 + 属性牌加成，×关卡） */
  _skillScore(count) {
    if (!count) return 0;
    const s = Skills.cellScore(this.mods) * this.level * count;
    this.score += s;
    this.skillKills += count;
    this.skillScore += s;
    return s;
  }

  /**
   * 把一个技能结算步骤转成事件：每步各自计分、各自出特效。
   *  - turret 步 → 'turret' 事件（弹道 + 命中爆点）
   *  - resonance 步 → 'resonance' 事件（共鸣波 + 同类格闪光）
   */
  _pushSkillStep(st) {
    const score = st.cells.length ? this._skillScore(st.cells.length) : 0;
    if (this.levelStats && st.cells.length) {
      if (st.kind === 'turret') this.levelStats.turretKills += st.cells.length;
      else this.levelStats.resonanceKills += st.cells.length;
    }
    if (st.kind === 'turret') {
      this.events.push({
        type: 'turret', origin: st.origin, dir: st.dir, shots: st.shots,
        cells: st.cells, count: st.cells.length, hits: st.cells.length, score,
        knock: !!st.knock, // true = 被带走时的补射（渲染可略作区分）
      });
    } else {
      this.events.push({
        type: 'resonance',
        waves: [{ origin: st.origin, kind: 'resonance', pattern: st.pattern, scope: st.scope, cells: st.cells }],
        cells: st.cells, count: st.cells.length, score,
      });
    }
    return score;
  }

  /**
   * 炮台落地开火：击落弹道上的方格（其余方格保持原位，不引发沉降）。
   * 子弹穿过自己方块的其余格；被击落的每个格子都会释放**它自己的**技能特效（可继续级联）。
   */
  _fireTurret(shot) {
    const res = Skills.fireTurret(this.board, shot.x, shot.y, shot.dir, shot.mods, shot.ignore);
    const seeds = [];
    for (let i = 0; i < res.shots.length; i++) {
      for (let j = 0; j < res.shots[i].hits.length; j++) seeds.push(res.shots[i].hits[j]);
    }
    let total = this._pushSkillStep({ kind: 'turret', origin: res.origin, dir: res.dir, shots: res.shots, cells: seeds });
    const casc = Skills.cascadeSkills(this.board, seeds);
    for (let i = 0; i < casc.steps.length; i++) total += this._pushSkillStep(casc.steps[i]);
    return total;
  }

  /** 消除技能结算：被消除/被击落的技能格各自释放特效（共鸣波及同类、炮台补射），可级联 */
  _resonance(seeds) {
    const casc = Skills.cascadeSkills(this.board, seeds);
    let total = 0;
    for (let i = 0; i < casc.steps.length; i++) total += this._pushSkillStep(casc.steps[i]);
    return total;
  }

  _lock() {
    const piece = this.current;
    const cells = this.cells(piece);
    this.board.lock(cells, piece.type);

    // 技能格落位（按局部矩阵坐标匹配，旋转/移动后仍指向同一格）
    let landTurret = null;
    if (piece.skill) {
      const local = cellsOf(piece.matrix);
      for (let i = 0; i < local.length; i++) {
        if (local[i].x === piece.skill.mx && local[i].y === piece.skill.my) {
          // own：本方块其余格（子弹要穿过它们，不能打到自己人）
          const skill = { kind: piece.skill.kind, dir: piece.dir, mods: piece.skill.mods, own: cells.slice() };
          this.board.setSkill(cells[i].x, cells[i].y, skill);
          if (piece.skill.kind === 'turret') {
            landTurret = { x: cells[i].x, y: cells[i].y, dir: piece.dir, mods: piece.skill.mods, ignore: skill.own };
          }
          break;
        }
      }
    }
    this.events.push({ type: 'lock', cells: cells.slice() });

    // 1) 落地技能：炮台开火（先于消行判定：击出的空洞可能让本行不再凑齐）
    if (landTurret) this._fireTurret(landTurret);

    // 2) 行列消除 → 共鸣 → 半侧沉降 → 连锁消除
    const cleared = this.board.clearLines();
    if (cleared.count > 0) {
      let count = cleared.count;
      const allCells = cleared.cells.slice();
      let rows = cleared.rows.slice();
      let cols = cleared.cols.slice();
      let wave = cleared;
      let settledMoved = 0;
      for (;;) {
        // 被消除的格子里带共鸣技能的，把同类方格一起带走
        const seeds = [];
        for (let i = 0; i < wave.cells.length; i++) {
          const c = wave.cells[i];
          if (c.skill && c.skill.kind === 'resonance') seeds.push(c);
        }
        if (seeds.length) this._resonance(seeds);

        // 半侧沉降：靠近消除线的一侧贴合消除线，另一半保持原位
        const settled = this.board.settle(rows, cols);
        settledMoved += settled.moved;

        const next = this.board.clearLines();
        if (next.count === 0) break;
        count += next.count;
        for (let i = 0; i < next.cells.length; i++) allCells.push(next.cells[i]);
        rows = rows.concat(next.rows);
        cols = cols.concat(next.cols);
        wave = next;
      }

      let base = SCORE_TABLE[Math.min(count, 4)];
      if (count > 4) base += (count - 4) * SCORE_EXTRA;
      const gained = base * this.level;
      this.score += gained;
      this.lines += count;
      if (this.levelStats) this.levelStats.clears += count;
      this.events.push({ type: 'clear', cells: allCells, count, settled: settledMoved, score: gained });
    }

    this.locksInLevel++;
    if (this.levelStats) this.levelStats.locks++;
    this._syncLevel();    // 分数够 + 门槛完成 → 挂起「过关结算」，等玩家确认才升关
    // 过关结算面板优先：牌留到进入下一关之后再发，避免两个面板叠着弹
    if (!this.pendingLevelUp) this._syncCards();

    this.current = null;
    this.phase = 'idle';
    // 过关结算挂起时先不出下一块：棋盘保持消行后的最后一帧，确认后由 update 补块
    if (!this.pendingLevelUp) this.spawn();
  }

  /**
   * 复活：清空棋盘并重新出块（保留分数/关卡/行数/本局构筑）。
   * 仅在游戏结束后可调用一次；返回是否复活成功。
   * 供「看激励视频复活 / 金币复活」使用（见 main.js tryRevive）。
   */
  revive() {
    if (!this.gameOver) return false;
    this.board.reset();
    this.events.length = 0; // 丢弃残留事件（含 gameover）
    this.gameOver = false;
    this.pendingCards = null;
    this.pendingCardsMeta = null;
    this.pendingLevelUp = null;
    this.bag = [];
    if (this.plan && this.plan.setup) LevelPlan.applySetup(this.board, this.plan.setup, this.mods);
    this.next = this._drawNext();
    this.current = null;
    this.phase = 'idle';
    this.hintTimer = 0;
    this.fallTimer = 0;
    this.spawn();
    return !this.gameOver;
  }

  /* ---------- 关卡断点（存档 / 继续上一关 / 关卡选择，见 js/main.js + js/progress.js） ---------- */

  /**
   * 本关「开局断点」快照：只有关卡开局状态，不含棋盘格子。
   * 教学关的棋盘由 js/levelplan.js 的脚本重建，所以断点天然可复现、也不会存坏局面。
   */
  snapshot() {
    return {
      level: this.level,
      score: this.score,
      lines: this.lines,
      levelStartScore: this.levelStartScore,
      mods: Skills.cloneMods(this.mods),
      cardPicks: this.cardPicks.slice(),
      cardGiven: Object.assign({}, this.cardGiven),
      cardTarget: this.cardTarget,
      skillKills: this.skillKills,
      skillScore: this.skillScore,
      tutorial: !!this.plan,
    };
  }

  /** 恢复到某关的开局断点（分数与构筑沿用，棋盘按该关脚本重建） */
  restoreLevel(state) {
    const s = state || {};
    this.board.reset();
    this.gameOver = false;
    this.pendingCards = null;
    this.pendingCardsMeta = null;
    this.events.length = 0;
    this.bag = [];
    this.level = Math.max(1, Math.floor(s.level || 1));
    this.score = Math.max(0, Math.floor(s.score || 0));
    this.lines = Math.max(0, Math.floor(s.lines || 0));
    const m = Skills.defaultMods();
    if (s.mods) for (const k in s.mods) if (k !== 'scope') m[k] = s.mods[k];
    m.scope = Array.isArray(s.mods && s.mods.scope) ? s.mods.scope.slice() : ['color'];
    this.mods = Skills.cloneMods(m);
    this.cardPicks = (s.cardPicks || []).slice();
    this.skillKills = s.skillKills || 0;
    this.skillScore = s.skillScore || 0;
    this.cardTarget = (typeof s.cardTarget === 'number' && s.cardTarget > 0)
      ? s.cardTarget : (CARD.INTERVAL > 0 ? CARD.INTERVAL : Infinity);
    this._initTutorial();
    this.cardGiven = Object.assign({}, s.cardGiven || {});
    this._beginLevel();
    this.next = this._drawNext();
    this.current = null;
    this.phase = 'idle';
    this.hintTimer = 0;
    this.fallTimer = 0;
    this.spawn();
    return !this.gameOver;
  }

  /** 从第 n 关开局（关卡选择入口）：分数取该关的入场基准分，构筑清空 */
  startLevel(n) {
    this.reset(n);
    return this;
  }

  /** 取走并清空事件队列 */
  drainEvents() {
    const ev = this.events;
    this.events = [];
    return ev;
  }
}

module.exports = GameCore;
