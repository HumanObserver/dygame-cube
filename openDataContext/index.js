/**
 * 开放数据域（好友排行榜）
 * 运行在独立的 JS 上下文中，只能使用 tt 的开放数据相关 API：
 *   tt.getSharedCanvas / tt.onMessage / tt.getFriendCloudStorage
 * 主域通过 postMessage({type:'renderRank', width, height}) 请求渲染。
 */
const sharedCanvas = tt.getSharedCanvas();
const ctx = sharedCanvas.getContext('2d');

let areaW = 300;
let areaH = 400;
let friends = [];
let renderToken = 0; // 防止异步头像回调渲染过期数据

tt.onMessage((msg) => {
  if (!msg) return;
  if (msg.type === 'renderRank') {
    areaW = Math.max(60, msg.width || sharedCanvas.width || 300);
    areaH = Math.max(60, msg.height || sharedCanvas.height || 400);
    sharedCanvas.width = areaW;
    sharedCanvas.height = areaH;
    fetchFriends();
  } else if (msg.type === 'hide') {
    renderToken++;
    ctx.clearRect(0, 0, sharedCanvas.width, sharedCanvas.height);
  }
});

function fetchFriends() {
  const token = ++renderToken;
  drawLoading(token);
  try {
    if (typeof tt.getFriendCloudStorage !== 'function') {
      drawEmpty(token, '当前基础库不支持好友数据');
      return;
    }
    tt.getFriendCloudStorage({
      keyList: ['score', 'level', 'lines'],
      success(res) {
        if (token !== renderToken) return;
        friends = normalize(res && res.data ? res.data : []);
        renderList(token);
        loadAvatars(token);
      },
      fail() {
        if (token !== renderToken) return;
        drawEmpty(token, '暂无好友数据，邀请好友一起玩吧');
      },
    });
  } catch (e) {
    if (token === renderToken) drawEmpty(token, '好友数据不可用');
  }
}

function normalize(list) {
  const rows = [];
  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    let score = 0, level = 0, lines = 0;
    const kvs = it.KVDataList || [];
    for (let j = 0; j < kvs.length; j++) {
      const kv = kvs[j];
      if (kv.key === 'score') score = parseInt(kv.value, 10) || 0;
      else if (kv.key === 'level') level = parseInt(kv.value, 10) || 0;
      else if (kv.key === 'lines') lines = parseInt(kv.value, 10) || 0;
    }
    rows.push({
      nickname: it.nickname || '神秘玩家',
      avatarUrl: it.avatarUrl || '',
      score: score,
      level: level,
      lines: lines,
      img: null,
    });
  }
  rows.sort((a, b) => b.score - a.score);
  return rows.slice(0, 30);
}

function loadAvatars(token) {
  if (typeof tt.createImage !== 'function') return;
  for (let i = 0; i < friends.length; i++) {
    const f = friends[i];
    if (!f.avatarUrl || f.img) continue;
    try {
      const img = tt.createImage();
      img.onload = () => {
        f.img = img;
        if (token === renderToken) renderList(token);
      };
      img.onerror = () => { /* 头像加载失败则显示首字 */ };
      img.src = f.avatarUrl;
    } catch (e) { /* 忽略 */ }
  }
}

/* ---------- 绘制 ---------- */

function drawLoading(token) {
  ctx.clearRect(0, 0, areaW, areaH);
  centerText('好友排行加载中…', areaH / 2, 14, 'rgba(255,255,255,0.6)', false);
}

function drawEmpty(token, msg) {
  ctx.clearRect(0, 0, areaW, areaH);
  centerText('好友排行', 30, 15, '#ffd54f', true);
  centerText(msg, areaH / 2, 13, 'rgba(255,255,255,0.55)', false);
}

function centerText(str, y, size, color, bold) {
  ctx.save();
  ctx.font = (bold ? 'bold ' : '') + size + 'px sans-serif';
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(str, areaW / 2, y);
  ctx.restore();
}

function renderList(token) {
  ctx.clearRect(0, 0, areaW, areaH);
  if (!friends.length) { drawEmpty(token, '暂无好友数据，邀请好友一起玩吧'); return; }

  ctx.save();
  ctx.font = 'bold 15px sans-serif';
  ctx.fillStyle = '#ffd54f';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('好友排行', 12, 22);
  ctx.restore();

  const rowH = Math.min(44, Math.max(28, (areaH - 44) / Math.min(friends.length, 8)));
  const n = Math.min(friends.length, Math.floor((areaH - 40) / rowH));
  for (let i = 0; i < n; i++) {
    const f = friends[i];
    const y = 44 + i * rowH + rowH / 2;
    const cx = 14;

    // 名次
    ctx.save();
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = i === 0 ? '#ffd54f' : (i === 1 ? '#cfd8dc' : (i === 2 ? '#ffab40' : 'rgba(255,255,255,0.5)'));
    ctx.fillText(String(i + 1), cx, y);
    ctx.restore();

    // 头像
    const ax = cx + 26, ar = rowH * 0.34;
    if (f.img) {
      try {
        ctx.save();
        ctx.beginPath();
        ctx.arc(ax + ar, y, ar, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(f.img, ax, y - ar, ar * 2, ar * 2);
        ctx.restore();
      } catch (e) { drawAvatarFallback(f, ax + ar, y, ar); }
    } else {
      drawAvatarFallback(f, ax + ar, y, ar);
    }

    // 昵称
    ctx.save();
    ctx.font = '13px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const nameX = ax + ar * 2 + 10;
    let nick = f.nickname;
    if (nick.length > 7) nick = nick.slice(0, 7) + '…';
    ctx.fillText(nick, nameX, y - 7);
    ctx.font = '10px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillText('第' + f.level + '关 · ' + f.lines + '行', nameX, y + 9);
    ctx.restore();

    // 分数
    ctx.save();
    ctx.font = 'bold 15px sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(f.score), areaW - 14, y);
    ctx.restore();
  }
}

function drawAvatarFallback(f, cx, cy, r) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.fill();
  ctx.font = 'bold ' + r + 'px sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText((f.nickname || '?').slice(0, 1), cx, cy + 1);
  ctx.restore();
}
