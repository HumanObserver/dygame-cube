/**
 * 自动游玩 bot（演示视频录制 / Node 离线仿真共用，UMD）
 *
 * 设计要点：
 * - 规划：枚举「旋转(含踢墙，与 gamecore.rotate 同 KICKS) × 垂直平移 × 沿重力落底」的全部
 *   可达落点；用游戏同款 Board（lock/clearLines/settle 链，与 gamecore._lock 一致）评估局面。
 * - 执行：全部动作在 hint 相位内按拟人节奏完成（节奏自适应 hintTimer，保证方块未自然下落，
 *   规划与执行严格一致）；进入 fall 相位后让方块可见地自然下落一小段，再 hardDrop。
 * - 确定性：core.rng 由外部注入种子随机流；bot 自己的节奏抖动使用独立种子流（botRng），
 *   相同 (gameSeed, botSeed) 下整局可复现（仿真选种 → 录制回放同内容）。
 * - 弧线控制：survive 模式打好局（消行/升关）；到达 finishAfterMs 或 maxLevel 后切 finish
 *   模式，向中心堆叠、封堵出生点，自然打出 game over（视频收尾）。
 *
 * 浏览器：AutoPlayer.attach({ game: window.__game, gameSeed, botSeed, hooks })
 * Node  ：AutoPlayer.createBot({ core, makeBoard, actRotate/actMove/actDrop, ... })
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AutoPlayer = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ===== 与 js/config.js、js/tetromino.js、js/gamecore.js 保持一致的常量（仿真测试校验一致性） ===== */
  var DIRS = [
    { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }, { x: 1, y: 0 },
  ];
  var PERP = [
    { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 0 }, { x: 0, y: 1 },
  ];
  var KICKS = [
    { x: 0, y: 0 }, { x: -1, y: 0 }, { x: 1, y: 0 },
    { x: 0, y: -1 }, { x: 0, y: 1 },
    { x: -2, y: 0 }, { x: 2, y: 0 }, { x: 0, y: -2 }, { x: 0, y: 2 },
  ];
  var SHAPES = {
    I: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
    O: [[1, 1], [1, 1]],
    T: [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
    S: [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
    Z: [[1, 1, 0], [0, 1, 1], [0, 0, 0]],
    J: [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
    L: [[0, 0, 1], [1, 1, 1], [0, 0, 0]],
  };

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function rotateCW(m) {
    var n = m.length, out = [], r, c;
    for (r = 0; r < n; r++) {
      out.push([]);
      for (c = 0; c < n; c++) out[r][c] = m[n - 1 - c][r];
    }
    return out;
  }

  function cellsOf(m) {
    var cells = [], r, c;
    for (r = 0; r < m.length; r++) {
      for (c = 0; c < m[r].length; c++) {
        if (m[r][c]) cells.push({ x: c, y: r });
      }
    }
    return cells;
  }

  /* ===== 纯函数规划器 ===== */

  function absCells(matrix, px, py) {
    var local = cellsOf(matrix), out = [], i;
    for (i = 0; i < local.length; i++) out.push({ x: local[i].x + px, y: local[i].y + py });
    return out;
  }

  function gridCollides(grid, cols, rows, cells) {
    for (var i = 0; i < cells.length; i++) {
      var c = cells[i];
      if (c.x < 0 || c.x >= cols || c.y < 0 || c.y >= rows) return true;
      if (grid[c.y][c.x]) return true;
    }
    return false;
  }

  function cloneGrid(grid) {
    return grid.map(function (r) { return r.slice(); });
  }

  /** next 型方块能否在中心出生（gamecore.spawn 的碰撞判定，SHAPES 同源） */
  function canSpawn(grid, cols, rows, type) {
    var m = SHAPES[type];
    if (!m) return true;
    var x0 = Math.floor((cols - m.length) / 2);
    var y0 = Math.floor((rows - m.length) / 2);
    return !gridCollides(grid, cols, rows, absCells(m, x0, y0));
  }

  /**
   * 枚举当前方块的全部可达落点（旋转→平移→落底），去重后评估，返回最优计划。
   * @param board 游戏同款 Board 实例（用其 collides/lock/clearLines/settle 保证规则一致）
   * @param piece {type, matrix, dir, x, y}（当前实时状态，hint 相位 = 出生位）
   * @param nextType core.next.type
   * @param mode 'survive' | 'finish'
   * @return {rotates, sign, moves, finalCells, clears, score}
   */
  function planPlacement(board, piece, nextType, mode) {
    var cols = board.cols, rows = board.rows;
    var grid0 = board.grid;
    var d = DIRS[piece.dir];
    var p = PERP[piece.dir];

    /* --- 旋转态枚举（复刻 gamecore.rotate 的踢墙顺序；失败即停，与执行一致） --- */
    var rotStates = [{ matrix: piece.matrix, x: piece.x, y: piece.y, rotates: 0 }];
    var m = piece.matrix, x = piece.x, y = piece.y;
    for (var r = 1; r <= 3; r++) {
      if (piece.type === 'O') break; // O 旋转无意义（gamecore.rotate 直接返回 true 不变形）
      var nm = rotateCW(m);
      var placed = null;
      for (var k = 0; k < KICKS.length; k++) {
        var cx = x + KICKS[k].x, cy = y + KICKS[k].y;
        if (!gridCollides(grid0, cols, rows, absCells(nm, cx, cy))) { placed = { x: cx, y: cy }; break; }
      }
      if (!placed) break; // 后续旋转从同一状态出发同样失败（与连续调用 core.rotate 行为一致）
      m = nm; x = placed.x; y = placed.y;
      rotStates.push({ matrix: m, x: x, y: y, rotates: r });
    }

    /* --- 平移 + 落底 → 候选（按最终落点去重） --- */
    var seen = {};
    var best = null;
    for (var si = 0; si < rotStates.length; si++) {
      var st = rotStates[si];
      var dirsToTry = [{ sign: 0, max: 0 }];
      if (si >= 0) { // sign=-1 与 +1
        dirsToTry.push({ sign: -1, max: cols + rows });
        dirsToTry.push({ sign: 1, max: cols + rows });
      }
      for (var di = 0; di < dirsToTry.length; di++) {
        var dt = dirsToTry[di];
        var px = st.x, py = st.y;
        var moves = 0;
        for (;;) {
          /* 落底（沿重力推进到碰撞前） */
          var gx = px, gy = py;
          for (;;) {
            if (gridCollides(grid0, cols, rows, absCells(st.matrix, gx + d.x, gy + d.y))) break;
            gx += d.x; gy += d.y;
          }
          var finalCells = absCells(st.matrix, gx, gy);
          var key = st.rotates + '|' + finalCells.map(function (c) { return c.x + ',' + c.y; }).join(';');
          if (!seen[key]) {
            seen[key] = true;
            var ev = evalPlacement(grid0, cols, rows, finalCells, piece.type, piece.dir, nextType, mode);
            var cand = {
              rotates: st.rotates,
              sign: dt.sign,
              moves: moves,
              finalCells: finalCells,
              clears: ev.clears,
              score: ev.score,
            };
            /* 确定性择优：分数高者胜；平分时旋转少、平移少、先枚举方向(-1 优先于 +1) */
            if (!best || cand.score > best.score) best = cand;
          }
          if (dt.max === 0) break;
          /* 垂直平移一步（复刻 core.movePerp：碰撞即停） */
          var nx = px + p.x * dt.sign, ny = py + p.y * dt.sign;
          if (gridCollides(grid0, cols, rows, absCells(st.matrix, nx, ny))) break;
          px = nx; py = ny; moves++;
          if (moves >= dt.max) break;
        }
      }
    }
    return best;
  }

  /* ===== 评估权重（可外部调参；simulate.cjs 扫参用） ===== */
  var WEIGHTS = {
    clear: 1200,        // 每消除 1 行/列
    clearMulti: [0, 0, 600, 900, 1200], // 2/3/4 连消额外加分
    wallDist: 5,        // 每格到重力墙距离罚分（贴墙平铺）
    adjacent: 2,        // 与已有格相邻
    wallLine: 150,      // 贴墙线（第0/19行、第0/19列）完成进度 p²×此值
    floorFunnel: 60,    // 底行进度引导：落在底行的格 × floorP × 此值
    innerLine: 40,      // 内部行列 p³×此值
    center4: 140,       // 中心 4×4 出生区每格罚分
    center8: 16,        // 中心 8×8 外圈每格罚分
    deadHoleFloor: 90,  // 底行死洞（战略线，最重）
    deadHoleCeil: 60,   // 顶行死洞
    deadHoleCol: 40,    // 侧列死洞（可被下落块回填，较轻）
    newBlockCol: 170,   // R1：亲手堵死一个「干净的」底行缺口列（每列）
    deadBlockCol: 25,   // R1：往已死列继续堆（每列，引导集中）
    corridor: 22,       // R2：占用中央十字走廊的每格罚分
  };

  /** 局面评估：复刻 gamecore._lock 的「锁定→消除→沉降→连锁」后打分 */
  function evalPlacement(grid0, cols, rows, finalCells, type, pieceDir, nextType, mode) {
    var grid = cloneGrid(grid0);
    var i, c;
    for (i = 0; i < finalCells.length; i++) {
      c = finalCells[i];
      if (c.x >= 0 && c.x < cols && c.y >= 0 && c.y < rows) grid[c.y][c.x] = type;
    }
    /* 消除 + 半侧沉降链（与 board.clearLines/settle 同规则；此处直接实现避免 Board 依赖差异） */
    var first = clearFull(grid, cols, rows);
    var count = first.count;
    var rowLines = first.rows, colLines = first.cols;
    while (count > 0) {
      settleHalf(grid, cols, rows, rowLines, colLines);
      var nx = clearFull(grid, cols, rows);
      if (nx.count === 0) break;
      count += nx.count;
      rowLines = rowLines.concat(nx.rows);
      colLines = colLines.concat(nx.cols);
    }

    var score = 0;
    var x, y;
    if (mode === 'finish') {
      if (nextType && !canSpawn(grid, cols, rows, nextType)) score += 1e7; // 直接封死出生点 → 结束
      score -= count * 800; // 消行会延缓结束
      for (i = 0; i < finalCells.length; i++) {
        c = finalCells[i];
        var dd = Math.max(Math.abs(c.x - (cols - 1) / 2), Math.abs(c.y - (rows - 1) / 2));
        score += Math.max(0, 7 - dd) * 90; // 越靠中心越好
      }
      return { score: score, clears: count };
    }

    /* ---- survive 模式 ----
     * 生存要诀（本游戏四向重力特性）：
     *  1) 贴自己的重力墙平铺（堆叠越平容量越大，中心保持空旷）
     *  2) 凑满贴墙的行/列（第 0/19 行、第 0/19 列）：一旦消除，settle 沉降会
     *     把所有悬空堆拽到地面并连锁消除多行 → 大量得分 + 棋盘大清洗
     *  3) 绝不堵中心出生区，保证下一块能出生
     */
    if (nextType && !canSpawn(grid, cols, rows, nextType)) score -= 1e6;
    var W = WEIGHTS;
    score += count * W.clear;
    if (count >= 2) score += W.clearMulti[Math.min(count, 4)];
    if (count >= 5) score += (count - 4) * 300;

    var dir = pieceDir; // 当前方块重力方向（贴墙平铺罚分用）
    var wd = DIRS[dir];

    /* 底行进度（沉降方向 = 下，底行是全局战略线：3/4 的重力族都能喂它，
     * 且每次消除后的 settle 都会让底行重生，最易触发连锁） */
    var floorN = 0;
    for (var fx = 0; fx < cols; fx++) if (grid[rows - 1][fx]) floorN++;
    var floorP = floorN / cols;

    /* 落点贴墙平铺：每格到重力墙的距离罚分（越平越好） */
    for (i = 0; i < finalCells.length; i++) {
      c = finalCells[i];
      var distWall;
      if (wd.y === 1) distWall = (rows - 1) - c.y;       // 下
      else if (wd.y === -1) distWall = c.y;              // 上
      else if (wd.x === -1) distWall = c.x;              // 左
      else distWall = (cols - 1) - c.x;                  // 右
      score -= distWall * W.wallDist;
      /* 底行引导：任何方块把格子送到底行都重赏（随底行进度递增） */
      if (c.y === rows - 1) score += floorP * W.floorFunnel + 8;
      /* 紧致：与已有格相邻小加分 */
      var nb = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (var j = 0; j < 4; j++) {
        var ax = c.x + nb[j][0], ay = c.y + nb[j][1];
        if (ax < 0 || ax >= cols || ay < 0 || ay >= rows) continue;
        if (grid[ay][ax]) score += W.adjacent;
      }
    }

    /* 行/列完成进度：贴墙四条线重点凑（p² 强梯度），内部线弱梯度；
     * 差 1~2 格完成的线额外重赏（引导补口） */
    var lineN = [];
    for (y = 0; y < rows; y++) {
      var n = 0;
      for (x = 0; x < cols; x++) if (grid[y][x]) n++;
      lineN.push({ row: y, n: n });
      if (n === cols - 1) score += 220;
      else if (n === cols - 2) score += 50;
    }
    var colN = [];
    for (x = 0; x < cols; x++) {
      var n2 = 0;
      for (y = 0; y < rows; y++) if (grid[y][x]) n2++;
      colN.push({ col: x, n: n2 });
      if (n2 === rows - 1) score += 220;
      else if (n2 === rows - 2) score += 50;
    }
    for (i = 0; i < lineN.length; i++) {
      var p = lineN[i].n / cols;
      if (lineN[i].n >= cols) continue; // 满行已在消除链中计过分
      var isWall = (lineN[i].row === 0 || lineN[i].row === rows - 1);
      score += (isWall ? p * p * W.wallLine : p * p * p * W.innerLine);
    }
    for (i = 0; i < colN.length; i++) {
      var p2 = colN[i].n / rows;
      if (colN[i].n >= rows) continue;
      var isWallC = (colN[i].col === 0 || colN[i].col === cols - 1);
      score += (isWallC ? p2 * p2 * W.wallLine : p2 * p2 * p2 * W.innerLine);
    }

    /* 规则 R1「底行缺口列保护」：
     * 落子后，格子所在列的底行格仍为空 → 该列底行缺口被堵死（下落块到不了）。
     * - 把「原本干净」的缺口列堵死 → 每列重罚（悬挂块/中层块从开局就避开活缺口列，
     *   迫使上重力块集中堆到最少的列里，牺牲最少的底行格）
     * - 往「已死」列上继续堆 → 轻罚（引导集中，不再扩散）
     * 底行差 1~2 格时仍由 down 块长驱直入补口 → 消除 + 沉降连锁。 */
    var newBlocked = {};
    for (i = 0; i < finalCells.length; i++) {
      c = finalCells[i];
      if (c.y >= rows - 1) continue;
      if (grid[rows - 1][c.x]) continue; // 底行格已被（本次或先前）填上 → 安全
      if (newBlocked[c.x]) continue;
      newBlocked[c.x] = true;
      var wasClean = true;
      for (y = 0; y < rows - 1; y++) {
        if (grid0[y][c.x]) { wasClean = false; break; }
      }
      score -= wasClean ? W.newBlockCol : W.deadBlockCol;
    }

    /* 规则 R2「中央十字走廊保持畅通」：下/上块沿出生行(y≈8..11)横移，
     * 左/右块沿出生列(x≈8..11)纵移；走廊被堵则够不到目标落点。 */
    for (i = 0; i < finalCells.length; i++) {
      c = finalCells[i];
      var inRowBand = (c.y >= 8 && c.y <= 11);
      var inColBand = (c.x >= 8 && c.x <= 11);
      if (inRowBand || inColBand) score -= W.corridor;
    }

    /* 死洞惩罚：贴墙线的空格若被其「喂养方向」挡住，则永远无法回填 → 重罚。
     * 底行空格：上方 (y=18) 有实体 → 下落块到不了（左右块也大概率被挡）
     * 顶行空格：下方 (y=1) 有实体 → 上升块到不了
     * 左列空格：右侧 (x=1) 有实体 → 左滑块到不了
     * 右列空格：左侧 (x=18) 有实体 → 右滑块到不了 */
    for (x = 0; x < cols; x++) {
      if (!grid[rows - 1][x] && grid[rows - 2][x]) score -= W.deadHoleFloor;
      if (!grid[0][x] && grid[1][x]) score -= W.deadHoleCeil;
    }
    for (y = 0; y < rows; y++) {
      if (!grid[y][0] && grid[y][1]) score -= W.deadHoleCol;
      if (!grid[y][cols - 1] && grid[y][cols - 2]) score -= W.deadHoleCol;
    }

    /* 中心安全：出生区(中央4×4)重罚，外圈轻罚 */
    for (y = 0; y < rows; y++) {
      for (x = 0; x < cols; x++) {
        if (!grid[y][x]) continue;
        var d = Math.max(Math.abs(x - (cols - 1) / 2), Math.abs(y - (rows - 1) / 2));
        if (d <= 2) score -= W.center4;
        else if (d <= 4) score -= W.center8;
      }
    }
    return { score: score, clears: count };
  }

  function clearFull(grid, cols, rows) {
    var r, c, count = 0;
    var rowsToClear = [], colsToClear = [];
    for (r = 0; r < rows; r++) {
      var full = true;
      for (c = 0; c < cols; c++) if (!grid[r][c]) { full = false; break; }
      if (full) rowsToClear.push(r);
    }
    for (c = 0; c < cols; c++) {
      var full2 = true;
      for (r = 0; r < rows; r++) if (!grid[r][c]) { full2 = false; break; }
      if (full2) colsToClear.push(c);
    }
    for (var i = 0; i < rowsToClear.length; i++) {
      r = rowsToClear[i];
      for (c = 0; c < cols; c++) grid[r][c] = null;
    }
    for (var j = 0; j < colsToClear.length; j++) {
      c = colsToClear[j];
      for (r = 0; r < rows; r++) grid[r][c] = null;
    }
    count = rowsToClear.length + colsToClear.length;
    return { count: count, rows: rowsToClear, cols: colsToClear };
  }

  /* ===== 半侧沉降仿真（与 js/board.js settle + js/config.js SETTLE 同规则） ===== */
  var SETTLE = { ROW_SIDE: 'above', COL_SIDE: 'left' };

  function normLines(lines, n) {
    var out = [], seen = {};
    for (var i = 0; i < lines.length; i++) {
      var v = lines[i];
      if (v >= 0 && v < n && !seen[v]) { seen[v] = 1; out.push(v); }
    }
    out.sort(function (a, b) { return a - b; });
    return out;
  }

  function compactDown(grid, cols, top, bottom) {
    if (bottom < top) return;
    for (var x = 0; x < cols; x++) {
      var write = bottom;
      for (var y = bottom; y >= top; y--) {
        var v = grid[y][x];
        if (!v) continue;
        if (write !== y) { grid[write][x] = v; grid[y][x] = null; }
        write--;
      }
    }
  }

  function compactRight(grid, rows, left, right) {
    if (right < left) return;
    for (var y = 0; y < rows; y++) {
      var write = right;
      for (var x = right; x >= left; x--) {
        var v = grid[y][x];
        if (!v) continue;
        if (write !== x) { grid[y][write] = v; grid[y][x] = null; }
        write--;
      }
    }
  }

  /** 只有贴近消除线的一侧朝消除线压实，另一半保持原位 */
  function settleHalf(grid, cols, rows, rowLines, colLines) {
    var lines = normLines(rowLines || [], rows), i;
    if (SETTLE.ROW_SIDE === 'below') {
      for (i = 0; i < lines.length; i++) {
        var lo = lines[i], hi = i + 1 < lines.length ? lines[i + 1] - 1 : rows - 1;
        compactUp(grid, cols, lo, hi);
      }
    } else {
      var top = 0;
      for (i = 0; i < lines.length; i++) { compactDown(grid, cols, top, lines[i]); top = lines[i] + 1; }
    }
    var clines = normLines(colLines || [], cols);
    if (SETTLE.COL_SIDE === 'right') {
      for (i = 0; i < clines.length; i++) {
        var clo = clines[i], chi = i + 1 < clines.length ? clines[i + 1] - 1 : cols - 1;
        compactLeft(grid, rows, clo, chi);
      }
    } else {
      var left = 0;
      for (i = 0; i < clines.length; i++) { compactRight(grid, rows, left, clines[i]); left = clines[i] + 1; }
    }
  }

  function compactUp(grid, cols, top, bottom) {
    if (bottom < top) return;
    for (var x = 0; x < cols; x++) {
      var write = top;
      for (var y = top; y <= bottom; y++) {
        var v = grid[y][x];
        if (!v) continue;
        if (write !== y) { grid[write][x] = v; grid[y][x] = null; }
        write++;
      }
    }
  }

  function compactLeft(grid, rows, left, right) {
    if (right < left) return;
    for (var y = 0; y < rows; y++) {
      var write = left;
      for (var x = left; x <= right; x++) {
        var v = grid[y][x];
        if (!v) continue;
        if (write !== x) { grid[y][write] = v; grid[y][x] = null; }
        write++;
      }
    }
  }

  /* ===== bot 驱动（浏览器 / Node 仿真共用） ===== */

  /**
   * @param opts {
   *   core,                       // GameCore 实例
   *   actRotate(), actMove(sign), actDrop(),   // 动作执行（浏览器走 onButton，仿真直调 core）
   *   botRng,                     // 节奏抖动随机流（独立于 core.rng）
   *   finishAfterMs = 52000,      // 开局后多久切 finish 模式
   *   maxLevel = 99,              // 达到该关卡立即切 finish
   *   hooks: { onPiece, onPlan, onAct, onDrop, onClear, onLevelUp, onGameOver, onMode }
   * }
   */
  function createBot(opts) {
    var core = opts.core;
    var rng = opts.botRng || mulberry32(1);
    var hooks = opts.hooks || {};
    var finishAfterMs = opts.finishAfterMs === undefined ? 52000 : opts.finishAfterMs;
    var maxLevel = opts.maxLevel === undefined ? 99 : opts.maxLevel;

    var bot = {
      mode: 'survive',
      playStart: null,      // 开局时间戳（第一次 tick 时设定）
      pieceRef: null,       // 当前处理的方块引用
      phase: 'idle',        // idle | think | act | fall | over
      plan: null,
      queue: [],            // 待执行动作 [{kind:'rotate'|'move', sign}]
      nextActAt: 0,
      actInterval: 60,
      fallStart: 0,
      dropDelay: 800,
      stats: { pieces: 0, plannedClears: 0, mismatches: 0 },
    };

    var prevLines = 0, prevLevel = 1;

    function startPlay(now) {
      bot.playStart = now;
      prevLines = core.lines;
      prevLevel = core.level;
    }

    function beginPiece(now) {
      bot.pieceRef = core.current;
      bot.stats.pieces++;
      var newMode = ((now - bot.playStart) >= finishAfterMs || core.level >= maxLevel) ? 'finish' : 'survive';
      if (newMode !== bot.mode) {
        bot.mode = newMode;
        if (hooks.onMode) hooks.onMode(bot.mode);
      }
      var nextType = core.next ? core.next.type : null;
      bot.plan = planPlacement(core.board, core.current, nextType, bot.mode);
      if (!bot.plan) { bot.phase = 'fall'; return; } // 无处可动（理论上不会）→ 等自然锁定
      if (hooks.onPlan) hooks.onPlan(bot.plan, core.current);
      /* 动作队列：旋转 → 平移 */
      bot.queue = [];
      for (var i = 0; i < bot.plan.rotates; i++) bot.queue.push({ kind: 'rotate' });
      for (var j = 0; j < bot.plan.moves; j++) bot.queue.push({ kind: 'move', sign: bot.plan.sign });
      bot.phase = 'think';
      bot.nextActAt = now + 100 + rng() * 140; // 看一眼提示再动手
      /* 动作间隔：在 hint 剩余时间的 85% 内均匀完成（保证方块未开始自然下落） */
      var budget = Math.max(120, core.hintTimer * 0.85 - (bot.nextActAt - now));
      bot.actInterval = Math.min(75, Math.max(26, budget / Math.max(1, bot.queue.length)));
      bot.dropDelay = 650 + rng() * 550; // fall 相位自然下落一段时间再硬降（露出下落动画）
    }

    bot.tick = function (now) {
      if (bot.phase === 'over') return;
      if (bot.playStart === null) startPlay(now);

      /* 事件侦测（浏览器与仿真一致：轮询增量） */
      if (core.lines > prevLines) {
        var dn = core.lines - prevLines; prevLines = core.lines;
        if (hooks.onClear) hooks.onClear(dn, core);
      }
      if (core.level > prevLevel) {
        var lv = core.level; prevLevel = lv;
        if (hooks.onLevelUp) hooks.onLevelUp(lv, core);
      }
      if (core.gameOver) {
        bot.phase = 'over';
        if (hooks.onGameOver) hooks.onGameOver(core);
        return;
      }

      /* 新方块检测：spawn 是进入 'hint' 相位的唯一入口。
       * 注意 movePerp/rotate/_stepGravity 都会替换 current 对象引用，
       * 不能用引用比较判断新块，必须用 tick 开始时采样的相位跳变：
       *   上一 tick 起点相位 ≠ 'hint' 且本 tick 起点相位 = 'hint' → 新方块。
       * （actDrop 在同一 tick 内同步 lock→spawn，本 tick 起点相位仍是 'fall'，
       *   下一 tick 起点看到 'hint'，跳变成立，不会漏检。） */
      var phaseAtStart = core.phase;
      if (phaseAtStart === 'hint' && bot.lastPhase !== 'hint' && core.current && core.canControl()) {
        bot.pieceRef = core.current;
        beginPiece(now);
        if (hooks.onPiece) hooks.onPiece(core.current, bot.stats.pieces);
      }
      bot.lastPhase = phaseAtStart;

      if (!core.current || !core.canControl()) return;

      if (bot.phase === 'think') {
        if (now >= bot.nextActAt) { bot.phase = 'act'; }
        else return;
      }
      if (bot.phase === 'act') {
        if (now < bot.nextActAt) return;
        var a = bot.queue.shift();
        if (a) {
          if (a.kind === 'rotate') opts.actRotate();
          else opts.actMove(a.sign);
          if (hooks.onAct) hooks.onAct(a);
          bot.nextActAt = now + bot.actInterval + rng() * 16;
          /* 安全阀：hint 已结束（方块开始自然下落）或 hint 将尽 → 剩余动作快速完成 */
          if (core.phase === 'fall' || core.hintTimer < (bot.queue.length + 1) * 30) {
            bot.nextActAt = now + 12;
          }
        } else {
          bot.phase = 'fall';
          bot.fallStart = 0;
        }
        return;
      }
      if (bot.phase === 'fall') {
        if (core.phase === 'hint') return; // 等 hint 结束、方块开始可见下落
        if (!bot.fallStart) { bot.fallStart = now; return; }
        var dist = ghostDistance(core);
        if ((now - bot.fallStart) >= bot.dropDelay || dist <= 1) {
          opts.actDrop();
          if (hooks.onDrop) hooks.onDrop(bot.plan);
          bot.phase = 'idle'; // 等下一个方块（lock→spawn 同步完成）
        }
      }
    };

    return bot;
  }

  /** 当前方块到幽灵落点的格距 */
  function ghostDistance(core) {
    if (!core.current || typeof core.ghostCells !== 'function') return 99;
    var g = core.ghostCells();
    if (!g.length) return 0;
    var cur = core.cells(core.current);
    /* 同形状格序一致：取第一格差值的切比雪夫距离（沿重力直线） */
    return Math.max(Math.abs(g[0].x - cur[0].x), Math.abs(g[0].y - cur[0].y));
  }

  /* ===== 浏览器接入 ===== */

  /**
   * @param o { game: window.__game, gameSeed, botSeed, finishAfterMs, maxLevel, hooks, skipRng }
   *   skipRng=true：调用方已自行注入 core.rng（录制页需在 start 前注入以对齐仿真序列）
   */
  function attach(o) {
    var G = o.game;
    var core = G.core;
    if (!o.skipRng) core.rng = mulberry32(o.gameSeed >>> 0);
    var bot = createBot({
      core: core,
      botRng: mulberry32((o.botSeed === undefined ? 777 : o.botSeed) >>> 0),
      finishAfterMs: o.finishAfterMs,
      maxLevel: o.maxLevel,
      hooks: o.hooks,
      actRotate: function () { G.onButton('rotate'); },
      actMove: function (sign) { G.onButton(sign < 0 ? 'left' : 'right'); },
      actDrop: function () { G.onButton('drop'); },
    });
    var timer = setInterval(function () {
      if (G.state === 'playing') bot.tick(Date.now());
      else if (bot.phase !== 'over' && G.state === 'gameover') bot.tick(Date.now());
    }, 16);
    bot.stop = function () { clearInterval(timer); };
    return bot;
  }

  return {
    createBot: createBot,
    attach: attach,
    planPlacement: planPlacement,
    canSpawn: canSpawn,
    mulberry32: mulberry32,
    ghostDistance: ghostDistance,
    WEIGHTS: WEIGHTS,
    CONST: { DIRS: DIRS, PERP: PERP, KICKS: KICKS, SHAPES: SHAPES },
  };
});
