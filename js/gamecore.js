/**
 * 游戏核心逻辑（纯 JS，无平台依赖，可在 Node 中单元测试）
 *
 * 相位机：idle → hint(下落前提示) → fall(下落中) → 锁定 → 落地技能 → 消行+共鸣+半侧沉降 → 生成下一个
 * 方块从棋盘中心生成，重力方向随机（下/左/上/右），填满整行或整列即消除。
 *
 * 关卡：累计分数达到「合格分」即过关 → 棋盘整局清场、新关卡重新开局（积分继续累加）。
 * 技能方块：第 2 关起方块上会出现技能格（炮台＝落地释放 / 共鸣＝被消除或被击落时释放）。
 * 属性牌：分数每跨过 CARD.INTERVAL 分弹三张牌三选一，选中后本局后续技能方块都带上该属性。
 */
const {
  COLS, ROWS, DIRS, PERP, TYPES,
  HINT_BASE, HINT_MIN, HINT_STEP,
  FALL_BASE, FALL_MIN, FALL_STEP,
  levelTarget: configLevelTarget,
  SCORE_TABLE, SCORE_EXTRA,
  SOFT_DROP_SCORE, HARD_DROP_SCORE,
  SKILL, CARD,
} = require('./config.js');
const { SHAPES, rotateCW, cellsOf, cloneMatrix } = require('./tetromino.js');
const Board = require('./board.js');
const Skills = require('./skills.js');

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
    this.events = [];                   // 事件队列：lock / clear / turret / resonance / levelup / cards / gameover
    this.board = new Board(COLS, ROWS);
    this.reset();
  }

  reset() {
    this.board.reset();
    this.score = 0;
    this.level = 1;
    this.lines = 0;
    this.gameOver = false;
    // 本局构筑（属性牌）与技能统计
    this.mods = Skills.defaultMods();
    this.cardPicks = [];
    this.pendingCards = null;
    this.cardTarget = CARD.INTERVAL > 0 ? CARD.INTERVAL : Infinity;
    this.skillKills = 0;
    this.skillScore = 0;
    this.bag = [];
    this.next = this._drawNext();
    this.current = null;
    this.phase = 'idle';
    this.hintTimer = 0;
    this.fallTimer = 0;
    this.spawn();
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
   */
  _rollSkill(type) {
    if (this.level < SKILL.START_LEVEL) return null;
    if (this.rng() >= Skills.skillChance(this.mods)) return null;
    const kind = Skills.rollKind(this.rng);
    const cells = cellsOf(SHAPES[type]);
    const pick = cells[Math.floor(this.rng() * cells.length) % cells.length];
    return { kind, mx: pick.x, my: pick.y, mods: Skills.cloneMods(this.mods) };
  }

  _drawNext() {
    const type = this._drawType();
    return { type: type, dir: Math.floor(this.rng() * 4), skill: this._rollSkill(type) };
  }

  /* ---------- 关卡参数 ---------- */

  /** 第 level 关的合格分（累计分数目标）；缺省为当前关 */
  levelTarget(level) {
    return configLevelTarget(level === undefined ? this.level : level);
  }

  hintTime() {
    return Math.max(HINT_MIN, HINT_BASE - (this.level - 1) * HINT_STEP);
  }

  fallInterval() {
    return Math.max(FALL_MIN, FALL_BASE - (this.level - 1) * FALL_STEP);
  }

  /**
   * 合格判定：累计分数达到当前关合格分即过关升 1 关（分数一次跨越多条合格线时连升）。
   * 过关＝清场重开：棋盘上所有已固定方格清空、当前方块作废，积分保留继续累加。
   */
  _syncLevel() {
    if (this.gameOver) return;
    while (this.score >= this.levelTarget(this.level)) {
      this.level++;
      this._startLevel();
    }
  }

  /** 新关卡开局：清场 + 推入 levelup 事件（随后的 spawn 由 update/_lock 负责） */
  _startLevel() {
    const cells = this.board.allCells();
    this.board.reset();
    this.current = null;
    this.phase = 'idle';
    this.hintTimer = 0;
    this.fallTimer = 0;
    this.events.push({
      type: 'levelup',
      level: this.level,
      target: this.levelTarget(this.level),
      cells: cells,
      skills: this.level >= SKILL.START_LEVEL,
    });
  }

  /**
   * 属性牌判定：分数每跨过 cardTarget（CARD.INTERVAL 的整数倍）弹一次三选一，
   * 选择前游戏暂停（update / canControl 均被 pendingCards 挡住）。
   */
  _syncCards() {
    if (!(CARD.INTERVAL > 0)) return;
    while (this.score >= this.cardTarget) {
      this.cardTarget += CARD.INTERVAL;
      if (this.gameOver) continue;
      const offer = Skills.offerCards(this.rng, this.mods, CARD.CHOICES);
      this.events.push({ type: 'cards', cards: offer });
      if (offer.length) this.pendingCards = offer; // 牌池见底则直接跳过
    }
  }

  /** 选择一张属性牌（牌面 id），立即生效并恢复游戏；返回选中的牌 */
  pickCard(id) {
    if (!this.pendingCards) return null;
    let view = null;
    for (let i = 0; i < this.pendingCards.length; i++) if (this.pendingCards[i].id === id) view = this.pendingCards[i];
    if (!view) return null;
    const card = Skills.applyCard(this.mods, id);
    this.pendingCards = null;
    this.cardPicks.push(id);
    this.events.push({ type: 'cardpick', id: id, tag: view.tag, name: view.name });
    return card;
  }

  /** 放弃本次三选一 */
  skipCards() {
    if (!this.pendingCards) return false;
    this.pendingCards = null;
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
    return !this.gameOver && !this.pendingCards && !!this.current && (this.phase === 'hint' || this.phase === 'fall');
  }

  /** 主循环驱动：dt 为毫秒 */
  update(dt) {
    if (this.gameOver || this.pendingCards) return;
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
      if (!this.current && !this.gameOver && !this.pendingCards) this.spawn();
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
    }
    return true;
  }

  /* ---------- 玩家操作 ---------- */

  /** 沿与重力垂直的轴移动，sign = -1 / +1 */
  movePerp(sign) {
    if (!this.canControl()) return false;
    const p = PERP[this.current.dir];
    const moved = this._moved(this.current, p.x * sign, p.y * sign);
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
      this.score += base * this.level;
      this.lines += count;
      this.events.push({ type: 'clear', cells: allCells, count, settled: settledMoved });
    }

    this._syncLevel(); // 累计分数达到当前关合格分 → 过关升 1 关（清场重开）
    this._syncCards(); // 跨过属性牌分数线 → 三选一

    this.current = null;
    this.phase = 'idle';
    this.spawn(); // 生成下一个（可能触发 gameover）
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
    this.bag = [];
    this.next = this._drawNext();
    this.current = null;
    this.phase = 'idle';
    this.hintTimer = 0;
    this.fallTimer = 0;
    this.spawn();
    return !this.gameOver;
  }

  /** 取走并清空事件队列 */
  drainEvents() {
    const ev = this.events;
    this.events = [];
    return ev;
  }
}

module.exports = GameCore;
