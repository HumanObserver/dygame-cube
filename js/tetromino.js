/**
 * 方块（Tetromino）定义与旋转，纯逻辑，可在 Node 中测试
 */

// 标准 7 种方块，使用正方形矩阵便于旋转
const SHAPES = {
  I: [
    [0, 0, 0, 0],
    [1, 1, 1, 1],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ],
  O: [
    [1, 1],
    [1, 1],
  ],
  T: [
    [0, 1, 0],
    [1, 1, 1],
    [0, 0, 0],
  ],
  S: [
    [0, 1, 1],
    [1, 1, 0],
    [0, 0, 0],
  ],
  Z: [
    [1, 1, 0],
    [0, 1, 1],
    [0, 0, 0],
  ],
  J: [
    [1, 0, 0],
    [1, 1, 1],
    [0, 0, 0],
  ],
  L: [
    [0, 0, 1],
    [1, 1, 1],
    [0, 0, 0],
  ],
};

/** 顺时针旋转一个正方形矩阵 */
function rotateCW(m) {
  const n = m.length;
  const out = [];
  for (let r = 0; r < n; r++) {
    out.push([]);
    for (let c = 0; c < n; c++) {
      out[r][c] = m[n - 1 - c][r];
    }
  }
  return out;
}

/** 提取矩阵中所有实体格子的局部坐标 [{x:列, y:行}] */
function cellsOf(m) {
  const cells = [];
  for (let r = 0; r < m.length; r++) {
    for (let c = 0; c < m[r].length; c++) {
      if (m[r][c]) cells.push({ x: c, y: r });
    }
  }
  return cells;
}

/** 复制矩阵 */
function cloneMatrix(m) {
  return m.map((row) => row.slice());
}

module.exports = { SHAPES, rotateCW, cellsOf, cloneMatrix };
