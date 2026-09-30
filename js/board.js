/**
 * 棋盘（网格）逻辑，纯逻辑，可在 Node 中测试
 *
 * 两份平行网格（同一坐标一一对应）：
 *  - grid[y][x]   null（空）或方块类型字母（已固定）→ 颜色/类型判定用
 *  - skills[y][x] null 或 {kind, dir, mods}（技能格信息：炮台 / 共鸣 + 落地时的属性快照）
 *
 * 消除后的沉降是「半侧沉降」：以消除线为界，只有紧邻消除线的一侧压实过去，
 * 另一侧保持原位（见 config.SETTLE），不会再出现「整盘方块一起落底」。
 */
const { SETTLE } = require('./config.js');

class Board {
  constructor(cols, rows) {
    this.cols = cols;
    this.rows = rows;
    this.reset();
  }

  reset() {
    this.grid = [];
    this.skills = [];
    for (let r = 0; r < this.rows; r++) {
      this.grid.push(new Array(this.cols).fill(null));
      this.skills.push(new Array(this.cols).fill(null));
    }
  }

  inside(x, y) {
    return x >= 0 && x < this.cols && y >= 0 && y < this.rows;
  }

  occupied(x, y) {
    return !!this.grid[y][x];
  }

  typeAt(x, y) {
    return this.inside(x, y) ? this.grid[y][x] : null;
  }

  skillAt(x, y) {
    return this.inside(x, y) ? this.skills[y][x] : null;
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

  /** 把一组绝对坐标固定到棋盘上（默认不带技能；技能用 setSkill 单独标记） */
  lock(cells, type) {
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (this.inside(c.x, c.y)) {
        this.grid[c.y][c.x] = type;
        this.skills[c.y][c.x] = null;
      }
    }
  }

  /** 给某个已固定格子挂上技能信息 {kind, dir, mods} */
  setSkill(x, y, skill) {
    if (!this.inside(x, y)) return false;
    this.skills[y][x] = skill || null;
    return true;
  }

  /** 取走并清空一个格子，返回 {x, y, type, skill}（空格返回 null） */
  remove(x, y) {
    if (!this.inside(x, y)) return null;
    const type = this.grid[y][x];
    if (!type) return null;
    const skill = this.skills[y][x];
    this.grid[y][x] = null;
    this.skills[y][x] = null;
    return { x: x, y: y, type: type, skill: skill };
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

  /** 当前所有已固定格子 [{x, y, type, skill}] */
  allCells() {
    const out = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (this.grid[r][c]) out.push({ x: c, y: r, type: this.grid[r][c], skill: this.skills[r][c] });
      }
    }
    return out;
  }

  /**
   * 消除所有被填满的行与列（四向重力下两个方向都可消除）
   * 返回 { rowCount, colCount, count, cells, rows, cols }，
   * cells 为被消除格子（去重，含 type/skill 快照，供共鸣等级联效果使用）。
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
        cells.push({ x: x, y: y, type: this.grid[y][x], skill: this.skills[y][x] });
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
      this.skills[p.y][p.x] = null;
    });

    return { rowCount: rows.length, colCount: cols.length, count: rows.length + cols.length, cells, rows, cols };
  }

  /**
   * 消除后的「半侧沉降」：只有紧邻消除线的一侧朝消除线方向压实，另一半保持原位。
   *  - rowLines：被消除的行号数组；这些行段（自上一条消除行起）内的方块向下贴合消除线
   *  - colLines：被消除的列号数组；这些列段内的方块向右贴合消除线
   * 不传参数（兼容旧调用）＝ 整列向下压实落底。
   * 返回 { moved, moves }：moves 为 [{x, fromY, toY, type}]（竖向移动）或
   * [{y, fromX, toX, type}]（横向移动），仅含实际移动的格子。
   */
  settle(rowLines, colLines) {
    const moves = [];
    let moved = 0;

    if (rowLines === undefined && colLines === undefined) {
      // 兼容：全板向下压实（旧 settle 行为）
      return { moved: this._compactDown(0, this.rows - 1, moves), moves };
    }

    const rows = normLines(rowLines, this.rows);
    const cols = normLines(colLines, this.cols);

    if (SETTLE.ROW_SIDE === 'below') {
      // 变体：消除行「下方」的半侧向上贴合，上方保持
      for (let i = 0; i < rows.length; i++) {
        const lo = rows[i];
        const hi = i + 1 < rows.length ? rows[i + 1] - 1 : this.rows - 1;
        moved += this._compactUp(lo, hi, moves);
      }
    } else {
      let top = 0;
      for (let i = 0; i < rows.length; i++) {
        const bottom = rows[i];
        moved += this._compactDown(top, bottom, moves);
        top = bottom + 1;
      }
      // top..rows-1（消除行的另一半）保持不动
    }

    if (SETTLE.COL_SIDE === 'right') {
      for (let i = 0; i < cols.length; i++) {
        const lo = cols[i];
        const hi = i + 1 < cols.length ? cols[i + 1] - 1 : this.cols - 1;
        moved += this._compactLeft(lo, hi, moves);
      }
    } else {
      let left = 0;
      for (let i = 0; i < cols.length; i++) {
        const right = cols[i];
        moved += this._compactRight(left, right, moves);
        left = right + 1;
      }
      // left..cols-1（消除列的另一半）保持不动
    }

    return { moved, moves };
  }

  /* ---------- 区段压实（grid 与 skills 一起移动） ---------- */

  _compactDown(top, bottom, moves) {
    if (bottom < top) return 0;
    let moved = 0;
    for (let x = 0; x < this.cols; x++) {
      let write = bottom;
      for (let y = bottom; y >= top; y--) {
        const v = this.grid[y][x];
        if (!v) continue;
        if (write !== y) {
          this._move(x, y, x, write, moves);
          moved++;
        }
        write--;
      }
    }
    return moved;
  }

  _compactUp(top, bottom, moves) {
    // 变体用：区内向上压实（贴合 top）
    if (bottom < top) return 0;
    let moved = 0;
    for (let x = 0; x < this.cols; x++) {
      let write = top;
      for (let y = top; y <= bottom; y++) {
        const v = this.grid[y][x];
        if (!v) continue;
        if (write !== y) {
          this._move(x, y, x, write, moves);
          moved++;
        }
        write++;
      }
    }
    return moved;
  }

  _compactRight(left, right, moves) {
    if (right < left) return 0;
    let moved = 0;
    for (let y = 0; y < this.rows; y++) {
      let write = right;
      for (let x = right; x >= left; x--) {
        const v = this.grid[y][x];
        if (!v) continue;
        if (write !== x) {
          this._move(x, y, write, y, moves);
          moved++;
        }
        write--;
      }
    }
    return moved;
  }

  _compactLeft(left, right, moves) {
    // 变体用：区内向左压实（贴合 left）
    if (right < left) return 0;
    let moved = 0;
    for (let y = 0; y < this.rows; y++) {
      let write = left;
      for (let x = left; x <= right; x++) {
        const v = this.grid[y][x];
        if (!v) continue;
        if (write !== x) {
          this._move(x, y, write, y, moves);
          moved++;
        }
        write++;
      }
    }
    return moved;
  }

  _move(x, y, nx, ny, moves) {
    const v = this.grid[y][x];
    this.grid[ny][nx] = v;
    this.skills[ny][nx] = this.skills[y][x];
    this.grid[y][x] = null;
    this.skills[y][x] = null;
    if (moves) {
      if (x === nx) moves.push({ x: x, fromY: y, toY: ny, type: v });
      else moves.push({ y: y, fromX: x, toX: nx, type: v });
    }
  }
}

/** 归一化消除线列表：过滤越界/去重/升序 */
function normLines(lines, n) {
  if (!lines || !lines.length) return [];
  const seen = {};
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const v = lines[i] | 0;
    if (v < 0 || v >= n || seen[v]) continue;
    seen[v] = true;
    out.push(v);
  }
  out.sort((a, b) => a - b);
  return out;
}

module.exports = Board;
