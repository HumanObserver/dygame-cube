/**
 * 主控制器：初始化画布、游戏循环、输入分发、场景切换
 */
const GameCore = require('./gamecore.js');
const Render = require('./render.js');
const Input = require('./input.js');
const rank = require('./rank.js');
const { DIRS, PERP } = require('./config.js');

const TT = (typeof tt !== 'undefined') ? tt : null;

class Main {
  constructor() {
    if (!TT || !TT.createCanvas) {
      throw new Error('tt API 不可用：本项目需在抖音开发者工具/真机中运行');
    }
    // 首次调用 createCanvas 返回上屏画布
    this.canvas = TT.createCanvas();
    this.ctx = this.canvas.getContext('2d');

    const info = TT.getSystemInfoSync();
    this.w = info.windowWidth || 375;
    this.h = info.windowHeight || 667;
    this.dpr = Math.min(info.pixelRatio || 2, 3);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    this.L = Render.buildLayout(this.w, this.h);
    this.core = new GameCore();

    this.state = 'menu'; // menu | playing | paused | gameover | rank | help
    this.best = rank.getBest();
    this.localRank = rank.getLocal();
    this.friendCanvas = null;
    this.newBest = false;
    this.fx = [];      // 消行闪光 [{cells, t, dur}]
    this.toast = null; // 浮字 {text, t, dur}
    this.last = Date.now();
    this._rankReturn = 'menu';

    this.input = new Input(TT);
    this.input.onTap = (x, y) => this.handleTap(x, y);
    this.input.onSwipe = (dx, dy, sx, sy) => this.handleSwipe(dx, dy, sx, sy);

    // 切后台自动暂停
    try {
      if (TT.onHide) TT.onHide(() => this.autoPause());
    } catch (e) { /* 忽略 */ }
    try {
      if (TT.onError) TT.onError((err) => console.error('[game error]', err));
    } catch (e) { /* 忽略 */ }

    this._raf = (typeof requestAnimationFrame === 'function')
      ? requestAnimationFrame
      : (cb) => setTimeout(() => cb(Date.now()), 16);
    this.loop = this.loop.bind(this);
    this._raf(this.loop);
  }

  /* ---------- 场景切换 ---------- */

  autoPause() {
    if (this.state === 'playing') this.state = 'paused';
  }

  setState(s) {
    if (this.state === 'rank' && s !== 'rank') rank.hideFriendRank();
    this.state = s;
    if (s === 'rank') this.enterRank();
  }

  enterRank() {
    this.localRank = rank.getLocal();
    this.best = rank.getBest();
    const A = this.L.rankArea;
    this.friendCanvas = rank.showFriendRank(A.w * this.dpr, A.h * this.dpr);
  }

  startGame() {
    this.core.reset();
    this.fx = [];
    this.toast = null;
    this.newBest = false;
    this.state = 'playing';
  }

  /* ---------- 输入 ---------- */

  handleTap(x, y) {
    const btns = Render.sceneButtons(this.state, this.L);
    for (let i = 0; i < btns.length; i++) {
      const b = btns[i];
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
        this.onButton(b.id);
        return;
      }
    }
    if (this.state === 'help') { this.setState('menu'); return; }
    if (this.state === 'playing') {
      const B = this.L.board;
      if (x >= B.x && x <= B.x + B.size && y >= B.y && y <= B.y + B.size) {
        if (this.core.rotate()) this.vibrate(8);
      }
    }
  }

  handleSwipe(dx, dy, sx, sy) {
    if (this.state !== 'playing' || !this.core.canControl()) return;
    const B = this.L.board;
    // 仅响应从棋盘区域起始的滑动
    if (!(sx >= B.x && sx <= B.x + B.size && sy >= B.y && sy <= B.y + B.size)) return;

    const dir = this.core.current.dir;
    const d = DIRS[dir];
    const p = PERP[dir];
    const dotG = dx * d.x + dy * d.y;   // 沿重力分量
    const dotP = dx * p.x + dy * p.y;   // 垂直分量

    if (Math.abs(dotG) >= Math.abs(dotP)) {
      if (dotG > 30) { this.core.hardDrop(); this.vibrate(15); }
    } else {
      const steps = Math.min(4, Math.max(1, Math.round(Math.abs(dotP) / 28)));
      const sign = dotP > 0 ? 1 : -1;
      let moved = false;
      for (let i = 0; i < steps; i++) { if (this.core.movePerp(sign)) moved = true; else break; }
      if (moved) this.vibrate(5);
    }
  }

  onButton(id) {
    switch (id) {
      case 'start':
      case 'retry':
      case 'restart':
        this.startGame();
        break;
      case 'resume':
        this.state = 'playing';
        break;
      case 'pause':
        if (this.state === 'playing') this.state = 'paused';
        break;
      case 'tomenu':
        this.setState('menu');
        break;
      case 'rank':
        this._rankReturn = (this.state === 'gameover') ? 'gameover' : 'menu';
        this.setState('rank');
        break;
      case 'back':
        this.setState(this._rankReturn || 'menu');
        break;
      case 'help':
        this.setState('help');
        break;
      case 'share':
        rank.share(this.core.score);
        break;
      case 'left':
        if (this.core.movePerp(-1)) this.vibrate(5);
        break;
      case 'right':
        if (this.core.movePerp(1)) this.vibrate(5);
        break;
      case 'rotate':
        if (this.core.rotate()) this.vibrate(8);
        break;
      case 'drop':
        if (this.core.canControl()) { this.core.hardDrop(); this.vibrate(15); }
        break;
      default:
        break;
    }
  }

  vibrate(ms) {
    try {
      if (ms >= 50 && TT.vibrateLong) TT.vibrateLong({ fail() {} });
      else if (TT.vibrateShort) TT.vibrateShort({ fail() {} });
    } catch (e) { /* 忽略 */ }
  }

  /* ---------- 事件与特效 ---------- */

  processEvents() {
    const evs = this.core.drainEvents();
    for (let i = 0; i < evs.length; i++) {
      const ev = evs[i];
      if (ev.type === 'clear') {
        this.fx.push({ cells: ev.cells, t: 0, dur: 300 });
        this.toast = { text: ev.count >= 2 ? ('消除 x' + ev.count + '！') : '消除！', t: 0, dur: 900 };
        this.vibrate(20);
      } else if (ev.type === 'levelup') {
        this.toast = { text: '第 ' + ev.level + ' 关 · 速度提升！', t: 0, dur: 1400 };
        this.vibrate(30);
      } else if (ev.type === 'gameover') {
        const r = rank.submit(this.core.score, this.core.level, this.core.lines);
        this.best = r.best;
        this.localRank = r.local;
        this.newBest = r.isBest;
        this.vibrate(80);
        this.setState('gameover');
      }
    }
  }

  updateFx(dt) {
    for (let i = this.fx.length - 1; i >= 0; i--) {
      this.fx[i].t += dt;
      if (this.fx[i].t >= this.fx[i].dur) this.fx.splice(i, 1);
    }
    if (this.toast) {
      this.toast.t += dt;
      if (this.toast.t >= this.toast.dur) this.toast = null;
    }
  }

  /* ---------- 主循环 ---------- */

  loop() {
    const now = Date.now();
    const dt = Math.min(100, now - this.last);
    this.last = now;

    if (this.state === 'playing') {
      this.core.update(dt);
      this.processEvents();
    }
    this.updateFx(dt);
    Render.draw(this);
    this._raf(this.loop);
  }
}

module.exports = Main;
