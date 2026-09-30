/**
 * recorder.js — 抖音竖屏录制引擎（配合 record.html 使用）
 *
 * 职责：
 *  1. 合成画布 1080×1920：游戏画布逐帧 drawImage + 底部字幕条（跟随配音）
 *  2. 音频总线：程序化 chiptune BGM（配音时自动闪避）+ 音效 + TTS 配音
 *     （media/narration/*.mp3，清单 clips.json）
 *  3. MediaRecorder 录制（H.264 + AAC → MP4），结束后 POST /__recording 上传
 *  4. 场景导演：菜单 → AI 对战（AutoPlayer bot）→ 结算配音 → 排行榜 → 回菜单 → 上传
 *
 * URL 参数：?seed=15&botseed=777&finish=60000&name=xxx&bgm=0
 * 完成标记：document.title = 'RECORDING-DONE OK'（record.cjs 轮询用）
 */
(function () {
  'use strict';

  var params = new URLSearchParams(location.search);
  var SEED = parseInt(params.get('seed') || '15', 10);
  var BOT_SEED = parseInt(params.get('botseed') || '777', 10);
  var FINISH_MS = parseInt(params.get('finish') || '60000', 10);
  var NAME = params.get('name') || ('gameplay-' + SEED + '-' + Date.now());
  var BGM_ON = params.get('bgm') !== '0';
  /* 属性牌停留时长（ms）：整局会在这一步暂停，要给配音留够说完的时间 */
  var CARD_HOLD_MS = parseInt(params.get('cardhold') || '6500', 10);
  /* 跳过前面几关：直接从第 N 关开局（技能方块立刻登场，适合演示新特性） */
  var START_LEVEL = parseInt(params.get('startlevel') || '1', 10);
  var W = 1080, H = 1920;

  var G = null;               // window.__game
  var gameCanvas = null;
  var comp = null, cctx = null;
  var ac = null;
  var master = null, bgmBus = null, sfxBus = null, narrBus = null;
  var analyser = null, streamDest = null, noiseBuf = null;
  var recorder = null, chunks = [], mimeUsed = '';
  var recT0 = 0, recMs = 0;
  var buffers = {};           // 配音 id → {buf, text}
  var narrPlaying = null, narrQueue = [];
  var subtitleNow = null;
  var audioPeak = 0, peakBuf = null;
  var finalStats = null;
  var bot = null;
  var clearAlt = false;
  var status = 'boot';
  var errors = [];

  function setStatus(s) {
    status = s;
    document.title = 'REC ' + s;
    heartbeat();
  }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* ---- 心跳：把状态/错误上报给 record.cjs（headless 无法看控制台） ---- */
  var lastHb = '';
  var updCount = 0;
  function heartbeat() {
    try {
      var core = window.__game ? window.__game.core : null;
      var payload = JSON.stringify({
        status: status,
        t: Math.round(performance.now() / 100) / 10,
        errors: errors.slice(-5),
        narr: Object.keys(buffers).length,
        audio: ac ? ac.state : 'none',
        rec: recorder ? recorder.state : 'none',
        gs: window.__game ? window.__game.state : 'none',
        upd: updCount,
        hint: core ? Math.round(core.hintTimer) : -1,
        phase: core ? core.phase : '-',
        piece: core && core.current ? core.current.type : '-',
        bmode: bot ? bot.mode : '-',
        bphase: bot ? bot.phase : '-',
        pieces: bot ? bot.stats.pieces : 0,
        lines: core ? core.lines : -1,
        score: core ? core.score : -1,
        /* 新特性观测点：技能击落 / 属性牌 / 是否卡在待选牌 */
        skillKills: core ? (core.skillKills || 0) : -1,
        cardPicks: core && core.cardPicks ? core.cardPicks.length : -1,
        waitCard: core && core.pendingCards ? core.pendingCards.length : 0,
        lv: core ? core.level : -1,
      });
      if (payload === lastHb) return;
      lastHb = payload;
      fetch('/__heartbeat', { method: 'POST', body: payload }).catch(function () { });
    } catch (e) { /* noop */ }
  }
  setInterval(heartbeat, 2000);
  window.onerror = function (msg, src, line) {
    errors.push('onerror: ' + msg + ' @' + (src || '').split('/').pop() + ':' + line);
    heartbeat();
  };
  window.addEventListener('unhandledrejection', function (e) {
    errors.push('reject: ' + (e.reason && e.reason.message || e.reason));
    heartbeat();
  });

  /* ============ 音频引擎 ============ */

  function initAudio() {
    ac = new (window.AudioContext || window.webkitAudioContext)();
    master = ac.createGain(); master.gain.value = 1.0;
    analyser = ac.createAnalyser(); analyser.fftSize = 1024;
    streamDest = ac.createMediaStreamDestination();
    master.connect(analyser);
    analyser.connect(streamDest);
    bgmBus = ac.createGain(); bgmBus.gain.value = 0.0001; bgmBus.connect(master);
    sfxBus = ac.createGain(); sfxBus.gain.value = 0.5; sfxBus.connect(master);
    narrBus = ac.createGain(); narrBus.gain.value = 1.0; narrBus.connect(master);
    // 白噪声缓冲（hat / 打击类音效用）
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    peakBuf = new Uint8Array(analyser.fftSize);
    setInterval(function () {
      if (!analyser) return;
      analyser.getByteTimeDomainData(peakBuf);
      for (var i = 0; i < peakBuf.length; i++) {
        var v = Math.abs(peakBuf[i] - 128);
        if (v > audioPeak) audioPeak = v;
      }
    }, 250);
    if (ac.state === 'suspended') {
      var tries = 0;
      var iv = setInterval(function () {
        ac.resume();
        if (ac.state === 'running' || ++tries > 40) clearInterval(iv);
      }, 120);
    }
  }

  /* ---- 程序化 chiptune BGM：Am–F–C–G，132bpm，每和弦 2 小节 ---- */
  var BPM = 132, STEP = 60 / BPM / 4; // 十六分音符时长
  var CHORDS = [
    [110.00, 220.00, 261.63, 329.63], // Am: A2 / A3 C4 E4
    [87.31, 174.61, 220.00, 261.63],  // F:  F2 / F3 A3 C4
    [130.81, 196.00, 261.63, 329.63], // C:  C3 / G3 C4 E4
    [98.00, 196.00, 246.94, 293.66],  // G:  G2 / G3 B3 D4
  ];
  var bgmStep = 0, bgmT0 = 0, bgmTimer = null;

  function osc(t, freq, type, dur, gain, bus, glideTo) {
    var o = ac.createOscillator(), g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(bus);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function noiseHit(t, dur, gain, filterType, freq) {
    var s = ac.createBufferSource(); s.buffer = noiseBuf;
    s.loop = true;
    var f = ac.createBiquadFilter(); f.type = filterType; f.frequency.value = freq;
    var g = ac.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(bgmBus);
    s.start(t); s.stop(t + dur + 0.02);
  }

  function bgmPlayStep(i, t) {
    var bar = Math.floor(i / 16) % 8;
    var ch = CHORDS[Math.floor(bar / 2) % 4];
    var s = i % 16;
    if (s === 0 || s === 8) osc(t, 150, 'sine', 0.12, 0.6, bgmBus, 42);      // kick
    if (s % 4 === 2) noiseHit(t, 0.03, 0.10, 'highpass', 6500);               // hat
    if (s % 2 === 0) osc(t, ch[0], 'triangle', 0.2, 0.5, bgmBus);             // bass 八分
    osc(t, ch[1 + (i % 3)] * 2, 'square', 0.09, 0.062, bgmBus);               // 琶音 十六分
  }
  function bgmScheduler() {
    if (!ac || ac.state !== 'running') return;
    while (bgmT0 + bgmStep * STEP < ac.currentTime + 0.25) {
      bgmPlayStep(bgmStep, bgmT0 + bgmStep * STEP);
      bgmStep++;
    }
  }
  function startBgm() {
    bgmT0 = ac.currentTime + 0.1;
    bgmStep = 0;
    bgmBus.gain.setValueAtTime(0.0001, ac.currentTime);
    bgmBus.gain.linearRampToValueAtTime(0.16, ac.currentTime + 1.4);
    bgmTimer = setInterval(bgmScheduler, 40);
    bgmScheduler();
  }
  function duck(on) {
    if (!ac) return;
    bgmBus.gain.cancelScheduledValues(ac.currentTime);
    bgmBus.gain.setTargetAtTime(on ? 0.045 : (BGM_ON ? 0.16 : 0.0001), ac.currentTime, on ? 0.06 : 0.12);
  }

  /* ---- 音效 ---- */
  function sfxAt(t) { return t; }
  function sfxClick() {
    if (!ac) return; var t = sfxAt(ac.currentTime);
    osc(t, 750, 'square', 0.03, 0.10, sfxBus);
  }
  function sfxDrop() {
    if (!ac) return; var t = ac.currentTime;
    osc(t, 110, 'sine', 0.12, 0.5, sfxBus, 48);
    var s = ac.createBufferSource(); s.buffer = noiseBuf;
    var f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
    var g = ac.createGain();
    g.gain.setValueAtTime(0.28, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    s.connect(f); f.connect(g); g.connect(sfxBus);
    s.start(t); s.stop(t + 0.1);
  }
  function sfxClear(n) {
    if (!ac) return;
    var t = ac.currentTime;
    var notes = [523.25, 659.25, 783.99, 1046.5];
    if (n >= 2) notes.push(1318.5);
    if (n >= 3) notes.push(1568.0);
    for (var i = 0; i < notes.length; i++) {
      osc(t + i * 0.055, notes[i], 'square', 0.09, 0.16, sfxBus);
    }
    osc(t + notes.length * 0.055, 2093, 'sine', 0.25, 0.05, sfxBus);
  }
  function sfxLevelup() {
    if (!ac) return;
    var t = ac.currentTime;
    var run = [440, 493.88, 554.37, 659.25, 880, 1108.73];
    for (var i = 0; i < run.length; i++) osc(t + i * 0.045, run[i], 'triangle', 0.07, 0.2, sfxBus);
    var tc = t + run.length * 0.045;
    [440, 554.37, 659.25, 880].forEach(function (f) { osc(tc, f, 'sine', 0.42, 0.09, sfxBus); });
  }
  function sfxGameover() {
    if (!ac) return;
    var t = ac.currentTime;
    var fall = [329.63, 261.63, 220.0, 164.81];
    for (var i = 0; i < fall.length; i++) osc(t + i * 0.17, fall[i], 'triangle', 0.18, 0.26, sfxBus);
    var s = ac.createBufferSource(); s.buffer = noiseBuf;
    var f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 320;
    var g = ac.createGain();
    g.gain.setValueAtTime(0.14, t + 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    s.connect(f); f.connect(g); g.connect(sfxBus);
    s.start(t + 0.5); s.stop(t + 1.15);
  }
  /* ---- 新特性音效：炮台开火 / 共鸣引爆 / 属性牌入包 ---- */
  function sfxTurret(hits) {
    if (!ac) return;
    var t = ac.currentTime;
    osc(t, 1400, 'square', 0.09, 0.14, sfxBus, 320);        // 能量弹「咻」
    if (hits) {
      osc(t + 0.07, 220, 'sawtooth', 0.16, 0.2, sfxBus, 70); // 命中闷响
      var s = ac.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
      var f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1200;
      var g = ac.createGain();
      g.gain.setValueAtTime(0.16, t + 0.08);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
      s.connect(f); f.connect(g); g.connect(sfxBus);
      s.start(t + 0.08); s.stop(t + 0.3);
    }
  }
  function sfxResonance() {
    if (!ac) return;
    var t = ac.currentTime;
    [523.25, 784, 1046.5, 1568].forEach(function (fr, i) {
      osc(t + i * 0.05, fr, 'sine', 0.3, 0.13, sfxBus, fr * 1.5); // 上滑「共鸣」
    });
    osc(t + 0.2, 120, 'sawtooth', 0.3, 0.22, sfxBus, 48);          // 引爆低频
  }
  function sfxCard() {
    if (!ac) return;
    var t = ac.currentTime;
    [880, 1174.66, 1567.98].forEach(function (fr, i) { osc(t + i * 0.07, fr, 'triangle', 0.14, 0.18, sfxBus); });
  }

  /* ---- 配音 + 字幕 ---- */
  function loadNarration() {
    return fetch('media/narration/clips.json')
      .then(function (r) { return r.json(); })
      .then(function (m) {
        var ids = Object.keys(m.clips || {});
        return Promise.all(ids.map(function (id) {
          return fetch('media/narration/' + m.clips[id].file)
            .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.arrayBuffer(); })
            .then(function (ab) {
              return new Promise(function (res) {
                ac.decodeAudioData(ab, function (buf) {
                  buffers[id] = { buf: buf, text: m.clips[id].text };
                  res();
                }, function () { res(); });
              });
            })
            .catch(function () { /* 缺某条配音不致命 */ });
        }));
      })
      .catch(function () { /* 无配音 → 纯 BGM+字幕关闭模式 */ });
  }

  function splitChunks(text) {
    var parts = String(text).split(/(?<=[，。！？；：、])/);
    var chunks = [], cur = '';
    for (var i = 0; i < parts.length; i++) {
      cur += parts[i];
      if (cur.length >= 10 || i === parts.length - 1) { chunks.push(cur); cur = ''; }
    }
    return chunks.filter(function (c) { return c.trim().length > 0; });
  }

  function playNarr(id, opt) {
    opt = opt || {};
    return new Promise(function (resolve) {
      function go() {
        var c = buffers[id];
        if (!c || !ac) { resolve(false); return; }
        if (narrPlaying) {
          if (opt.queue && narrQueue.length < 3) {
            narrQueue.push({
              id: id, resolve: resolve, bornAt: performance.now(),
              /* 排队太久就作废：新特性解说讲究「此时此刻」，宁可不说也不迟说 */
              ttl: opt.ttl || 6000,
            });
          } else resolve(false);
          return;
        }
        var src = ac.createBufferSource();
        src.buffer = c.buf;
        src.connect(narrBus);
        narrPlaying = src;
        subtitleNow = { text: c.text, start: ac.currentTime, dur: c.buf.duration, chunks: splitChunks(c.text) };
        duck(true);
        src.onended = function () {
          narrPlaying = null;
          subtitleNow = null;
          duck(false);
          resolve(true);
          pumpQueue();
        };
        src.start();
      }
      if (opt.delay) setTimeout(go, opt.delay);
      else go();
    });
  }

  function pumpQueue() {
    while (narrQueue.length) {
      var nx = narrQueue.shift();
      if (nx.bornAt && performance.now() - nx.bornAt > (nx.ttl || 6000)) { nx.resolve(false); continue; }
      setTimeout(function () { playNarr(nx.id, { queue: true }).then(nx.resolve); }, 300);
      return;
    }
  }

  function currentSubtitle() {
    if (!subtitleNow || !ac) return null;
    var s = subtitleNow;
    var el = ac.currentTime - s.start;
    if (el < 0) el = 0;
    if (el > s.dur + 0.4) return null;
    var idx = Math.min(s.chunks.length - 1, Math.floor((el / s.dur) * s.chunks.length));
    return s.chunks[idx];
  }

  /* ---- 定向解说：同一句台词在 gapMs 内只说一句（免得新特性解说刷屏） ---- */
  var lastSaid = {};
  function say(id, gapMs, opt) {
    if (!buffers[id]) return false;             // 该条配音缺失 → 静默跳过
    var now = performance.now();
    if (lastSaid[id] && now - lastSaid[id] < (gapMs || 8000)) return false;
    lastSaid[id] = now;
    playNarr(id, opt);
    return true;
  }
  var told = {};          // 一次性讲解（首次沉降/首次技能登场）
  function sayOnce(id, opt) {
    if (told[id]) return false;
    told[id] = true;
    return say(id, 0, opt);
  }

  /* ============ 事件导演：盯 gamecore 的事件队列讲新特性 ============ */

  /**
   * 包一层 main.processEvents：在它 drain 事件之前先读一遍，
   * 炮台开火 / 共鸣引爆 / 首次半侧沉降 / 技能方块登场 都配上音效与解说。
   * 不改游戏源码，纯录制侧观测。
   */
  function installEventDirector() {
    var orig = G.processEvents.bind(G);
    G.processEvents = function () {
      var evs = G.core.events || [];
      for (var i = 0; i < evs.length; i++) {
        try { direct(evs[i]); } catch (e) { errors.push('director: ' + e.message); }
      }
      return orig();
    };
    function direct(ev) {
      if (ev.type === 'turret') {
        var hits = ev.count || 0;
        sfxTurret(hits);
        if (hits > 0) say(hits >= 6 ? 'turretBig' : 'turret', 11000, { queue: true });
      } else if (ev.type === 'resonance') {
        if ((ev.count || 0) > 0) { sfxResonance(); say('resonance', 11000, { queue: true }); }
      } else if (ev.type === 'clear') {
        /* 首次出现「半侧沉降」时讲解一次（只有贴近消除线那一半会滑动压实） */
        if ((ev.settled || 0) > 0) sayOnce('settle', { queue: true });
      } else if (ev.type === 'levelup') {
        if (ev.skills) sayOnce('skillintro', { queue: true });
      } else if (ev.type === 'cardpick') {
        sfxCard();
      }
    }
  }

  /* ============ 合成画布 ============ */

  function roundRect(x, y, w, h, r) {
    cctx.beginPath();
    cctx.moveTo(x + r, y);
    cctx.arcTo(x + w, y, x + w, y + h, r);
    cctx.arcTo(x + w, y + h, x, y + h, r);
    cctx.arcTo(x, y + h, x, y, r);
    cctx.arcTo(x, y, x + w, y, r);
    cctx.closePath();
  }

  function drawSubtitle(text) {
    var cy = 1618;
    cctx.font = '600 54px "Microsoft YaHei","PingFang SC",sans-serif';
    cctx.textAlign = 'center';
    cctx.textBaseline = 'middle';
    var tw = cctx.measureText(text).width;
    var bw = Math.min(W - 70, tw + 68), bh = 96;
    var bx = (W - bw) / 2, by = cy - bh / 2;
    roundRect(bx, by, bw, bh, 28);
    cctx.fillStyle = 'rgba(10,12,24,0.70)';
    cctx.fill();
    cctx.lineWidth = 2;
    cctx.strokeStyle = 'rgba(255,255,255,0.16)';
    cctx.stroke();
    cctx.shadowColor = 'rgba(0,0,0,0.65)';
    cctx.shadowBlur = 8;
    cctx.shadowOffsetY = 2;
    cctx.fillStyle = '#ffffff';
    cctx.fillText(text, W / 2, cy + 2);
    cctx.shadowColor = 'transparent';
    cctx.shadowBlur = 0;
    cctx.shadowOffsetY = 0;
  }

  function drawBadge() { /* 真人玩家人设：不显示任何 AI/自动游玩标识 */ }

  function frame() {
    requestAnimationFrame(frame);
    if (!gameCanvas || !cctx) return;
    try {
      cctx.drawImage(gameCanvas, 0, 0, W, H);
      drawBadge();
      var t = currentSubtitle();
      if (t) drawSubtitle(t);
    } catch (e) { /* ignore */ }
  }

  function initComposite() {
    gameCanvas = document.getElementById('game-canvas');
    comp = document.createElement('canvas');
    comp.width = W; comp.height = H;
    cctx = comp.getContext('2d');
    requestAnimationFrame(frame);
  }

  /* ============ 录制 + 上传 ============ */

  var MIME_CANDIDATES = [
    'video/mp4;codecs="avc1.640034,mp4a.40.2"',
    'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
  ];
  function pickMime() {
    for (var i = 0; i < MIME_CANDIDATES.length; i++) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(MIME_CANDIDATES[i])) {
        return MIME_CANDIDATES[i];
      }
    }
    return '';
  }

  function startRecording() {
    var vstream = comp.captureStream(30);
    if (streamDest) {
      streamDest.stream.getAudioTracks().forEach(function (tr) { vstream.addTrack(tr); });
    }
    mimeUsed = pickMime();
    var opts = { videoBitsPerSecond: 6000000, audioBitsPerSecond: 128000 };
    if (mimeUsed) opts.mimeType = mimeUsed;
    recorder = new MediaRecorder(vstream, opts);
    recorder.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
    recorder.onstop = upload;
    recorder.onerror = function (e) { errors.push('recorder: ' + (e.error && e.error.name || 'unknown')); };
    // 必须用 timeslice：无 timeslice 的长录制在 headless Edge 下会冻结/崩溃（实测）。
    // 代价是产出 fragmented MP4（duration 元数据缺失），由 record.cjs 调用
    // tools/fix-mp4-duration.cjs 扫描 moof/trun 回填正确时长。
    recorder.start(2000);
    recT0 = performance.now();
    setStatus('recording');
  }

  function stopRecording() {
    recMs = Math.round(performance.now() - recT0);
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    setStatus('encoding');
  }

  function upload() {
    setStatus('uploading');
    var type = mimeUsed ? mimeUsed.split(';')[0] : 'video/mp4';
    var blob = new Blob(chunks, { type: type });
    blob.arrayBuffer().then(function (ab) {
      var q = new URLSearchParams();
      q.set('name', NAME);
      q.set('seed', String(SEED));
      q.set('durationMs', String(recMs));
      q.set('audioPeak', String(audioPeak));
      q.set('size', String(blob.size));
      q.set('mime', type);
      if (finalStats) {
        q.set('score', String(finalStats.score));
        q.set('level', String(finalStats.level));
        q.set('lines', String(finalStats.lines));
        q.set('pieces', String(finalStats.pieces));
        q.set('playMs', String(finalStats.playMs));
        q.set('skillKills', String(finalStats.skillKills));
        q.set('cards', String(finalStats.cards));
        q.set('build', String(finalStats.build || ''));
      }
      if (errors.length) q.set('errors', errors.join('|').slice(0, 300));
      return fetch('/__recording?' + q.toString(), { method: 'POST', body: ab });
    }).then(function (res) {
      return res.text().then(function (t) {
        document.title = 'RECORDING-DONE ' + (res.ok ? 'OK' : 'FAIL');
        setStatus(res.ok ? 'done' : 'upload-failed');
        console.log('[recorder] upload:', t);
      });
    }).catch(function (e) {
      errors.push('upload: ' + e.message);
      document.title = 'RECORDING-DONE FAIL';
      setStatus('upload-failed');
    });
  }

  /* ============ 场景导演 ============ */

  function waitGame() {
    return new Promise(function (resolve, reject) {
      var t0 = Date.now();
      (function poll() {
        if (window.__game && window.__game.state === 'menu' && document.getElementById('game-canvas')) {
          resolve();
        } else if (Date.now() - t0 > 20000) {
          reject(new Error('game not ready'));
        } else {
          setTimeout(poll, 60);
        }
      })();
    });
  }

  function attachBot() {
    bot = AutoPlayer.attach({
      game: G,
      gameSeed: SEED,
      botSeed: BOT_SEED,
      finishAfterMs: FINISH_MS,
      maxLevel: 99,
      cardHoldMs: CARD_HOLD_MS, // 属性牌停留时间：够看清三张牌、也够把这句配音讲完
      skipRng: true, // rng 已在 start 前注入（与 simulate.cjs 的构造序列一致）
      hooks: {
        onDrop: function () { sfxDrop(); },
        onClear: function (dn) {
          sfxClear(dn);
          var id = dn >= 3 ? 'clear4' : dn === 2 ? 'clear2' : (clearAlt = !clearAlt, clearAlt ? 'clear1' : 'clear3');
          playNarr(id);
        },
        onLevelUp: function () {
          sfxLevelup();
          playNarr('levelup', { queue: true });
        },
        /* ---- 属性牌三选一（新特性）：出现时讲解，选完再说拿到了什么 ---- */
        onCardOffer: function () {
          sfxCard();
          say('cards', 0, { queue: true });
        },
        onCardPick: function (view) {
          var tag = view && view.tag;
          say(tag === 'resonance' ? 'cardReso' : tag === 'common' ? 'cardCommon' : 'cardTurret', 0, { queue: true });
        },
        onMode: function (m) {
          if (m === 'finish') playNarr('danger', { delay: 1500, queue: true });
        },
        onGameOver: function (core) {
          finalStats = {
            score: core.score,
            level: core.level,
            lines: core.lines,
            pieces: bot ? bot.stats.pieces : 0,
            /* 新特性战绩：技能击落格数 / 属性牌张数与构筑 */
            skillKills: core.skillKills || 0,
            cards: (core.cardPicks || []).length,
            build: (core.cardPicks || []).join('+'),
            playMs: Math.round(core.elapsed === undefined ? (Date.now() - (bot ? bot.playStart : Date.now())) : core.elapsed),
          };
          tail();
        },
      },
    });
  }

  function tail() {
    setStatus('tail');
    narrQueue.length = 0;   // 丢掉对局里排队超时的台词，保证结算播报一定说得出
    wait(800).then(function () {
      sfxGameover();
      return wait(400);
    }).then(function () {
      return playNarr('gameover-' + SEED, { queue: true, ttl: 20000 });
    }).then(function () {
      return wait(600);
    }).then(function () {
      sfxClick(); G.onButton('rank');
      return wait(450);
    }).then(function () {
      return playNarr('rank', { queue: true, ttl: 20000 });
    }).then(function () {
      return wait(700);
    }).then(function () {
      sfxClick(); G.onButton('back');
      return wait(300);
    }).then(function () {
      sfxClick(); G.onButton('tomenu');
      return wait(450);
    }).then(function () {
      return playNarr('outro', { queue: true });
    }).then(function () {
      return wait(700);
    }).then(function () {
      stopRecording();
    }).catch(function (e) {
      errors.push('tail: ' + e.message);
      stopRecording();
    });
  }

  /** 跳过前面几关：把关卡与积分口径直接推到第 n 关（技能方块立刻登场） */
  function skipToLevel(n) {
    try {
      var core = G.core;
      var base = n > 1 ? core.levelTarget(n - 1) : 0;
      core.level = n;
      core.score = base; // 积分累加口径：接着上一关的合格分继续算
      console.log('[recorder] 跳过前 ' + (n - 1) + ' 关 → level=' + core.level + ' score=' + core.score);
    } catch (e) { errors.push('startlevel: ' + e.message); }
  }

  function run() {
    setStatus('boot');
    waitGame().then(function () {
      G = window.__game;
      // 运行时监测：包装 core.update 计数（定位卡死；不改游戏源码）
      try {
        var origUpdate = G.core.update.bind(G.core);
        G.core.update = function (dt) { updCount++; return origUpdate(dt); };
      } catch (e) { /* noop */ }
      initAudio();
      return loadNarration();
    }).then(function () {
      initComposite();
      return new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); });
    }).then(function () {
      startRecording();
      if (BGM_ON) startBgm();
      return wait(650);
    }).then(function () {
      playNarr('intro');          // 开场白横跨菜单→开局（钩子式旁白）
      /* 菜单停留跟随开场白长度但不拖节奏：最多 6.5s 就进对局，
       * 开场白剩下的尾巴会自然盖在最初几个方块上 */
      var d = buffers.intro ? buffers.intro.buf.duration : 5.5;
      return wait(Math.round(Math.min(6500, Math.max(3200, d * 1000 - 2600))));
    }).then(function () {
      /* 关键顺序（与 simulate.cjs 逐位对齐）：
       * 1) 注入种子 rng → 2) attach bot（空转等待）→ 3) onButton('start')
       *    → startGame() → core.reset() 消费种子流（= 仿真里构造函数的首次 reset） */
      G.core.rng = AutoPlayer.mulberry32(SEED >>> 0);
      installEventDirector();     // 炮台/共鸣/沉降/技能登场 的音效与解说
      attachBot();
      sfxClick();
      G.onButton('start');
      if (START_LEVEL > 1) skipToLevel(START_LEVEL); // 跳过前面几关，直接演示技能/属性牌
      setStatus('playing');
      playNarr('rules', { queue: true, delay: 300 }); // intro 播完后自动接规则讲解
    }).catch(function (e) {
      errors.push('run: ' + (e && e.message));
      document.title = 'RECORDING-DONE FAIL';
      setStatus('error');
    });
  }

  window.__rec = {
    get status() { return status; },
    get errors() { return errors; },
    get audioPeak() { return audioPeak; },
    get finalStats() { return finalStats; },
    playNarr: playNarr,
    run: run,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
