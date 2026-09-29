/**
 * 核心逻辑单元测试（Node 内置测试框架，无第三方依赖）
 * 运行：node --test test/
 */
const test = require('node:test');
const assert = require('node:assert');

const GameCore = require('../js/gamecore.js');
const Board = require('../js/board.js');
const { SHAPES, rotateCW, cellsOf } = require('../js/tetromino.js');
const { COLS, ROWS, DIRS, PERP } = require('../js/config.js');

/** 可复现的伪随机源 */
function constRng(v) {
  return function () { return v; };
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ================= tetromino ================= */

test('rotateCW：T 顺时针旋转后朝向右', () => {
  const m = rotateCW(SHAPES.T);
  const cells = cellsOf(m).map((c) => c.x + ',' + c.y).sort();
  assert.deepStrictEqual(cells, ['1,0', '1,1', '1,2', '2,1']);
});

test('rotateCW：I 旋转一次变竖直', () => {
  const m = rotateCW(SHAPES.I);
  const cells = cellsOf(m).map((c) => c.x + ',' + c.y).sort();
  assert.deepStrictEqual(cells, ['2,0', '2,1', '2,2', '2,3']);
});

test('rotateCW：任意方块旋转 4 次还原', () => {
  for (const type of Object.keys(SHAPES)) {
    let m = SHAPES[type];
    for (let i = 0; i < 4; i++) m = rotateCW(m);
    assert.deepStrictEqual(m, SHAPES[type], type + ' 旋转 4 次应还原');
  }
});

test('cellsOf：实体格数量正确', () => {
  for (const type of Object.keys(SHAPES)) {
    assert.strictEqual(cellsOf(SHAPES[type]).length, 4, type + ' 应有 4 格');
  }
});

/* ================= board ================= */

test('board：越界与占位碰撞', () => {
  const b = new Board(10, 10);
  assert.strictEqual(b.collides([{ x: -1, y: 0 }]), true);
  assert.strictEqual(b.collides([{ x: 10, y: 5 }]), true);
  assert.strictEqual(b.collides([{ x: 5, y: 5 }]), false);
  b.lock([{ x: 5, y: 5 }], 'T');
  assert.strictEqual(b.collides([{ x: 5, y: 5 }]), true);
});

test('board：填满整行消除', () => {
  const b = new Board(10, 10);
  const row = [];
  for (let c = 0; c < 10; c++) row.push({ x: c, y: 9 });
  b.lock(row, 'I');
  const r = b.clearLines();
  assert.strictEqual(r.rowCount, 1);
  assert.strictEqual(r.colCount, 0);
  assert.strictEqual(r.count, 1);
  assert.strictEqual(r.cells.length, 10);
  assert.strictEqual(b.grid[9].every((v) => v === null), true);
});

test('board：填满整列消除', () => {
  const b = new Board(10, 10);
  const col = [];
  for (let r = 0; r < 10; r++) col.push({ x: 0, y: r });
  b.lock(col, 'I');
  const res = b.clearLines();
  assert.strictEqual(res.colCount, 1);
  assert.strictEqual(res.rowCount, 0);
  assert.strictEqual(res.cells.length, 10);
});

test('board：行列十字同时消除，交叉格去重', () => {
  const b = new Board(10, 10);
  const cells = [];
  for (let c = 0; c < 10; c++) cells.push({ x: c, y: 9 });
  for (let r = 0; r < 10; r++) cells.push({ x: 0, y: r });
  b.lock(cells, 'J');
  const res = b.clearLines();
  assert.strictEqual(res.count, 2); // 1 行 + 1 列
  assert.strictEqual(res.cells.length, 19); // 20 - 1 交叉格
  assert.strictEqual(b.grid[9][0], null);
  assert.strictEqual(b.grid[5][0], null);
  assert.strictEqual(b.grid[9][5], null);
  assert.strictEqual(b.grid[5][5], null); // 未波及的格子保留
});

/* ================= gamecore ================= */

test('core：7-bag 每 7 个方块不重复', () => {
  const core = new GameCore({ rng: mulberry32(42) });
  core.bag = [];
  const first = [];
  for (let i = 0; i < 7; i++) first.push(core._drawType());
  assert.strictEqual(new Set(first).size, 7);
  const second = [];
  for (let i = 0; i < 7; i++) second.push(core._drawType());
  assert.strictEqual(new Set(second).size, 7);
});

test('core：重力方向由 rng 决定（0.3→左，0.9→右）', () => {
  const c1 = new GameCore({ rng: constRng(0.3) });
  assert.strictEqual(c1.current.dir, 1);
  const c2 = new GameCore({ rng: constRng(0.9) });
  assert.strictEqual(c2.current.dir, 3);
});

test('core：方块从中心生成，hint 相位结束后进入 fall', () => {
  const core = new GameCore({ rng: constRng(0.3) });
  assert.strictEqual(core.phase, 'hint');
  // 10x10 棋盘，出生点应靠近中心
  assert.ok(Math.abs(core.current.x + core.current.matrix.length / 2 - COLS / 2) <= 1);
  core.update(core.hintTime() + 1);
  assert.strictEqual(core.phase, 'fall');
});

test('core：重力向下自然落底锁定并重新出块', () => {
  const core = new GameCore({ rng: constRng(0.1) }); // dir = 0 (下)
  assert.strictEqual(core.current.dir, 0);
  // 固定一个 O 方块从顶部落下，保证确定性结果
  core.phase = 'fall';
  core.current = { type: 'O', matrix: SHAPES.O, dir: 0, x: 4, y: 0 };
  core.score = 0;
  const iv = core.fallInterval();
  for (let i = 0; i < 9; i++) core.update(iv); // 8 格下落 + 第 9 拍锁定
  assert.strictEqual(core.phase, 'hint');       // 已锁定并生成下一块
  let locked = 0;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (core.board.grid[r][c]) locked++;
  assert.strictEqual(locked, 4);                // O 方块 4 格落底
  assert.strictEqual(core.board.grid[9][4], 'O');
  assert.strictEqual(core.score, 8);            // 自然下落 8 格 × 1 分
});

test('core：重力向左时落向左侧墙', () => {
  const core = new GameCore({ rng: constRng(0.3) }); // dir = 1 (左)
  core.update(core.hintTime() + 1);
  const iv = core.fallInterval();
  for (let i = 0; i < 12; i++) core.update(iv);
  let minCol = 99;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (core.board.grid[r][c] && c < minCol) minCol = c;
  assert.strictEqual(minCol, 0);
});

test('core：movePerp 沿垂直轴移动，撞墙返回 false', () => {
  const core = new GameCore({ rng: constRng(0.1) }); // 重力向下，垂直轴 = x
  core.phase = 'fall';
  core.current = { type: 'O', matrix: SHAPES.O, dir: 0, x: 0, y: 3 };
  assert.strictEqual(core.movePerp(-1), false); // 已在左墙
  assert.strictEqual(core.current.x, 0);
  assert.strictEqual(core.movePerp(1), true);
  assert.strictEqual(core.current.x, 1);
  assert.strictEqual(core.current.y, 3); // y 不变
});

test('core：旋转带踢墙，O 方块旋转直接成功', () => {
  const core = new GameCore({ rng: constRng(0.1) });
  core.phase = 'fall';
  core.current = { type: 'O', matrix: SHAPES.O, dir: 0, x: 4, y: 4 };
  assert.strictEqual(core.rotate(), true);
  // T 旋转后形状变化
  core.current = { type: 'T', matrix: SHAPES.T, dir: 0, x: 4, y: 4 };
  assert.strictEqual(core.rotate(), true);
  assert.deepStrictEqual(core.current.matrix, rotateCW(SHAPES.T));
});

test('core：ghostCells 给出重力方向落点', () => {
  const core = new GameCore({ rng: constRng(0.1) }); // dir down
  core.phase = 'fall';
  core.current = { type: 'O', matrix: SHAPES.O, dir: 0, x: 0, y: 3 };
  const g = core.ghostCells();
  const ys = g.map((c) => c.y);
  assert.strictEqual(Math.max.apply(null, ys), ROWS - 1); // 贴底
});

test('core：消行得分（同时消 2 行 = 250×关卡 + 落距×2）', () => {
  const core = new GameCore({ rng: constRng(0.1) });
  core.phase = 'fall';
  // 预填第 8、9 行，仅留第 8、9 列空
  const cells = [];
  for (let c = 0; c < COLS - 2; c++) { cells.push({ x: c, y: 8 }); cells.push({ x: c, y: 9 }); }
  core.board.lock(cells, 'J');
  core.score = 0;
  core.current = { type: 'O', matrix: SHAPES.O, dir: 0, x: 8, y: 7 };
  core.hardDrop(); // 下落 1 格锁定，补满两行
  assert.strictEqual(core.lines, 2);
  assert.strictEqual(core.score, 250 * 1 + 1 * 2);
  // 两行被清空
  for (let c = 0; c < COLS; c++) {
    assert.strictEqual(core.board.grid[8][c], null);
    assert.strictEqual(core.board.grid[9][c], null);
  }
});

test('core：每 8 行升 1 关，下落间隔缩短', () => {
  const core = new GameCore({ rng: constRng(0.1) });
  const iv1 = core.fallInterval();
  assert.strictEqual(iv1, 1000);
  core.lines = 7;
  core.phase = 'fall';
  const cells = [];
  for (let c = 0; c < COLS - 2; c++) cells.push({ x: c, y: 9 });
  core.board.lock(cells, 'J');
  core.current = { type: 'O', matrix: SHAPES.O, dir: 0, x: 8, y: 8 };
  core.hardDrop(); // 补满第 9 行缺口 → 消 1 行 → lines=8 → 升级
  assert.strictEqual(core.lines, 8);
  assert.strictEqual(core.level, 2);
  assert.strictEqual(core.fallInterval(), 920);
  assert.strictEqual(core.hintTime(), 950);
});

test('core：速度有下限', () => {
  const core = new GameCore({ rng: constRng(0.1) });
  core.level = 99;
  assert.strictEqual(core.fallInterval(), 120);
  assert.strictEqual(core.hintTime(), 500);
});

test('core：中心出生点被堵 → 游戏结束', () => {
  const core = new GameCore({ rng: constRng(0.1) });
  const cells = [];
  for (let r = 3; r <= 6; r++) for (let c = 3; c <= 6; c++) cells.push({ x: c, y: r });
  core.board.lock(cells, 'Z');
  core.spawn();
  assert.strictEqual(core.gameOver, true);
  assert.strictEqual(core.phase, 'over');
  const evs = core.drainEvents();
  assert.ok(evs.some((e) => e.type === 'gameover'));
});

test('core：hardDrop 计分（每格 +2）', () => {
  const core = new GameCore({ rng: constRng(0.1) }); // dir down
  core.phase = 'fall';
  core.current = { type: 'O', matrix: SHAPES.O, dir: 0, x: 4, y: 0 };
  core.score = 0;
  core.hardDrop(); // 从 y=0 落到 y=8，共 8 格
  assert.strictEqual(core.score, 16);
});
