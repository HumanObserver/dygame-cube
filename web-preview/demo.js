/**
 * 自动演示脚本：按固定虚拟时间线自动游玩，配合无头浏览器
 * --virtual-time-budget=N --screenshot 截取各关键场景。
 * 仅在 demo.html 中加载，不影响 index.html 正常游玩与抖音真机环境。
 *
 * 时间线（虚拟毫秒）：
 *   300  开局            → 截图 1-menu(250) / 2-hint(950)
 *   1500 第 1 块硬降；1550 将第 2 块重力设为向下
 *   4200 第 2 块下落中    → 截图 3-fall(4200)
 *   4900 布置消行（第 9 行留 8、9 列 + O 块）
 *   5000 硬降 → 消行      → 截图 4-clear(5150)
 *   5500 布置升级（lines=7 + 第 8 行留 8、9 列 + O 块）
 *   5600 硬降 → 升 2 关   → 截图 5-levelup(5750)
 *   6200 中心 4×4 堵死 → spawn 碰撞 → 游戏结束 → 截图 6-gameover(6500)
 *   6800 打开排行榜       → 截图 7-rank(7100)
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
    for (r = 0; r < 10; r++) { g[r][8] = null; g[r][9] = null; } // 清空 O 下落通道
    var pre = [];
    for (c = 0; c < 8; c++) if (!g[9][c]) pre.push({ x: c, y: 9 });
    if (pre.length) core.board.lock(pre, 'J');
    core.current = { type: 'O', matrix: cloneO(), dir: 0, x: 8, y: 6 };
    core.phase = 'fall'; core.fallTimer = 0;
  });
  at(5000, function () { G.core.hardDrop(); });

  /* 升级演示：先补到 7 行，再消 1 行触发升级 */
  at(5500, function () {
    var core = G.core, g = core.board.grid, c;
    core.lines = 7;
    var pre = [];
    for (c = 0; c < 8; c++) if (!g[8][c]) pre.push({ x: c, y: 8 });
    if (pre.length) core.board.lock(pre, 'J');
    core.current = { type: 'O', matrix: cloneO(), dir: 0, x: 8, y: 5 };
    core.phase = 'fall'; core.fallTimer = 0;
  });
  at(5600, function () { G.core.hardDrop(); });

  /* 游戏结束演示：堵死中心出生区 */
  at(6200, function () {
    var core = G.core, cells = [];
    for (var y = 3; y <= 6; y++) for (var x = 3; x <= 6; x++) cells.push({ x: x, y: y });
    core.board.lock(cells, 'T');
    core.current = null;
    core.spawn(); // 中心碰撞 → gameover 事件 → 主循环切换到结算面板
  });

  /* 排行榜画面 */
  at(6800, function () { G.onButton('rank'); });
})();
