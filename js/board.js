/**
 * 棋盘（网格）逻辑，纯逻辑，可在 Node 中测试
 * grid[y][x] 为 null（空）或方块类型字母（已固定）
 */

class Board {
  constructor(cols, rows) {
    this.cols = cols;
    this.rows = rows;
    this.grid = [];
    this.reset();
  }

  reset() {
    this.grid = [];
    for (let r = 0; r < this.rows; r++) {
      this.grid.push(new Array(this.cols).fill(null));
    }
  }

  inside(x, y) {
    return x >= 0 && x < this.cols && y >= 0 && y < this.rows;
  }

  occupied(x, y) {
    return !!this.grid[y][x];
  }

  /** 一组绝对坐标是否与边界或已固定格子冲突 */
  collides(cells) {
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (!this.inside(c.x, c.y)) return true;
      if (this.grid[c.y][c.x]) return true;
    }
    return false;
  }

  /** 把一组绝对坐标固定到棋盘上 */
  lock(cells, type) {
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (this.inside(c.x, c.y)) this.grid[c.y][c.x] = type;
    }
  }

  fullRow(r) {
    for (let c = 0; c < this.cols; c++) {
      if (!this.grid[r][c]) return false;
    }
    return true;
  }

  fullCol(c) {
    for (let r = 0; r < this.rows; r++) {
      if (!this.grid[r][c]) return false;
    }
    return true;
  }

  /**
   * 消除所有被填满的行与列（四向重力下两个方向都可消除）
   * 返回 { rowCount, colCount, count, cells }，cells 为被消除格子（去重）
   */
  clearLines() {
    const rows = [];
    const cols = [];
    for (let r = 0; r < this.rows; r++) if (this.fullRow(r)) rows.push(r);
    for (let c = 0; c < this.cols; c++) if (this.fullCol(c)) cols.push(c);

    const seen = {};
    const cells = [];
    const add = (x, y) => {
      const key = x + ',' + y;
      if (!seen[key]) {
        seen[key] = true;
        cells.push({ x, y });
      }
    };
    rows.forEach((r) => {
      for (let c = 0; c < this.cols; c++) add(c, r);
    });
    cols.forEach((c) => {
      for (let r = 0; r < this.rows; r++) add(c, r);
    });
    cells.forEach((p) => {
      this.grid[p.y][p.x] = null;
    });

    return { rowCount: rows.length, colCount: cols.length, count: rows.length + cols.length, cells };
  }
}

module.exports = Board;
