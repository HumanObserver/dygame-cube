/**
 * 全局配置常量
 * 引力方块：20x20 方形棋盘，方块从中心生成，重力方向随机（下/左/上/右）
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

/* ================= 关卡合格分 =================
 * 每一关都有一个「合格分」（累计分数目标）：本局累计分数达到当前关合格分即算过关，
 * 升入下一关（下落提速、提示缩短）。想调整某一关多少分合格，直接改下表对应项即可。
 * 表格覆盖前 10 关；超出表格的关卡按公式外推：第 n 关需再净得 LEVEL_TARGET_STEP × n 分。
 * 默认曲线：第 1 关 500，第 2 关 1500，第 3 关 3000，第 4 关 5000 …（逐关增量 +500）
 */
const LEVEL_TARGETS = [500, 1500, 3000, 5000, 7500, 10500, 14000, 18000, 22500, 27500];
const LEVEL_TARGET_STEP = 500;

/** 第 level 关的合格分（累计分数目标）；level 从 1 开始 */
function levelTarget(level) {
  if (level <= LEVEL_TARGETS.length) return LEVEL_TARGETS[level - 1];
  let t = LEVEL_TARGETS[LEVEL_TARGETS.length - 1];
  for (let n = LEVEL_TARGETS.length + 1; n <= level; n++) t += LEVEL_TARGET_STEP * n;
  return t;
}

/* ================= 平台能力配置 =================
 * 对应审核检测的五项能力：侧边栏复访 / 添加到桌面 / 订阅消息 / 广告 / 内购。
 * 所有标 TODO 的 ID 必须替换为「抖音开放平台开发者后台」中创建的真实 ID，
 * 否则对应能力在真机上会走失败回调（已做守卫降级，不影响游戏运行）。
 */
const PLATFORM = {
  /* ---- 广告：后台「流量主」→「广告位管理」创建后替换 ---- */
  REWARDED_AD_UNIT_ID: 'd9tbmu1k2kk5ehnpvl',     // TODO: 替换为你的激励视频广告位 ID
  INTERSTITIAL_AD_UNIT_ID: 'e7fm9np9lsu7694n9q', // TODO: 替换为你的插屏广告位 ID
  INTERSTITIAL_MIN_INTERVAL: 90000,              // 两次插屏的最小间隔（ms），防打扰

  /* ---- 订阅消息：后台「功能」→「订阅消息」选用模板后替换 ---- */
  SUBSCRIBE_TMPL_IDS: ['REPLACE_WITH_TMPL_ID'],  // TODO: 替换为订阅消息模板 ID（可多个）

  /* ---- 内购：需游戏版号并在后台开通内购能力后才可开启 ---- */
  // 默认 false：内购调用代码已接入（js/platform.js），但购买入口隐藏，
  // 避免在无版号时触发「未获资质开通虚拟支付」的审核风险。拿到版号后改为 true。
  ENABLE_IAP: false,
  IAP: {
    productId: 'coins_100', // TODO: 后台配置的内购道具 ID
    priceFen: 100,          // 道具价格（单位：分）
    coins: 100,             // 到账金币数
    zoneId: '1',            // 游戏分区
  },

  /* ---- 金币经济（复活 / 奖励发放与消耗） ---- */
  WELCOME_COINS: 30,        // 新玩家赠送金币（足够一次金币复活，保证复活链路可用）
  REVIVE_COIN_COST: 30,     // 金币复活消耗
  AD_REWARD_COINS: 50,      // 完整观看一次激励视频的金币奖励
  SIDEBAR_REWARD_COINS: 60, // 从抖音首页侧边栏进入游戏后可领取（每日一次）
};

module.exports = {
  COLS: 20,
  ROWS: 20,
  TYPES: ['I', 'O', 'T', 'S', 'Z', 'J', 'L'],
  DIRS,
  PERP,
  COLORS,

  // 下落前提示（方块类型 + 方向）的停留时间
  HINT_BASE: 1000,   // 第 1 关提示时长 ms
  HINT_MIN: 500,     // 提示时长下限 ms
  HINT_STEP: 50,     // 每升 1 关减少 ms

  // 下落速度（每格间隔）— 20×20 棋盘下落距离翻倍，间隔减半以保持节奏与原 10×10 相当
  FALL_BASE: 500,    // 第 1 关每格 ms
  FALL_MIN: 80,      // 速度上限（最快每格 80ms）
  FALL_STEP: 40,     // 每升 1 关加快 ms

  // 关卡合格分：累计分数达到 LEVEL_TARGETS[level-1] 即过该关（详见文件顶部说明）
  LEVEL_TARGETS,
  LEVEL_TARGET_STEP,
  levelTarget,

  SCORE_TABLE: [0, 100, 250, 500, 800], // 同时消除 1/2/3/4 行的基础分
  SCORE_EXTRA: 200,          // 超过 4 行后每多 1 行的附加基础分
  SOFT_DROP_SCORE: 1,        // 自然下落每格 +1
  HARD_DROP_SCORE: 2,        // 快速降落每格 +2

  // 视觉
  ACCENT: '#ff4d6d',
  BG_TOP: '#0f1220',
  BG_BOTTOM: '#1c2140',
  BOARD_SCALE: 1.0,          // 棋盘整体缩放（方块大小）：20×20 下单格已约为 10×10 时的一半；调小可进一步缩小方块

  // 平台能力（审核检测项）配置
  PLATFORM,
};
