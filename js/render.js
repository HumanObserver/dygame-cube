/**
 * 渲染模块：全部 Canvas 2D 绘制逻辑
 * 场景：menu / playing / cards / paused / gameover / rank / help
 */
const {
  COLS, ROWS, DIRS, PERP, COLORS, ACCENT, BG_TOP, BG_BOTTOM, BOARD_SCALE, PLATFORM, SKILL, CARD,
} = require('./config.js');
const { SHAPES, cellsOf } = require('./tetromino.js');
const Skills = require('./skills.js');
const LevelPlan = require('./levelplan.js');

/* ================= 布局 ================= */

function buildLayout(w, h) {
  const s = Math.max(0.66, Math.min(1.25, Math.min(w / 375, h / 700)));

  const hud = { x: 12 * s, y: 10 * s, w: w - 24 * s, h: 52 * s };
  const pauseBtn = { x: w - 54 * s, y: 16 * s, w: 40 * s, h: 40 * s };
  const nextBox = { x: 12 * s, y: 68 * s, w: 128 * s, h: 64 * s };
  const gravBox = { x: 148 * s, y: 68 * s, w: w - 160 * s, h: 64 * s };

  // 棋盘：正方形，尽量大（下方留出「教学条 + 固定操作十字」的高度）
  const cb = 46 * s;                 // 方向键边长
  const cgap = 8 * s;                // 十字内间距
  const dropW = 62 * s;              // 「速降」竖条宽度
  const crossW = cb * 3 + cgap * 2;  // 十字整体宽高（上/下/左/右/翻转）
  const guideBand = 64 * s;          // 棋盘下方：教学条 + 构筑条
  const bottomPad = 16 * s;
  const controlsTop = h - bottomPad - crossW;
  const boardBottomMax = controlsTop - guideBand;
  let bs = Math.min(w - 24 * s, boardBottomMax - 142 * s, h * 0.56);
  bs = Math.max(bs, Math.min(180, w - 24 * s));
  bs *= BOARD_SCALE; // 整体缩放棋盘：方块更小，四周留白更多
  let by = 142 * s;
  const slack = boardBottomMax - bs - by;
  if (slack > 0) by += slack * 0.4;
  const board = { x: (w - bs) / 2, y: by, size: bs, cell: bs / COLS };

  // 底部操作区：五个按键位置**固定**，不随重力方向旋转
  //   上 / 左 / 翻转 / 右 / 下 排成十字（翻转在正中），「速降」竖条放十字右侧
  const groupW = crossW + cgap + dropW;
  const gx = (w - groupW) / 2;
  const crossCX = gx + crossW / 2;
  const crossCY = controlsTop + crossW / 2;
  const step = cb + cgap;
  const cellRect = (ccx, ccy) => ({ x: ccx - cb / 2, y: ccy - cb / 2, w: cb, h: cb });
  const controls = {
    up: cellRect(crossCX, crossCY - step),
    left: cellRect(crossCX - step, crossCY),
    flip: cellRect(crossCX, crossCY),
    right: cellRect(crossCX + step, crossCY),
    down: cellRect(crossCX, crossCY + step),
    drop: { x: gx + crossW + cgap, y: controlsTop, w: dropW, h: crossW },
  };
  const guide = { x: board.x, y: board.y + bs + 18 * s, w: bs, h: 20 * s };
  const build = { x: board.x, y: board.y + bs + 40 * s, w: bs, h: 14 * s };

  // 排行榜页好友区域
  const rankArea = { x: 16 * s, y: 104 * s, w: w - 32 * s, h: Math.min(280 * s, h * 0.38) };

  return { w, h, s, hud, pauseBtn, nextBox, gravBox, board, controls, guide, build, controlsTop, rankArea };
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
    const bw = 220 * s, bx = (w - bw) / 2;
    let y = h * 0.44;
    const hasSave = !!(opts.checkpoint && opts.checkpoint.level > 1);
    const half = (bw - 8 * s) / 2, rowH = 46 * s;
    if (hasSave) {
      out.push(mk('resume', { x: bx, y: y, w: bw, h: 56 * s }, { text: '继续 · 第 ' + opts.checkpoint.level + ' 关', primary: true }));
    } else {
      out.push(mk('start', { x: bx, y: y, w: bw, h: 56 * s }, { text: '开始游戏', primary: true }));
    }
    y += 56 * s + 10 * s;
    // 第 1~6 关是教学关：没有存档时主按钮就是「开始游戏」，有存档则给「重玩第 1 关」
    if (hasSave) {
      out.push(mk('start', { x: bx, y: y, w: half, h: rowH }, { text: '重玩第 1 关', small2: true }));
      out.push(mk('levels', { x: bx + half + 8 * s, y: y, w: half, h: rowH }, { text: '关卡选择', small2: true }));
    } else {
      out.push(mk('levels', { x: bx, y: y, w: bw, h: rowH }, { text: '关卡选择' }));
    }
    y += rowH + 10 * s;
    out.push(mk('rank', { x: bx, y: y, w: half, h: rowH }, { text: '排行榜', small2: true }));
    out.push(mk('help', { x: bx + half + 8 * s, y: y, w: half, h: rowH }, { text: '玩法说明', small2: true }));
    y += rowH + 10 * s;
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
    // 五个按键**固定不动**：上/下/左/右按屏幕方向移动，翻转在十字正中（旋转）
    const c = L.controls;
    out.push(mk('up', c.up, { glyph: 'arrow', dx: 0, dy: -1 }));
    out.push(mk('left', c.left, { glyph: 'arrow', dx: -1, dy: 0 }));
    out.push(mk('flip', c.flip, { text: '翻转', tiny: true }));
    out.push(mk('right', c.right, { glyph: 'arrow', dx: 1, dy: 0 }));
    out.push(mk('down', c.down, { glyph: 'arrow', dx: 0, dy: 1 }));
    out.push(mk('drop', c.drop, { text: '速降', stack: true }));
    out.push(mk('pause', L.pauseBtn, { glyph: 'pause' }));
    if (scene === 'paused') {
      const bw = 200 * s, bh = 50 * s, bx = (w - bw) / 2, py = h * 0.42;
      out.push(mk('resume', { x: bx, y: py, w: bw, h: bh }, { text: '继续游戏', primary: true }));
      out.push(mk('restart', { x: bx, y: py + (bh + 14 * s), w: bw, h: bh }, { text: '重新开始' }));
      out.push(mk('tomenu', { x: bx, y: py + (bh + 14 * s) * 2, w: bw, h: bh }, { text: '返回主页' }));
    }
  } else if (scene === 'levels') {
    // 关卡选择：1~6 为教学关，之后是正式关
    const total = LevelPlan.TOTAL_LEVELS;
    const cols = 4, gap = 8 * s;
    const gw = Math.min(w - 40 * s, 320 * s);
    const cw = (gw - gap * (cols - 1)) / cols, ch = 54 * s;
    const x0 = (w - gw) / 2, y0 = h * 0.27;
    for (let i = 0; i < total; i++) {
      const row = Math.floor(i / cols), col = i % cols;
      out.push(mk('level' + (i + 1), {
        x: x0 + col * (cw + gap), y: y0 + row * (ch + gap), w: cw, h: ch,
      }, { level: i + 1, tutorial: LevelPlan.isTutorial(i + 1) }));
    }
    const rows = Math.ceil(total / cols);
    const bw = 160 * s;
    out.push(mk('back', { x: (w - bw) / 2, y: y0 + rows * (ch + gap) + 16 * s, w: bw, h: 46 * s }, { text: '返回' }));
  } else if (scene === 'levelclear') {
    // 过关结算：确认后才清场进入下一关（底部十字此时不画，按钮放到顺手的高度）
    const rep = opts.report || {};
    const bw = 244 * s, bh = 54 * s, bx = (w - bw) / 2;
    out.push(mk('nextLevel', { x: bx, y: h * 0.775, w: bw, h: bh },
      { text: '进入第 ' + (rep.next || 2) + ' 关', primary: true }));
    out.push(mk('tomenu', { x: bx, y: h * 0.775 + bh + 12 * s, w: bw, h: 42 * s },
      { text: '返回主页（本关进度已存）', small: true }));
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
  } else if (scene === 'cards') {
    // 属性牌三选一（纵向牌面列表，文字更好读）
    const cards = opts.cards || [];
    const meta = opts.cardsMeta || null;
    const cw = Math.min(w - 40 * s, 320 * s), ch = 96 * s, gap = 12 * s;
    const cx = (w - cw) / 2;
    const cy0 = meta && meta.tutorial ? h * 0.27 : h * 0.235;
    const n = Math.min(CARD.CHOICES, cards.length);
    for (let i = 0; i < n; i++) {
      out.push(mk('card' + i, { x: cx, y: cy0 + i * (ch + gap), w: cw, h: ch }, { cardIndex: i }));
    }
    const sw = 150 * s;
    // 教学关的「天赋牌」必须选一张：不给跳过入口（core.skipCards 同样拒绝）
    if (!(meta && meta.force)) {
      out.push(mk('cardsSkip', { x: (w - sw) / 2, y: cy0 + n * (ch + gap) + 4 * s, w: sw, h: 40 * s },
        { text: '跳过（不加持）', small2: true }));
    }
  } else if (scene === 'rank' || scene === 'help' || scene === 'levels') {
    if (scene !== 'levels') {
      const bw = 160 * s, bh = 46 * s;
      out.push(mk('back', { x: (w - bw) / 2, y: h - 78 * s, w: bw, h: bh }, { text: '返回' }));
    }
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

/**
 * 以 (cx,cy) 为中心绘制方块小图（按实体格包围盒居中）
 * 返回 {ox, oy}：局部坐标 (0,0) 对应的像素位置（供技能格标记定位）
 */
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
  return { ox: ox, oy: oy };
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

/* ================= 技能格（炮台 / 共鸣）渲染 ================= */

/**
 * 在已画好的方格上叠加技能标记：
 *  - 炮台（落地技能）：金色准星炮口，炮口朝向子弹的发射方向（重力反方向）
 *  - 共鸣（消除技能）：青色同心涟漪 + 中心点
 * 用描边环 + 图形，不遮挡方格本色（共鸣按颜色匹配，本色必须可辨）
 */
function drawSkillBadge(ctx, px, py, size, skill, t) {
  if (!skill) return;
  const accent = SKILL.ACCENT[skill.kind] || '#ffffff';
  const cx = px + size / 2, cy = py + size / 2;
  const pulse = 0.72 + 0.28 * Math.sin((t || 0) / 220 + (px + py) * 0.02);
  ctx.save();
  // 描边环：标明「这是技能格」
  ctx.globalAlpha = 0.55 + 0.35 * pulse;
  ctx.strokeStyle = accent;
  ctx.lineWidth = Math.max(1, size * 0.09);
  roundRect(ctx, px + 1.5, py + 1.5, size - 3, size - 3, Math.min(7, size * 0.2));
  ctx.stroke();
  ctx.globalAlpha = 1;

  if (skill.kind === 'turret') {
    // 炮台：方形炮座 + 指向发射方向的炮管 + 炮口亮点
    const d = DIRS[Skills.shotDirs(skill.dir)[0]];
    const seat = size * 0.30;
    ctx.fillStyle = 'rgba(12,14,26,0.72)';
    roundRect(ctx, cx - seat / 2, cy - seat / 2, seat, seat, seat * 0.28);
    ctx.fill();
    ctx.strokeStyle = accent;
    ctx.lineWidth = Math.max(1.2, size * 0.13);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + d.x * size * 0.40, cy + d.y * size * 0.40);
    ctx.stroke();
    ctx.globalAlpha = pulse;
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(cx + d.x * size * 0.40, cy + d.y * size * 0.40, Math.max(1, size * 0.09), 0, Math.PI * 2);
    ctx.fill();
  } else {
    // 共鸣：同心涟漪
    ctx.strokeStyle = accent;
    ctx.lineWidth = Math.max(1, size * 0.08);
    for (let k = 0; k < 2; k++) {
      ctx.globalAlpha = (k === 0 ? 1 : 0.55) * pulse;
      ctx.beginPath();
      ctx.arc(cx, cy, size * (0.16 + k * 0.13), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(1, size * 0.09), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** 小图标（属性牌牌面 / HUD 技能条用） */
function drawSkillIcon(ctx, kind, cx, cy, r, t) {
  const accent = SKILL.ACCENT[kind] || '#ffffff';
  ctx.save();
  ctx.strokeStyle = accent;
  ctx.fillStyle = accent;
  ctx.lineWidth = Math.max(1, r * 0.18);
  if (kind === 'turret') {
    roundRect(ctx, cx - r * 0.55, cy - r * 0.2, r * 1.1, r * 0.9, r * 0.25);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, cy - r * 0.2);
    ctx.lineTo(cx, cy - r);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy - r, r * 0.2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    for (let k = 0; k < 3; k++) {
      ctx.globalAlpha = 1 - k * 0.3;
      ctx.beginPath();
      ctx.arc(cx, cy, r * (0.28 + k * 0.3), 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawButton(ctx, b, L, enabled) {
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

  if (b.glyph === 'arrow') {
    // 方向键：箭头指向**屏幕方向**，永远不随重力旋转
    drawTriangle(ctx, cx, cy, b.dx || 0, b.dy || 0, Math.min(b.w, b.h) * 0.44, '#ffffff');
  } else if (b.glyph === 'pause') {
    const bw2 = 4 * s, bh2 = 14 * s, gap = 3 * s;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(cx - gap - bw2, cy - bh2 / 2, bw2, bh2);
    ctx.fillRect(cx + gap, cy - bh2 / 2, bw2, bh2);
  } else if (b.stack && b.text) {
    // 「速降」竖排：占住十字右侧的竖条，好按且不会跟方向键混
    const fs = 17 * s, lh = fs * 1.12, n = b.text.length;
    for (let i = 0; i < n; i++) {
      const yy = cy - (n - 1) * lh / 2 + i * lh + fs * 0.34;
      text(ctx, b.text.charAt(i), cx, yy, fs, ACCENT, 'center', true);
    }
  } else if (b.text) {
    const fs = b.tiny ? 12 : (b.small2 ? 11 : (b.small ? 15 : 17));
    const dy = b.tiny ? 4 * s : (b.small2 ? 4 * s : (b.small ? 5 * s : 7 * s));
    const col = b.tiny ? '#ffd54f' : (b.primary ? '#ffffff' : 'rgba(255,255,255,0.92)');
    text(ctx, b.text, cx, cy + dy, fs * s, col, 'center', true);
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

  text(ctx, '引力方块', w / 2, h * 0.28, 42 * s, '#ffffff', 'center', true);
  text(ctx, '四向重力 · 方块消除 · 技能构筑', w / 2, h * 0.28 + 30 * s, 14 * s, 'rgba(255,255,255,0.65)', 'center', false);
  text(ctx, '前 6 关手把手教学 · 第 7 关起四向随机重力', w / 2, h * 0.28 + 52 * s, 12 * s,
    'rgba(170,205,255,0.8)', 'center', false);
  const cp = main.checkpoint;
  text(ctx, '最高分 ' + main.best + ' · 金币 ' + (main.coins || 0)
    + (cp && cp.level > 1 ? (' · 进度 第 ' + cp.level + ' 关') : ''),
    w / 2, h * 0.44 - 24 * s, 15 * s, 'rgba(255,215,0,0.9)', 'center', true);

  const btns = sceneButtons('menu', L, main.sceneOpts ? main.sceneOpts() : {});
  for (let i = 0; i < btns.length; i++) drawButton(ctx, btns[i], L, true);

  text(ctx, 'v1.5.2 · 抖音小游戏', w / 2, h - 20 * s, 11 * s, 'rgba(255,255,255,0.35)', 'center', false);
}

function drawHud(ctx, L, main) {
  const s = L.s, hud = L.hud;
  const core = main.core;
  const target = core.levelTarget(); // 当前关合格分（累计分数目标）
  const colW = (hud.w - 56 * s) / 4;
  const cols = [
    { label: '分数', value: String(core.score), size: 22 },
    { label: '合格分', value: String(target), size: 16, color: '#ffd54f' },
    { label: '关卡', value: String(core.level), size: 20 },
    { label: '行数', value: String(core.lines), size: 20 },
  ];
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i];
    const cx = hud.x + colW * i + colW / 2;
    const fs = c.value.length > 6 ? c.size - 4 : c.size; // 长数字自动缩小
    text(ctx, c.label, cx, hud.y + 16 * s, 11 * s, 'rgba(255,255,255,0.55)', 'center', false);
    text(ctx, c.value, cx, hud.y + 42 * s, fs * s, c.color || '#ffffff', 'center', true);
  }
  // 本关进度条：本关入场分 → 本关合格分（量的是「这一关净拿了多少分」；
  // 用上一关合格分当起点会在上一关爆分时变成负数区间，进度条一直满格）
  const prev = core.level > 1 ? core.levelStartScore : 0;
  const k = Math.max(0, Math.min(1, (core.score - prev) / Math.max(1, target - prev)));
  const bw = hud.w, bh = Math.max(3, 4 * s), bx = hud.x, by = hud.y + 50 * s;
  roundRect(ctx, bx, by, bw, bh, bh / 2);
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fill();
  if (k > 0) {
    roundRect(ctx, bx, by, Math.max(bh, bw * k), bh, bh / 2);
    ctx.fillStyle = '#ffd54f';
    ctx.fill();
  }
}

function drawNextBox(ctx, L, main, t) {
  const s = L.s, bx = L.nextBox;
  const next = main.core.next;
  roundRect(ctx, bx.x, bx.y, bx.w, bx.h, 10 * s);
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fill();
  text(ctx, '下一个', bx.x + 10 * s, bx.y + 15 * s, 10 * s, 'rgba(255,255,255,0.55)', 'left', false);
  const mc = 10 * s;
  const off = drawMiniShape(ctx, next.type, bx.x + bx.w * 0.38, bx.y + bx.h * 0.58, mc, 1);
  // 技能格预告（预览图上同样标出哪一格带技能）
  if (next.skill) {
    drawSkillBadge(ctx, off.ox + next.skill.mx * mc, off.oy + next.skill.my * mc, mc,
      { kind: next.skill.kind, dir: next.dir }, t);
  }
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

  // 命中震屏：整块棋盘（含特效）轻微抖动，强化打击感
  const sh = main.shake;
  const shaking = !!(sh && sh.t < sh.dur);
  if (shaking) {
    const k = 1 - sh.t / sh.dur;
    const amp = (sh.amp || 3) * k * s;
    ctx.save();
    ctx.translate(Math.sin(sh.t * 0.09) * amp, Math.cos(sh.t * 0.13) * amp);
  }

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

  // 已固定格子（附带技能格标记）
  const skills = core.board.skills;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const v = core.board.grid[r][c];
      if (!v) continue;
      const px = B.x + c * cell, py = B.y + r * cell;
      drawCell(ctx, px, py, cell, COLORS[v], 1);
      if (skills[r][c]) drawSkillBadge(ctx, px, py, cell, skills[r][c], t);
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
    // 技能格预告：落地前就能看到哪一格带技能（按局部坐标匹配，旋转后仍跟随）
    if (cur.skill) {
      const sp = { x: cur.x + cur.skill.mx, y: cur.y + cur.skill.my };
      ctx.save();
      ctx.globalAlpha = hinting ? 0.6 + 0.3 * (0.5 + 0.5 * Math.sin(t / 150)) : 1;
      drawSkillBadge(ctx, px(sp), py(sp), cell, { kind: cur.skill.kind, dir: cur.dir }, t);
      ctx.restore();
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

  // 特效：消行闪光 / 炮台弹道 / 共鸣波 / 技能击落闪光
  drawFx(ctx, L, main, t, px, py, cell);

  // 提示浮字
  if (main.toast) {
    const k = main.toast.t / main.toast.dur;
    const alpha = k < 0.15 ? k / 0.15 : (k > 0.7 ? (1 - k) / 0.3 : 1);
    text(ctx, main.toast.text, B.x + B.size / 2, B.y - 12 * s - (1 - alpha) * 8 * s,
      17 * s, '#ffd54f', 'center', true, Math.max(0, alpha));
  }

  if (shaking) ctx.restore();
}

/* ================= 特效渲染 ================= */

/** 子弹动画总时长(ms)：按最长弹道 × 每格帧时 + 命中余韵 */
function bulletDuration(shots) {
  let maxLen = 1;
  for (let i = 0; i < (shots || []).length; i++) maxLen = Math.max(maxLen, shots[i].path.length);
  return maxLen * SKILL.BULLET_FRAME + 380;
}

/** 一整格白色闪光（消行 / 过关清场） */
function drawFlashCells(ctx, cells, k, px, py, cell, color, insetRatio) {
  const alpha = Math.max(0, 1 - k);
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha * 0.85;
  ctx.fillStyle = color || '#ffffff';
  const inset = cell * (insetRatio || 0) * k;
  for (let i = 0; i < cells.length; i++) {
    ctx.fillRect(px(cells[i]) + inset, py(cells[i]) + inset, cell - inset * 2, cell - inset * 2);
  }
  ctx.restore();
}

/** 炮台弹道：从炮口出发的拖尾 + 弹头 + 命中爆点 */
function drawTurretFx(ctx, f, L, px, py, cell) {
  const frame = f.t / SKILL.BULLET_FRAME; // 已飞行的格数
  const accent = SKILL.ACCENT.turret;
  const cx = (c) => px(c) + cell / 2;
  const cy = (c) => py(c) + cell / 2;
  ctx.save();
  for (let i = 0; i < f.shots.length; i++) {
    const shot = f.shots[i];
    const path = shot.path;
    if (!path.length) continue;
    const head = Math.min(path.length - 1, Math.floor(frame));
    // 拖尾：最近 5 格渐隐
    for (let j = Math.max(0, head - 4); j <= head; j++) {
      const age = head - j;
      ctx.globalAlpha = Math.max(0, 0.55 - age * 0.1) * (1 - f.t / (f.dur * 1.4));
      ctx.fillStyle = accent;
      const pad = cell * (0.32 + age * 0.03);
      ctx.beginPath();
      ctx.arc(cx(path[j]), cy(path[j]), Math.max(1, cell / 2 - pad), 0, Math.PI * 2);
      ctx.fill();
    }
    // 弹头（在 path[head] → path[head+1] 之间插值）
    const a = path[head];
    const b = path[Math.min(path.length - 1, head + 1)];
    const frac = Math.min(1, frame - head);
    const hx = cx(a) + (cx(b) - cx(a)) * frac;
    const hy = cy(a) + (cy(b) - cy(a)) * frac;
    ctx.globalAlpha = Math.max(0, 1 - f.t / (f.dur * 1.2));
    ctx.fillStyle = '#fff8e1';
    ctx.beginPath();
    ctx.arc(hx, hy, Math.max(1.2, cell * 0.16), 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = accent;
    ctx.lineWidth = Math.max(1, cell * 0.07);
    ctx.stroke();
    // 命中爆点：白热闪 + 扩散环 + 十字/斜向火花（打击感加强）
    for (let j = 0; j < shot.hits.length; j++) {
      const hit = shot.hits[j];
      if (hit.step === undefined || frame < hit.step) continue;
      const g = Math.min(1, (frame - hit.step) / 3.2);
      const hx2 = cx(hit), hy2 = cy(hit);
      const r = cell * (0.3 + g * 0.75);
      if (g < 0.3) {
        ctx.globalAlpha = (1 - g / 0.3) * 0.95;
        ctx.fillStyle = '#fffde7';
        ctx.beginPath();
        ctx.arc(hx2, hy2, cell * (0.5 - g * 0.5), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = Math.max(0, 1 - g);
      ctx.strokeStyle = '#ffe082';
      ctx.lineWidth = Math.max(1.2, cell * 0.13 * (1 - g) + 0.8);
      ctx.beginPath();
      ctx.arc(hx2, hy2, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(hx2 - r, hy2); ctx.lineTo(hx2 + r, hy2);
      ctx.moveTo(hx2, hy2 - r); ctx.lineTo(hx2, hy2 + r);
      ctx.stroke();
      // 斜向四道火花
      ctx.globalAlpha = Math.max(0, 1 - g) * 0.75;
      ctx.strokeStyle = accent;
      ctx.lineWidth = Math.max(1, cell * 0.07);
      const dr = r * 0.72;
      ctx.beginPath();
      ctx.moveTo(hx2 - dr, hy2 - dr); ctx.lineTo(hx2 - dr * 1.7, hy2 - dr * 1.7);
      ctx.moveTo(hx2 + dr, hy2 - dr); ctx.lineTo(hx2 + dr * 1.7, hy2 - dr * 1.7);
      ctx.moveTo(hx2 - dr, hy2 + dr); ctx.lineTo(hx2 - dr * 1.7, hy2 + dr * 1.7);
      ctx.moveTo(hx2 + dr, hy2 + dr); ctx.lineTo(hx2 + dr * 1.7, hy2 + dr * 1.7);
      ctx.stroke();
    }
  }
  // 炮口闪光
  if (f.origin && frame < 1.2) {
    const g = frame / 1.2;
    ctx.globalAlpha = Math.max(0, 1 - g);
    ctx.fillStyle = '#fffde7';
    ctx.beginPath();
    ctx.arc(cx(f.origin), cy(f.origin), cell * (0.2 + g * 0.4), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** 共鸣波：从共鸣格向外扩散的涟漪 + 同类方格的连线 + 按消失方式的光束 */
function drawResonanceFx(ctx, f, L, px, py, cell) {
  const accent = SKILL.ACCENT.resonance;
  const cx = (c) => px(c) + cell / 2;
  const cy = (c) => py(c) + cell / 2;
  ctx.save();
  for (let i = 0; i < f.waves.length; i++) {
    const w = f.waves[i];
    const k = Math.min(1, f.t / f.dur);
    const fade = Math.max(0, 1 - k);
    const ox = cx(w.origin), oy = cy(w.origin);
    // 与同类方格的共鸣连线
    ctx.strokeStyle = accent;
    ctx.lineWidth = Math.max(1, cell * 0.06);
    for (let j = 0; j < w.cells.length; j++) {
      const c = w.cells[j];
      const kk = Math.min(1, k * 1.6 - j * 0.004);
      if (kk <= 0) continue;
      ctx.globalAlpha = fade * 0.5 * kk;
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.lineTo(ox + (cx(c) - ox) * kk, oy + (cy(c) - oy) * kk);
      ctx.stroke();
    }
    // 涟漪（两圈向外）
    for (let j = 0; j < 2; j++) {
      const r = cell * (0.4 + (k * 2.4 + j * 0.5));
      ctx.globalAlpha = fade * (j ? 0.3 : 0.6);
      ctx.beginPath();
      ctx.arc(ox, oy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    // 消失方式：爆炸圆 / 激光束
    if (w.pattern === 'bomb') {
      ctx.globalAlpha = fade * 0.55;
      ctx.fillStyle = '#ff8a65';
      ctx.beginPath();
      ctx.arc(ox, oy, cell * (0.6 + k * 1.5), 0, Math.PI * 2);
      ctx.fill();
    } else if (w.pattern === 'laserH' || w.pattern === 'laserV' || w.pattern === 'cross') {
      const arms = w.pattern === 'laserH' ? [[1, 0], [-1, 0]]
        : (w.pattern === 'laserV' ? [[0, 1], [0, -1]] : [[1, 0], [-1, 0], [0, 1], [0, -1]]);
      ctx.globalAlpha = fade * 0.85;
      ctx.strokeStyle = accent;
      ctx.lineWidth = Math.max(1.5, cell * (0.26 * (1 - k) + 0.06));
      const len = cell * (1 + 2 * Math.min(1, k * 1.5));
      for (let j = 0; j < arms.length; j++) {
        ctx.beginPath();
        ctx.moveTo(ox, oy);
        ctx.lineTo(ox + arms[j][0] * len, oy + arms[j][1] * len);
        ctx.stroke();
      }
    }
    // 被共鸣带走的方格闪一下
    ctx.globalAlpha = fade * 0.6;
    ctx.fillStyle = accent;
    for (let j = 0; j < w.cells.length; j++) {
      const c = w.cells[j];
      const pad = cell * 0.2;
      ctx.fillRect(px(c) + pad, py(c) + pad, cell - pad * 2, cell - pad * 2);
    }
  }
  ctx.restore();
}

/**
 * 命中爆点（子弹击落 / 共鸣带走）：白热核心 + 双层冲击波 + 放射火花 + 方格碎块外飞。
 * 大范围共鸣时只给前 IMPACT_FULL 格画完整爆点，其余画简化闪光，控制绘制开销。
 */
const IMPACT_FULL = 24;

function drawImpactFx(ctx, f, L, px, py, cell) {
  const k = Math.max(0, Math.min(1, f.t / f.dur));
  const accent = f.accent || '#ffe082';
  const cells = f.cells || [];
  const cx = (c) => px(c) + cell / 2;
  const cy = (c) => py(c) + cell / 2;
  ctx.save();
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    const x = cx(c), y = cy(c);
    if (i >= IMPACT_FULL) {
      // 简化：整格渐隐闪光
      ctx.globalAlpha = Math.max(0, 1 - k) * 0.5;
      ctx.fillStyle = accent;
      const pad = cell * 0.18;
      ctx.fillRect(px(c) + pad, py(c) + pad, cell - pad * 2, cell - pad * 2);
      continue;
    }
    // 1) 白热核心（前 35%）
    if (k < 0.35) {
      const kk = k / 0.35;
      ctx.globalAlpha = 1 - kk * 0.85;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(x, y, Math.max(1, cell * (0.6 - kk * 0.16)), 0, Math.PI * 2);
      ctx.fill();
    }
    // 2) 双层冲击波
    for (let j = 0; j < 2; j++) {
      const g = (k - j * 0.14) / 0.62;
      if (g <= 0 || g >= 1) continue;
      ctx.globalAlpha = (1 - g) * (j ? 0.4 : 0.9);
      ctx.strokeStyle = j ? accent : '#fff8e1';
      ctx.lineWidth = Math.max(1, cell * (0.17 * (1 - g) + 0.03));
      ctx.beginPath();
      ctx.arc(x, y, cell * (0.3 + g * (1.45 + j * 0.55)), 0, Math.PI * 2);
      ctx.stroke();
    }
    // 3) 放射火花（8 条，按格序错开角度）
    const g3 = Math.min(1, k / 0.7);
    if (g3 < 1) {
      const r1 = cell * (0.2 + g3 * 1.1);
      const r2 = r1 + cell * 0.24 * (1 - g3);
      ctx.globalAlpha = (1 - g3) * 0.95;
      ctx.lineWidth = Math.max(1, cell * 0.1 * (1 - g3) + 0.6);
      for (let a = 0; a < 8; a++) {
        const ang = (a / 8) * Math.PI * 2 + i * 0.42;
        ctx.strokeStyle = a % 2 ? accent : '#fffde7';
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(ang) * r1, y + Math.sin(ang) * r1);
        ctx.lineTo(x + Math.cos(ang) * r2, y + Math.sin(ang) * r2);
        ctx.stroke();
      }
    }
    // 4) 方格碎块向四角外飞
    const g4 = Math.min(1, k / 0.85);
    if (g4 < 1) {
      ctx.globalAlpha = (1 - g4) * 0.85;
      ctx.fillStyle = accent;
      const half = cell * 0.2;
      const off = cell * (0.12 + g4 * 0.8);
      for (let q = 0; q < 4; q++) {
        const sx = q % 2 ? 1 : -1, sy = q < 2 ? -1 : 1;
        ctx.fillRect(x + sx * off - half / 2, y + sy * off - half / 2, half, half);
      }
    }
  }
  ctx.restore();
}

function drawFx(ctx, L, main, t, px, py, cell) {
  const list = main.fx || [];
  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    if (f.t < 0) continue;
    const k = Math.max(0, Math.min(1, f.t / f.dur));
    const kind = f.kind || 'clear';
    if (kind === 'clear') {
      drawFlashCells(ctx, f.cells, k, px, py, cell, '#ffffff', 0);
    } else if (kind === 'impact' || kind === 'blast') {
      drawImpactFx(ctx, f, L, px, py, cell);
    } else if (kind === 'turret') {
      drawTurretFx(ctx, f, L, px, py, cell);
    } else if (kind === 'resonance') {
      drawResonanceFx(ctx, f, L, px, py, cell);
    }
  }
}

/** 漂浮加分字 */
function drawFloats(ctx, L, main) {
  const list = main.floats || [];
  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    const k = Math.max(0, Math.min(1, f.t / f.dur));
    ctx.save();
    ctx.globalAlpha = k < 0.2 ? k / 0.2 : (1 - k) / 0.8;
    text(ctx, f.text, f.x, f.y - k * 26 * L.s, 15 * L.s, f.color || '#ffd54f', 'center', true);
    ctx.restore();
  }
}

/** 棋盘下方的教学条（第 1~6 关常驻）：本关叫什么 + 还差什么；教学完成后提示拿分过关 */
function drawGuide(ctx, L, main) {
  const core = main.core;
  if (!core.tutorialOn) return;
  const plan = LevelPlan.planFor(core.level);
  if (!plan) return;
  const G = L.guide, s = L.s;
  const gs = LevelPlan.gateStatus(core.level, core.levelStats);
  const left = '第 ' + core.level + ' 关 · ' + plan.name;
  const right = gs.done
    ? '教学完成 · 拿满 ' + core.levelTarget() + ' 分过关'
    : '还差 ' + gs.left + '：' + gs.what;
  const done = gs.done;
  ctx.save();
  roundRect(ctx, G.x, G.y, G.w, G.h, G.h / 2);
  ctx.fillStyle = done ? 'rgba(120,220,160,0.10)' : 'rgba(255,213,79,0.12)';
  ctx.fill();
  ctx.strokeStyle = done ? 'rgba(120,220,160,0.42)' : 'rgba(255,213,79,0.5)';
  ctx.lineWidth = 1;
  ctx.stroke();
  let fs = 11 * s;
  ctx.font = 'bold ' + fs + 'px sans-serif';
  while ((ctx.measureText(left).width + ctx.measureText(right).width) > G.w - 18 * s && fs > 8 * s) {
    fs -= 0.5 * s;
    ctx.font = 'bold ' + fs + 'px sans-serif';
  }
  const ty = G.y + G.h * 0.68;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  ctx.fillText(left, G.x + 9 * s, ty);
  ctx.textAlign = 'right';
  ctx.fillStyle = done ? 'rgba(150,230,180,0.95)' : '#ffd54f';
  ctx.fillText(right, G.x + G.w - 9 * s, ty);
  ctx.restore();
}

/** 棋盘下方的技能构筑条：本局已选属性牌的生效值 */
function drawBuildBar(ctx, L, main) {
  const core = main.core;
  if (core.level < SKILL.START_LEVEL && !core.cardPicks.length) return;
  const B = L.board;
  const s = L.s;
  const y = (L.build ? L.build.y : B.y + B.size + 14 * s) + 10 * s;
  if (y > L.controlsTop - 6 * s) return; // 空间不足则不画
  const chips = Skills.buildSummary(core.mods);
  const cards = core.cardPicks.length;
  ctx.save();
  ctx.font = 'bold ' + (11 * s) + 'px sans-serif';
  const items = chips.map((c) => ({ label: c.label + ' ' + c.text, color: c.accent }));
  if (cards) items.push({ label: '属性牌 ×' + cards, color: '#ffd54f' });
  const gap = 14 * s;
  let total = 0;
  for (let i = 0; i < items.length; i++) total += ctx.measureText(items[i].label).width + (i ? gap : 0);
  let x = B.x + B.size / 2 - total / 2;
  ctx.textBaseline = 'alphabetic';
  for (let i = 0; i < items.length; i++) {
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = items[i].color;
    ctx.fillText(items[i].label, x, y);
    x += ctx.measureText(items[i].label).width + gap;
  }
  ctx.restore();
}

function drawControls(ctx, L, main) {
  if (main.state === 'levelclear') return; // 结算面板自带按钮，底部十字先让位（避免按钮叠按钮）
  const enabled = main.core.canControl();
  const btns = sceneButtons('playing', L);
  for (let i = 0; i < btns.length; i++) {
    const b = btns[i];
    drawButton(ctx, b, L, b.id === 'pause' ? true : enabled);
  }
}

/** 按像素宽度折行（最多 maxLines 行，超出用省略号收尾） */
function wrapText(ctx, str, maxW, maxLines) {
  const lines = [];
  let cur = '';
  for (let i = 0; i < str.length; i++) {
    const test = cur + str[i];
    if (cur && ctx.measureText(test).width > maxW) { lines.push(cur); cur = str[i]; }
    else cur = test;
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    const last = kept[maxLines - 1];
    kept[maxLines - 1] = last.slice(0, Math.max(1, last.length - 1)) + '…';
    return kept;
  }
  return lines;
}

const TAG_ACCENT = {
  turret: SKILL.ACCENT.turret,
  resonance: SKILL.ACCENT.resonance,
  common: '#b388ff',
};
const TAG_LABEL = { turret: '炮台', resonance: '共鸣', common: '通用' };

/** 属性牌三选一面板（通用节奏：分数跨过 CARD.INTERVAL；教学关：脚本指定时机只发某系牌） */
function drawCards(ctx, L, main) {
  const s = L.s, w = L.w, h = L.h;
  drawOverlay(ctx, L, 0.72);
  const opts = main.sceneOpts ? main.sceneOpts() : {};
  const cards = opts.cards || [];
  const meta = opts.cardsMeta || null;
  const tut = !!(meta && meta.tutorial);

  text(ctx, tut ? '天赋牌 · 三选一' : '属性牌 · 三选一', w / 2, h * 0.155, 24 * s, '#ffffff', 'center', true);
  text(ctx, tut ? (meta.note || '选一张，本局后续的技能方块都会带上它')
    : '选一张，本局后续遇到的技能方块都会带上它', w / 2, h * 0.155 + 24 * s, 12 * s,
    tut ? (TAG_ACCENT[meta.tag] || '#ffd54f') : 'rgba(255,255,255,0.62)', 'center', false);
  text(ctx, tut ? ('第 ' + meta.level + ' 关教学 · ' + (meta.force ? '选一张才能继续' : '可以不选'))
    : '（当前 ' + main.core.score + ' 分 · 每 ' + CARD.INTERVAL + ' 分一次）', w / 2, h * 0.155 + 42 * s,
    11 * s, 'rgba(255,215,79,0.85)', 'center', false);

  const btns = sceneButtons('cards', L, opts);
  for (let i = 0; i < cards.length && i < CARD.CHOICES; i++) {
    const b = btns[i];
    const card = cards[i];
    const accent = TAG_ACCENT[card.tag] || '#ffffff';
    ctx.save();
    roundRect(ctx, b.x, b.y, b.w, b.h, 14 * s);
    const g = ctx.createLinearGradient(b.x, b.y, b.x, b.y + b.h);
    g.addColorStop(0, 'rgba(30,36,66,0.98)');
    g.addColorStop(1, 'rgba(18,22,42,0.98)');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.6;
    ctx.globalAlpha = 0.85;
    ctx.stroke();
    ctx.restore();

    // 左侧色条
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = accent;
    roundRect(ctx, b.x + 5 * s, b.y + 12 * s, 3 * s, b.h - 24 * s, 2 * s);
    ctx.fill();
    ctx.restore();

    // 类型标签
    const chipW = 46 * s, chipH = 18 * s;
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = accent;
    roundRect(ctx, b.x + 14 * s, b.y + 12 * s, chipW, chipH, chipH / 2);
    ctx.fill();
    ctx.restore();
    text(ctx, TAG_LABEL[card.tag] || '属性', b.x + 14 * s + chipW / 2, b.y + 12 * s + chipH * 0.72,
      10 * s, accent, 'center', true);

    // 牌名
    text(ctx, card.name, b.x + 14 * s + chipW + 10 * s, b.y + 12 * s + chipH * 0.74, 16 * s, '#ffffff', 'left', true);

    // 说明（自动折行）
    ctx.save();
    ctx.font = (12 * s) + 'px sans-serif';
    const lines = wrapText(ctx, card.desc, b.w - 30 * s, 2);
    ctx.restore();
    for (let j = 0; j < lines.length; j++) {
      text(ctx, lines[j], b.x + 15 * s, b.y + 12 * s + chipH + 18 * s + j * 16 * s, 12 * s,
        'rgba(255,255,255,0.86)', 'left', false);
    }

    // 数值变化
    if (card.value) {
      text(ctx, card.value, b.x + b.w - 15 * s, b.y + b.h - 10 * s, 11 * s, accent, 'right', true);
    }
    // 图标
    if (card.tag === 'turret' || card.tag === 'resonance') {
      drawSkillIcon(ctx, card.tag, b.x + b.w - 26 * s, b.y + 22 * s, 11 * s, Date.now());
    }
  }

  const skip = btns[cards.length];
  if (skip) drawButton(ctx, skip, L, true);
}

/** 教学关开场目标卡：棋盘正中一张卡片，几秒后自动消失（点棋盘可提前关闭） */
function drawTip(ctx, L, main) {
  const tip = main.tip;
  if (!tip) return;
  const B = L.board, s = L.s;
  const k = Math.max(0, Math.min(1, tip.t / (tip.dur || 4000)));
  const alpha = k < 0.12 ? k / 0.12 : (k > 0.78 ? Math.max(0, (1 - k) / 0.22) : 1);
  const pw = Math.min(B.size - 12 * s, 306 * s);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = 'bold ' + (12.5 * s) + 'px sans-serif';
  const lines = wrapText(ctx, tip.text, pw - 26 * s, 3);
  const rowH = 19 * s;
  const ph = 58 * s + lines.length * rowH;
  const px = B.x + (B.size - pw) / 2, py = B.y + B.size * 0.26;
  roundRect(ctx, px, py, pw, ph, 14 * s);
  ctx.fillStyle = 'rgba(16,20,40,0.95)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,213,79,0.6)';
  ctx.lineWidth = 1.4;
  ctx.stroke();
  text(ctx, tip.title, px + pw / 2, py + 27 * s, 16 * s, '#ffd54f', 'center', true);
  for (let i = 0; i < lines.length; i++) {
    text(ctx, lines[i], px + pw / 2, py + 27 * s + (21 + i * 19) * s, 12.5 * s, 'rgba(255,255,255,0.9)', 'center', false);
  }
  text(ctx, '点棋盘可关闭', px + pw / 2, py + ph - 11 * s, 10 * s, 'rgba(255,255,255,0.38)', 'center', false);
  ctx.restore();
}

function drawGameScene(ctx, L, main, t) {
  drawHud(ctx, L, main);
  drawNextBox(ctx, L, main, t);
  drawGravBox(ctx, L, main, t);
  drawBoard(ctx, L, main, t);
  drawTip(ctx, L, main);
  drawGuide(ctx, L, main);
  drawBuildBar(ctx, L, main);
  drawFloats(ctx, L, main);
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
  for (let i = 0; i < btns.length; i++) {
    const b = btns[i];
    if (b.id === 'resume' || b.id === 'restart' || b.id === 'tomenu') drawButton(ctx, b, L, true);
  }
}

/**
 * 过关结算面板：本关成绩 + 下一关预告。
 * 达标后 core 会挂起（pendingLevelUp），棋盘保持消行后的样子停在这一帧；
 * 玩家点「进入第 N 关」→ main 调 core.confirmLevelUp() → 才清场开新关。
 */
function drawLevelClear(ctx, L, main) {
  drawOverlay(ctx, L, 0.62);
  const s = L.s, w = L.w, h = L.h;
  const opts = main.sceneOpts ? main.sceneOpts() : {};
  const rep = opts.report || {};
  const px2 = 24 * s, pw = w - 48 * s;
  const py2 = h * 0.10, ph = h * 0.62;
  roundRect(ctx, px2, py2, pw, ph, 16 * s);
  ctx.fillStyle = 'rgba(18,22,42,0.97)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,213,79,0.35)';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  text(ctx, '第 ' + (rep.level || 1) + ' 关 合格！', w / 2, py2 + 40 * s, 26 * s, '#ffd54f', 'center', true);
  text(ctx, rep.name ? ('教学 · ' + rep.name) : '继续前进', w / 2, py2 + 62 * s, 12.5 * s,
    'rgba(255,255,255,0.6)', 'center', false);

  const rows = [
    ['本关得分', '+' + (rep.gained || 0)],
    ['累计分数', String(rep.score || 0) + ' / ' + (rep.target || 0)],
    ['放下方块', (rep.locks || 0) + ' 块'],
  ];
  if (rep.lines) rows.push(['消除行数', rep.lines + ' 行']);
  if (rep.turret) rows.push(['炮台击落', rep.turret + ' 格']);
  if (rep.resonance) rows.push(['共鸣带走', rep.resonance + ' 格']);
  if (rep.cardPicks) rows.push(['天赋牌', '已选 ' + rep.cardPicks + ' 张']);
  rows.push(['本关用时', Math.max(1, Math.round((rep.ms || 0) / 1000)) + ' 秒']);

  const ry0 = py2 + 88 * s, rowH = 23 * s;
  for (let i = 0; i < rows.length; i++) {
    const yy = ry0 + i * rowH;
    text(ctx, rows[i][0], px2 + 26 * s, yy, 12.5 * s, 'rgba(255,255,255,0.58)', 'left', false);
    text(ctx, rows[i][1], px2 + pw - 26 * s, yy, 13.5 * s, '#ffffff', 'right', true);
  }

  // 下一关预告：教学关给出本关目标，正式关点明「四向随机重力登场」
  const ny = py2 + ph - 86 * s;
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(px2 + 20 * s, ny - 16 * s);
  ctx.lineTo(px2 + pw - 20 * s, ny - 16 * s);
  ctx.stroke();
  ctx.restore();
  text(ctx, '下一关 · 第 ' + (rep.next || 2) + ' 关' + (rep.nextName ? (' · ' + rep.nextName) : ''),
    px2 + 26 * s, ny + 2 * s, 14 * s, rep.nextTutorial ? '#8ec5ff' : '#ffab91', 'left', true);
  text(ctx, '合格分 ' + (rep.nextTarget || 0), px2 + pw - 26 * s, ny + 2 * s, 12 * s,
    'rgba(255,215,79,0.9)', 'right', false);
  ctx.font = 'bold ' + (11.5 * s) + 'px sans-serif';
  const gl = wrapText(ctx, rep.nextGuide || (rep.nextTutorial ? '' : '四向随机重力登场 · 技能方块按概率出现'), pw - 52 * s, 2);
  for (let i = 0; i < gl.length; i++) {
    text(ctx, gl[i], px2 + 26 * s, ny + 22 * s + i * 16 * s, 11.5 * s, 'rgba(255,255,255,0.78)', 'left', false);
  }

  const btns = sceneButtons('levelclear', L, opts);
  for (let i = 0; i < btns.length; i++) drawButton(ctx, btns[i], L, true);
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
  if (core.skillKills) {
    rows.push(['技能击落', core.skillKills + ' 格 · +' + core.skillScore]);
    rows.push(['属性牌', '已选 ' + core.cardPicks.length + ' 张']);
  }
  const ry0 = py2 + 92 * s;
  for (let i = 0; i < rows.length; i++) {
    const yy = ry0 + i * 24 * s;
    text(ctx, rows[i][0], px2 + 28 * s, yy, 13 * s, 'rgba(255,255,255,0.6)', 'left', false);
    text(ctx, rows[i][1], px2 + pw - 28 * s, yy, 14 * s, '#ffffff', 'right', true);
  }

  const btns = sceneButtons('gameover', L, main.sceneOpts ? main.sceneOpts() : {});
  for (let i = 0; i < btns.length; i++) drawButton(ctx, btns[i], L, true);
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
    drawButton(ctx, b, L, enabled);
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
  for (let i = 0; i < btns.length; i++) drawButton(ctx, btns[i], L, true);
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
    '· 方块从棋盘中心生成，箭头指示重力方向（第 7 关起四向随机）',
    '· 上/下/左/右：按屏幕方向移动一格（按键位置固定，不随重力转）',
    '· 翻转（十字正中）：旋转方块；也可直接点棋盘旋转',
    '· 速降（十字右侧）：立刻落底锁定；沿重力方向滑动棋盘同样有效',
    '· 第 1~6 关为教学关：重力恒向下、局面开局摆好，照着提示做',
    '· 教学关要先随手玩几块、再做本关要教的动作，不会一块就跳关',
    '· 分数够 + 动作练完 → 弹「过关结算」，点按钮才进下一关',
    '· 填满任意整行或整列即可消除；消除一行 = 100 × 关卡分',
    '· 消除后只有贴近消除线的一侧沉降，另一半保持原位',
    '· 第 3 关起出现技能方块（金色炮台 / 青色共鸣）',
    '· 炮台＝落地发射能量弹，穿过自己方块击落别家',
    '· 共鸣＝被消除或被击落时，同类方格一起消失',
    '· 每 ' + CARD.INTERVAL + ' 分弹三张属性牌（子弹/穿透/反弹/共鸣范围…），本局生效',
    '· 第 4 关教炮台天赋、第 6 关教共鸣天赋（只能选该系牌）',
    '· 第 7 关起合格分还要求「本关净拿分」，四向随机重力登场',
    '· 中心出生点被堵住时游戏结束（可复活一次）',
  ];
  for (let i = 0; i < lines.length; i++) {
    text(ctx, lines[i], px2 + 22 * s, py2 + 66 * s + i * 21.5 * s, 11.5 * s, 'rgba(255,255,255,0.85)', 'left', false);
  }

  const btns = sceneButtons('help', L);
  for (let i = 0; i < btns.length; i++) drawButton(ctx, btns[i], L, true);
}

/* ================= 总入口 ================= */

/** 关卡选择页：第 1~6 关为教学关，之后是正式关（都能直接进，方便老玩家跳过教学） */
function drawLevels(ctx, L, main, t) {
  const s = L.s, w = L.w, h = L.h;
  const total = LevelPlan.TOTAL_LEVELS;
  const maxReached = main.maxLevel || 1;
  text(ctx, '关卡选择', w / 2, h * 0.15, 26 * s, '#ffffff', 'center', true);
  text(ctx, '第 1~' + LevelPlan.TUTORIAL.MAX_LEVEL + ' 关是教学关（固定重力向下 · 预置局面 · 手把手）',
    w / 2, h * 0.15 + 24 * s, 12 * s, 'rgba(255,255,255,0.6)', 'center', false);
  text(ctx, '已玩到第 ' + maxReached + ' 关 · 最高分 ' + (main.best || 0),
    w / 2, h * 0.15 + 42 * s, 12 * s, 'rgba(255,215,79,0.85)', 'center', false);

  const save = main.checkpoint || null;
  const btns = sceneButtons('levels', L, {});
  for (let i = 0; i < btns.length; i++) {
    const b = btns[i];
    if (!b.level) { drawButton(ctx, b, L, true); continue; }
    const plan = LevelPlan.planFor(b.level);
    const isSave = save && save.level === b.level;
    ctx.save();
    roundRect(ctx, b.x, b.y, b.w, b.h, 12 * s);
    if (isSave) {
      const g = ctx.createLinearGradient(b.x, b.y, b.x, b.y + b.h);
      g.addColorStop(0, '#ff6b8a');
      g.addColorStop(1, '#e63958');
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = plan ? 'rgba(90,140,220,0.20)' : 'rgba(255,255,255,0.08)';
    }
    ctx.fill();
    ctx.strokeStyle = isSave ? 'rgba(255,255,255,0.55)' : (plan ? 'rgba(140,180,255,0.5)' : 'rgba(255,255,255,0.18)');
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
    const cx = b.x + b.w / 2;
    text(ctx, String(b.level), cx, b.y + b.h * 0.44, 18 * s, '#ffffff', 'center', true);
    text(ctx, plan ? plan.name : '正式关', cx, b.y + b.h - 7 * s, 9 * s,
      plan ? 'rgba(170,205,255,0.9)' : 'rgba(255,255,255,0.45)', 'center', false);
  }
}

function draw(main) {
  const ctx = main.ctx, L = main.L, t = Date.now();
  drawBackground(ctx, L);
  switch (main.state) {
    case 'menu':
      drawMenu(ctx, L, main, t);
      break;
    case 'levels':
      drawLevels(ctx, L, main, t);
      break;
    case 'playing':
      drawGameScene(ctx, L, main, t);
      break;
    case 'cards':
      drawGameScene(ctx, L, main, t);
      drawCards(ctx, L, main);
      break;
    case 'levelclear':
      drawGameScene(ctx, L, main, t);
      drawLevelClear(ctx, L, main);
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

module.exports = { buildLayout, sceneButtons, draw, roundRect, bulletDuration, drawSkillBadge, wrapText };
