/**
 * 核心逻辑单元测试（Node 内置测试框架，无第三方依赖）
 * 运行：node --test test/
 */
const test = require('node:test');
const assert = require('node:assert');

const GameCore = require('../js/gamecore.js');
const Board = require('../js/board.js');
const Skills = require('../js/skills.js');
const { SHAPES, rotateCW, cellsOf } = require('../js/tetromino.js');
const { COLS, ROWS, DIRS, PERP, FALL_BASE, FALL_STEP, FALL_MIN, HINT_BASE, HINT_STEP, HINT_MIN,
  LEVEL_TARGETS, LEVEL_TARGET_STEP, levelTarget, SKILL, CARD } = require('../js/config.js');

const SKILL_BASE = SKILL.BASE_CELL_SCORE; // 技能消失每格基础分（关卡 1 时即总分）

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

test('board：settle() 不传消除线＝整列向下压实（兼容旧行为）', () => {
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

test('board：半侧沉降——中间行消除后上半下沉贴合，下半保持原位', () => {
  const b = new Board(10, 10);
  const row = [];
  for (let c = 0; c < 10; c++) row.push({ x: c, y: 5 });
  b.lock(row, 'I');            // 待消除的中间行
  b.lock([{ x: 2, y: 1 }], 'J');  // 消除线上方 → 应下沉
  b.lock([{ x: 2, y: 8 }], 'T');  // 消除线下方 → 应保持
  b.lock([{ x: 4, y: 9 }], 'S');  // 底部 → 应保持
  const cleared = b.clearLines();
  assert.strictEqual(cleared.count, 1);
  const r = b.settle(cleared.rows, cleared.cols);
  assert.strictEqual(r.moved, 1, '只有贴近消除线上侧的格子移动');
  assert.strictEqual(b.grid[5][2], 'J'); // 上半沉到贴合消除线
  assert.strictEqual(b.grid[1][2], null);
  assert.strictEqual(b.grid[8][2], 'T'); // 下半保持
  assert.strictEqual(b.grid[9][4], 'S');
});

test('board：半侧沉降——整列消除后左侧右滑贴合，右侧保持', () => {
  const b = new Board(10, 10);
  const col = [];
  for (let r = 0; r < 10; r++) col.push({ x: 4, y: r });
  b.lock(col, 'I');
  b.lock([{ x: 1, y: 2 }], 'J'); // 消除线左侧 → 右滑
  b.lock([{ x: 7, y: 2 }], 'T'); // 消除线右侧 → 保持
  const cleared = b.clearLines();
  assert.strictEqual(cleared.count, 1);
  const r = b.settle(cleared.rows, cleared.cols);
  assert.strictEqual(r.moved, 1);
  assert.strictEqual(b.grid[2][4], 'J'); // 贴着消除线
  assert.strictEqual(b.grid[2][1], null);
  assert.strictEqual(b.grid[2][7], 'T'); // 右半不动
});

test('board：多条消除线各自分段压实，互不越界', () => {
  const b = new Board(10, 10);
  const top = [], bottom = [];
  for (let c = 0; c < 10; c++) { top.push({ x: c, y: 3 }); bottom.push({ x: c, y: 7 }); }
  b.lock(top, 'I');
  b.lock(bottom, 'O');
  b.lock([{ x: 1, y: 0 }], 'J'); // 第 3 行之上
  b.lock([{ x: 2, y: 5 }], 'T'); // 两条消除线之间
  b.lock([{ x: 3, y: 9 }], 'S'); // 第 7 行之下
  const cleared = b.clearLines();
  assert.strictEqual(cleared.count, 2);
  b.settle(cleared.rows, cleared.cols);
  assert.strictEqual(b.grid[3][1], 'J'); // 上段贴第 3 行
  assert.strictEqual(b.grid[7][2], 'T'); // 中段贴第 7 行
  assert.strictEqual(b.grid[9][3], 'S'); // 下段保持
  assert.strictEqual(b.grid[0][1], null);
  assert.strictEqual(b.grid[5][2], null);
});

test('board：沉降时技能格与方格一起移动，remove() 返回技能快照', () => {
  const b = new Board(10, 10);
  const row = [];
  for (let c = 0; c < 10; c++) row.push({ x: c, y: 6 });
  b.lock(row, 'I');
  b.lock([{ x: 2, y: 1 }], 'Z');
  b.setSkill(2, 1, { kind: 'turret', dir: 0, mods: { bullets: 1 } });
  assert.strictEqual(b.skillAt(2, 1).kind, 'turret');
  const cleared = b.clearLines();
  b.settle(cleared.rows, cleared.cols);
  assert.strictEqual(b.grid[6][2], 'Z');
  assert.strictEqual(b.skillAt(2, 6).kind, 'turret', '技能格应随方格移动');
  assert.strictEqual(b.skillAt(2, 1), null);
  const got = b.remove(2, 6);
  assert.strictEqual(got.type, 'Z');
  assert.strictEqual(got.skill.kind, 'turret');
  assert.strictEqual(b.grid[6][2], null);
  assert.strictEqual(b.skillAt(2, 6), null);
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

test('core：消列后靠近消除线的左半侧右滑贴合，右半侧保持', () => {
  const core = new GameCore({ rng: constRng(0.1) });
  core.phase = 'fall';
  const R = ROWS, C = COLS;
  const col = [];
  for (let r = 0; r < R - 4; r++) col.push({ x: C - 1, y: r }); // 第 C-1 列已填 0..R-5 行
  core.board.lock(col, 'I');
  core.board.lock([{ x: 5, y: 7 }], 'Z');  // 消除线左侧的方块
  core.board.lock([{ x: C - 2, y: 3 }], 'S'); // 也在左侧（C-2 < C-1）
  // 竖直 I（占 1 列 4 行）从 x=C-3 落底 → 补齐第 C-1 列最后 4 格
  core.current = { type: 'I', matrix: rotateCW(SHAPES.I), dir: 0, x: C - 3, y: R - 4 };
  core.hardDrop();
  assert.strictEqual(core.lines, 1); // 整列消除
  // 左半侧贴着消除线（第 C-1 列）重新排布：第 7 行的 Z 滑到 C-1
  assert.strictEqual(core.board.grid[7][5], null);
  assert.strictEqual(core.board.grid[7][C - 1], 'Z');
  assert.strictEqual(core.board.grid[3][C - 2], null);
  assert.strictEqual(core.board.grid[3][C - 1], 'S');
  // 其余列被搬空后不再有残留
  for (let r = 0; r < R; r++) if (r !== 7 && r !== 3) assert.strictEqual(core.board.grid[r][C - 1], null);
});

test('core：沉降凑齐新整行 → 连锁消除合并计数（半侧沉降：上半沉到消除线）', () => {
  const core = new GameCore({ rng: constRng(0.1) }); // 重力向下
  core.phase = 'fall';
  const R = ROWS, C = COLS;
  // 第 6 行：除第 9 列外填满；第 10 行整行填满（首消目标）；第 9 列上方一颗悬空 Z
  const mid = [];
  for (let c = 0; c < C; c++) if (c !== 9) mid.push({ x: c, y: 6 });
  core.board.lock(mid, 'J');
  const row = [];
  for (let c = 0; c < C; c++) row.push({ x: c, y: 10 });
  core.board.lock(row, 'T');
  core.board.lock([{ x: 9, y: 3 }], 'Z');
  core.score = 0;
  // 触发块：贴底停放（落距 0，不干扰沉降区），锁定后触发首消
  core.current = { type: 'O', matrix: SHAPES.O, dir: 0, x: 0, y: R - 2 };
  core.hardDrop();
  // 首消第 10 行 → 沉降：第 0..10 行这段向下贴合第 10 行
  // → 第 6 行的 19 格 + 悬空 Z 全部落到第 10 行 → 凑齐新整行 → 连锁消除
  assert.strictEqual(core.lines, 2);
  assert.strictEqual(core.score, 250); // SCORE_TABLE[2] × 关卡 1（落距 0，无硬降分）
  assert.strictEqual(core.board.grid[10][0], null); // 首消行已清空
  assert.strictEqual(core.board.grid[10][9], null); // 连锁补齐的格子也被消除
  assert.strictEqual(core.board.grid[6][0], null);  // 第 6 行已沉到第 10 行
  assert.strictEqual(core.board.grid[3][9], null);  // 悬空 Z 已参与连锁
  // 下半侧保持不动：触发块仍在底两行
  assert.strictEqual(core.board.grid[R - 2][0], 'O');
  assert.strictEqual(core.board.grid[R - 1][1], 'O');
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

/* ================= 过关清场 + 积分累加（需求 2） ================= */

test('core：达到合格分 → 棋盘清场、当前块作废、积分累加进入下一关', () => {
  const core = new GameCore({ rng: constRng(0.1) }); // 重力向下
  core.phase = 'fall';
  const cells = [];
  for (let c = 0; c < COLS - 2; c++) { cells.push({ x: c, y: ROWS - 2 }); cells.push({ x: c, y: ROWS - 1 }); }
  core.board.lock(cells, 'J');
  core.board.lock([{ x: 5, y: 5 }], 'Z'); // 无关残子：过关时应一并被清掉
  core.score = LEVEL_TARGETS[0] - 250; // 消 2 行 = 250×1 → 刚好达标
  core.current = { type: 'O', matrix: SHAPES.O, dir: 0, x: COLS - 2, y: ROWS - 3 };
  core.hardDrop();
  assert.strictEqual(core.lines, 2);
  assert.strictEqual(core.level, 2, '累计分数达标应升关');
  assert.strictEqual(core.score, LEVEL_TARGETS[0] + 2, '过关后积分不清零（+硬降落距 1 格 ×2）');
  assert.strictEqual(core.board.allCells().length, 0, '过关应清空整局棋盘');
  assert.ok(core.current, '过关后应重新出块');
  const evs = core.drainEvents();
  const up = evs.filter((e) => e.type === 'levelup');
  assert.strictEqual(up.length, 1);
  assert.ok(up[0].cells.length >= 1, 'levelup 事件应带上被清场的格子（动画用）');
  assert.strictEqual(up[0].skills, true, '进入第 2 关后棋盘上会出现技能方块');
  assert.strictEqual(up[0].target, LEVEL_TARGETS[1]);
  assert.strictEqual(core.fallInterval(), FALL_BASE - FALL_STEP, '新关卡下落更快');
});

test('core：软降途中过关同样清场重开，且不会卡住（update 自动补块）', () => {
  const core = new GameCore({ rng: constRng(0.1) });
  core.phase = 'fall';
  core.current = { type: 'O', matrix: SHAPES.O, dir: 0, x: 4, y: 0 };
  core.board.lock([{ x: 1, y: 1 }], 'T'); // 场上残留
  core.score = LEVEL_TARGETS[0] - 2;      // 再软降 2 格即达标
  core.update(core.fallInterval() * 2);
  assert.strictEqual(core.level, 2, '软降分跨过合格线也应过关');
  assert.strictEqual(core.board.allCells().length, 0, '场上残留应被清场');
  assert.ok(core.current, 'update 应自动补上一个新方块');
  assert.strictEqual(core.board.allCells().length, 0);
});

/* ================= 技能方块（需求 3） ================= */

test('core：第 1 关没有技能方块，第 2 关起按概率出现并快照属性', () => {
  const core = new GameCore({ rng: constRng(0.1) }); // 0.1 < 出现概率
  core.level = 1;
  assert.strictEqual(core._rollSkill('T'), null, '第 1 关不应出现技能格');
  core.level = SKILL.START_LEVEL;
  core.mods.pierce = 2;
  core.mods.scope = ['color', 'row'];
  const sk = core._rollSkill('T');
  assert.ok(sk && (sk.kind === 'turret' || sk.kind === 'resonance'), '第 2 关应能抽到技能格');
  assert.strictEqual(sk.mods.pierce, 2, '技能格应带上当时的属性快照');
  assert.deepStrictEqual(sk.mods.scope, ['color', 'row']);
  sk.mods.pierce = 99; // 快照独立，改回来不影响后续
  assert.strictEqual(core.mods.pierce, 2);
  const never = new GameCore({ rng: constRng(0.99) }); // 概率检定不命中
  never.level = 2;
  assert.strictEqual(never._rollSkill('T'), null);
});

test('core：炮台落地开火，击落弹道上的方格且其余方格保持原位（不沉降）', () => {
  const core = new GameCore({ rng: constRng(0.1) });
  core.phase = 'fall';
  core.board.lock([{ x: 8, y: 12 }], 'J'); // 弹道上的目标
  core.board.lock([{ x: 8, y: 5 }], 'Z');  // 更远处的同列方格（穿透 0 → 不应被击落）
  core.board.lock([{ x: 3, y: 3 }], 'I');  // 无关悬空方格（不应因沉降移动）
  core.score = 0;
  core.current = {
    type: 'O', matrix: SHAPES.O, dir: 0, x: 8, y: 18,
    skill: { kind: 'turret', mx: 0, my: 0, mods: Skills.defaultMods() },
  };
  core.hardDrop();
  assert.strictEqual(core.board.grid[12][8], null, '被击落的方格消失');
  assert.strictEqual(core.board.grid[5][8], 'Z', '穿透 0：子弹只击落一格');
  assert.strictEqual(core.board.grid[3][3], 'I', '其余方格保持原位（无沉降）');
  assert.strictEqual(core.board.grid[18][8], 'O');
  assert.strictEqual(core.board.skillAt(8, 18).kind, 'turret', '炮台格本身留在场上');
  assert.strictEqual(core.skillKills, 1);
  assert.strictEqual(core.score, SKILL_BASE * 1); // 每格 20 分 × 关卡 1
  const evs = core.drainEvents().filter((e) => e.type === 'turret');
  assert.strictEqual(evs.length, 1);
  assert.strictEqual(evs[0].count, 1);
  assert.ok(evs[0].shots[0].path.length > 0, '事件应带弹道用于动画');
});

test('skills：子弹穿透层数、撞墙反弹与空弹道消散', () => {
  // 穿透 1 ＝ 最多击落 2 格
  const b = new Board(10, 10);
  b.lock([{ x: 8, y: 6 }], 'J');
  b.lock([{ x: 8, y: 2 }], 'Z');
  const mods = Skills.defaultMods();
  mods.pierce = 1;
  const shot = Skills.fireTurret(b, 8, 9, 0, mods); // 重力向下 → 子弹沿反重力向上
  assert.strictEqual(shot.shots.length, 1, '子弹数 1 → 单弹道');
  assert.strictEqual(shot.shots[0].hits.length, 2, '穿透 1 击落 2 格');
  assert.strictEqual(b.grid[6][8], null);
  assert.strictEqual(b.grid[2][8], null);

  // 无反弹：飞到边界即消散（空弹道不命中）
  const straight = Skills.fireTurret(new Board(10, 10), 0, 9, 0, Skills.defaultMods());
  assert.strictEqual(straight.shots[0].hits.length, 0);
  assert.strictEqual(straight.shots[0].path.length, 9, '从第 9 行飞到第 0 行共 9 格后出界');

  // 有反弹：撞墙后顺时针转 90° 继续沿新弹道飞行
  const b2 = new Board(10, 10);
  b2.lock([{ x: 5, y: 0 }], 'J'); // 只有反弹后的横向弹道上才有目标
  const m2 = Skills.defaultMods();
  m2.bounce = 1;
  const bounced = Skills.fireTurret(b2, 0, 9, 0, m2);
  assert.strictEqual(bounced.shots[0].hits.length, 1, '反弹后命中另一条线上的方格');
  assert.strictEqual(b2.grid[0][5], null);
  assert.ok(bounced.shots[0].path.length > 9, '反弹让子弹飞得更远');

  // 子弹数 3 → 三条弹道（反重力 + 两侧向）
  const b3 = new Board(10, 10);
  b3.lock([{ x: 5, y: 5 }, { x: 4, y: 9 }, { x: 6, y: 9 }], 'J');
  const m3 = Skills.defaultMods();
  m3.bullets = 3;
  const fan = Skills.fireTurret(b3, 5, 9, 0, m3);
  assert.strictEqual(fan.shots.length, 3);
  assert.strictEqual(fan.shots[0].dir, 2, '第一发沿反重力方向（上）');
  assert.strictEqual(fan.shots.reduce((n, s) => n + s.hits.length, 0), 3, '三条弹道各击落一格');
});

test('skills：共鸣格消失时带走同类方格，异类保留', () => {
  const b = new Board(10, 10);
  b.lock([{ x: 1, y: 1 }], 'Z');
  b.setSkill(1, 1, { kind: 'resonance', dir: 0, mods: Skills.defaultMods() });
  b.lock([{ x: 5, y: 7 }], 'Z');  // 同类（同色）
  b.lock([{ x: 2, y: 3 }], 'I');  // 异类
  const seed = b.remove(1, 1);      // 共鸣格「被消除 / 被击落」
  const casc = Skills.cascadeResonance(b, [seed]);
  assert.strictEqual(casc.destroyed.length, 1);
  assert.strictEqual(b.grid[7][5], null, '同类方格一同消失');
  assert.strictEqual(b.grid[3][2], 'I', '异类方格保留');
  assert.strictEqual(casc.waves[0].origin.x, 1);
});

test('skills：共鸣级联——被共鸣带走的共鸣格会继续引爆', () => {
  const rs = (scope) => ({
    kind: 'resonance', dir: 0,
    mods: Object.assign(Skills.defaultMods(), { scope: scope }),
  });
  const b = new Board(10, 10);
  b.lock([{ x: 1, y: 1 }], 'Z');
  b.setSkill(1, 1, rs(['row']));      // 第一波：只带走同一行
  b.lock([{ x: 7, y: 1 }], 'Q');      // 同一行 → 被第一波带走（它自己也是共鸣格）
  b.setSkill(7, 1, rs(['color']));    // 第二波：按同色扩散
  b.lock([{ x: 3, y: 6 }], 'Q');      // 同色 → 被第二波带走
  b.lock([{ x: 9, y: 9 }], 'Z');      // 既不同行也不同色 → 保留
  const casc = Skills.cascadeResonance(b, [b.remove(1, 1)]);
  assert.strictEqual(casc.destroyed.length, 2, '两波级联共带走 2 格');
  assert.strictEqual(casc.waves.length, 2, '应记录两波共鸣');
  assert.strictEqual(casc.waves[1].origin.x, 7);
  assert.strictEqual(b.grid[6][3], null, '第二波波及的方格已消失');
  assert.strictEqual(b.grid[9][9], 'Z', '未波及的方格保留');
});

test('core：共鸣格随整行消除时，同类方格一起消失并计分', () => {
  const core = new GameCore({ rng: constRng(0.1) });
  core.phase = 'fall';
  const row = [];
  for (let c = 0; c < COLS - 2; c++) row.push({ x: c, y: ROWS - 1 });
  core.board.lock(row, 'Q');
  core.board.setSkill(3, ROWS - 1, { kind: 'resonance', dir: 0, mods: Skills.defaultMods() });
  core.board.lock([{ x: 7, y: 3 }], 'Q'); // 同类远端方格
  core.board.lock([{ x: 9, y: 3 }], 'W'); // 异类方格
  core.score = 0;
  core.current = { type: 'O', matrix: SHAPES.O, dir: 0, x: COLS - 2, y: ROWS - 2 };
  core.hardDrop();
  assert.strictEqual(core.lines, 1);
  assert.strictEqual(core.board.allCells().filter((c) => c.type === 'Q').length, 0, '同类方格应已全部消失');
  assert.strictEqual(core.board.allCells().filter((c) => c.type === 'W').length, 1, '异类方格仍在场（只是沉降）');
  assert.strictEqual(core.skillKills, 1);
  assert.strictEqual(core.score, 100 + SKILL_BASE); // 消 1 行 + 共鸣 1 格
  assert.ok(core.drainEvents().some((e) => e.type === 'resonance'));
});

test('core：共鸣的消失方式与扩展维度（爆炸 8 格 / 横竖激光 / 十字 / 同层同列）', () => {
  const SPOTS = [
    [3, 3], [4, 3], [5, 3], [3, 4], [5, 4], [3, 5], [4, 5], [5, 5], // 周围 8 格
    [2, 4], [6, 4], [4, 2], [4, 6],                                  // 激光延伸段
    [0, 4], [1, 4], [8, 4], [9, 4], [4, 0], [4, 1], [4, 8], [4, 9],   // 整行 / 整列补位
    [0, 0], [9, 9],                                                   // 远处同色
  ];
  function mk(pattern, scope) {
    const b = new Board(10, 10);
    for (let i = 0; i < SPOTS.length; i++) b.lock([{ x: SPOTS[i][0], y: SPOTS[i][1] }], 'Q');
    const mods = Skills.defaultMods();
    mods.pattern = pattern || 'none';
    mods.scope = scope || [];
    return { b: b, mods: mods };
  }
  // 共鸣格本体在 (4,4)（type Q，由 seed 提供），周围均为同类 Q
  const count = (o) => Skills.resonanceTargets(o.b, 4, 4, 'Q', o.mods).length;
  assert.strictEqual(count(mk('bomb')), 8, '爆炸：周围 8 格');
  assert.strictEqual(count(mk('laserH')), 4, '横激光：左右各 2 格');
  assert.strictEqual(count(mk('laserV')), 4, '竖激光：上下各 2 格');
  assert.strictEqual(count(mk('cross')), 8, '十字激光：四向各 2 格');
  assert.strictEqual(count(mk(null, ['row'])), 8, '同层：该行其它 8 格');
  assert.strictEqual(count(mk(null, ['col'])), 8, '同列：该列其它 8 格');
  assert.strictEqual(count(mk(null, ['color'])), 22, '同色：全场同类方格');
  assert.strictEqual(count(mk('none', [])), 0, '无属性时共鸣只消失自身');
  assert.strictEqual(count(mk('bomb', ['row'])), 14, '维度可叠加（同层 + 爆炸）');
});

test('core：共鸣格被炮台击落时也会释放（消除技能＝被消除或被击落）', () => {
  const core = new GameCore({ rng: constRng(0.1) });
  core.phase = 'fall';
  core.board.lock([{ x: 8, y: 10 }], 'Z');
  core.board.setSkill(8, 10, { kind: 'resonance', dir: 0, mods: Skills.defaultMods() }); // 弹道上的共鸣格
  core.board.lock([{ x: 2, y: 2 }], 'Z'); // 同类方格 → 应被共鸣带走
  core.board.lock([{ x: 1, y: 1 }], 'I'); // 异类 → 保留
  core.score = 0;
  core.current = {
    type: 'O', matrix: SHAPES.O, dir: 0, x: 8, y: 18,
    skill: { kind: 'turret', mx: 0, my: 0, mods: Skills.defaultMods() },
  };
  core.hardDrop();
  assert.strictEqual(core.board.grid[10][8], null, '共鸣格被击落');
  assert.strictEqual(core.board.grid[2][2], null, '共鸣格被击落时同样释放：同类方格消失');
  assert.strictEqual(core.board.grid[1][1], 'I', '异类保留');
  assert.strictEqual(core.skillKills, 2);
  const evs = core.drainEvents();
  assert.ok(evs.some((e) => e.type === 'resonance'), '应推入 resonance 事件');
});

/* ================= 属性牌三选一（需求 4） ================= */

test('core：分数跨过 CARD.INTERVAL → 弹出三张属性牌并暂停对局', () => {
  const core = new GameCore({ rng: mulberry32(7) });
  assert.strictEqual(core.pendingCards, null, '开局不应有待选牌');
  core.score = CARD.INTERVAL - 1;
  core._syncCards();
  assert.strictEqual(core.pendingCards, null);
  core.score = CARD.INTERVAL;
  core._syncCards();
  assert.ok(core.pendingCards, '跨过分数线应待发牌');
  assert.strictEqual(core.pendingCards.length, CARD.CHOICES, '默认三选一');
  assert.strictEqual(core.canControl(), false, '待选牌时不可操作');
  const frozen = core.current;
  core.update(core.fallInterval() * 10);
  assert.strictEqual(core.current, frozen, '待选牌时对局时间不推进');
  assert.ok(core.drainEvents().some((e) => e.type === 'cards'));
});

test('core：选牌立即生效并写进后续技能方块；跳过则不生效', () => {
  const core = new GameCore({ rng: constRng(0.1) });
  core.pendingCards = [{ id: 'bullet_pierce', tag: 'turret', name: '穿甲弹头', desc: '' }];
  core.level = SKILL.START_LEVEL;
  assert.strictEqual(core.pickCard('bullet_pierce').id, 'bullet_pierce');
  assert.strictEqual(core.mods.pierce, 1, '属性牌应写入本局构筑');
  assert.strictEqual(core.pendingCards, null);
  assert.strictEqual(core.canControl(), true, '选完牌恢复操作');
  assert.deepStrictEqual(core.cardPicks, ['bullet_pierce']);
  core.rng = constRng(0.1);
  const sk = core._rollSkill('I');
  if (sk) assert.strictEqual(sk.mods.pierce, 1, '后续技能方块带上该属性');

  const c2 = new GameCore({ rng: constRng(0.1) });
  c2.pendingCards = [{ id: 'bullet_pierce' }];
  assert.strictEqual(c2.skipCards(), true);
  assert.strictEqual(c2.pendingCards, null);
  assert.strictEqual(c2.mods.pierce, 0, '跳过不生效');
  assert.strictEqual(c2.pickCard('bullet_pierce'), null, '跳过后再选无效');
});

test('skills：属性牌数值叠加、满级后不再出现；共鸣维度叠加、消失方式互相替换', () => {
  const mods = Skills.defaultMods();
  for (let i = 0; i < 10; i++) Skills.applyCard(mods, 'bullet_pierce');
  assert.strictEqual(mods.pierce, Skills.cardById('bullet_pierce').max, '穿透有上限');
  for (let i = 0; i < 10; i++) Skills.applyCard(mods, 'turret_bullets');
  assert.strictEqual(mods.bullets, 4);
  const offer = Skills.offerCards(Math.random, mods, 30).map((c) => c.id);
  assert.ok(offer.indexOf('bullet_pierce') < 0, '满级的牌不再出现在牌池');
  assert.ok(offer.indexOf('turret_bullets') < 0);
  assert.ok(offer.indexOf('reso_bomb') >= 0, '未装备的牌仍在池子里');

  Skills.applyCard(mods, 'reso_row');
  Skills.applyCard(mods, 'reso_row');
  assert.deepStrictEqual(mods.scope, ['color', 'row'], '同层维度只叠加一次');
  Skills.applyCard(mods, 'reso_bomb');
  assert.strictEqual(mods.pattern, 'bomb');
  Skills.applyCard(mods, 'reso_cross');
  assert.strictEqual(mods.pattern, 'cross', '消失方式为替换关系');
  assert.strictEqual(Skills.offerCards(Math.random, mods, 30).map((c) => c.id).indexOf('reso_cross'), -1);
  assert.ok(Skills.offerCards(Math.random, mods, 30).length >= 1, '牌池不会见底到 0');
});

test('core：技能击落的分数同样推动过关与属性牌节奏', () => {
  const core = new GameCore({ rng: constRng(0.1) });
  core.phase = 'fall';
  core.board.lock([{ x: 8, y: 12 }], 'J');
  core.score = CARD.INTERVAL - SKILL_BASE; // 一发子弹的分数刚好跨过属性牌线
  core.current = {
    type: 'O', matrix: SHAPES.O, dir: 0, x: 8, y: 18,
    skill: { kind: 'turret', mx: 0, my: 0, mods: Skills.defaultMods() },
  };
  core.hardDrop();
  assert.strictEqual(core.score, CARD.INTERVAL);
  assert.strictEqual(core.level, 2, '技能分数也应推动过关（合格分 500）');
  assert.strictEqual(core.board.allCells().length, 0, '过关清场');
  assert.ok(core.pendingCards, '跨过属性牌线应待发牌');
  assert.strictEqual(core.pendingCards.length, CARD.CHOICES);
  assert.strictEqual(core.cardTarget, CARD.INTERVAL * 2);
});

/* ================= 集成不变量 ================= */

test('core：长时间自动对局（升关清场 + 技能 + 属性牌）不变量成立', () => {
  const core = new GameCore({ rng: mulberry32(20250926) });
  core.level = SKILL.START_LEVEL; // 直接从第 2 关参数开始，覆盖技能与属性牌路径
  core.score = 0;
  core.cardTarget = CARD.INTERVAL;
  const seen = new Set();
  let guard = 0;
  let revives = 0;
  let prevScore = 0;
  let prevLevel = 1;
  while (guard++ < 4000) {
    if (core.gameOver) { core.revive(); revives++; continue; } // 堵死就重开，继续压后面所有路径
    if (core.pendingCards) {
      core.pickCard(core.pendingCards[Math.floor(core.rng() * core.pendingCards.length) % core.pendingCards.length].id);
      continue;
    }
    const r = core.rng();
    if (r < 0.2) core.rotate();
    else if (r < 0.4) core.movePerp(r < 0.3 ? -1 : 1);
    else core.hardDrop();
    core.update(core.fallInterval() * 2);
    for (const ev of core.drainEvents()) {
      seen.add(ev.type);
      if (ev.type === 'clear' || ev.type === 'turret' || ev.type === 'resonance') {
        assert.ok(ev.count === undefined || ev.count >= 0);
      }
      if (ev.type === 'levelup') assert.ok(Array.isArray(ev.cells), 'levelup 应带清场快照');
    }
    // 不变量 1：技能网格与方格网格严格同步
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (core.board.skills[y][x] && !core.board.grid[y][x]) {
          throw new Error('技能格与方格不同步 @' + x + ',' + y);
        }
      }
    }
    // 不变量 2：分数与关卡单调不减
    assert.ok(core.score >= prevScore, '分数不应减少');
    assert.ok(core.level >= prevLevel, '关卡不应回退');
    prevScore = core.score;
    prevLevel = core.level;
  }
  assert.ok(revives > 0, '随机走法应至少堵死过一次');
  assert.ok(seen.has('levelup'), '应触发过关清场');
  assert.ok(seen.has('cards'), '应触发属性牌三选一');
  assert.ok(seen.has('turret') || seen.has('resonance'), '应至少释放过一次技能');
  assert.ok(core.level >= 3, '累积分数应连过数关, 实际=' + core.level);
  assert.ok(core.cardPicks.length > 0 && core.mods !== Skills.defaultMods(), '属性牌应已生效');
});

test('config：各关合格分表递增，表外按公式外推', () => {
  assert.strictEqual(levelTarget(1), LEVEL_TARGETS[0]);
  assert.strictEqual(levelTarget(2), LEVEL_TARGETS[1]);
  for (let n = 2; n <= LEVEL_TARGETS.length; n++) {
    assert.ok(levelTarget(n) > levelTarget(n - 1), '合格分应逐关递增: 第' + n + '关');
  }
  // 超出表格的关卡：第 n 关净增 LEVEL_TARGET_STEP × n
  const L = LEVEL_TARGETS.length;
  assert.strictEqual(levelTarget(L + 1), LEVEL_TARGETS[L - 1] + LEVEL_TARGET_STEP * (L + 1));
  assert.ok(levelTarget(L + 2) > levelTarget(L + 1));
});

test('core：达到第 1 关合格分即升关，下落间隔缩短', () => {
  const core = new GameCore({ rng: constRng(0.1) });
  const iv1 = core.fallInterval();
  assert.strictEqual(iv1, FALL_BASE);
  core.phase = 'fall';
  const cells = [];
  for (let c = 0; c < COLS - 2; c++) cells.push({ x: c, y: ROWS - 1 });
  core.board.lock(cells, 'J');
  core.score = LEVEL_TARGETS[0] - 100; // 距第 1 关合格分差 100 分
  core.current = { type: 'O', matrix: SHAPES.O, dir: 0, x: COLS - 2, y: ROWS - 2 };
  core.hardDrop(); // 补满底行缺口 → 消 1 行 +100×1 → 达到合格分
  assert.strictEqual(core.level, 2, '达到合格分应升到第 2 关');
  assert.strictEqual(core.fallInterval(), FALL_BASE - FALL_STEP);
  assert.strictEqual(core.hintTime(), HINT_BASE - HINT_STEP);
  const evs = core.drainEvents();
  assert.ok(evs.some((e) => e.type === 'levelup' && e.level === 2), '应推入 levelup 事件');
});

test('core：分数一次跨越多条合格线 → 连升多关', () => {
  const core = new GameCore({ rng: constRng(0.1) });
  core.score = LEVEL_TARGETS[2] - 1; // 距第 3 关合格分差 1 分
  core._syncLevel();
  assert.strictEqual(core.level, 3);
  const ups = core.drainEvents().filter((e) => e.type === 'levelup');
  assert.deepStrictEqual(ups.map((e) => e.level), [2, 3], '应连升两级并各推一个事件');
});

test('core：消除行数不再直接升关（升关只看合格分）', () => {
  const core = new GameCore({ rng: constRng(0.1) });
  core.lines = 100; // 旧规则（8 行/关）下早已连升，新规则不生效
  core.score = LEVEL_TARGETS[0] - 1;
  core._syncLevel();
  assert.strictEqual(core.level, 1);
});

test('core：自然下落软降分同样计入合格进度', () => {
  const core = new GameCore({ rng: constRng(0.1) }); // 重力向下
  core.score = LEVEL_TARGETS[0] - 2; // 差 2 分；软降每格 +1
  core.phase = 'fall';
  core.current = { type: 'O', matrix: SHAPES.O, dir: 0, x: 4, y: 0 };
  core.update(core.fallInterval() * 2); // 自然下落 2 格
  assert.strictEqual(core.level, 2, '软降分达到合格线也应升关');
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

/* ================= 复活（看广告/金币复活，见 platform.js） ================= */

test('core：revive 清空棋盘并保留分数/关卡，可继续游戏', () => {
  const core = new GameCore({ rng: constRng(0.1) });
  // 人为构造游戏结束：堵死中心出生点
  const cells = [];
  const c0 = Math.floor(ROWS / 2) - 2;
  for (let r = c0; r < c0 + 4; r++) for (let c = c0; c < c0 + 4; c++) cells.push({ x: c, y: r });
  core.board.lock(cells, 'Z');
  core.spawn();
  assert.strictEqual(core.gameOver, true);
  core.drainEvents();

  core.score = 1234; core.level = 3; core.lines = 20;
  assert.strictEqual(core.revive(), true, '复活应成功');
  assert.strictEqual(core.gameOver, false, '复活后不应处于结束态');
  assert.strictEqual(core.score, 1234, '分数应保留');
  assert.strictEqual(core.level, 3, '关卡应保留');
  assert.strictEqual(core.lines, 20, '行数应保留');
  // 棋盘已清空
  let filled = 0;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (core.board.grid[r][c]) filled++;
  assert.strictEqual(filled, 0, '复活后棋盘应清空');
  // 新方块已生成且可控制
  assert.ok(core.current, '复活后应生成新方块');
  assert.strictEqual(core.canControl(), true, '复活后应可操作');
  assert.strictEqual(core.drainEvents().length, 0, '复活后不应有残留事件');
});

test('core：revive 仅在结束态生效，且清空后可再次正常结束', () => {
  const core = new GameCore({ rng: constRng(0.1) });
  assert.strictEqual(core.revive(), false, '未结束时无效');
  // 构造结束 → 复活 → 再堵死中心 → 又能正常结束
  const cells = [];
  const c0 = Math.floor(ROWS / 2) - 2;
  for (let r = c0; r < c0 + 4; r++) for (let c = c0; c < c0 + 4; c++) cells.push({ x: c, y: r });
  core.board.lock(cells, 'Z');
  core.spawn();
  assert.strictEqual(core.gameOver, true);
  core.drainEvents();
  assert.strictEqual(core.revive(), true);
  core.board.lock(cells, 'Z');
  core.current = null;
  core.spawn();
  assert.strictEqual(core.gameOver, true, '复活后再次堵死应能结束');
  assert.ok(core.drainEvents().some((e) => e.type === 'gameover'));
});
