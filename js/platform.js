/**
 * 平台能力模块：统一封装抖音小游戏审核要求的平台能力
 *
 * 对应审核检测项：
 *  1. 侧边栏复访（必接）— tt.navigateToScene({scene:'sidebar'}) 跳转侧边栏；
 *     tt.checkScene 判断宿主是否支持；tt.onShow 监听启动来源（location='sidebar_card'
 *     或 scene='021036' 即为侧边栏启动），据此发放每日复访奖励。
 *     ⚠️ 官方要求 tt.onShow 必须在 game.js 运行时机同步注册（见 game.js）。
 *  2. 添加到桌面 — tt.addToDesktop
 *  3. 订阅消息   — tt.requestSubscribeMessage（模板 ID 见 config.js PLATFORM）
 *  4. 广告       — tt.createRewardedVideoAd（激励视频）/ tt.createInterstitialAd（插屏）
 *  5. 内购       — tt.requestMidasPaymentGameItem（需版号；PLATFORM.ENABLE_IAP=false 时入口隐藏）
 *
 * 另含金币钱包（tt.setStorageSync 持久化）：看广告得金币、侧边栏复访得金币、
 * 金币复活消耗、（开通内购后）购买金币。
 *
 * 说明：本文件刻意使用字面量 tt.xxx(...) 形式调用（而非别名），
 * 与官方文档/审核检测的调用特征保持一致；所有调用均先经 typeof 守卫 + try/catch，
 * API 缺失或失败时静默降级，绝不影响游戏本体运行。
 */
const { PLATFORM } = require('./config.js');

const KEY_COINS = 'gravcube.coins';
const KEY_SIDEBAR_CLAIM = 'gravcube.sidebarClaim'; // 值为 'YYYY-M-D'，标记当日已领取
const KEY_WELCOMED = 'gravcube.welcomed';          // 新手赠币只发一次

/* ================= 能力检测 ================= */

const hasTT = (typeof tt !== 'undefined') && !!tt;

const api = {
  rewardedAd: hasTT && typeof tt.createRewardedVideoAd === 'function',
  interstitialAd: hasTT && typeof tt.createInterstitialAd === 'function',
  subscribe: hasTT && typeof tt.requestSubscribeMessage === 'function',
  addToDesktop: hasTT && typeof tt.addToDesktop === 'function',
  sidebar: hasTT && typeof tt.navigateToScene === 'function', // 审核要求：必须使用 tt.navigateToScene 调用
  checkScene: hasTT && typeof tt.checkScene === 'function',
  iap: hasTT && typeof tt.requestMidasPaymentGameItem === 'function',
  showModal: hasTT && typeof tt.showModal === 'function',
};

/* ================= 存储 ================= */

function safeGet(key, def) {
  try {
    if (hasTT && tt.getStorageSync) {
      const v = tt.getStorageSync(key);
      return (v === '' || v === undefined || v === null) ? def : v;
    }
  } catch (e) { /* 忽略存储异常 */ }
  return def;
}

function safeSet(key, value) {
  try {
    if (hasTT && tt.setStorageSync) tt.setStorageSync(key, value);
  } catch (e) { /* 忽略存储异常 */ }
}

/* ================= 金币钱包 ================= */

let coinsCache = null; // 内存缓存，避免每帧读存储

function getCoins() {
  if (coinsCache === null) {
    const v = safeGet(KEY_COINS, 0);
    coinsCache = (typeof v === 'number' && isFinite(v) && v > 0) ? Math.floor(v) : 0;
  }
  return coinsCache;
}

function addCoins(n) {
  const v = getCoins() + Math.max(0, Math.floor(n) || 0);
  coinsCache = v;
  safeSet(KEY_COINS, v);
  return v;
}

function spendCoins(n) {
  n = Math.floor(n) || 0;
  if (getCoins() < n) return false;
  coinsCache -= n;
  safeSet(KEY_COINS, coinsCache);
  return true;
}

/* ================= 启动信息与生命周期（侧边栏复访） ================= */

let launchInfo = null;         // 最近一次 tt.onShow 的启动参数（官方要求始终用最新值判断）
let sidebarAvailable = null;   // tt.checkScene 结果：true / false / null(未知)
const showListeners = [];
let lifecycleReady = false;

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
}

/** 是否从抖音首页侧边栏启动（官方判定：location='sidebar_card'，scene='021036'） */
function isFromSidebar() {
  if (!launchInfo) return false;
  return launchInfo.location === 'sidebar_card' || launchInfo.scene === '021036';
}

/**
 * 初始化：必须在 game.js 运行时机尽早调用（官方文档强调 tt.onShow 注册过晚会收不到回调）
 */
function init() {
  if (lifecycleReady || !hasTT) return;
  lifecycleReady = true;

  // 冷启动参数（部分宿主 onShow 首次不回调，用同步接口兜底）
  try {
    if (tt.getLaunchOptionsSync) launchInfo = tt.getLaunchOptionsSync() || null;
  } catch (e) { /* 忽略 */ }

  // 热启动/复访监听：始终保留最新启动信息
  try {
    if (tt.onShow) {
      tt.onShow((opts) => {
        if (opts) launchInfo = opts;
        for (let i = 0; i < showListeners.length; i++) {
          try { showListeners[i](launchInfo); } catch (e) { /* 忽略监听器异常 */ }
        }
      });
    }
  } catch (e) { /* 忽略 */ }

  // 当前宿主是否支持跳转侧边栏（isExist=false 时不展示奖励入口）
  try {
    if (api.checkScene) {
      tt.checkScene({
        scene: 'sidebar',
        success: (res) => { sidebarAvailable = !!(res && res.isExist); },
        fail: () => { sidebarAvailable = false; },
      });
    }
  } catch (e) { /* 忽略 */ }

  // 新手赠币（一次性）：保证「金币复活」链路在无广告环境下也可用
  if (!safeGet(KEY_WELCOMED, false)) {
    safeSet(KEY_WELCOMED, true);
    if (PLATFORM.WELCOME_COINS > 0) addCoins(PLATFORM.WELCOME_COINS);
  }
}

/** 注册 onShow 监听（如刷新金币显示） */
function onShow(cb) {
  if (typeof cb === 'function') showListeners.push(cb);
}

/* ================= 侧边栏复访 ================= */

let sidebarClaimCache = null; // 内存缓存最近领取日期，避免每帧读存储

function claimedDate() {
  if (sidebarClaimCache === null) sidebarClaimCache = safeGet(KEY_SIDEBAR_CLAIM, '');
  return sidebarClaimCache;
}

/**
 * 侧边栏复访状态（纯内存判断，可每帧调用）
 * supported    — 当前宿主是否支持（checkScene 明确返回 false 才算不支持）
 * fromSidebar  — 本次启动是否来自侧边栏
 * claimedToday — 今日是否已领取
 * claimable    — 当前是否可领取奖励
 */
function getSidebarState() {
  const supported = api.sidebar && sidebarAvailable !== false;
  const claimedToday = claimedDate() === todayStr();
  const fromSidebar = isFromSidebar();
  return {
    supported,
    fromSidebar,
    claimedToday,
    claimable: supported && fromSidebar && !claimedToday,
  };
}

/** 跳转抖音首页侧边栏（审核要求：必须使用 tt.navigateToScene 调用） */
function goSidebar(onResult) {
  const cb = onResult || function () {};
  if (!api.sidebar) { cb({ ok: false, reason: 'unsupported' }); return; }
  try {
    tt.navigateToScene({
      scene: 'sidebar', // 官方接入指引：scene 固定传 'sidebar'
      success: (res) => cb({ ok: true, res }),
      fail: (res) => cb({ ok: false, reason: 'fail', res }),
    });
  } catch (e) {
    cb({ ok: false, reason: 'error', err: e });
  }
}

/** 领取侧边栏复访奖励（每日一次），成功返回 true */
function claimSidebarReward() {
  const st = getSidebarState();
  if (!st.claimable) return false;
  sidebarClaimCache = todayStr();
  safeSet(KEY_SIDEBAR_CLAIM, sidebarClaimCache);
  addCoins(PLATFORM.SIDEBAR_REWARD_COINS);
  return true;
}

/* ================= 激励视频广告 ================= */

let rewardedAd = null;
let rewardedPending = null; // 当前等待结果的回调（防并发）

function failRewardedPending(reason, extra) {
  const cb = rewardedPending;
  rewardedPending = null;
  if (cb) cb(Object.assign({ ok: false, reason }, extra || {}));
}

function ensureRewardedAd() {
  if (rewardedAd || !api.rewardedAd) return rewardedAd;
  try {
    rewardedAd = tt.createRewardedVideoAd({ adUnitId: PLATFORM.REWARDED_AD_UNIT_ID });
    if (rewardedAd.onClose) {
      rewardedAd.onClose((res) => {
        const cb = rewardedPending;
        rewardedPending = null;
        if (!cb) return;
        // isEnded === true 表示完整观看；false 表示中途退出，不发奖励
        if (res && res.isEnded === false) cb({ ok: false, reason: 'notEnded' });
        else cb({ ok: true });
      });
    }
    if (rewardedAd.onError) {
      rewardedAd.onError((err) => failRewardedPending('error', { err }));
    }
  } catch (e) {
    rewardedAd = null;
  }
  return rewardedAd;
}

/**
 * 播放激励视频。onResult({ok:true}) 完整观看；
 * {ok:false, reason:'unsupported'|'busy'|'notEnded'|'error'|'showFail'}
 */
function showRewardedAd(onResult) {
  const cb = onResult || function () {};
  const ad = ensureRewardedAd();
  if (!ad || typeof ad.show !== 'function') { cb({ ok: false, reason: 'unsupported' }); return; }
  if (rewardedPending) { cb({ ok: false, reason: 'busy' }); return; }
  rewardedPending = cb;
  try {
    const p = ad.show();
    if (p && typeof p.catch === 'function') {
      p.catch(() => {
        // 首次 show 失败：load 后重试一次
        try {
          const q = (typeof ad.load === 'function') ? ad.load() : null;
          if (q && typeof q.then === 'function') {
            q.then(() => ad.show()).catch((e) => failRewardedPending('showFail', { err: e }));
          } else {
            failRewardedPending('showFail');
          }
        } catch (e) {
          failRewardedPending('showFail', { err: e });
        }
      });
    }
  } catch (e) {
    failRewardedPending('showFail', { err: e });
  }
}

/* ================= 插屏广告 ================= */

let interstitialAd = null;
let lastInterstitialAt = 0;

/**
 * 展示插屏广告（带最小间隔节流）。适合在游戏结束等自然停顿点调用。
 * @param {boolean} force 忽略间隔限制强制展示
 */
function showInterstitialAd(force) {
  if (!api.interstitialAd) return;
  const now = Date.now();
  // lastInterstitialAt=0 表示从未展示过，首次不节流
  if (!force && lastInterstitialAt !== 0 && now - lastInterstitialAt < PLATFORM.INTERSTITIAL_MIN_INTERVAL) return;
  try {
    if (!interstitialAd) {
      interstitialAd = tt.createInterstitialAd({ adUnitId: PLATFORM.INTERSTITIAL_AD_UNIT_ID });
      if (interstitialAd.onError) interstitialAd.onError(() => { /* 无广告填充等情况，静默 */ });
      if (interstitialAd.onClose) interstitialAd.onClose(() => { /* 关闭即恢复游戏，无需处理 */ });
    }
    lastInterstitialAt = now;
    if (typeof interstitialAd.show === 'function') {
      const p = interstitialAd.show();
      if (p && typeof p.catch === 'function') {
        p.catch(() => {
          try {
            if (typeof interstitialAd.load === 'function') {
              const q = interstitialAd.load();
              if (q && typeof q.then === 'function') q.then(() => interstitialAd.show()).catch(() => {});
            }
          } catch (e) { /* 忽略 */ }
        });
      }
    } else if (typeof interstitialAd.load === 'function') {
      interstitialAd.load(); // 预加载，下次再展示
    }
  } catch (e) { /* 忽略广告异常 */ }
}

/* ================= 订阅消息 ================= */

/** 请求订阅消息（模板 ID 需在开发者后台「功能→订阅消息」中创建并填入 config.js） */
function requestSubscribe(onResult) {
  const cb = onResult || function () {};
  if (!api.subscribe) { cb({ ok: false, reason: 'unsupported' }); return; }
  try {
    tt.requestSubscribeMessage({
      tmplIds: PLATFORM.SUBSCRIBE_TMPL_IDS,
      success: (res) => cb({ ok: true, res }),
      fail: (res) => cb({ ok: false, reason: 'fail', res }),
    });
  } catch (e) {
    cb({ ok: false, reason: 'error', err: e });
  }
}

/* ================= 添加到桌面 ================= */

/** 引导用户将小游戏添加到手机桌面 */
function addToDesktop(onResult) {
  const cb = onResult || function () {};
  if (!api.addToDesktop) { cb({ ok: false, reason: 'unsupported' }); return; }
  try {
    tt.addToDesktop({
      success: (res) => cb({ ok: true, res }),
      fail: (res) => cb({ ok: false, reason: 'fail', res }),
    });
  } catch (e) {
    cb({ ok: false, reason: 'error', err: e });
  }
}

/* ================= 内购（需版号，默认隐藏入口） ================= */

/**
 * 购买金币（道具直购）。仅当 PLATFORM.ENABLE_IAP=true 且宿主支持时发起。
 * onResult({ok:true}) 支付成功（发货以服务端回调为准，此处仅做客户端到账）。
 */
function buyCoins(onResult) {
  const cb = onResult || function () {};
  if (!PLATFORM.ENABLE_IAP || !api.iap) { cb({ ok: false, reason: 'unsupported' }); return; }
  const p = PLATFORM.IAP;
  try {
    tt.requestMidasPaymentGameItem({
      buyQuantity: p.coins,      // 购买数量
      zoneId: p.zoneId,          // 游戏分区
      currencyType: 'CNY',
      platform: 'android',
      productId: p.productId,    // 道具 ID
      goodsPrice: p.priceFen,    // 道具价格（分）
      outTradeNo: 'gc' + Date.now() + Math.floor(Math.random() * 10000), // 商户订单号
      attach: 'coins',
      success: (res) => cb({ ok: true, res }),
      fail: (res) => cb({ ok: false, reason: 'fail', res }),
    });
  } catch (e) {
    cb({ ok: false, reason: 'error', err: e });
  }
}

/* ================= 通用确认弹窗 ================= */

/** tt.showModal 封装；宿主不支持弹窗时直接按「确认」处理（降级） */
function confirm(title, content, cb) {
  const done = (ok) => { try { cb(ok); } catch (e) { /* 忽略 */ } };
  try {
    if (api.showModal) {
      tt.showModal({
        title: title,
        content: content,
        confirmText: '确定',
        cancelText: '取消',
        success: (res) => done(!!(res && res.confirm)),
        fail: () => done(false),
      });
      return;
    }
  } catch (e) { /* 走降级 */ }
  done(true);
}

module.exports = {
  api,
  init,
  onShow,
  // 钱包
  getCoins, addCoins, spendCoins,
  // 侧边栏复访
  getSidebarState, goSidebar, claimSidebarReward,
  // 广告
  showRewardedAd, showInterstitialAd,
  // 订阅消息 / 桌面 / 内购
  requestSubscribe, addToDesktop, buyCoins,
  // 工具
  confirm,
};
