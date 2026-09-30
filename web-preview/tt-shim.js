/**
 * 浏览器版 tt.* API 垫片（仅用于本机预览，真机/抖音开发者工具不经过此文件）
 * - createCanvas        → 页面挂载的 <canvas>
 * - onTouch*            → 触摸事件 + 鼠标模拟（桌面浏览器可玩）
 * - set/getStorageSync  → localStorage（JSON 序列化，前缀 tt:）
 * - vibrate/onHide/onError/shareAppMessage → 浏览器等价或优雅降级
 * - getOpenDataContext  → null（好友排行走本地降级分支）
 */
(function () {
  'use strict';

  // 录制/演示页可通过 window.__TT_LOGICAL_W/H 覆盖逻辑尺寸（配合 --force-device-scale-factor
  // 得到 1080×1920 等大分辨率画布；正常预览不受影响）
  var logicalW = window.__TT_LOGICAL_W || Math.min(window.innerWidth, 480);
  var logicalH = window.__TT_LOGICAL_H || window.innerHeight;
  if (logicalW < 320) logicalW = 320;
  if (logicalH < 480) logicalH = 480;

  var canvas = document.createElement('canvas');
  canvas.id = 'game-canvas';
  canvas.style.width = logicalW + 'px';
  canvas.style.height = logicalH + 'px';
  canvas.style.touchAction = 'none';
  canvas.style.userSelect = 'none';
  canvas.style.webkitUserSelect = 'none';
  document.body.appendChild(canvas);
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  var toastEl = document.getElementById('tt-toast');
  var toastTimer = null;
  function showToast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.style.opacity = '0'; }, 2200);
  }

  /* ---------- 触摸 / 鼠标 → tt.onTouch* ---------- */
  var handlers = { start: [], move: [], end: [], cancel: [] };

  function fire(type, touches, changed) {
    var ev = {
      type: 'touch' + type,
      touches: touches,
      changedTouches: changed || touches,
      timeStamp: Date.now(),
    };
    var list = handlers[type];
    for (var i = 0; i < list.length; i++) {
      try { list[i](ev); } catch (e) { console.error('[tt-shim]', e); }
    }
  }

  function toLogical(clientX, clientY) {
    var rect = canvas.getBoundingClientRect();
    return {
      clientX: (clientX - rect.left) * (logicalW / (rect.width || logicalW)),
      clientY: (clientY - rect.top) * (logicalH / (rect.height || logicalH)),
    };
  }
  function pointFromTouch(t) { return toLogical(t.clientX, t.clientY); }

  canvas.addEventListener('touchstart', function (e) {
    e.preventDefault();
    if (e.touches[0]) fire('start', [pointFromTouch(e.touches[0])]);
  }, { passive: false });
  canvas.addEventListener('touchmove', function (e) {
    e.preventDefault();
    if (e.touches[0]) fire('move', [pointFromTouch(e.touches[0])]);
  }, { passive: false });
  canvas.addEventListener('touchend', function (e) {
    e.preventDefault();
    var t = e.changedTouches[0];
    fire('end', [], t ? [pointFromTouch(t)] : []);
  }, { passive: false });
  canvas.addEventListener('touchcancel', function (e) {
    e.preventDefault();
    fire('cancel', [], []);
  }, { passive: false });

  var mouseDown = false;
  canvas.addEventListener('mousedown', function (e) {
    e.preventDefault();
    mouseDown = true;
    fire('start', [toLogical(e.clientX, e.clientY)]);
  });
  window.addEventListener('mousemove', function (e) {
    if (!mouseDown) return;
    fire('move', [toLogical(e.clientX, e.clientY)]);
  });
  window.addEventListener('mouseup', function (e) {
    if (!mouseDown) return;
    mouseDown = false;
    fire('end', [], [toLogical(e.clientX, e.clientY)]);
  });

  /* ---------- 存储 ---------- */
  var PREFIX = 'tt:';
  function getStorageSync(key) {
    try {
      var raw = localStorage.getItem(PREFIX + key);
      if (raw === null) return '';
      return JSON.parse(raw);
    } catch (e) { return ''; }
  }
  function setStorageSync(key, value) {
    try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch (e) { /* 忽略 */ }
  }
  function removeStorageSync(key) {
    try { localStorage.removeItem(PREFIX + key); } catch (e) { /* 忽略 */ }
  }

  /* ---------- 震动 ---------- */
  function vibrate(ms) {
    try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* 忽略 */ }
  }

  /* ---------- 平台能力 mock（侧边栏/桌面/订阅/广告/内购，仅预览用） ---------- */
  var showCbs = [];
  function fireShow(opts) {
    for (var i = 0; i < showCbs.length; i++) {
      try { showCbs[i](opts); } catch (e) { console.error('[tt-shim]', e); }
    }
  }
  function mockAd(kind) {
    var closeCbs = [];
    return {
      load: function () { return Promise.resolve(); },
      show: function () {
        showToast('【预览】播放' + kind + '…');
        setTimeout(function () {
          for (var i = 0; i < closeCbs.length; i++) {
            try { closeCbs[i]({ isEnded: true }); } catch (e) { /* 忽略 */ }
          }
        }, kind === '激励视频' ? 900 : 300);
        return Promise.resolve();
      },
      onClose: function (cb) { closeCbs.push(cb); },
      onError: function () {},
      onLoad: function () {},
      destroy: function () {},
    };
  }

  /* ---------- tt 全局 ---------- */
  window.tt = {
    createCanvas: function () { return canvas; },
    getSystemInfoSync: function () {
      return {
        windowWidth: logicalW,
        windowHeight: logicalH,
        pixelRatio: window.devicePixelRatio || 1,
        platform: 'browser-preview',
        SDKVersion: 'web',
      };
    },
    onTouchStart: function (cb) { handlers.start.push(cb); },
    onTouchMove: function (cb) { handlers.move.push(cb); },
    onTouchEnd: function (cb) { handlers.end.push(cb); },
    onTouchCancel: function (cb) { handlers.cancel.push(cb); },
    getStorageSync: getStorageSync,
    setStorageSync: setStorageSync,
    removeStorageSync: removeStorageSync,
    vibrateShort: function () { vibrate(15); },
    vibrateLong: function () { vibrate(400); },
    onHide: function (cb) {
      document.addEventListener('visibilitychange', function () { if (document.hidden) cb(); });
    },
    onError: function (cb) {
      window.addEventListener('error', function (e) { cb(e.message || 'error'); });
    },
    shareAppMessage: function (opts) {
      var title = (opts && opts.title) || '引力方块';
      showToast('【预览分享】' + title);
      if (opts && opts.success) { try { opts.success(); } catch (e) { /* 忽略 */ } }
    },
    setUserCloudStorage: function (opts) {
      if (opts && opts.success) { try { opts.success(); } catch (e) { /* 忽略 */ } }
    },
    getOpenDataContext: function () { return null; },

    /* ---- 生命周期（侧边栏复访判定用） ---- */
    onShow: function (cb) { showCbs.push(cb); },
    getLaunchOptionsSync: function () { return { scene: '010115', query: {} }; },

    /* ---- 侧边栏复访 ---- */
    checkScene: function (opts) {
      if (opts && opts.success) setTimeout(function () { opts.success({ isExist: true }); }, 0);
    },
    navigateToScene: function (opts) {
      showToast('【预览】tt.navigateToScene scene=' + (opts && opts.scene));
      if (opts && opts.success) setTimeout(function () { opts.success({}); }, 0);
    },

    /* ---- 添加到桌面 ---- */
    addToDesktop: function (opts) {
      showToast('【预览】tt.addToDesktop 已调用');
      if (opts && opts.success) setTimeout(function () { opts.success({}); }, 0);
    },

    /* ---- 订阅消息 ---- */
    requestSubscribeMessage: function (opts) {
      showToast('【预览】订阅消息 tmplIds=' + ((opts && opts.tmplIds) || []).join(','));
      if (opts && opts.success) setTimeout(function () { opts.success({}); }, 0);
    },

    /* ---- 广告 ---- */
    createRewardedVideoAd: function () { return mockAd('激励视频'); },
    createInterstitialAd: function () { return mockAd('插屏广告'); },

    /* ---- 内购 ---- */
    requestMidasPaymentGameItem: function (opts) {
      showToast('【预览】内购 productId=' + (opts && opts.productId));
      if (opts && opts.success) setTimeout(function () { opts.success({}); }, 0);
    },

    /* ---- 弹窗 ---- */
    showModal: function (opts) {
      var msg = ((opts && opts.title) ? opts.title + '\n' : '') + ((opts && opts.content) || '');
      var ok = window.confirm(msg);
      if (opts && opts.success) setTimeout(function () { opts.success({ confirm: ok, cancel: !ok }); }, 0);
    },
  };

  // 预览辅助：在控制台执行 __ttMockSidebarShow() 模拟「从抖音首页侧边栏进入游戏」
  window.__ttMockSidebarShow = function () {
    fireShow({ scene: '021036', query: {}, launch_from: 'homepage', location: 'sidebar_card' });
  };
  // 启动后补发一次普通 onShow（非侧边栏来源）
  setTimeout(function () { fireShow({ scene: '010115', query: {} }); }, 0);

  // 视口变化后重载以重建布局
  var reloadTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(function () { location.reload(); }, 400);
  });
})();
