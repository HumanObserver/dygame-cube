/**
 * 渲染模块：全部 Canvas 2D 绘制逻辑
 * 场景：menu / playing / paused / gameover / rank / help
 */
const {
  COLS, ROWS, DIRS, PERP, COLORS, ACCENT, BG_TOP, BG_BOTTOM, BOARD_SCALE, PLATFORM,
} = require('./config.js');
const { SHAPES, cellsOf } = require('./tetromino.js');

/* ================= 布局 ================= */

function buildLayout(w, h) {
  const s = Math.max(0.66, Math.min(1.25, Math.min(w / 375, h / 700)));

  const hud = { x: 12 * s, y: 10 * s, w: w - 24 * s, h: 52 * s };
  const pauseBtn = { x: w - 54 * s, y: 16 * s, w: 40 * s, h: 40 * s };
  const nextBox = { x: 12 * s, y: 68 * s, w: 128 * s, h: 64 * s };
  const gravBox = { x: 148 * s, y: 68 * s, w: w - 160 * s, h: 64 * s };

  // 棋盘：正方形，尽量大
  const reserved = 322 * s; // HUD + 提示行 + 控制区
  let bs = Math.min(w - 24 * s, h - reserved, h * 0.56);
  bs = Math.max(bs, Math.min(180, w - 24 * s));
  bs *= BOARD_SCALE; // 整体缩放棋盘：方块更小，四周留白更多
  let by = 142 * s;
  const slack = h - 96 * s - bs - by;
  if (slack > 0) by += slack * 0.3;
  const board = { x: (w - bs) / 2, y: by, size: bs, cell: bs / COLS };

  // 底部控制按钮
  const btnSize = Math.min(64 * s, (w - 40 * s) / 4.6);
  const cy = h - 92 * s;
  const xs = [w * 0.14, w * 0.38, w * 0.62, w * 0.86];
  const controls = {
    left: { x: xs[0] - btnSize / 2, y: cy, w: btnSize, h: btnSize },
    rotate: { x: xs[1] - btnSize / 2, y: cy, w: btnSize, h: btnSize },
    drop: { x: xs[2] - btnSize / 2, y: cy, w: btnSize, h: btnSize },
    right: { x: xs[3] - btnSize / 2, y: cy, w: btnSize, h: btnSize },
  };

  // 排行榜页好友区域
  const rankArea = { x: 16 * s, y: 104 * s, w: w - 32 * s, h: Math.min(280 * s, h * 0.38) };

  return { w, h, s, hud, pauseBtn, nextBox, gravBox, board, controls, rankArea };
}

/* ================= 按钮定义（绘制 + 命中检测共用） ================= */

function mk(id, r, extra) {
  const b = { id: id, x: r.x, y: r.y, w: r.w, h: r.h };
  if (extra) for (const k in extra) b[k] = extra[k];
  return b;
}

/**
 * 场景按钮定义（绘制 + 命中检测共用）
 * @param opts {canRevive, sidebarSupported, sidebarClaimable} 由 main.sceneOpts() 提供
 */
function sceneButtons(scene, L, opts) {
  opts = opts || {};
  const s = L.s, w = L.w, h = L.h;
  const out = [];
  if (scene === 'menu') {
    const bw = 220 * s, bh = 56 * s, bx = (w - bw) / 2;
    let y = h * 0.50;
    out.push(mk('start', { x: bx, y: y, w: bw, h: bh }, { text: '开始游戏', primary: true }));
    y += bh + 12 * s;
    out.push(mk('rank', { x: bx, y: y, w: bw, h: 48 * s }, { text: '排行榜' }));
    y += 48 * s + 12 * s;
    out.push(mk('help', { x: bx, y: y, w: bw, h: 48 * s }, { text: '玩法说明' }));
    y += 48 * s + 12 * s;
    // 侧边栏复访奖励入口（必接能力；宿主明确不支持时隐藏）
    if (opts.sidebarSupported !== false) {
      out.push(mk('sidebarGift', { x: bx, y: y, w: bw, h: 44 * s }, {
        text: opts.sidebarClaimable ? '侧边栏奖励 · 可领取' : '侧边栏奖励',
        primary: !!opts.sidebarClaimable,
      }));
      y += 44 * s + 12 * s;
    }
    // 平台能力小按钮行：添加到桌面 / 订阅提醒 / 免费金币（看激励视频）
    const gap = 6 * s;
    const sw = (bw - gap * 2) / 3;
    const sh = 36 * s;
    out.push(mk('desktop', { x: bx, y: y, w: sw, h: sh }, { text: '添加到桌面', small2: true }));
    out.push(mk('subscribe', { x: bx + sw + gap, y: y, w: sw, h: sh }, { text: '订阅提醒', small2: true }));
    out.push(mk('freeCoins', { x: bx + (sw + gap) * 2, y: y, w: sw, h: sh }, { text: '免费金币', small2: true }));
  } else if (scene === 'playing' || scene === 'paused') {
    const c = L.controls;
    out.push(mk('left', c.left, { glyph: 'perp', sign: -1 }));
    out.push(mk('rotate', c.rotate, { text: '旋转', small: true }));
    out.push(mk('drop', c.drop, { glyph: 'drop' }));
    out.push(mk('right', c.right, { glyph: 'perp', sign: 1 }));
    out.push(mk('pause', L.pauseBtn, { glyph: 'pause' }));
    if (scene === 'paused') {
      const bw = 200 * s, bh = 50 * s, bx = (w - bw) / 2, py = h * 0.42;
      out.push(mk('resume', { x: bx, y: py, w: bw, h: bh }, { text: '继续游戏', primary: true }));
      out.push(mk('restart', { x: bx, y: py + (bh + 14 * s), w: bw, h: bh }, { text: '重新开始' }));
      out.push(mk('tomenu', { x: bx, y: py + (bh + 14 * s) * 2, w: bw, h: bh }, { text: '返回主页' }));
    }
  } else if (scene === 'gameover') {
    const bw = 220 * s, bh = 50 * s, bx = (w - bw) / 2;
    let y = opts.canRevive ? h * 0.42 : h * 0.47;
    if (opts.canRevive) {
      // 复活按钮（看激励视频 / 金币复活，见 main.tryRevive），每局限一次
      out.push(mk('revive', { x: bx, y: y, w: bw, h: bh }, { text: '复活继续', primary: true }));
      y += bh + 14 * s;
      out.push(mk('retry', { x: bx, y: y, w: bw, h: bh }, { text: '再来一局' }));
    } else {
      out.push(mk('retry', { x: bx, y: y, w: bw, h: bh }, { text: '再来一局', primary: true }));
    }
    y += bh + 14 * s;
    out.push(mk('rank', { x: bx, y: y, w: bw, h: bh }, { text: '排行榜' }));
    y += bh + 14 * s;
    out.push(mk('share', { x: bx, y: y, w: bw, h: bh }, { text: '分享给好友' }));
    y += bh + 14 * s;
    out.push(mk('tomenu', { x: bx, y: y, w: bw, h: bh }, { text: '返回主页' }));
  } else if (scene === 'rank' || scene === 'help') {
    const bw = 160 * s, bh = 46 * s;
    out.push(mk('back', { x: (w - bw) / 2, y: h - 78 * s, w: bw, h: bh }, { text: '返回' }));
  } else if (scene === 'sidebar') {
    // 侧边栏复访任务面板：去侧边栏 / 领取奖励
    const bw = 220 * s, bh = 50 * s, bx = (w - bw) / 2;
    out.push(mk('sidebarAction', { x: bx, y: h * 0.565, w: bw, h: bh }, {
      text: opts.sidebarClaimable ? '立即领奖' : '去首页侧边栏',
      primary: true,
    }));
    const cw = 160 * s;
    out.push(mk('sidebarClose', { x: (w - cw) / 2, y: h * 0.645, w: cw, h: 44 * s }, { text: '关闭' }));
  }
  return out;
}

/* ================= 绘制小工具 ================= */

function roundRect(ctx, x, y, w, h, r) {
  if (w < 2 || h < 2) return;
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawTriangle(ctx, cx, cy, dx, dy, size, color) {
  const nx = -dy, ny = dx;
  ctx.beginPath();
  ctx.moveTo(cx + dx * size * 0.6, cy + dy * size * 0.6);
  ctx.lineTo(cx - dx * size * 0.4 + nx * size * 0.5, cy - dy * size * 0.4 + ny * size * 0.5);
  ctx.lineTo(cx - dx * size * 0.4 - nx * size * 0.5, cy - dy * size * 0.4 - ny * size * 0.5);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function text(ctx, str, x, y, size, color, align, bold, alpha) {
  ctx.save();
  ctx.font = (bold ? 'bold ' : '') + size + 'px sans-serif';
  ctx.fillStyle = color || '#ffffff';
  ctx.textAlign = align || 'left';
  ctx.textBaseline = 'alphabetic';
  if (alpha !== undefined) ctx.globalAlpha = alpha;
  ctx.fillText(str, x, y);
  ctx.restore();
}

/** 以 (cx,cy) 为中心绘制方块小图（按实体格包围盒居中） */
function drawMiniShape(ctx, type, cx, cy, cell, alpha) {
  const m = SHAPES[type];
  const cs = cellsOf(m);
  let minX = 99, maxX = -99, minY = 99, maxY = -99;
  for (let i = 0; i < cs.length; i++) {
    if (cs[i].x < minX) minX = cs[i].x;
    if (cs[i].x > maxX) maxX = cs[i].x;
    if (cs[i].y < minY) minY = cs[i].y;
    if (cs[i].y > maxY) maxY = cs[i].y;
  }
  const bw = (maxX - minX + 1) * cell;
  const bh = (maxY - minY + 1) * cell;
  const ox = cx - bw / 2 - minX * cell;
  const oy = cy - bh / 2 - minY * cell;
  ctx.save();
  ctx.globalAlpha = alpha === undefined ? 1 : alpha;
  for (let i = 0; i < cs.length; i++) {
    const px = ox + cs[i].x * cell;
    const py = oy + cs[i].y * cell;
    roundRect(ctx, px + 1, py + 1, cell - 2, cell - 2, cell * 0.22);
    ctx.fillStyle = COLORS[type];
    ctx.fill();
  }
  ctx.restore();
}

function drawCell(ctx, px, py, size, color, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha === undefined ? 1 : alpha;
  roundRect(ctx, px + 1.5, py + 1.5, size - 3, size - 3, Math.min(7, size * 0.2));
  ctx.fillStyle = color;
  ctx.fill();
  // 顶部高光
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  roundRect(ctx, px + 4, py + 3.5, Math.max(2, size - 8), Math.max(2, size * 0.12), 2);
  ctx.fill();
  ctx.restore();
}

function drawButton(ctx, b, L, dir, enabled) {
  const s = L.s;
  ctx.save();
  if (enabled === false) ctx.globalAlpha = 0.45;
  if (b.primary) {
    const g = ctx.createLinearGradient(b.x, b.y, b.x, b.y + b.h);
    g.addColorStop(0, '#ff6b8a');
    g.addColorStop(1, '#e63958');
    roundRect(ctx, b.x, b.y, b.w, b.h, b.h * 0.28);
    ctx.fillStyle = g;
    ctx.fill();
  } else {
    roundRect(ctx, b.x, b.y, b.w, b.h, Math.min(b.h * 0.28, 14 * s));
    ctx.fillStyle = 'rgba(255,255,255,0.09)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;

  if (b.glyph === 'perp' && dir !== undefined) {
    const p = PERP[dir];
    drawTriangle(ctx, cx, cy, p.x * b.sign, p.y * b.sign, Math.min(b.w, b.h) * 0.42, '#ffffff');
  } else if (b.glyph === 'drop' && dir !== undefined) {
    const d = DIRS[dir];
    drawTriangle(ctx, cx, cy - 4 * s, d.x, d.y, Math.min(b.w, b.h) * 0.44, ACCENT);
    text(ctx, '落下', cx, cy + b.h * 0.34, 10 * s, 'rgba(255,255,255,0.75)', 'center', false);
  } else if (b.glyph === 'pause') {
    const bw2 = 4 * s, bh2 = 14 * s, gap = 3 * s;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(cx - gap - bw2, cy - bh2 / 2, bw2, bh2);
    ctx.fillRect(cx + gap, cy - bh2 / 2, bw2, bh2);
  } else if (b.text) {
    const fs = b.small2 ? 11 : (b.small ? 15 : 17);
    const dy = b.small2 ? 4 * s : (b.small ? 5 * s : 7 * s);
    text(ctx, b.text, cx, cy + dy, fs * s,
      b.primary ? '#ffffff' : 'rgba(255,255,255,0.92)', 'center', true);
  }
  ctx.restore();
}

/* ================= 场景绘制 ================= */

function drawBackground(ctx, L) {
  const g = ctx.createLinearGradient(0, 0, 0, L.h);
  g.addColorStop(0, BG_TOP);
  g.addColorStop(1, BG_BOTTOM);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, L.w, L.h);
}

function drawMenu(ctx, L, main, t) {
  const s = L.s, w = L.w, h = L.h;
  // 漂浮装饰方块
  const deco = [
    { type: 'T', x: w * 0.18, y: h * 0.16, cell: 13 * s, ph: 0 },
    { type: 'I', x: w * 0.80, y: h * 0.22, cell: 11 * s, ph: 2 },
    { type: 'S', x: w * 0.14, y: h * 0.36, cell: 10 * s, ph: 4 },
    { type: 'L', x: w * 0.86, y: h * 0.40, cell: 11 * s, ph: 1 },
  ];
  for (let i = 0; i < deco.length; i++) {
    const d = deco[i];
    const yy = d.y + Math.sin(t / 900 + d.ph) * 6 * s;
    drawMiniShape(ctx, d.type, d.x, yy, d.cell, 0.5);
  }

  text(ctx, '引力方块', w / 2, h * 0.30, 42 * s, '#ffffff', 'center', true);
  text(ctx, '四向重力 · 方块消除玩法', w / 2, h * 0.30 + 30 * s, 14 * s, 'rgba(255,255,255,0.65)', 'center', false);
  text(ctx, '最高分 ' + main.best + ' · 金币 ' + (main.coins || 0), w / 2, h * 0.50 - 22 * s,
    15 * s, 'rgba(255,215,0,0.9)', 'center', true);

  const btns = sceneButtons('menu', L, main.sceneOpts ? main.sceneOpts() : {});
  for (let i = 0; i < btns.length; i++) drawButton(ctx, btns[i], L, undefined, true);

  text(ctx, 'v1.1.0 · 抖音小游戏', w / 2, h - 20 * s, 11 * s, 'rgba(255,255,255,0.35)', 'center', false);
}

function drawHud(ctx, L, main) {
  const s = L.s, hud = L.hud;
  const core = main.core;
  const colW = (hud.w - 56 * s) / 3;
  const cols = [
    { label: '分数', value: String(core.score) },
    { label: '关卡', value: String(core.level) },
    { label: '行数', value: String(core.lines) },
  ];
  for (let i = 0; i < cols.length; i++) {
    const cx = hud.x + colW * i + colW / 2;
    text(ctx, cols[i].label, cx, hud.y + 16 * s, 11 * s, 'rgba(255,255,255,0.55)', 'center', false);
    text(ctx, cols[i].value, cx, hud.y + 42 * s, i === 0 ? 24 * s : 20 * s, '#ffffff', 'center', true);
  }
}

function drawNextBox(ctx, L, main, t) {
  const s = L.s, bx = L.nextBox;
  const next = main.core.next;
  roundRect(ctx, bx.x, bx.y, bx.w, bx.h, 10 * s);
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fill();
  text(ctx, '下一个', bx.x + 10 * s, bx.y + 15 * s, 10 * s, 'rgba(255,255,255,0.55)', 'left', false);
  drawMiniShape(ctx, next.type, bx.x + bx.w * 0.38, bx.y + bx.h * 0.58, 10 * s, 1);
  const d = DIRS[next.dir];
  drawTriangle(ctx, bx.x + bx.w * 0.78, bx.y + bx.h * 0.58, d.x, d.y, 16 * s, ACCENT);
}

function drawGravBox(ctx, L, main, t) {
  const s = L.s, gx = L.gravBox;
  const cur = main.core.current;
  const dir = cur ? cur.dir : 0;
  const d = DIRS[dir];
  roundRect(ctx, gx.x, gx.y, gx.w, gx.h, 10 * s);
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fill();
  text(ctx, '重力方向', gx.x + 12 * s, gx.y + 15 * s, 10 * s, 'rgba(255,255,255,0.55)', 'left', false);
  drawTriangle(ctx, gx.x + 30 * s, gx.y + gx.h * 0.60, d.x, d.y, 20 * s, ACCENT);
  const hinting = main.core.phase === 'hint';
  const stateText = main.core.gameOver ? '—' : (hinting ? '准备下落…' : '下落中');
  const alpha = hinting ? 0.55 + 0.4 * Math.sin(t / 160) : 0.75;
  text(ctx, stateText, gx.x + 56 * s, gx.y + gx.h * 0.66, 13 * s, 'rgba(255,255,255,' + alpha.toFixed(2) + ')', 'left', true);
}

function drawBoard(ctx, L, main, t) {
  const s = L.s, B = L.board, core = main.core;
  const cell = B.cell;

  // 底板
  roundRect(ctx, B.x - 4 * s, B.y - 4 * s, B.size + 8 * s, B.size + 8 * s, 10 * s);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // 网格线
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < COLS; i++) {
    ctx.moveTo(B.x + i * cell, B.y);
    ctx.lineTo(B.x + i * cell, B.y + B.size);
    ctx.moveTo(B.x, B.y + i * cell);
    ctx.lineTo(B.x + B.size, B.y + i * cell);
  }
  ctx.stroke();
  ctx.restore();

  // 中心生成点标记
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.lineWidth = 1.5;
  const ccx = B.x + B.size / 2, ccy = B.y + B.size / 2, cr = 5 * s;
  ctx.beginPath();
  ctx.moveTo(ccx - cr, ccy); ctx.lineTo(ccx + cr, ccy);
  ctx.moveTo(ccx, ccy - cr); ctx.lineTo(ccx, ccy + cr);
  ctx.stroke();
  ctx.restore();

  const px = (c) => B.x + c.x * cell;
  const py = (c) => B.y + c.y * cell;

  // 已固定格子
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const v = core.board.grid[r][c];
      if (v) drawCell(ctx, B.x + c * cell, B.y + r * cell, cell, COLORS[v], 1);
    }
  }

  const cur = core.current;
  if (cur && !core.gameOver) {
    const dir = cur.dir;
    const d = DIRS[dir];

    // 重力侧墙高亮
    ctx.save();
    ctx.strokeStyle = ACCENT;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 3 * s;
    ctx.beginPath();
    if (d.y === 1) { ctx.moveTo(B.x, B.y + B.size - 1.5 * s); ctx.lineTo(B.x + B.size, B.y + B.size - 1.5 * s); }
    if (d.y === -1) { ctx.moveTo(B.x, B.y + 1.5 * s); ctx.lineTo(B.x + B.size, B.y + 1.5 * s); }
    if (d.x === 1) { ctx.moveTo(B.x + B.size - 1.5 * s, B.y); ctx.lineTo(B.x + B.size - 1.5 * s, B.y + B.size); }
    if (d.x === -1) { ctx.moveTo(B.x + 1.5 * s, B.y); ctx.lineTo(B.x + 1.5 * s, B.y + B.size); }
    ctx.stroke();
    ctx.restore();

    // 幽灵落点
    const ghost = core.ghostCells();
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.strokeStyle = COLORS[cur.type];
    ctx.lineWidth = 1.5;
    for (let i = 0; i < ghost.length; i++) {
      roundRect(ctx, px(ghost[i]) + 2, py(ghost[i]) + 2, cell - 4, cell - 4, cell * 0.18);
      ctx.stroke();
    }
    ctx.restore();

    // 当前方块（hint 相位半透明呼吸闪烁 = 下落前提示）
    const hinting = core.phase === 'hint';
    const alpha = hinting ? 0.45 + 0.3 * (0.5 + 0.5 * Math.sin(t / 150)) : 1;
    const cells = core.cells(cur);
    for (let i = 0; i < cells.length; i++) {
      drawCell(ctx, px(cells[i]), py(cells[i]), cell, COLORS[cur.type], alpha);
    }

    // hint 相位：大号方向箭头（从中心指向重力墙）
    if (hinting) {
      const pulse = 0.55 + 0.45 * Math.sin(t / 150);
      const ax = B.x + B.size / 2 + d.x * B.size * 0.33;
      const ay = B.y + B.size / 2 + d.y * B.size * 0.33;
      ctx.save();
      ctx.globalAlpha = pulse;
      drawTriangle(ctx, ax, ay, d.x, d.y, 34 * s, '#ffffff');
      ctx.restore();
    }
  }

  // 消行闪光特效
  for (let i = 0; i < main.fx.length; i++) {
    const f = main.fx[i];
    const k = 1 - f.t / f.dur;
    ctx.save();
    ctx.globalAlpha = Math.max(0, k) * 0.85;
    ctx.fillStyle = '#ffffff';
    for (let j = 0; j < f.cells.length; j++) {
      ctx.fillRect(px(f.cells[j]), py(f.cells[j]), cell, cell);
    }
    ctx.restore();
  }

  // 提示浮字
  if (main.toast) {
    const k = main.toast.t / main.toast.dur;
    const alpha = k < 0.15 ? k / 0.15 : (k > 0.7 ? (1 - k) / 0.3 : 1);
    text(ctx, main.toast.text, B.x + B.size / 2, B.y - 12 * s - (1 - alpha) * 8 * s,
      17 * s, '#ffd54f', 'center', true, Math.max(0, alpha));
  }
}

function drawControls(ctx, L, main) {
  const dir = main.core.current ? main.core.current.dir : 0;
  const enabled = main.core.canControl();
  const btns = sceneButtons('playing', L);
  for (let i = 0; i < btns.length; i++) {
    const b = btns[i];
    if (b.id === 'pause') { drawButton(ctx, b, L, dir, true); continue; }
    drawButton(ctx, b, L, dir, enabled);
  }
}

function drawGameScene(ctx, L, main, t) {
  drawHud(ctx, L, main);
  drawNextBox(ctx, L, main, t);
  drawGravBox(ctx, L, main, t);
  drawBoard(ctx, L, main, t);
  drawControls(ctx, L, main);
}

function drawOverlay(ctx, L, alpha) {
  ctx.save();
  ctx.fillStyle = 'rgba(5,7,15,' + alpha + ')';
  ctx.fillRect(0, 0, L.w, L.h);
  ctx.restore();
}

function drawPaused(ctx, L, main) {
  drawOverlay(ctx, L, 0.55);
  const s = L.s;
  text(ctx, '已暂停', L.w / 2, L.h * 0.32, 30 * s, '#ffffff', 'center', true);
  const btns = sceneButtons('paused', L);
  const dir = main.core.current ? main.core.current.dir : 0;
  for (let i = 0; i < btns.length; i++) {
    const b = btns[i];
    if (b.id === 'resume' || b.id === 'restart' || b.id === 'tomenu') drawButton(ctx, b, L, dir, true);
  }
}

function drawGameOver(ctx, L, main) {
  drawOverlay(ctx, L, 0.6);
  const s = L.s, w = L.w, h = L.h, core = main.core;

  const px2 = 26 * s, pw = w - 52 * s;
  const py2 = h * 0.14, ph = h * 0.30;
  roundRect(ctx, px2, py2, pw, ph, 16 * s);
  ctx.fillStyle = 'rgba(20,24,44,0.95)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  ctx.stroke();

  text(ctx, '游戏结束', w / 2, py2 + 40 * s, 24 * s, '#ffffff', 'center', true);
  text(ctx, main.newBest ? '新纪录！' : '中心被堵住了', w / 2, py2 + 64 * s, 12 * s,
    main.newBest ? '#ffd54f' : 'rgba(255,255,255,0.55)', 'center', true);

  const rows = [
    ['本局分数', String(core.score)],
    ['最高分', String(main.best)],
    ['到达关卡', '第 ' + core.level + ' 关'],
    ['消除行数', core.lines + ' 行'],
  ];
  const ry0 = py2 + 92 * s;
  for (let i = 0; i < rows.length; i++) {
    const yy = ry0 + i * 24 * s;
    text(ctx, rows[i][0], px2 + 28 * s, yy, 13 * s, 'rgba(255,255,255,0.6)', 'left', false);
    text(ctx, rows[i][1], px2 + pw - 28 * s, yy, 14 * s, '#ffffff', 'right', true);
  }

  const btns = sceneButtons('gameover', L, main.sceneOpts ? main.sceneOpts() : {});
  for (let i = 0; i < btns.length; i++) drawButton(ctx, btns[i], L, undefined, true);
}

/** 侧边栏复访任务面板（必接能力，官方指引：入口奖励 + 跳转侧边栏 + 复访领奖） */
function drawSidebar(ctx, L, main) {
  drawOverlay(ctx, L, 0.66);
  const s = L.s, w = L.w, h = L.h;
  const px2 = 22 * s, pw = w - 44 * s;
  const py2 = h * 0.14, ph = h * 0.58;
  roundRect(ctx, px2, py2, pw, ph, 16 * s);
  ctx.fillStyle = 'rgba(20,24,44,0.97)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  ctx.stroke();

  text(ctx, '首页侧边栏入口奖励', w / 2, py2 + 40 * s, 20 * s, '#ffffff', 'center', true);
  text(ctx, '每日从侧边栏进入游戏可领 ' + PLATFORM.SIDEBAR_REWARD_COINS + ' 金币',
    w / 2, py2 + 66 * s, 13 * s, 'rgba(255,215,0,0.9)', 'center', true);

  const lines = [
    '① 点击下方「去首页侧边栏」按钮',
    '② 在侧边栏中点击「引力方块」图标',
    '③ 返回游戏，点击「立即领奖」',
  ];
  for (let i = 0; i < lines.length; i++) {
    text(ctx, lines[i], px2 + 26 * s, py2 + 106 * s + i * 30 * s, 14 * s, 'rgba(255,255,255,0.85)', 'left', false);
  }

  const opts = main.sceneOpts ? main.sceneOpts() : {};
  let status, color;
  if (opts.sidebarClaimable) {
    status = '✔ 已检测到侧边栏复访，可领取今日奖励';
    color = '#69f0ae';
  } else if (opts.sidebarClaimedToday) {
    status = '今日奖励已领取，明天再来';
    color = 'rgba(255,255,255,0.5)';
  } else if (opts.sidebarSupported === false) {
    status = '当前宿主不支持侧边栏，请在抖音 App 中打开';
    color = 'rgba(255,255,255,0.5)';
  } else {
    status = '尚未从侧边栏进入，按上述步骤完成即可领奖';
    color = 'rgba(255,255,255,0.65)';
  }
  text(ctx, status, w / 2, h * 0.565 - 20 * s, 12 * s, color, 'center', true);

  const btns = sceneButtons('sidebar', L, opts);
  for (let i = 0; i < btns.length; i++) {
    const b = btns[i];
    const enabled = (b.id !== 'sidebarAction') || opts.sidebarSupported !== false;
    drawButton(ctx, b, L, undefined, enabled);
  }
}

/** 全局浮动提示（平台能力反馈等，所有场景可见） */
function drawPToast(ctx, L, main) {
  const p = main.ptoast;
  if (!p) return;
  const k = p.t / p.dur;
  let alpha = 1;
  if (k < 0.1) alpha = k / 0.1;
  else if (k > 0.75) alpha = (1 - k) / 0.25;
  alpha = Math.max(0, Math.min(1, alpha));
  const s = L.s;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = 'bold ' + (13 * s) + 'px sans-serif';
  const tw = ctx.measureText(p.text).width;
  const bw = tw + 36 * s, bh = 36 * s;
  const bx = (L.w - bw) / 2, by = L.h * 0.15;
  roundRect(ctx, bx, by, bw, bh, bh / 2);
  ctx.fillStyle = 'rgba(10,12,24,0.9)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1;
  ctx.stroke();
  text(ctx, p.text, L.w / 2, by + bh * 0.68, 13 * s, '#ffffff', 'center', true);
  ctx.restore();
}

function drawRank(ctx, L, main, t) {
  const s = L.s, w = L.w, h = L.h;
  text(ctx, '排行榜', w / 2, 44 * s, 24 * s, '#ffffff', 'center', true);

  // 好友排行（开放数据域共享画布）
  const A = L.rankArea;
  roundRect(ctx, A.x, A.y, A.w, A.h, 12 * s);
  ctx.save();
  ctx.clip();
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.fillRect(A.x, A.y, A.w, A.h);
  if (main.friendCanvas && main.friendCanvas.width > 0 && main.friendCanvas.height > 0) {
    try {
      ctx.drawImage(main.friendCanvas, A.x, A.y, A.w, A.h);
    } catch (e) {
      text(ctx, '好友排行渲染失败', A.x + A.w / 2, A.y + A.h / 2, 13 * s, 'rgba(255,255,255,0.5)', 'center', false);
    }
  } else {
    text(ctx, '好友排行', A.x + A.w / 2, A.y + A.h / 2 - 10 * s, 14 * s, 'rgba(255,255,255,0.6)', 'center', true);
    text(ctx, '需登录抖音并在真机运行', A.x + A.w / 2, A.y + A.h / 2 + 12 * s, 11 * s, 'rgba(255,255,255,0.4)', 'center', false);
  }
  ctx.restore();

  // 本机 TOP10
  const ly = A.y + A.h + 26 * s;
  text(ctx, '本机 TOP10', A.x + 4 * s, ly, 14 * s, '#ffd54f', 'left', true);
  const list = main.localRank || [];
  if (list.length === 0) {
    text(ctx, '暂无记录，快去玩一局吧', w / 2, ly + 34 * s, 12 * s, 'rgba(255,255,255,0.45)', 'center', false);
  } else {
    const n = Math.min(list.length, 8);
    const rowH = Math.min(24 * s, (h - 100 * s - ly) / Math.max(n, 1));
    for (let i = 0; i < n; i++) {
      const it = list[i];
      const yy = ly + 22 * s + i * rowH;
      const medal = i === 0 ? '#ffd54f' : (i === 1 ? '#cfd8dc' : (i === 2 ? '#ffab40' : 'rgba(255,255,255,0.45)'));
      text(ctx, String(i + 1), A.x + 10 * s, yy, 12 * s, medal, 'left', true);
      text(ctx, String(it.score), A.x + 40 * s, yy, 13 * s, '#ffffff', 'left', true);
      const dt = new Date(it.ts || Date.now());
      const dateStr = (dt.getMonth() + 1) + '-' + dt.getDate();
      text(ctx, '第' + it.level + '关 · ' + it.lines + '行 · ' + dateStr,
        A.x + A.w - 8 * s, yy, 11 * s, 'rgba(255,255,255,0.5)', 'right', false);
    }
  }

  const btns = sceneButtons('rank', L);
  for (let i = 0; i < btns.length; i++) drawButton(ctx, btns[i], L, undefined, true);
}

function drawHelp(ctx, L, main) {
  drawOverlay(ctx, L, 0.66);
  const s = L.s, w = L.w, h = L.h;
  const px2 = 22 * s, pw = w - 44 * s;
  const py2 = h * 0.10, ph = h * 0.66;
  roundRect(ctx, px2, py2, pw, ph, 16 * s);
  ctx.fillStyle = 'rgba(20,24,44,0.97)';
  ctx.fill();

  text(ctx, '玩法说明', w / 2, py2 + 38 * s, 20 * s, '#ffffff', 'center', true);
  const lines = [
    '· 方块从棋盘中心生成，箭头指示重力方向',
    '· 下落前方块会停留片刻，提示类型与方向',
    '· ◀ ▶ 按钮：沿垂直于重力的方向移动',
    '· 点击棋盘任意处：旋转方块',
    '· 沿重力方向滑动棋盘：快速落底',
    '· 「落下」按钮：立即沿重力落底',
    '· 填满任意整行或整列即可消除得分',
    '· 消除后剩余方块整体下沉落底，可连锁消除',
    '· 每消除 8 行升 1 关，下落速度加快',
    '· 中心出生点被堵住时游戏结束',
  ];
  for (let i = 0; i < lines.length; i++) {
    text(ctx, lines[i], px2 + 22 * s, py2 + 76 * s + i * 27 * s, 13 * s, 'rgba(255,255,255,0.85)', 'left', false);
  }

  const btns = sceneButtons('help', L);
  for (let i = 0; i < btns.length; i++) drawButton(ctx, btns[i], L, undefined, true);
}

/* ================= 总入口 ================= */

function draw(main) {
  const ctx = main.ctx, L = main.L, t = Date.now();
  drawBackground(ctx, L);
  switch (main.state) {
    case 'menu':
      drawMenu(ctx, L, main, t);
      break;
    case 'playing':
      drawGameScene(ctx, L, main, t);
      break;
    case 'paused':
      drawGameScene(ctx, L, main, t);
      drawPaused(ctx, L, main);
      break;
    case 'gameover':
      drawGameScene(ctx, L, main, t);
      drawGameOver(ctx, L, main);
      break;
    case 'rank':
      drawRank(ctx, L, main, t);
      break;
    case 'help':
      drawMenu(ctx, L, main, t);
      drawHelp(ctx, L, main);
      break;
    case 'sidebar':
      drawMenu(ctx, L, main, t);
      drawSidebar(ctx, L, main);
      break;
    default:
      break;
  }
  drawPToast(ctx, L, main);
}

module.exports = { buildLayout, sceneButtons, draw, roundRect };
