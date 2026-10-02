/**
 * 无头集成冒烟测试：在 Node 中用 tt 模拟环境 + Canvas 2D Proxy mock 运行 Main，
 * 覆盖全部场景切换、按钮/手势输入、一整局到 gameover，并验证 openDataContext 模块。
 * 运行：node web-preview/smoke.cjs
 */
'use strict';
const assert = require('assert');

/* ---------- 可控时钟 & 确定性随机 ---------- */
let clock = 0;
Date.now = () => clock;
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
Math.random = mulberry32(42);

/* ---------- Canvas 2D mock（Proxy：任意绘制方法 → no-op） ---------- */
const gradientStub = { addColorStop() {} };
function makeCtx(canvasObj) {
  const target = {
    canvas: canvasObj,
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1,
    font: '10px sans-serif', textAlign: 'left', textBaseline: 'alphabetic',
    globalAlpha: 1, shadowColor: 'rgba(0,0,0,0)', shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0,
    lineCap: 'butt', lineJoin: 'miter', miterLimit: 10,
    globalCompositeOperation: 'source-over', imageSmoothingEnabled: true,
    lineDashOffset: 0, filter: 'none',
  };
  return new Proxy(target, {
    get(t, prop) {
      if (prop in t) return t[prop];
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient' || prop === 'createPattern') {
        return () => gradientStub;
      }
      if (prop === 'measureText') return () => ({ width: 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 });
      if (prop === 'getLineDash') return () => [];
      if (prop === 'isPointInPath') return () => false;
      if (prop === 'getImageData') return (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(4, (w | 0) * (h | 0) * 4)) });
      if (typeof prop === 'symbol') return undefined;
      return () => undefined;
    },
    set(t, prop, v) { t[prop] = v; return true; },
  });
}
const canvasMock = { width: 0, height: 0 };
const ctxMock = makeCtx(canvasMock);
canvasMock.getContext = () => ctxMock;

/* ---------- tt mock ---------- */
const storage = new Map();
const touchCbs = {};
let shareCount = 0;
const showCbs = [];            // tt.onShow 回调（侧边栏复访）
const mock = {                 // 平台能力调用计数
  navigateToScene: 0, addToDesktop: 0, subscribe: 0, interstitial: 0, iap: 0,
};
function fireShow(opts) { for (const cb of showCbs) cb(opts); }
/** 同步回调的激励视频/插屏 mock（冒烟测试为假时钟，必须同步触发 onClose） */
function mockAd(kind, onShowCb) {
  const closeCbs = [];
  return {
    load: () => Promise.resolve(),
    show: () => {
      if (onShowCb) onShowCb();
      for (const cb of closeCbs) cb({ isEnded: true });
      return Promise.resolve();
    },
    onClose: (cb) => closeCbs.push(cb),
    onError: () => {},
    onLoad: () => {},
    destroy: () => {},
  };
}
global.tt = {
  createCanvas: () => canvasMock,
  getSystemInfoSync: () => ({ windowWidth: 390, windowHeight: 844, pixelRatio: 2, platform: 'smoke' }),
  onTouchStart: (cb) => { touchCbs.start = cb; },
  onTouchMove: (cb) => { touchCbs.move = cb; },
  onTouchEnd: (cb) => { touchCbs.end = cb; },
  onTouchCancel: (cb) => { touchCbs.cancel = cb; },
  getStorageSync: (k) => (storage.has(k) ? storage.get(k) : ''),
  setStorageSync: (k, v) => { storage.set(k, v); },
  removeStorageSync: (k) => { storage.delete(k); },
  vibrateShort() {}, vibrateLong() {},
  onHide() {}, onError() {},
  shareAppMessage() { shareCount++; },
  setUserCloudStorage(o) { if (o && o.success) o.success(); },
  getOpenDataContext: () => null,

  /* ---- 生命周期 / 侧边栏复访 ---- */
  onShow: (cb) => { showCbs.push(cb); },
  getLaunchOptionsSync: () => ({ scene: '010115', query: {} }),
  checkScene: (o) => { if (o && o.success) o.success({ isExist: true }); },
  navigateToScene: (o) => {
    mock.navigateToScene++;
    assert.strictEqual(o && o.scene, 'sidebar', 'navigateToScene 必须传 scene=sidebar');
    if (o && o.success) o.success({});
  },

  /* ---- 添加到桌面 / 订阅消息 ---- */
  addToDesktop: (o) => { mock.addToDesktop++; if (o && o.success) o.success({}); },
  requestSubscribeMessage: (o) => {
    mock.subscribe++;
    assert.ok(Array.isArray(o && o.tmplIds) && o.tmplIds.length > 0, '订阅消息需传 tmplIds');
    if (o && o.success) o.success({});
  },

  /* ---- 广告 ---- */
  createRewardedVideoAd: () => mockAd('rewarded'),
  createInterstitialAd: () => mockAd('interstitial', () => { mock.interstitial++; }),

  /* ---- 内购 ---- */
  requestMidasPaymentGameItem: (o) => { mock.iap++; if (o && o.success) o.success({}); },

  /* ---- 弹窗（同步确认） ---- */
  showModal: (o) => { if (o && o.success) o.success({ confirm: true, cancel: false }); },
};

/* ---------- rAF 捕获 ---------- */
let pendingFrame = null;
global.requestAnimationFrame = (cb) => { pendingFrame = cb; return 1; };
global.cancelAnimationFrame = () => { pendingFrame = null; };

function frames(n, dt) {
  for (let i = 0; i < n; i++) {
    clock += (dt === undefined ? 16 : dt);
    const cb = pendingFrame;
    pendingFrame = null;
    if (cb) cb(clock);
  }
}

/* ---------- 输入模拟 ---------- */
function touchAt(type, x, y) {
  const p = { clientX: x, clientY: y, identifier: 0 };
  const ev = { type: 'touch' + type, touches: type === 'end' ? [] : [p], changedTouches: [p], timeStamp: clock };
  touchCbs[type](ev);
}
function tap(x, y) {
  touchAt('start', x, y);
  clock += 30;
  touchAt('end', x, y);
}
function swipe(x1, y1, x2, y2) {
  touchAt('start', x1, y1);
  clock += 16;
  touchAt('move', x2, y2);
  clock += 16;
  touchAt('end', x2, y2);
}

/* ---------- 启动游戏 ---------- */
const Main = require('../js/main.js');
const Render = require('../js/render.js');
const rankMod = require('../js/rank.js');
const { DIRS } = require('../js/config.js');

const main = new Main();
assert.strictEqual(main.state, 'menu', '初始场景应为 menu');
frames(5);

function btnCenter(id) {
  const opts = main.sceneOpts ? main.sceneOpts() : {};
  const b = Render.sceneButtons(main.state, main.L, opts).filter((x) => x.id === id)[0];
  assert.ok(b, '按钮不存在: ' + id + ' @ ' + main.state);
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}
function tapBtn(id) {
  const c = btnCenter(id);
  tap(c.x, c.y);
  frames(2);
}

/* menu → help → menu */
tapBtn('help');
assert.strictEqual(main.state, 'help', 'help 场景');
tap(5, 5);
frames(2);
assert.strictEqual(main.state, 'menu', 'help 点击空白返回 menu');

/* menu → rank → back */
tapBtn('rank');
assert.strictEqual(main.state, 'rank', 'rank 场景');
tapBtn('back');
assert.strictEqual(main.state, 'menu', 'rank 返回 menu');

/* ---------- 教学关（第 1~6 关）：固定向下重力 + 过关结算 + 开局断点 ---------- */
tapBtn('start');
assert.strictEqual(main.state, 'playing', '开始游戏');
assert.strictEqual(main.core.level, 1, '新对局从第 1 关（教学）开始');
assert.strictEqual(main.core.plan && main.core.plan.setup, 'starter', '第 1 关应铺教学局面');
assert.ok(main.checkpoint && main.checkpoint.level === 1, '开局应存下关卡断点');

let tutGuard = 0;
let sawPanel = false;
while (main.core.level === 1 && tutGuard++ < 400) {
  if (main.state === 'levelclear') { sawPanel = true; break; }
  if (main.state !== 'playing') { frames(2, 50); continue; }
  frames(2, 50);
  const cur = main.core.current;
  if (!cur || !main.core.canControl()) continue;
  assert.strictEqual(cur.dir, 0, '教学关重力恒为向下');
  // 把方块对齐底行缺口，然后按「速降」键：门槛要求亲手消一行 + 再多玩几块
  const cells = main.core.cells(cur);
  let sum = 0;
  for (let i = 0; i < cells.length; i++) sum += cells[i].x;
  const cx0 = Math.round(sum / cells.length);
  for (let m = 0; m < Math.abs(cx0 - 10); m++) main.core.moveDir(cx0 > 10 ? 1 : 3);
  tapBtn('drop');
  frames(2, 50);
  if (main.core.pendingCards) { tapBtn('card0'); frames(2, 50); }
}
assert.ok(sawPanel, '分数 + 门槛都达成后应弹「过关结算」，而不是直接跳关');
assert.strictEqual(main.core.level, 1, '结算未确认 → 仍停在第 1 关');
assert.ok(main.core.levelStats.clears >= 1, '第 1 关应完成消行教学');
assert.ok(main.core.locksInLevel >= 5, '过关前应先自由玩几块，实际=' + main.core.locksInLevel);
assert.ok(main.core.score > 0, '教学关应有得分');
frames(3); // 真正画一遍结算面板（drawLevelClear 分支）
const rep = main.core.pendingLevelUp;
assert.ok(rep && rep.next === 2 && rep.target > 0 && rep.locks >= 5, '结算应带本关成绩与下一关预告');
tapBtn('nextLevel');
frames(2, 50);
assert.strictEqual(main.state, 'playing', '确认后回到对局');
assert.strictEqual(main.core.level, 2, '确认后升入第 2 关');
assert.strictEqual(main.core.plan && main.core.plan.setup, 'clearRow', '第 2 关铺消除缺口');
assert.ok(main.checkpoint && main.checkpoint.level === 2, '进入新关后断点应更新到第 2 关');
console.log('教学关 OK — 结算面板 → 第' + main.core.level + '关 落块' + rep.locks
  + ' 消行' + rep.lines + ' score=' + main.core.score + ' 断点=第' + main.checkpoint.level + '关');

/* ---------- 断点续玩：新会话从「继续 · 第 N 关」接上 ---------- */
main.setState('menu');
frames(2);
const progressMod = require('../js/progress.js');
const saved = progressMod.load();
assert.ok(saved && saved.level >= 2, '关卡开局断点应已落盘, 实际=' + JSON.stringify(saved));
main.checkpoint = saved; // 模拟重开一次会话：菜单读到上次的断点
tapBtn('resume');
assert.strictEqual(main.state, 'playing', '菜单「继续」应直接进游戏');
assert.strictEqual(main.core.level, saved.level, '续玩关卡与断点一致');
assert.strictEqual(main.core.score, saved.score, '续玩分数与断点一致');
assert.ok(main.core.plan, '续玩仍带教学脚本');
console.log('断点续玩 OK — 第' + main.core.level + '关 / ' + main.core.score + '分');

/* ---------- 关卡选择 → 正式关（四向随机重力）跑完整一局 ---------- */
main.onButton('levels');
assert.strictEqual(main.state, 'levels', '关卡选择场景');
frames(2); // 真正画一遍选关页（含 drawLevels 分支）
main.onButton('level7');
assert.strictEqual(main.state, 'playing', '选关直接进入第 7 关');
assert.strictEqual(main.core.level, 7, '应为第 7 关');
assert.ok(!main.core.plan, '第 7 关起不再是教学关');

/* 完整一局：横向铺开 + 硬降（每 7 块改压一次「下滑方向滑动」），直到 gameover
 * （若全部堆在中心列，几块就会堵住中心出生点提前结束；铺开可对局更长） */
const seenDirs = new Set();
let guard = 0;
let pieceIdx = 0;
let panelCount = 0;
while ((main.state === 'playing' || main.state === 'levelclear' || main.state === 'cards') && guard++ < 4000) {
  frames(2, 50); // 每轮推进 ~100ms（loop 内 dt 上限 100）
  if (main.core.pendingCards) { tapBtn('card0'); frames(2, 50); }
  if (main.state === 'levelclear') {
    panelCount++;
    frames(2); // 结算面板也画一帧
    tapBtn('nextLevel');
    continue;
  }
  if (main.state !== 'playing') continue;
  const cur = main.core.current;
  if (!cur) continue;
  seenDirs.add(cur.dir);
  if (main.core.canControl()) {
    // 先向两侧错开落点
    const side = (pieceIdx % 2 === 0) ? 1 : -1;
    const moves = 1 + (pieceIdx % 4);
    for (let m = 0; m < moves; m++) main.core.movePerp(side);
    pieceIdx++;
    if (pieceIdx % 7 === 0) {
      // 顺带压一遍「屏幕方向滑动」输入：向下快滑 = 速降
      const B = main.L.board;
      swipe(B.x + B.size / 2, B.y + B.size / 2, B.x + B.size / 2, B.y + B.size / 2 + 140);
    } else {
      main.core.hardDrop();
    }
    frames(2, 50);
  }
}
assert.strictEqual(main.state, 'gameover', '应结束于 gameover (guard=' + guard + ')');
assert.ok(guard < 4000, 'guard 用尽仍未结束');
assert.strictEqual(seenDirs.size, 4, '应出现全部 4 个重力方向: ' + [...seenDirs]);
assert.ok(main.core.score > 0, '应有得分');
assert.ok(rankMod.getBest() > 0, '本机 best 应已持久化');
assert.ok(rankMod.getLocal().length >= 1, '本机排行应有记录');

/* gameover → rank → back → retry → pause → resume → tomenu */
tapBtn('rank');
assert.strictEqual(main.state, 'rank');
tapBtn('back');
assert.strictEqual(main.state, 'gameover', 'rank 应返回 gameover');
tapBtn('retry');
assert.strictEqual(main.state, 'playing', 'retry 重开');
tapBtn('pause');
assert.strictEqual(main.state, 'paused', '暂停');
tapBtn('resume');
assert.strictEqual(main.state, 'playing', '恢复');
tapBtn('pause');
assert.strictEqual(main.state, 'paused', '再次暂停');
tapBtn('tomenu');
assert.strictEqual(main.state, 'menu', '回主菜单');

console.log('主流程 OK — score=' + main.core.score + ' level=' + main.core.level +
  ' lines=' + main.core.lines + ' dirs=[' + [...seenDirs].join(',') + '] guard=' + guard +
  ' 结算面板=' + panelCount);

/* playing 场景：固定十字五键 + 速降（按键不随重力旋转） */
tapBtn('start');
frames(30, 50); // 1500ms > hint(1000ms)，进入 fall
assert.strictEqual(main.core.phase, 'fall', '应处于 fall 阶段, 实际=' + main.core.phase);
tapBtn('up');
tapBtn('left');
tapBtn('flip');
tapBtn('right');
tapBtn('down');
tapBtn('drop');
frames(3);
console.log('控制按钮 OK');

/* 分享 */
rankMod.share(main.core.score);
assert.strictEqual(shareCount, 1, 'shareAppMessage 应被调用');

/* ---------- 新玩法冒烟：半侧沉降 / 过关结算 / 炮台 / 共鸣 / 属性牌 ---------- */
const Skills = require('../js/skills.js');
const { SHAPES } = require('../js/tetromino.js');
const { ROWS: SR, COLS: SC, CARD: SCARD, LEVEL_TARGETS: SLT, SKILL: SSK } = require('../js/config.js');

/** 机制冒烟专用：手动摆棋盘 + 硬降，教学脚本的预置局面会干扰断言 → 关掉教学关 */
function freshGame() {
  main.onButton('start');
  frames(2, 50);
  assert.strictEqual(main.state, 'playing');
  main.core.tutorialOn = false;
  delete main.core.levelTarget; // 清掉上一段可能留下的「屏蔽升关」钩子
  main.core.startLevel(1);      // 空棋盘重开（教学关预置局面已随 tutorialOn 关闭）
  frames(2, 50);
  assert.strictEqual(main.core.board.allCells().length, 0, '机制冒烟应从空棋盘开始');
  return main.core;
}

/* 1) 半侧沉降：中间行消除，线上方下沉、线下方保持 */
{
  const core = freshGame();
  core.level = 1;
  core.levelTarget = () => Infinity; // 只验沉降：别让达标把棋盘清掉
  const row = [];
  for (let c = 0; c < SC; c++) row.push({ x: c, y: 10 });
  core.board.lock(row, 'I');
  core.board.lock([{ x: 2, y: 4 }], 'J'); // 消除线之上 → 应下沉
  core.board.lock([{ x: 2, y: 16 }], 'T'); // 消除线之下 → 应保持
  core.phase = 'fall';
  core.current = { type: 'O', matrix: SHAPES.O, dir: 0, x: 0, y: SR - 2 };
  core.hardDrop();
  frames(2, 50);
  assert.strictEqual(core.lines, 1, '半侧沉降冒烟：应消除 1 行');
  assert.strictEqual(core.board.grid[10][2], 'J', '上半应沉到贴合消除线');
  assert.strictEqual(core.board.grid[16][2], 'T', '下半应保持原位');
}

/* 2) 过关结算：达标先弹面板，确认后才清场、积分累加 */
{
  const core = freshGame();
  core.score = SLT[0] - 100;
  const row = [];
  for (let c = 0; c < SC - 2; c++) row.push({ x: c, y: SR - 1 });
  core.board.lock(row, 'J');
  core.board.lock([{ x: 6, y: 3 }], 'Z');
  core.phase = 'fall';
  core.current = { type: 'O', matrix: SHAPES.O, dir: 0, x: SC - 2, y: SR - 3 };
  core.hardDrop();
  frames(2, 50);
  assert.strictEqual(main.state, 'levelclear', '合格分达成 → 先弹「过关结算」');
  assert.strictEqual(core.level, 1, '未确认不跳关');
  assert.ok(core.board.allCells().length > 0, '结算期间棋盘停在最后一帧');
  tapBtn('nextLevel');
  frames(2, 50);
  assert.strictEqual(core.level, 2, '确认后进入第 2 关');
  assert.strictEqual(core.board.allCells().length, 0, '过关应清场');
  assert.strictEqual(main.state, 'playing', '确认后回到对局');
  assert.ok(core.score >= SLT[0], '积分累加不清零: ' + core.score);
  assert.ok(main.fx.length > 0 || main.toast, '过关应有动效或提示');
}

/* 3) 炮台：落地开火击落方格，穿过自己方块的其余格，其余方格保持，且有弹道/爆点动效 */
{
  const core = freshGame();
  main.fx = []; main.floats = []; main.shake = null;
  core.board.lock([{ x: 8, y: 12 }], 'J');
  core.board.lock([{ x: 8, y: 6 }], 'Z'); // 穿透 0 → 不应被击落
  core.phase = 'fall';
  core.current = {
    type: 'O', matrix: SHAPES.O, dir: 0, x: 8, y: SR - 2,
    skill: { kind: 'turret', mx: 0, my: 1, mods: Skills.defaultMods() }, // 技能格在 (8,19)，向上先遇到己方格 (8,18)
  };
  core.hardDrop();
  frames(2, 50);
  assert.strictEqual(core.board.grid[SR - 2][8], 'O', '子弹不打自己方块的其余格');
  assert.strictEqual(core.board.grid[12][8], null, '穿过己方格后击落弹道上的方格');
  assert.strictEqual(core.board.grid[6][8], 'Z', '穿透 0：更远处方格不受影响');
  assert.strictEqual(core.skillKills, 1);
  assert.ok(core.board.skillAt(8, SR - 1) && core.board.skillAt(8, SR - 1).kind === 'turret', '炮台格应留在场上');
  const kinds = main.fx.map((f) => f.kind);
  assert.ok(kinds.indexOf('turret') >= 0, '应有子弹弹道动效: ' + JSON.stringify(kinds));
  assert.ok(kinds.indexOf('impact') >= 0, '应有命中爆点动效: ' + JSON.stringify(kinds));
  assert.ok(main.floats.length >= 1, '应有技能加分漂浮字');
}

/* 3b) 命中震屏：击落方格时触发，且会自然结束 */
{
  assert.ok(main.shake && main.shake.amp > 0, '命中应触发震屏');
  frames(12, 50);
  assert.strictEqual(main.shake, null, '震屏应在时长结束后复位');
}

/* 4) 共鸣：整行消除时带走同类方格；被带走的炮台格补射（各自的技能特效） */
{
  const core = freshGame();
  main.fx = []; main.floats = [];
  const row = [];
  for (let c = 0; c < SC - 2; c++) row.push({ x: c, y: SR - 1 });
  core.board.lock(row, 'Q');
  core.board.setSkill(3, SR - 1, { kind: 'resonance', dir: 0, mods: Skills.defaultMods() });
  core.board.lock([{ x: 7, y: 3 }], 'Q'); // 同类远端方格（带炮台 → 被带走时补射）
  core.board.setSkill(7, 3, { kind: 'turret', dir: 0, mods: Skills.defaultMods(), own: [{ x: 7, y: 3 }] });
  core.board.lock([{ x: 7, y: 0 }], 'J'); // 补射目标
  core.phase = 'fall';
  core.current = { type: 'O', matrix: SHAPES.O, dir: 0, x: SC - 2, y: SR - 2 };
  core.hardDrop();
  frames(2, 50);
  assert.strictEqual(core.board.allCells().filter((c) => c.type === 'Q').length, 0, '同类方格全部消失');
  assert.strictEqual(core.board.grid[0][7], null, '被共鸣带走的炮台格补射击落目标');
  assert.ok(core.skillKills >= 2, '共鸣 + 补射击落都计分: ' + core.skillKills);
  const kinds4 = main.fx.map((f) => f.kind);
  assert.ok(kinds4.indexOf('resonance') >= 0, '应有共鸣波动效');
  assert.ok(kinds4.indexOf('impact') >= 0, '被消除的方格应有各自的命中爆点');
  assert.ok(kinds4.indexOf('turret') >= 0, '补射应有自己的弹道动效: ' + JSON.stringify(kinds4));
}

/* 5) 属性牌：三选一场景进入 / 选择 / 跳过 */
{
  const core = freshGame();
  core.levelTarget = () => Infinity; // 这段只验发牌：别让 700 分顺手把过关结算弹出来
  core.score = SCARD.INTERVAL;
  core._syncCards();
  frames(2, 50);
  assert.strictEqual(main.state, 'cards', '分数过线应进入属性牌场景');
  assert.ok(core.pendingCards && core.pendingCards.length === SCARD.CHOICES, '应待发三张牌');
  const cbs = Render.sceneButtons(main.state, main.L, main.sceneOpts());
  assert.strictEqual(cbs.length, SCARD.CHOICES + 1, '三张牌 + 跳过按钮');
  const before = JSON.stringify(core.mods);
  tapBtn('card0');
  assert.strictEqual(main.state, 'playing', '选牌后回到游戏');
  assert.strictEqual(core.pendingCards, null, '选牌后解除暂停');
  assert.notStrictEqual(JSON.stringify(core.mods), before, '选牌应改变本局构筑');
  assert.strictEqual(core.cardPicks.length, 1);

  core.score = SCARD.INTERVAL * 2;
  core._syncCards();
  frames(2, 50);
  assert.strictEqual(main.state, 'cards', '第二次过线再次弹牌');
  tapBtn('cardsSkip');
  assert.strictEqual(main.state, 'playing', '跳过应回到游戏');
  assert.strictEqual(core.cardPicks.length, 1, '跳过不记录选择');
  main.setState('menu'); frames(2);
}
console.log('新玩法冒烟 OK — 半侧沉降 / 过关结算 / 炮台 / 共鸣 / 属性牌');

/* ---------- 平台能力冒烟：侧边栏复访 / 桌面 / 订阅 / 广告金币 / 复活 / 插屏 ---------- */
const platform = require('../js/platform.js');
const { ROWS: RWS, PLATFORM: PCFG } = require('../js/config.js');

platform.init(); // 注册 onShow/checkScene + 新手赠币（一次性）
assert.strictEqual(platform.api.sidebar, true, '应检测到 navigateToScene');
assert.ok(platform.getCoins() >= PCFG.WELCOME_COINS, '新手赠币应到账');

// 普通启动（非侧边栏）→ 不可领奖
let st = platform.getSidebarState();
assert.strictEqual(st.supported, true, 'checkScene isExist=true → supported');
assert.strictEqual(st.claimable, false, '非侧边栏启动不可领奖');

// 模拟从抖音首页侧边栏复访进入（官方启动参数）
fireShow({ scene: '021036', query: {}, launch_from: 'homepage', location: 'sidebar_card' });
st = platform.getSidebarState();
assert.strictEqual(st.fromSidebar, true, '应判定为侧边栏启动');
assert.strictEqual(st.claimable, true, '侧边栏启动 + 未领取 → 可领奖');

// menu → 侧边栏奖励面板 → 领取奖励
main.setState('menu'); frames(2);
tapBtn('sidebarGift');
assert.strictEqual(main.state, 'sidebar', '侧边栏任务面板');
const coinsBefore = platform.getCoins();
tapBtn('sidebarAction');
assert.strictEqual(platform.getCoins(), coinsBefore + PCFG.SIDEBAR_REWARD_COINS, '领奖后金币增加');
assert.strictEqual(platform.getSidebarState().claimedToday, true, '今日已领取');
tapBtn('sidebarAction'); // 已领取后再点 → 仍可跳侧边栏（培养复访），但不重复发奖
assert.strictEqual(platform.getCoins(), coinsBefore + PCFG.SIDEBAR_REWARD_COINS, '重复点击不重复发奖');
assert.strictEqual(mock.navigateToScene, 1, 'navigateToScene(scene=sidebar) 应被调用');
tapBtn('sidebarClose');
assert.strictEqual(main.state, 'menu', '关闭面板回菜单');

// 小按钮：添加到桌面 / 订阅提醒 / 免费金币（激励视频同步 mock → +金币）
const c1 = platform.getCoins();
tapBtn('desktop');
assert.strictEqual(mock.addToDesktop, 1, 'addToDesktop 应被调用');
tapBtn('subscribe');
assert.strictEqual(mock.subscribe, 1, 'requestSubscribeMessage 应被调用');
tapBtn('freeCoins');
assert.strictEqual(platform.getCoins(), c1 + PCFG.AD_REWARD_COINS, '看广告应得金币');

// 非侧边栏启动时点「去首页侧边栏」→ navigateToScene(scene='sidebar')
fireShow({ scene: '010115', query: {} }); // 切回普通启动信息
tapBtn('sidebarGift');
tapBtn('sidebarAction');
assert.strictEqual(mock.navigateToScene, 2, 'navigateToScene 应再次被调用');
tapBtn('sidebarClose');

// 构造游戏结束 → 复活按钮出现 → 点复活（激励视频路径，同步 onClose isEnded）
main.onButton('start');
assert.strictEqual(main.state, 'playing');
{
  const core = main.core;
  core.reset();
  const cc = [];
  const c0 = Math.floor(RWS / 2) - 2;
  for (let r = c0; r < c0 + 4; r++) for (let c = c0; c < c0 + 4; c++) cc.push({ x: c, y: r });
  core.board.lock(cc, 'Z');
  core.current = null;
  core.spawn(); // 中心被堵 → gameover 事件
  frames(2, 50); // 主循环处理事件 → 切结算面板
}
assert.strictEqual(main.state, 'gameover', '应进入结算');
assert.ok(mock.interstitial >= 1, 'gameover 应触发插屏广告');
assert.strictEqual(main.canRevive(), true, '应可复活');
{
  const core = main.core;
  const scoreBefore = core.score;
  core.score = 500; // 便于断言分数保留
  tapBtn('revive');
  assert.strictEqual(main.state, 'playing', '复活后应回到游戏');
  assert.strictEqual(core.gameOver, false, '复活后非结束态');
  assert.strictEqual(core.score, 500, '复活保留分数');
  assert.strictEqual(main.reviveUsed, true, '复活已用');
  assert.strictEqual(main.canRevive(), false, '每局限一次复活');
  core.score = scoreBefore;
}
main.setState('menu'); frames(2);
console.log('平台能力 OK — coins=' + platform.getCoins() +
  ' navigateToScene=' + mock.navigateToScene + ' interstitial=' + mock.interstitial);

/* 重力方向随机性直测：独立 rng（不干扰主流程随机流），空棋盘反复 spawn 200 次
 * （教学关第 1~6 关重力恒向下，这里要验的是正式关的四向随机 → tutorial:false） */
const GameCore = require('../js/gamecore.js');
const gc = new GameCore({ rng: mulberry32(7), tutorial: false });
const dirTally = [0, 0, 0, 0];
for (let i = 0; i < 200; i++) {
  gc.spawn();
  dirTally[gc.current.dir]++;
}
assert.ok(dirTally.every((n) => n >= 25), '4 个方向应均匀出现（期望各 ~50 次）: ' + dirTally);
console.log('方向随机直测 OK — down/left/up/right = ' + dirTally.join('/'));

/* ---------- openDataContext 冒烟 ---------- */
const sharedCanvas = { width: 0, height: 0 };
const sharedCtx = makeCtx(sharedCanvas);
sharedCanvas.getContext = () => sharedCtx;
let odcMessageCb = null;
const createdImages = [];
global.tt = {
  getSharedCanvas: () => sharedCanvas,
  onMessage: (cb) => { odcMessageCb = cb; },
  getFriendCloudStorage: (opts) => {
    if (opts && opts.success) {
      opts.success({
        data: [
          { nickname: '张三', avatarUrl: 'https://example.com/a.png', KVDataList: [{ key: 'score', value: '1200' }, { key: 'level', value: '3' }, { key: 'lines', value: '25' }] },
          { nickname: '一个非常非常长的昵称测试', avatarUrl: '', KVDataList: [{ key: 'score', value: '900' }] },
          { nickname: 'Li', avatarUrl: 'https://example.com/b.png', KVDataList: [{ key: 'score', value: '2500' }, { key: 'level', value: '5' }, { key: 'lines', value: '41' }] },
        ],
      });
    }
  },
  createImage: () => {
    const img = { onload: null, onerror: null, _src: '', width: 40, height: 40 };
    Object.defineProperty(img, 'src', {
      get() { return img._src; },
      set(v) { img._src = v; createdImages.push(img); },
    });
    return img;
  },
};
require('../openDataContext/index.js');
assert.ok(odcMessageCb, 'openDataContext 应注册 onMessage');
odcMessageCb({ type: 'renderRank', width: 300, height: 400 });
assert.strictEqual(sharedCanvas.width, 300);
assert.strictEqual(sharedCanvas.height, 400);
if (createdImages[0] && createdImages[0].onload) createdImages[0].onload();
odcMessageCb({ type: 'hide' });
console.log('openDataContext OK — images=' + createdImages.length);

console.log('SMOKE OK');
