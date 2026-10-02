/**
 * 关卡进度存档（「玩到第几关」的记忆）
 *
 * 用途：
 *  - 新手第一次进来从第 1 关开始走教学（第 1~6 关）；
 *  - 之后每次启动默认「延续上次的关卡」，菜单上有「继续 第 N 关」；
 *  - 手动在「关卡选择」里点某一关 = 从那关重新开始（也会覆盖存档点）。
 *
 * 只保存「关卡开局状态」（棋盘由 js/levelplan.js 的脚本重建，教学关不会存进烂摊子）。
 * 所有 tt.* 调用均有守卫，API 不可用时静默降级为内存存储（Web 预览 / Node 测试）。
 */
const TT = (typeof tt !== 'undefined') ? tt : null;

const KEY_PROGRESS = 'gravcube.checkpoint';
const KEY_MAXLEVEL = 'gravcube.maxLevel';
const SAVE_VERSION = 1;

const memory = {}; // 无 tt 环境下的降级存储

function safeGet(key) {
  try {
    if (TT && TT.getStorageSync) {
      const v = TT.getStorageSync(key);
      if (v === '' || v === undefined || v === null) return memory[key];
      return typeof v === 'string' ? tryParse(v) : v;
    }
  } catch (e) { /* 忽略存储异常 */ }
  return memory[key];
}

function safeSet(key, value) {
  memory[key] = value;
  try {
    if (TT && TT.setStorageSync) TT.setStorageSync(key, value);
  } catch (e) { /* 忽略 */ }
}

function tryParse(s) {
  try { return JSON.parse(s); } catch (e) { return null; }
}

function num(v, def) {
  return (typeof v === 'number' && isFinite(v)) ? v : def;
}

/**
 * 保存开局断点。
 * @param {object} state GameCore.snapshot() 的结果（外加可选的 seed）
 */
function save(state) {
  if (!state || !state.level) return null;
  const rec = {
    v: SAVE_VERSION,
    level: Math.max(1, Math.floor(state.level)),
    score: Math.max(0, Math.floor(num(state.score, 0))),
    lines: Math.max(0, Math.floor(num(state.lines, 0))),
    levelStartScore: Math.max(0, Math.floor(num(state.levelStartScore, num(state.score, 0)))),
    cardTarget: num(state.cardTarget, 0),
    cardPicks: Array.isArray(state.cardPicks) ? state.cardPicks.slice() : [],
    cardGiven: state.cardGiven && typeof state.cardGiven === 'object' ? Object.assign({}, state.cardGiven) : {},
    mods: state.mods && typeof state.mods === 'object' ? state.mods : null,
    skillKills: Math.max(0, Math.floor(num(state.skillKills, 0))),
    skillScore: Math.max(0, Math.floor(num(state.skillScore, 0))),
    tutorial: !!state.tutorial,
    ts: Date.now(),
  };
  safeSet(KEY_PROGRESS, rec);
  bump(rec.level);
  return rec;
}

/** 读取断点；没有存档或版本不符 → null */
function load() {
  const v = safeGet(KEY_PROGRESS);
  if (!v || typeof v !== 'object') return null;
  if (v.v !== SAVE_VERSION || !v.level) return null;
  if (num(v.score, -1) < 0) return null;
  return v;
}

/** 清掉断点（「从第 1 关重新开始」时用） */
function clear() {
  delete memory[KEY_PROGRESS];
  try {
    if (TT && TT.removeStorageSync) TT.removeStorageSync(KEY_PROGRESS);
    else if (TT && TT.setStorageSync) TT.setStorageSync(KEY_PROGRESS, '');
  } catch (e) { /* 忽略 */ }
}

/** 到达过的最高关卡（关卡选择界面用它决定哪些关可选） */
function bump(level) {
  const cur = maxLevel();
  if (level > cur) safeSet(KEY_MAXLEVEL, level);
  return Math.max(cur, level);
}

function maxLevel() {
  return Math.max(1, Math.floor(num(safeGet(KEY_MAXLEVEL), 1)));
}

module.exports = { SAVE_VERSION, save, load, clear, bump, maxLevel, KEY_PROGRESS, KEY_MAXLEVEL };
