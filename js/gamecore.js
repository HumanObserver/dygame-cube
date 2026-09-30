/**
 * 游戏核心逻辑（纯 JS，无平台依赖，可在 Node 中单元测试）
 *
 * 相位机：idle → hint(下落前提示) → fall(下落中) → 锁定/消行+沉降 → 生成下一个
 * 方块从棋盘中心生成，重力方向随机（下/左/上/右），填满整行或整列即消除。
 * 消除后场上剩余方块整体下沉落底（每列向下压实），下沉凑齐的新行列连锁消除。
 */
const {
  COLS, ROWS, DIRS, PERP, TYPES,
  HINT_BASE, HINT_MIN, HINT_STEP,
  FALL_BASE, FALL_MIN, FALL_STEP,
  levelTarget: configLevelTarget,
  SCORE_TABLE, SCORE_EXTRA,
  SOFT_DROP_SCORE, HARD_DROP_SCORE,
} = require('./config.js');
const { SHAPES, rotateCW, cellsOf, cloneMatrix } = require('./tetromino.js');
const Board = require('./board.js');

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
    this.events = [];                   // 事件队列：lock / clear / levelup / gameover
    this.board = new Board(COLS, ROWS);
    this.reset();
  }

  reset() {
    this.board.reset();
    this.score = 0;
    this.level = 1;
    this.lines = 0;
    this.gameOver = false;
    this.bag = [];
    this.next = this._drawNext();
    this.current = null;
    this.phase = 'idle';
    this.hintTimer = 0;
    this.fallTimer = 0;
    this.spawn();
  }

  /* ---------- 随机出块：7-bag（每 7 个一块袋，袋内洗牌） ---------- */

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

  _drawNext() {
    return { type: this._drawType(), dir: Math.floor(this.rng() * 4) };
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
   * 在每次加分后调用；升级会推入 levelup 事件（level = 升入的新关卡）。
   */
  _syncLevel() {
    while (this.score >= this.levelTarget(this.level)) {
      this.level++;
      this.events.push({ type: 'levelup', level: this.level, target: this.levelTarget(this.level) });
    }
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
      // 棋盘中心生成
      x: Math.floor((COLS - matrix.length) / 2),
      y: Math.floor((ROWS - matrix.length) / 2),
    };
    if (this.board.collides(this.cells(piece))) {
      // 中心被堵住 → 游戏结束
      this.current = piece;
      this.phase = 'over';
      this.gameOver = true;
      this.events.push({ type: 'gameover' });
      return;
    }
    this.current = piece;
    this.phase = 'hint';
    this.hintTimer = this.hintTime();
    this.fallTimer = 0;
  }

  canControl() {
    return !this.gameOver && !!this.current && (this.phase === 'hint' || this.phase === 'fall');
  }

  /** 主循环驱动：dt 为毫秒 */
  update(dt) {
    if (this.gameOver || !this.current) return;
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
      }
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
    while (this._stepGravity(false)) dist++;
    this.score += dist * HARD_DROP_SCORE;
    this._syncLevel();
  }

  /* ---------- 锁定 / 消行 / 升级 ---------- */

  _lock() {
    const cells = this.cells(this.current);
    this.board.lock(cells, this.current.type);
    this.events.push({ type: 'lock', cells: cells.slice() });

    const cleared = this.board.clearLines();
    if (cleared.count > 0) {
      // 消除 → 沉降 循环：消除后剩余方块整体下沉（每列向下压实，不再悬空）；
      // 下沉可能凑齐新的整行/整列 → 继续消除并沉降，直到稳定（连锁消除合并计数）
      let count = cleared.count;
      const allCells = cleared.cells.slice();
      let settledMoved = 0;
      for (;;) {
        const settled = this.board.settle();
        settledMoved += settled.moved;
        const next = this.board.clearLines();
        if (next.count === 0) break;
        count += next.count;
        for (let i = 0; i < next.cells.length; i++) allCells.push(next.cells[i]);
      }

      let base = SCORE_TABLE[Math.min(count, 4)];
      if (count > 4) base += (count - 4) * SCORE_EXTRA;
      this.score += base * this.level;
      this.lines += count;
      this.events.push({ type: 'clear', cells: allCells, count, settled: settledMoved });

      this._syncLevel(); // 累计分数达到当前关合格分 → 过关升级
    }

    this.current = null;
    this.phase = 'idle';
    this.spawn(); // 生成下一个（可能触发 gameover）
  }

  /**
   * 复活：清空棋盘并重新出块（保留分数/关卡/行数）。
   * 仅在游戏结束后可调用一次；返回是否复活成功。
   * 供「看激励视频复活 / 金币复活」使用（见 main.js tryRevive）。
   */
  revive() {
    if (!this.gameOver) return false;
    this.board.reset();
    this.events.length = 0; // 丢弃残留事件（含 gameover）
    this.gameOver = false;
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
