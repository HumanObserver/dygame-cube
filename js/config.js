/**
 * 全局配置常量
 * 引力方块：10x10 方形棋盘，方块从中心生成，重力方向随机（下/左/上/右）
 */

// 重力方向单位向量：0=下 1=左 2=上 3=右
const DIRS = [
  { x: 0, y: 1, name: 'down', label: '↓' },
  { x: -1, y: 0, name: 'left', label: '←' },
  { x: 0, y: -1, name: 'up', label: '↑' },
  { x: 1, y: 0, name: 'right', label: '→' },
];

// 每个重力方向对应的“横向移动”轴（与重力垂直）
// 重力向下/上时，横向 = x 轴；重力向左/右时，横向 = y 轴
const PERP = [
  { x: 1, y: 0 },  // 重力向下：横向为屏幕左右
  { x: 0, y: 1 },  // 重力向左：横向为屏幕上下
  { x: 1, y: 0 },  // 重力向上：横向为屏幕左右
  { x: 0, y: 1 },  // 重力向右：横向为屏幕上下
];

// 七种方块的颜色
const COLORS = {
  I: '#00e5ff',
  O: '#ffd500',
  T: '#b388ff',
  S: '#69f0ae',
  Z: '#ff5252',
  J: '#448aff',
  L: '#ffab40',
};

module.exports = {
  COLS: 10,
  ROWS: 10,
  TYPES: ['I', 'O', 'T', 'S', 'Z', 'J', 'L'],
  DIRS,
  PERP,
  COLORS,

  // 下落前提示（方块类型 + 方向）的停留时间
  HINT_BASE: 1000,   // 第 1 关提示时长 ms
  HINT_MIN: 500,     // 提示时长下限 ms
  HINT_STEP: 50,     // 每升 1 关减少 ms

  // 下落速度（每格间隔）
  FALL_BASE: 1000,   // 第 1 关每格 ms
  FALL_MIN: 120,     // 速度上限（最快每格 120ms）
  FALL_STEP: 80,     // 每升 1 关加快 ms

  LINES_PER_LEVEL: 8,        // 每消除 8 行升 1 关
  SCORE_TABLE: [0, 100, 250, 500, 800], // 同时消除 1/2/3/4 行的基础分
  SCORE_EXTRA: 200,          // 超过 4 行后每多 1 行的附加基础分
  SOFT_DROP_SCORE: 1,        // 自然下落每格 +1
  HARD_DROP_SCORE: 2,        // 快速降落每格 +2

  // 视觉
  ACCENT: '#ff4d6d',
  BG_TOP: '#0f1220',
  BG_BOTTOM: '#1c2140',
};
