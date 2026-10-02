/**
 * 自动演示脚本：按固定虚拟时间线自动游玩，配合无头浏览器
 * --virtual-time-budget=N --screenshot 截取各关键场景。
 * 仅在 demo.html 中加载，不影响 index.html 正常游玩与抖音真机环境。
 *
 * 时间线（虚拟毫秒）：
 *   300  开局            → 截图 1-menu(250) / 2-hint(950)
 *   1500 第 1 块硬降；1550 将第 2 块重力设为向下
 *   4200 第 2 块下落中    → 截图 3-fall(4200)
 *   4900 布置消行（底行留最后两列 + O 块）
 *   5000 硬降 → 消行      → 截图 4-clear(5150)
 *   5500 布置过关（分数压到合格线 -60 + 门槛补齐 + 次底行留最后两列 + O 块）
 *   5600 硬降 → 弹出「过关结算」面板 → 截图 5-levelup(5750)
 *   5900 点「进入第 2 关」→ 清场并铺第 2 关预置缺口
 *   6200 中心 4×4 堵死 → spawn 碰撞 → 游戏结束 → 截图 6-gameover(6500)
 *   6800 打开排行榜       → 截图 7-rank(7100)
 *   7400 关卡选择页       → 截图 8-levels(7600)
 *   8200 第 4 关强制天赋牌 → 截图 9-tutcard(8600)
 *   9100 第 1 关过关结算   → 截图 10-clearpanel(9700)
 */
(function () {
  var G = window.__game;
  if (!G) return;

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  G.core.rng = mulberry32(42); // 确定性随机流

  var O_MATRIX = [[1, 1], [1, 1]];
  function cloneO() { return O_MATRIX.map(function (r) { return r.slice(); }); }
  function at(ms, fn) { setTimeout(fn, ms); }

  at(300, function () { G.onButton('start'); });

  at(1500, function () { G.core.hardDrop(); });
  at(1550, function () { if (G.core.current) G.core.current.dir = 0; }); // 演示用：重力向下
  at(4600, function () { G.core.hardDrop(); });

  /* 消行演示 */
  at(4900, function () {
    var core = G.core, g = core.board.grid, r, c;
    var R = g.length, C = g[0].length;
    for (r = 0; r < R; r++) { g[r][C - 2] = null; g[r][C - 1] = null; } // 清空 O 下落通道
    var pre = [];
    for (c = 0; c < C - 2; c++) if (!g[R - 1][c]) pre.push({ x: c, y: R - 1 });
    if (pre.length) core.board.lock(pre, 'J');
    core.current = { type: 'O', matrix: cloneO(), dir: 0, x: C - 2, y: R - 6 };
    core.phase = 'fall'; core.fallTimer = 0;
  });
  at(5000, function () { G.core.hardDrop(); });

  /* 过关结算演示：把分数压到第 1 关合格线附近 + 补齐门槛，再消 1 行触发「过关结算」面板 */
  at(5500, function () {
    var core = G.core, g = core.board.grid, c;
    var R = g.length, C = g[0].length;
    core.score = Math.max(0, core.levelTarget(core.level) - 60); // 距合格分差 60，消行 +100 即达标
    core.locksInLevel = 5; core.levelStats.locks = 5; core.levelStats.clears = 1; // 门槛已练到
    var pre = [];
    for (c = 0; c < C - 2; c++) if (!g[R - 2][c]) pre.push({ x: c, y: R - 2 });
    if (pre.length) core.board.lock(pre, 'J');
    core.current = { type: 'O', matrix: cloneO(), dir: 0, x: C - 2, y: R - 6 };
    core.phase = 'fall'; core.fallTimer = 0;
  });
  at(5600, function () { G.core.hardDrop(); }); // → 截图 5-levelup：过关结算面板（停在消行后那一帧）
  at(5900, function () { G.onButton('nextLevel'); }); // 确认进入第 2 关（预置缺口 + 强制横条）

  /* 游戏结束演示：堵死中心出生区 */
  at(6200, function () {
    var core = G.core, cells = [];
    var R = core.board.grid.length;
    var c0 = Math.floor(R / 2) - 2; // 中心 4×4，覆盖所有出生位
    for (var y = c0; y < c0 + 4; y++) for (var x = c0; x < c0 + 4; x++) cells.push({ x: x, y: y });
    core.board.lock(cells, 'T');
    core.current = null;
    core.spawn(); // 中心碰撞 → gameover 事件 → 主循环切换到结算面板
  });

  /* 排行榜画面 */
  at(6800, function () { G.onButton('rank'); });

  /* v1.4.0 新场景：关卡选择页 → 教学关强制天赋牌 */
  at(7400, function () { G.onButton('levels'); });
  at(8200, function () {
    var core = G.core;
    core.startLevel(4);            // 第 4 关：炮台天赋教学（预置靶面 + 每块带炮台格）
    G.state = 'playing';
    core.score = core.levelStartScore + 80; // 净增 80 分 → 脚本指定强制发牌
    core._syncCards();
    if (core.pendingCards) G.setState('cards');
  });

  /* 教学关过关结算：第 1 关「动作练完 + 分数达标」那一帧（棋盘还是预置局面） */
  at(9100, function () {
    var core = G.core;
    core.startLevel(1);
    G.state = 'playing';
    core.locksInLevel = 5; core.levelStats.locks = 5; core.levelStats.clears = 2;
    core.score = core.levelTarget(1) + 180;
    core._syncLevel();
    if (core.pendingLevelUp) G.setState('levelclear');
  });
})();
