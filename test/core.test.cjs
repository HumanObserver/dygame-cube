/**
 * 核心逻辑单元测试（Node 内置测试框架，无第三方依赖）
 * 运行：node --test test/
 */
const test = require('node:test');
const assert = require('node:assert');

const GameCore = require('../js/gamecore.js');
const Board = require('../js/board.js');
const { SHAPES, rotateCW, cellsOf } = require('../js/tetromino.js');
const { COLS, ROWS, DIRS, PERP, FALL_BASE, FALL_STEP, FALL_MIN, HINT_BASE, HINT_STEP, HINT_MIN } = require('../js/config.js');

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

test('board：settle 每列向下压实，悬空格子落底且保持相对顺序', () => {
  const b = new Board(10, 10);
  b.lock([{ x: 2, y: 0 }], 'I'); // 悬空格子（上）
  b.lock([{ x: 2, y: 3 }], 'J'); // 悬空格子（下）
  b.lock([{ x: 5, y: 9 }], 'T'); // 已落底，不应移动
  const r = b.settle();
  assert.strictEqual(r.moved, 2);
  assert.strictEqual(b.grid[9][2], 'J'); // 原本靠下的仍靠下
  assert.strictEqual(b.grid[8][2], 'I');
  assert.strictEqual(b.grid[0][2], null);
  assert.strictEqual(b.grid[3][2], null);
  assert.strictEqual(b.grid[9][5], 'T');
  // 幂等：已压实的棋盘再次 settle 无移动
  const again = b.settle();
  assert.strictEqual(again.moved, 0);
  assert.strictEqual(again.moves.length, 0);
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
  // 出生点应靠近棋盘中心（对任意 COLS 尺寸成立）
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
  const dist = ROWS - 2; // O 占 2 行：从 y=0 落到 y=ROWS-2 共 dist 格
  for (let i = 0; i < dist + 1; i++) core.update(iv); // dist 格下落 + 最后一拍锁定
  assert.strictEqual(core.phase, 'hint');       // 已锁定并生成下一块
  let locked = 0;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (core.board.grid[r][c]) locked++;
  assert.strictEqual(locked, 4);                // O 方块 4 格落底
  assert.strictEqual(core.board.grid[ROWS - 1][4], 'O');
  assert.strictEqual(core.score, dist);         // 自然下落 dist 格 × 1 分
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
  // 预填底部两行，仅留最后两列空
  const cells = [];
  for (let c = 0; c < COLS - 2; c++) { cells.push({ x: c, y: ROWS - 2 }); cells.push({ x: c, y: ROWS - 1 }); }
  core.board.lock(cells, 'J');
  core.score = 0;
  core.current = { type: 'O', matrix: SHAPES.O, dir: 0, x: COLS - 2, y: ROWS - 3 };
  core.hardDrop(); // 下落 1 格锁定，补满两行
  assert.strictEqual(core.lines, 2);
  assert.strictEqual(core.score, 250 * 1 + 1 * 2);
  // 两行被清空
  for (let c = 0; c < COLS; c++) {
    assert.strictEqual(core.board.grid[ROWS - 2][c], null);
    assert.strictEqual(core.board.grid[ROWS - 1][c], null);
  }
});

test('core：消行后剩余方块整体下沉，列内无悬空', () => {
  const core = new GameCore({ rng: constRng(0.1) }); // 重力向下
  core.phase = 'fall';
  const R = ROWS, C = COLS;
  // 第 0 列两个悬空格子 + 底行仅缺最后两列
  core.board.lock([{ x: 0, y: 3 }], 'Z');
  core.board.lock([{ x: 0, y: 12 }], 'S');
  const cells = [];
  for (let c = 0; c < C - 2; c++) cells.push({ x: c, y: R - 1 });
  core.board.lock(cells, 'J');
  core.score = 0;
  core.current = { type: 'O', matrix: SHAPES.O, dir: 0, x: C - 2, y: R - 3 };
  core.hardDrop(); // 补满底行 → 消除 → 沉降
  assert.strictEqual(core.lines, 1);
  // 原悬空的两格已沉到第 0 列底部，且保持上下相对顺序
  assert.strictEqual(core.board.grid[R - 1][0], 'S');
  assert.strictEqual(core.board.grid[R - 2][0], 'Z');
  assert.strictEqual(core.board.grid[3][0], null);
  assert.strictEqual(core.board.grid[12][0], null);
  // 全棋盘不变量：任何列内不允许「下方有空洞的悬空格子」
  for (let c = 0; c < C; c++) {
    let sawHole = false;
    for (let r = R - 1; r >= 0; r--) {
      if (!core.board.grid[r][c]) sawHole = true;
      else assert.ok(!sawHole, '列 ' + c + ' 行 ' + r + ' 悬空（下方有空洞）');
    }
  }
});

test('core：消列后悬空方块同样下沉落底', () => {
  const core = new GameCore({ rng: constRng(0.1) });
  core.phase = 'fall';
  const R = ROWS, C = COLS;
  const col = [];
  for (let r = 0; r < R - 4; r++) col.push({ x: C - 1, y: r }); // 第 C-1 列已填 0..R-5 行
  core.board.lock(col, 'I');
  core.board.lock([{ x: 5, y: 7 }], 'Z'); // 悬空块
  // 竖直 I（占 1 列 4 行）从 x=C-3 落底 → 补齐第 C-1 列最后 4 格
  core.current = { type: 'I', matrix: rotateCW(SHAPES.I), dir: 0, x: C - 3, y: R - 4 };
  core.hardDrop();
  assert.strictEqual(core.lines, 1); // 整列消除
  for (let r = 0; r < R; r++) assert.strictEqual(core.board.grid[r][C - 1], null);
  assert.strictEqual(core.board.grid[R - 1][5], 'Z'); // 悬空块已落底
  assert.strictEqual(core.board.grid[7][5], null);
});

test('core：沉降凑齐新整行 → 连锁消除合并计数', () => {
  const core = new GameCore({ rng: constRng(0.1) }); // 重力向下
  core.phase = 'fall';
  const R = ROWS, C = COLS;
  // 第 10 行整行填满（首消目标）；底行缺第 9 列；第 9 列上方有一悬空格子
  const row = [];
  for (let c = 0; c < C; c++) row.push({ x: c, y: 10 });
  core.board.lock(row, 'T');
  const bottom = [];
  for (let c = 0; c < C; c++) if (c !== 9) bottom.push({ x: c, y: R - 1 });
  core.board.lock(bottom, 'J');
  core.board.lock([{ x: 9, y: 4 }], 'Z');
  core.score = 0;
  // O 下落被悬空 Z 挡住，锁定在第 2/3 行（不直接参与消除），锁定后触发首消
  core.current = { type: 'O', matrix: SHAPES.O, dir: 0, x: 8, y: 0 };
  core.hardDrop();
  // 首消第 10 行 → 沉降：O 块与悬空 Z 下落，Z 落到底行第 9 列 → 底行凑齐
  // → 连锁消除底行 → 再沉降：O 块落底
  assert.strictEqual(core.lines, 2);
  assert.strictEqual(core.score, 250 + 2 * 2); // 合计 2 行 = SCORE_TABLE[2] + 硬降落距 2 格 ×2
  // O 块最终沉底（底行消除后再沉降到 18/19 行的 8、9 列）
  assert.strictEqual(core.board.grid[R - 1][8], 'O');
  assert.strictEqual(core.board.grid[R - 1][9], 'O');
  assert.strictEqual(core.board.grid[R - 2][8], 'O');
  assert.strictEqual(core.board.grid[R - 2][9], 'O');
  assert.strictEqual(core.board.grid[10][0], null); // 首消行已清空
  assert.strictEqual(core.board.grid[4][9], null);  // 悬空 Z 已参与连锁消除
  assert.strictEqual(core.board.grid[R - 1][0], null); // 连锁消除的底行不再回填
});

test('core：未发生消除时不触发下沉（保留四向重力锁定的悬空位置）', () => {
  const core = new GameCore({ rng: constRng(0.1) }); // 重力向下
  core.phase = 'fall';
  core.board.lock([{ x: 3, y: 2 }], 'T'); // 悬空块（如上向重力锁定的残留）
  core.current = { type: 'O', matrix: SHAPES.O, dir: 0, x: 10, y: 0 };
  core.hardDrop(); // 落底锁定，但未消除任何行列
  assert.strictEqual(core.lines, 0);
  assert.strictEqual(core.board.grid[2][3], 'T'); // 悬空块保持原位，不沉降
});

test('core：每 8 行升 1 关，下落间隔缩短', () => {
  const core = new GameCore({ rng: constRng(0.1) });
  const iv1 = core.fallInterval();
  assert.strictEqual(iv1, FALL_BASE);
  core.lines = 7;
  core.phase = 'fall';
  const cells = [];
  for (let c = 0; c < COLS - 2; c++) cells.push({ x: c, y: ROWS - 1 });
  core.board.lock(cells, 'J');
  core.current = { type: 'O', matrix: SHAPES.O, dir: 0, x: COLS - 2, y: ROWS - 2 };
  core.hardDrop(); // 补满底行缺口 → 消 1 行 → lines=8 → 升级
  assert.strictEqual(core.lines, 8);
  assert.strictEqual(core.level, 2);
  assert.strictEqual(core.fallInterval(), FALL_BASE - FALL_STEP);
  assert.strictEqual(core.hintTime(), HINT_BASE - HINT_STEP);
});

test('core：速度有下限', () => {
  const core = new GameCore({ rng: constRng(0.1) });
  core.level = 99;
  assert.strictEqual(core.fallInterval(), FALL_MIN);
  assert.strictEqual(core.hintTime(), HINT_MIN);
});

test('core：中心出生点被堵 → 游戏结束', () => {
  const core = new GameCore({ rng: constRng(0.1) });
  const cells = [];
  const c0 = Math.floor(ROWS / 2) - 2; // 中心 4×4 区域（覆盖所有方块的出生位置）
  for (let r = c0; r < c0 + 4; r++) for (let c = c0; c < c0 + 4; c++) cells.push({ x: c, y: r });
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
  core.hardDrop(); // 从 y=0 落到 y=ROWS-2，共 ROWS-2 格
  assert.strictEqual(core.score, (ROWS - 2) * 2);
});
