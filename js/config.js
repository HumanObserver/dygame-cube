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

/* ================= 沉降规则 =================
 * 消除线（整行 / 整列）清空后只压实「靠近消除线的一侧」，另一侧保持原位：
 *  - 整行 r 被消除 → 第 0..r 行这段方块整体向下沉到贴合 r，第 r+1 行以下不动
 *  - 整列 c 被消除 → 第 0..c 列这段方块整体向右滑到贴合 c，第 c+1 列以右不动
 * 想改成「下半边保持上滑 / 右半半边保持左滑」，把下面两项改成 'below' / 'right' 即可。
 */
const SETTLE = {
  ROW_SIDE: 'above', // 'above' = 消除行上方的半侧下沉（默认）| 'below'
  COL_SIDE: 'left',  // 'left'  = 消除列左侧的半侧右滑（默认）| 'right'
};

/* ================= 技能方块（第 2 关起出现） =================
 * 两类技能格（详见 js/skills.js）：
 *  - 炮台（落地技能）：方块落地瞬间发射能量弹，命中的方格被击落消失（其余方格保持原位，
 *    不引发沉降），消失方格计分
 *  - 共鸣（消除技能）：方格被消除或被击落时，与它同类（同色 / 同层 / 同列，由属性牌决定）
 *    的方格一同消失，消失方格计分
 * 技能格的具体数值由「属性牌」决定（见 CARD）
 */
const SKILL = {
  START_LEVEL: 2,          // 从第几关开始出现技能方块
  CHANCE: 0.30,            // 每个方块带技能格的基础概率
  CHANCE_STEP: 0.10,       // 属性牌「灵能灌注」每层的增量
  CHANCE_MAX: 0.85,
  WEIGHT: { turret: 0.55, resonance: 0.45 }, // 两类技能的抽取权重
  BASE_CELL_SCORE: 20,     // 技能消失的每格基础分（×关卡）
  CELL_SCORE_STEP: 5,      // 属性牌「高能弹药」每层增量
  BULLET_FRAME: 70,        // 子弹每飞行一格的动画时长(ms)
  CASCADE_LIMIT: 160,      // 单次技能级联最多消失的方格数（性能/观感保护）
  ACCENT: { turret: '#ffcf5c', resonance: '#7df9ff' },
};

/* ================= 属性牌（三选一） =================
 * 分数每跨过 CARD.INTERVAL 分（默认 1000）就弹出三张属性牌供选择，
 * 选中后本局后续遇到的技能方块即带上该属性（叠加，永久生效）。
 */
const CARD = {
  INTERVAL: 1000, // 每隔多少分给一次三选一（0 = 关闭属性牌）
  CHOICES: 3,     // 每次弹出的牌数
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

  // 消除后的半侧沉降规则
  SETTLE,

  // 技能方块 + 属性牌
  SKILL,
  CARD,

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
