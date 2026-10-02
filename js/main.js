/**
 * 主控制器：初始化画布、游戏循环、输入分发、场景切换
 */
const GameCore = require('./gamecore.js');
const Render = require('./render.js');
const Input = require('./input.js');
const rank = require('./rank.js');
const platform = require('./platform.js');
const Skills = require('./skills.js');
const LevelPlan = require('./levelplan.js');
const progress = require('./progress.js');
const { PLATFORM, SKILL, CARD } = require('./config.js');

// DIRS 下标（屏幕绝对方向）：0=下 1=左 2=上 3=右。按键与滑动都用它，不随重力旋转。
const D_DOWN = 0, D_LEFT = 1, D_UP = 2, D_RIGHT = 3;

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

    this.state = 'menu'; // menu | playing | levelclear | cards | paused | gameover | rank | help | sidebar | levels
    this.best = rank.getBest();
    this.localRank = rank.getLocal();
    // 关卡进度存档：新手从第 1 关（教学）开始，之后默认「继续上次玩到的关卡」，选关可强行进入
    this.checkpoint = progress.load();
    this.maxLevel = Math.max(progress.maxLevel(), (this.checkpoint && this.checkpoint.level) || 1);
    this.friendCanvas = null;
    this.newBest = false;
    this.fx = [];      // 特效队列 [{kind, cells/shots/waves, t, dur}]
    this.floats = [];  // 漂浮加分字 [{text, x, y, t, dur, color}]
    this.shake = null; // 命中震屏 {t, dur, amp}
    this.toast = null; // 浮字 {text, t, dur}
    this.tip = null;   // 教学关开场提示卡 {title, text, t, dur}
    this.ptoast = null; // 全局平台提示 {text, t, dur}（所有场景可见）
    this.last = Date.now();
    this._rankReturn = 'menu';
    this.coins = platform.getCoins();
    this.reviveUsed = false; // 本局是否已用过复活（每局限一次）

    this.input = new Input(TT);
    this.input.onTap = (x, y) => this.handleTap(x, y);
    this.input.onSwipe = (dx, dy, sx, sy) => this.handleSwipe(dx, dy, sx, sy);

    // 从侧边栏等入口回到前台时刷新金币/状态（侧边栏复访奖励依赖最新 onShow 信息）
    platform.onShow(() => { this.coins = platform.getCoins(); });

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

  /**
   * 开一局。
   * @param opts.level    从第几关开局（关卡选择；第 1~6 关为教学关）
   * @param opts.resume   传入存档断点则从该断点的关卡开局（分数/构筑沿用）
   */
  startGame(opts) {
    opts = opts || {};
    if (opts.resume) this.core.restoreLevel(opts.resume);
    else this.core.startLevel(opts.level || 1);
    this.fx = [];
    this.floats = [];
    this.shake = null;
    this.toast = null;
    this.newBest = false;
    this.reviveUsed = false;
    this._fromClear = false;   // 过关结算的「刚确认」标记不留到新局
    this.state = 'playing';
    this.saveProgress();       // 「本关开局」= 断点，下次进来直接续这一关
    this.showLevelTip();       // 教学关：开局弹一张目标卡
  }

  /** 存下当前关卡的开局断点（只在开局时存，死亡/回主菜单不会丢进度） */
  saveProgress() {
    const rec = progress.save(this.core.snapshot());
    if (rec) {
      this.checkpoint = rec;
      this.maxLevel = Math.max(this.maxLevel || 1, rec.level);
    }
  }

  /** 教学关开场目标卡（正式关不弹） */
  showLevelTip() {
    const core = this.core;
    const plan = LevelPlan.planFor(core.level);
    if (!plan) { this.tip = null; return; }
    this.tip = { title: '第 ' + core.level + ' 关 · ' + plan.name, text: plan.guide, t: 0, dur: 4200 };
  }

  /* ---------- 平台能力（侧边栏/桌面/订阅/广告/内购，详见 js/platform.js） ---------- */

  /** 供渲染/命中检测使用的场景状态 */
  sceneOpts() {
    const st = platform.getSidebarState();
    return {
      canRevive: this.canRevive(),
      sidebarSupported: st.supported,
      sidebarClaimable: st.claimable,
      sidebarClaimedToday: st.claimedToday,
      cards: this.core.pendingCards || null, // 属性牌三选一（cards 场景）
      cardsMeta: this.core.pendingCardsMeta || null, // 教学牌：系别/文案/不可跳过
      report: this.core.pendingLevelUp || null,     // 过关结算面板数据（levelclear 场景）
      checkpoint: this.checkpoint,           // 菜单「继续 第 N 关」
      totalLevels: LevelPlan.TOTAL_LEVELS,
      maxLevel: this.maxLevel,
    };
  }

  /** 本局是否还能复活（每局限一次；有广告/金币/内购任一途径即可） */
  canRevive() {
    if (this.state !== 'gameover' || this.reviveUsed) return false;
    return platform.api.rewardedAd
      || platform.getCoins() >= PLATFORM.REVIVE_COIN_COST
      || (PLATFORM.ENABLE_IAP && platform.api.iap);
  }

  /** 全局浮动提示 */
  notify(msg) {
    this.ptoast = { text: msg, t: 0, dur: 2200 };
  }

  /** 复活入口：优先看激励视频；广告不可用则金币复活；金币不足且已开通内购则引导购买 */
  tryRevive() {
    if (this.state !== 'gameover' || this.reviveUsed) return;
    if (platform.api.rewardedAd) {
      this.notify('正在加载激励视频…');
      platform.showRewardedAd((res) => {
        if (res.ok) { this.doRevive('复活成功，继续加油！'); return; }
        if (res.reason === 'notEnded') { this.notify('完整观看广告才能复活'); return; }
        this.reviveByCoins();
      });
    } else {
      this.reviveByCoins();
    }
  }

  reviveByCoins() {
    const cost = PLATFORM.REVIVE_COIN_COST;
    const coins = platform.getCoins();
    if (coins >= cost) {
      platform.confirm('金币复活', '使用 ' + cost + ' 金币复活并继续本局？', (ok) => {
        if (!ok) return;
        if (platform.spendCoins(cost)) {
          this.coins = platform.getCoins();
          this.doRevive('复活成功，继续加油！');
        } else {
          this.notify('金币不足');
        }
      });
      return;
    }
    if (PLATFORM.ENABLE_IAP && platform.api.iap) {
      const p = PLATFORM.IAP;
      platform.confirm('金币不足',
        '复活需要 ' + cost + ' 金币（当前 ' + coins + '）。花 ' +
        (p.priceFen / 100).toFixed(2) + ' 元购买 ' + p.coins + ' 金币？',
        (ok) => {
          if (!ok) return;
          platform.buyCoins((res) => {
            if (res.ok) {
              this.coins = platform.addCoins(p.coins);
              this.notify('购买成功');
              this.reviveByCoins();
            } else {
              this.notify(res.reason === 'unsupported' ? '内购未开通' : '购买未完成');
            }
          });
        });
      return;
    }
    this.notify('复活失败：广告未就绪且金币不足');
  }

  doRevive(msg) {
    if (this.reviveUsed) return;
    if (this.core.revive()) {
      this.reviveUsed = true;
      this.newBest = false;
      this.fx = [];
      this.state = 'playing';
      this.notify(msg);
      this.vibrate(20);
    } else {
      this.notify('复活失败');
    }
  }

  /** 免费金币：完整观看激励视频得金币 */
  earnCoinsByAd() {
    if (!platform.api.rewardedAd) { this.notify('当前环境不支持激励视频'); return; }
    this.notify('正在加载激励视频…');
    platform.showRewardedAd((res) => {
      if (res.ok) {
        this.coins = platform.addCoins(PLATFORM.AD_REWARD_COINS);
        this.notify('金币 +' + PLATFORM.AD_REWARD_COINS);
        this.vibrate(15);
      } else if (res.reason === 'notEnded') {
        this.notify('完整观看广告才能领取');
      } else {
        this.notify('广告未就绪，请稍后再试');
      }
    });
  }

  /** 侧边栏复访任务面板按钮：可领奖→领奖；否则跳转侧边栏（官方指引的复访动线） */
  onSidebarAction() {
    const st = platform.getSidebarState();
    if (st.claimable) {
      if (platform.claimSidebarReward()) {
        this.coins = platform.getCoins();
        this.notify('领取成功：金币 +' + PLATFORM.SIDEBAR_REWARD_COINS);
        this.vibrate(20);
      } else {
        this.notify('今日已领取');
      }
      return;
    }
    if (!st.supported) { this.notify('当前宿主不支持侧边栏'); return; }
    // 跳转抖音首页侧边栏（审核要求：必须使用 tt.navigateToScene）
    platform.goSidebar((res) => {
      if (!res.ok) this.notify('跳转侧边栏失败');
    });
  }

  /* ---------- 输入 ---------- */

  handleTap(x, y) {
    const btns = Render.sceneButtons(this.state, this.L, this.sceneOpts());
    for (let i = 0; i < btns.length; i++) {
      const b = btns[i];
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
        this.onButton(b.id);
        return;
      }
    }
    if (this.state === 'help' || this.state === 'sidebar') { this.setState('menu'); return; }
    if (this.state === 'levels') { this.setState('menu'); return; }
    if (this.state === 'playing') {
      const B = this.L.board;
      if (x >= B.x && x <= B.x + B.size && y >= B.y && y <= B.y + B.size) {
        if (this.tip) { this.tip = null; return; } // 先关掉教学目标卡，别误触旋转
        if (this.core.rotate()) this.vibrate(8);
      }
    }
  }

  handleSwipe(dx, dy, sx, sy) {
    if (this.state !== 'playing' || !this.core.canControl()) return;
    const B = this.L.board;
    // 仅响应从棋盘区域起始的滑动
    if (!(sx >= B.x && sx <= B.x + B.size && sy >= B.y && sy <= B.y + B.size)) return;
    if (this.tip) this.tip = null;

    // 滑动按**屏幕方向**走（和下面那排固定按键一致）：左右/上 = 移动一格，下 = 速降
    const adx = Math.abs(dx), ady = Math.abs(dy);
    if (ady >= adx) {
      if (dy > 30) { this.core.hardDrop(); this.vibrate(15); return; }
      if (dy < -30) { if (this.core.moveDir(D_UP)) this.vibrate(5); return; }
      return;
    }
    const dir = dx > 0 ? D_RIGHT : D_LEFT;
    const steps = Math.min(8, Math.max(1, Math.round(adx / B.cell)));
    let moved = false;
    for (let i = 0; i < steps; i++) { if (this.core.moveDir(dir)) moved = true; else break; }
    if (moved) this.vibrate(5);
  }

  onButton(id) {
    switch (id) {
      case 'start':
        this.startGame({ level: 1 }); // 新对局：从第 1 关教学重新开始
        break;
      case 'retry':
      case 'restart':
        // 再来一局 / 重新开始：回到「本关开局断点」（进度不丢，见 js/progress.js）
        if (this.checkpoint) this.startGame({ resume: this.checkpoint });
        else this.startGame({ level: this.core.level });
        break;
      case 'resume':
        if (this.state === 'menu') this.startGame({ resume: this.checkpoint || { level: 1 } });
        else this.state = 'playing';
        break;
      case 'nextLevel':
        // 过关结算 → 进入下一关：此刻才清场、铺本关脚本
        this._fromClear = true;
        if (this.core.confirmLevelUp()) this.setState('playing');
        break;
      case 'levels':
        this._rankReturn = 'menu';
        this.setState('levels');
        break;
      /* ---- 关卡选择（第 1~6 关为教学关） ---- */
      case 'level1': case 'level2': case 'level3': case 'level4':
      case 'level5': case 'level6': case 'level7': case 'level8':
      case 'level9': case 'level10': case 'level11': case 'level12':
        this.startGame({ level: +id.slice(5) });
        break;
      /* ---- 属性牌三选一 ---- */
      case 'card0':
      case 'card1':
      case 'card2': {
        const cards = this.core.pendingCards;
        if (cards && cards[+id.slice(-1)]) this.chooseCard(cards[+id.slice(-1)].id);
        break;
      }
      case 'cardsSkip':
        if (this.core.skipCards()) this.state = 'playing';
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
      /* ---- 平台能力按钮 ---- */
      case 'sidebarGift':
        this.setState('sidebar');
        break;
      case 'sidebarAction':
        this.onSidebarAction();
        break;
      case 'sidebarClose':
        this.setState('menu');
        break;
      case 'desktop':
        platform.addToDesktop((res) => {
          if (res.ok) this.notify('已发起添加到桌面');
          else this.notify(res.reason === 'unsupported' ? '当前环境不支持添加到桌面' : '添加到桌面未完成');
        });
        break;
      case 'subscribe':
        platform.requestSubscribe((res) => {
          if (res.ok) this.notify('已订阅消息提醒');
          else this.notify(res.reason === 'unsupported' ? '当前环境不支持订阅消息' : '订阅未完成');
        });
        break;
      case 'freeCoins':
        this.earnCoinsByAd();
        break;
      case 'revive':
        this.tryRevive();
        break;
      /* ---- 固定方向按键：屏幕四向 + 十字正中翻转 + 右侧速降（不随重力旋转） ---- */
      case 'up':
        if (this.core.moveDir(D_UP)) this.vibrate(5);
        break;
      case 'down':
        if (this.core.moveDir(D_DOWN)) this.vibrate(5);
        break;
      case 'left':
        if (this.core.moveDir(D_LEFT)) this.vibrate(5);
        break;
      case 'right':
        if (this.core.moveDir(D_RIGHT)) this.vibrate(5);
        break;
      case 'flip':
      case 'rotate': // 'rotate' 为兼容旧入口（Web 预览脚本 / 棋盘点击）保留
        if (this.core.rotate()) this.vibrate(8);
        break;
      case 'drop': // 速降
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
        this.fx.push({ kind: 'clear', cells: ev.cells, t: 0, dur: 300 });
        this.toast = { text: ev.count >= 2 ? ('消除 x' + ev.count + '！') : '消除！', t: 0, dur: 900 };
        this.vibrate(20);
      } else if (ev.type === 'turret') {
        // 炮台开火：弹道动画 + 命中爆点（被击落格各自的技能特效由后续事件带出）
        const dur = Render.bulletDuration(ev.shots);
        if (ev.shots.length) this.fx.push({ kind: 'turret', origin: ev.origin, shots: ev.shots, t: 0, dur });
        if (ev.count) {
          this.fx.push({ kind: 'impact', cells: ev.cells, accent: SKILL.ACCENT.turret, t: 0, dur: 560 });
          this._shake(ev.count >= 3 ? 5.5 : 3.6, 260);
        }
        this._floatSkillScore(ev, ev.knock ? '补射' : '炮台');
        this.vibrate(ev.count ? 25 : 10);
      } else if (ev.type === 'resonance') {
        this.fx.push({ kind: 'resonance', waves: ev.waves, t: 0, dur: 460 });
        if (ev.count) {
          this.fx.push({ kind: 'impact', cells: ev.cells, accent: SKILL.ACCENT.resonance, t: 0, dur: 620 });
          this._shake(Math.min(7, 3 + ev.count * 0.5), 300);
        }
        this._floatSkillScore(ev, '共鸣');
        this.vibrate(ev.count ? 30 : 10);
      } else if (ev.type === 'levelclear') {
        // 过关结算：对局已挂起（core.pendingLevelUp），棋盘保持消行后的最后一帧
        this.vibrate(40);
        if (this.state === 'playing') this.setState('levelclear');
      } else if (ev.type === 'levelup') {
        if (ev.cells && ev.cells.length) this.fx.push({ kind: 'clear', cells: ev.cells, t: 0, dur: 420 });
        const skillTip = ev.skills && ev.level === SKILL.START_LEVEL ? '（技能方块已登场）' : '';
        this.toast = {
          text: this._fromClear
            ? ('第 ' + ev.level + ' 关开始' + skillTip)
            : ('第 ' + (ev.level - 1) + ' 关合格！进入第 ' + ev.level + ' 关' + skillTip),
          t: 0, dur: 1600,
        };
        this.vibrate(30);
        this.saveProgress();   // 每关开局就是一个断点：下次进来直接从这关继续
        if (this._fromClear) {
          this._fromClear = false; // 结算面板刚讲过目标，不再重复弹目标卡
          this.tip = null;
        } else {
          this.showLevelTip();     // 教学关（第 1~6 关）弹「本关目标」卡
        }
      } else if (ev.type === 'cards') {
        // 属性牌三选一：通用节奏或教学脚本（教学牌带 meta.tutorial）；牌池见底则不打断对局
        if (ev.cards && ev.cards.length && this.state === 'playing') this.setState('cards');
      } else if (ev.type === 'cardpick') {
        const tag = Skills.TAG_LABEL[ev.tag] || '属性';
        this.notify('已获得「' + ev.name + '」（' + tag + '系）');
      } else if (ev.type === 'gameover') {
        this.tip = null;
        const r = rank.submit(this.core.score, this.core.level, this.core.lines);
        this.best = r.best;
        this.localRank = r.local;
        this.newBest = r.isBest;
        this.reviveUsed = false;
        this.vibrate(80);
        this.setState('gameover');
        // 插屏广告：游戏结束是自然停顿点（platform 内部有最小间隔节流）
        platform.showInterstitialAd();
      }
    }
  }

  /** 技能消失方格的漂浮加分 */
  _floatSkillScore(ev, label) {
    if (!ev.score || !ev.cells || !ev.cells.length) return;
    const B = this.L.board;
    const ox = B.x + B.size / 2, oy = B.y + B.size * 0.34;
    this.floats.push({ text: label + ' +' + ev.score, x: ox, y: oy, t: 0, dur: 900, color: '#ffe082' });
  }

  /** 命中震屏：取更强的一次，避免密集命中时抖动叠加过猛 */
  _shake(amp, dur) {
    if (!this.shake || this.shake.t >= this.shake.dur || amp > this.shake.amp) {
      this.shake = { t: 0, dur: dur || 260, amp: amp || 3 };
    }
  }

  /** 属性牌三选一：选牌并恢复对局 */
  chooseCard(id) {
    if (!this.core.pickCard(id)) return;
    this.state = 'playing';
    this.fx = [];
    this.shake = null;
    this.vibrate(20);
  }

  updateFx(dt) {
    for (let i = this.fx.length - 1; i >= 0; i--) {
      this.fx[i].t += dt;
      if (this.fx[i].t >= this.fx[i].dur) this.fx.splice(i, 1);
    }
    if (this.shake) {
      this.shake.t += dt;
      if (this.shake.t >= this.shake.dur) this.shake = null;
    }
    for (let i = this.floats.length - 1; i >= 0; i--) {
      this.floats[i].t += dt;
      if (this.floats[i].t >= this.floats[i].dur) this.floats.splice(i, 1);
    }
    if (this.toast) {
      this.toast.t += dt;
      if (this.toast.t >= this.toast.dur) this.toast = null;
    }
    if (this.tip) {
      this.tip.t += dt;
      if (this.tip.t >= this.tip.dur) this.tip = null;
    }
    if (this.ptoast) {
      this.ptoast.t += dt;
      if (this.ptoast.t >= this.ptoast.dur) this.ptoast = null;
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
