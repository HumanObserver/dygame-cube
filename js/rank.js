/**
 * 排行榜模块
 * - 本机排行：tt.setStorageSync 持久化 TOP10（始终可用）
 * - 好友排行：tt.setUserCloudStorage 托管分数，开放数据域内拉取好友数据渲染
 * 所有 tt.* 调用均有守卫，API 不可用时静默降级，不影响游戏本体。
 */
const TT = (typeof tt !== 'undefined') ? tt : null;

const KEY_BEST = 'gravcube.best';
const KEY_LOCAL = 'gravcube.localRank';

function safeGet(key, def) {
  try {
    if (TT && TT.getStorageSync) {
      const v = TT.getStorageSync(key);
      return (v === '' || v === undefined || v === null) ? def : v;
    }
  } catch (e) { /* 忽略存储异常 */ }
  return def;
}

function safeSet(key, value) {
  try {
    if (TT && TT.setStorageSync) TT.setStorageSync(key, value);
  } catch (e) { /* 忽略存储异常 */ }
}

/** 本机 TOP10 列表 [{score, level, lines, ts}]，按分数降序 */
function getLocal() {
  const v = safeGet(KEY_LOCAL, []);
  return Array.isArray(v) ? v : [];
}

/** 历史最高分 */
function getBest() {
  const v = safeGet(KEY_BEST, 0);
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

/**
 * 提交一局成绩
 * @returns {{isBest:boolean, best:number, local:Array}}
 */
function submit(score, level, lines) {
  const prevBest = getBest();
  const isBest = score > 0 && score > prevBest;
  if (isBest) safeSet(KEY_BEST, score);

  if (score > 0) {
    const list = getLocal();
    list.push({ score, level, lines, ts: Date.now() });
    list.sort((a, b) => b.score - a.score);
    safeSet(KEY_LOCAL, list.slice(0, 10));
  }

  // 云端托管数据：供开放数据域的好友排行榜使用
  try {
    if (TT && TT.setUserCloudStorage) {
      TT.setUserCloudStorage({
        KVDataList: [
          { key: 'score', value: String(score) },
          { key: 'level', value: String(level) },
          { key: 'lines', value: String(lines) },
          { key: 'update_time', value: String(Math.floor(Date.now() / 1000)) },
        ],
        fail() {},
      });
    }
  } catch (e) { /* 云端不可用时仅保留本机排行 */ }

  return { isBest, best: Math.max(prevBest, score), local: getLocal() };
}

/* ---------- 开放数据域（好友排行） ---------- */

function getOpenDataContext() {
  try {
    if (TT && TT.getOpenDataContext) return TT.getOpenDataContext();
  } catch (e) { /* 忽略 */ }
  return null;
}

/**
 * 通知开放数据域渲染好友排行榜
 * @param width/height 渲染区域尺寸（物理像素）
 * @returns 共享画布（可能为 null，调用方需判空）
 */
function showFriendRank(width, height) {
  const odc = getOpenDataContext();
  if (!odc) return null;
  try {
    if (odc.postMessage) {
      odc.postMessage({ type: 'renderRank', width: Math.floor(width), height: Math.floor(height) });
    }
  } catch (e) { /* 忽略 */ }
  return odc.canvas || null;
}

/** 离开排行榜页面时通知开放数据域清空共享画布 */
function hideFriendRank() {
  const odc = getOpenDataContext();
  if (!odc) return;
  try {
    if (odc.postMessage) odc.postMessage({ type: 'hide' });
  } catch (e) { /* 忽略 */ }
}

/* ---------- 分享 ---------- */

function share(score) {
  try {
    if (TT && TT.shareAppMessage) {
      TT.shareAppMessage({
        title: score > 0
          ? `我在《引力方块》拿了 ${score} 分，四向重力你能撑几关？`
          : '引力方块：方块从中心掉落，重力随机四向，来挑战！',
        query: 'from=share',
        fail() {},
      });
    }
  } catch (e) { /* 忽略 */ }
}

module.exports = { getLocal, getBest, submit, showFriendRank, hideFriendRank, share };
