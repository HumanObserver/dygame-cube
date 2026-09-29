/**
 * 无头集成冒烟测试：在 Node 中用 tt 模拟环境 + Canvas 2D Proxy mock 运行 Main，
 * 覆盖全部场景切换、按钮/手势输入、一整局到 gameover，并验证 openDataContext 模块。
 * 运行：node web-preview/smoke.js
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
  const b = Render.sceneButtons(main.state, main.L).filter((x) => x.id === id)[0];
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

/* 开始游戏 */
tapBtn('start');
assert.strictEqual(main.state, 'playing', '开始游戏');

/* 完整一局：横向铺开 + 沿重力滑动硬降，直到 gameover
 * （若全部堆在中心列，几块就会堵住中心出生点提前结束；铺开可对局更长、覆盖消行/升级路径） */
const seenDirs = new Set();
let guard = 0;
let pieceIdx = 0;
while (main.state === 'playing' && guard++ < 4000) {
  frames(2, 50); // 每轮推进 ~100ms（loop 内 dt 上限 100）
  const cur = main.core.current;
  if (!cur) continue;
  seenDirs.add(cur.dir);
  if (main.core.canControl()) {
    // 先向两侧错开落点
    const side = (pieceIdx % 2 === 0) ? 1 : -1;
    const moves = 1 + (pieceIdx % 4);
    for (let m = 0; m < moves; m++) main.core.movePerp(side);
    pieceIdx++;
    const d = DIRS[cur.dir];
    const B = main.L.board;
    const cx = B.x + B.size / 2;
    const cy = B.y + B.size / 2;
    swipe(cx, cy, cx + d.x * 140, cy + d.y * 140);
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
  ' lines=' + main.core.lines + ' dirs=[' + [...seenDirs].join(',') + '] guard=' + guard);

/* playing 场景四个控制按钮 */
tapBtn('start');
frames(30, 50); // 1500ms > hint(1000ms)，进入 fall
assert.strictEqual(main.core.phase, 'fall', '应处于 fall 阶段, 实际=' + main.core.phase);
tapBtn('left');
tapBtn('rotate');
tapBtn('right');
tapBtn('drop');
frames(3);
console.log('控制按钮 OK');

/* 分享 */
rankMod.share(main.core.score);
assert.strictEqual(shareCount, 1, 'shareAppMessage 应被调用');

/* 重力方向随机性直测：独立 rng（不干扰主流程随机流），空棋盘反复 spawn 200 次 */
const GameCore = require('../js/gamecore.js');
const gc = new GameCore({ rng: mulberry32(7) });
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
