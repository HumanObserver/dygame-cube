# 引力方块（dygame-cube）

一款抖音小游戏：四向重力方块消除玩法（合规文案，对外物料统一使用「方块消除玩法」表述）。

## 玩法特色

- **中心生成**：方块从 20×20 棋盘正中心生成，而非传统的顶部
- **随机重力**：每个方块的下落方向随机（下 / 左 / 上 / 右），重力侧的棋盘边缘会高亮显示
- **下落前提示**：方块正式下落前会停留片刻并闪烁，同时用大号箭头预告「方块类型 + 下落方向」；HUD 中还有「下一个」面板提前展示下一块的类型与方向
- **双向消行**：填满任意整行 **或** 整列即可消除（适配四向重力）
- **半侧沉降**：消除后**只有贴近消除线的那一半**方块朝着消除线滑动贴合，另一半保持原位（消行→上半下沉、下半不动；消列→近侧那半横向滑动）；滑动的这一半若凑齐新的整行/整列将连锁消除，一并计数计分
- **过关清场**：每关设有「合格分」（第 1 关 500 分、第 2 关 1500 分、第 3 关 3000 分……逐关递增），本局累计分数达到合格分即过关——**棋盘整体清空、从下一关重新开局，但积分不清零、继续累加**；升关后下落更快、提示时间更短；HUD 顶部显示当前关合格分与进度条
- **技能方块**（第 2 关起按概率出现，棋盘中随机一格带技能，两种类别）：
  - **炮台**（落地技能，金色徽章）：落位瞬间沿**反重力方向**发射能量弹，击落弹道上的方格；子弹会**穿过自己方块的其余格**（不打自己人，也不消耗穿透），只击落别人的方格；被击落的方格**原地消失、不引发沉降**（原方格保持），每格按构筑计分
  - **共鸣**（消除技能，青色徽章）：当它**被消除或被能量弹击落**时释放，把与它「同类」的方格一起带走（默认同颜色/同类型），并沿被带走的共鸣格继续级联引爆
  - **连锁各放各的技能**：被技能带走的方格若自己也是技能格，会当场释放**它本人的**技能（共鸣继续波及、炮台就地补射），每步单独计分、单独出特效（结算与事件按步拆分，`knock` 标记补射）
- **命中表现**：子弹命中 = 白热闪光 + 双层冲击波 + 8 道放射火花 + 四角碎块外飞 + 弹道十字/斜向火花，并伴随**棋盘震屏**（幅度按击落格数递增，0.26~0.3s 内衰减）与震动反馈；共鸣消失同理带青色爆点
- **属性牌三选一**（本局永久生效的构筑）：累计分数每跨过 `CARD.INTERVAL`（默认 1000 分）弹出三张属性牌，选一张后**后续遇到的技能方块都会带上这份属性**
  - 炮台系：子弹数（双联/三联/四联炮管）、穿透层数、撞墙反弹次数、单格加分
  - 共鸣系：同类判定维度扩展（同色 / 同层=同一行 / 同列=同一列，可叠加）+ 消失方式（爆炸周围 8 格 / 横向激光左右各 2 格 / 竖向激光上下各 2 格 / 十字激光四向各 2 格）
  - 通用：技能方块出现概率提升
  - 满级的属性牌不再进入牌池；待选牌时对局自动暂停，可跳过不发
- **玩家排行**：
  - 本机 TOP10（始终可用，本地持久化）
  - 好友排行榜（开放数据域 + 云端托管数据，需真机登录抖音）
- **金币与复活**：新手赠币、看激励视频、每日侧边栏复访均可得金币；游戏结束后可「看广告复活」或「金币复活」（每局一次，保留分数继续玩）
- **平台能力接入**（对应抖音审核检测项，全部带守卫降级，详见 `js/platform.js`）：
  - 侧边栏复访（必接）：`tt.navigateToScene({scene:'sidebar'})` 跳转 + `tt.checkScene` 可用性判断 + `tt.onShow` 启动来源检测 + 每日复访奖励
  - 添加到桌面：`tt.addToDesktop`
  - 订阅消息：`tt.requestSubscribeMessage`
  - 广告：激励视频 `tt.createRewardedVideoAd`（免费金币 / 复活）+ 插屏 `tt.createInterstitialAd`（结算页，90s 节流）
  - 内购：`tt.requestMidasPaymentGameItem`（需游戏版号；`PLATFORM.ENABLE_IAP=false` 时购买入口隐藏）
- **操作方式**：
  - 底部按钮：◀ ▶（沿垂直于重力的方向移动）、旋转、落下（沿重力直达底部）
  - 手势：点击棋盘 = 旋转；沿重力方向滑动 = 快速落底；垂直滑动 = 横向移动

## 目录结构

```
game/
├── game.js                 # 小游戏入口
├── game.json               # 全局配置（竖屏、开放数据域）
├── project.config.json     # 开发者工具项目配置（需填入 AppID）
├── js/
│   ├── config.js           # 常量配置（棋盘、速度、计分、关卡合格分、沉降规则、技能与属性牌、配色）
│   ├── tetromino.js        # 7 种方块定义与旋转（纯逻辑）
│   ├── board.js            # 棋盘网格：碰撞、锁定、行列消除、半侧沉降、技能格（纯逻辑）
│   ├── skills.js           # 技能与属性牌：炮台弹道、共鸣波及与级联、牌池与加成（纯逻辑）
│   ├── gamecore.js         # 核心状态机：hint → fall → lock → 技能结算 → 过关清场 → 属性牌（纯逻辑）
│   ├── render.js           # Canvas 2D 渲染与布局（技能徽章、弹道/爆炸/共鸣动效、属性牌场景）
│   ├── input.js            # 触摸手势（点按 / 滑动）
│   ├── platform.js         # 平台能力：侧边栏复访/桌面/订阅/广告/内购/金币钱包
│   ├── rank.js             # 排行榜：本地存储 + 云端托管 + 分享
│   └── main.js             # 主控制器：游戏循环、场景切换（含 cards 场景）
├── openDataContext/
│   └── index.js            # 开放数据域：好友排行榜渲染（独立上下文）
└── test/
    └── core.test.cjs       # 核心逻辑单元测试（51 个用例）
```

纯逻辑层（config / tetromino / board / skills / gamecore）不依赖任何抖音 API，可直接在 Node 中测试。

## 本地测试

需要 Node.js ≥ 18：

```bash
node --test test/core.test.cjs
```

覆盖：旋转与踢墙、行列消除、**半侧沉降**（消行/消列的近侧压实 + 连锁）、四向重力锁定、计分、**过关清场（升关不清分、多关连升、全清无残留）**、速度下限、游戏结束判定、复活（revive）、**技能格（炮台落地开火 / 穿过己方方块 / 穿透·反弹·多管·激光 / 共鸣同类引爆 / 被带走的格子各自释放技能＝补射）**、**属性牌（发牌、选择、跳过、构筑生效、技能格携带 mods）** 等 55 个用例。

集成冒烟测试（在 Node 中以模拟 tt 环境 + Canvas 打桩运行整个游戏：场景切换、按钮/手势输入、完整一局打到游戏结束、分享、侧边栏复访领奖/跳转、添加到桌面、订阅消息、激励视频得金币、广告复活、插屏节流、开放数据域渲染）：

```bash
node web-preview/smoke.cjs
```

## 浏览器预览（无需安装抖音开发者工具）

```bash
node web-preview/serve.cjs
```

打开终端显示的地址（默认 <http://127.0.0.1:8737>，端口被占用时自动 +1）：

- `web-preview/tt-shim.js` 把 `tt.*` API 补齐为浏览器等价物：画布 → `<canvas>`、触摸 → 鼠标/触屏事件、存储 → localStorage
- 桌面鼠标操作：单击 = 点按（旋转 / 按按钮），按住拖动 = 滑动（沿重力方向拖 = 快速落下，垂直方向拖 = 横向移动）
- 好友排行榜依赖开放数据域，浏览器中不可用，自动降级为本机排行；其余玩法与真机一致
- `serve.cjs` 启动时自动执行 `build.cjs`，将 CommonJS 模块打包为 `web-preview/bundle.js`（构建产物，已在 .gitignore 中忽略）

## 自动化演示（脚本对局 + 场景截图）

`web-preview/demo.html`（内联脚本 + `demo.js`）在浏览器中自动播放一局**脚本化确定性对局**：种子随机流（mulberry32(42)）+ 固定虚拟时间线 —— 开局 → 下落前提示 → 下落 → 消行 → 升级 → 游戏结束 → 排行榜。配合无头浏览器的 `--virtual-time-budget`（虚拟时钟，确定性回放）即可自动截取各关键场景：

```powershell
node web-preview/serve.cjs   # 先保持服务运行
# 各帧截图预算(ms)：1-menu=250  2-hint=950  3-fall=4200  4-clear=5150
#                5-levelup=5750  6-gameover=6500  7-rank=7100
& "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --headless=new --disable-gpu `
  --hide-scrollbars --force-device-scale-factor=1 --window-size=390,844 `
  --user-data-dir="$env:TEMP\gcdemo-hint" --virtual-time-budget=950 `
  --screenshot=web-preview/shots/2-hint.png "http://127.0.0.1:8737/demo.html"
```

演示截图（`web-preview/shots/`）：

![主菜单](web-preview/shots/1-menu.png)
![下落前提示](web-preview/shots/2-hint.png)
![下落中](web-preview/shots/3-fall.png)
![消行闪光](web-preview/shots/4-clear.png)
![升级](web-preview/shots/5-levelup.png)
![游戏结束](web-preview/shots/6-gameover.png)
![排行榜](web-preview/shots/7-rank.png)

## 演示视频自动录制（自动游玩 + 配音 + 无头录制）

一条命令产出一条 1080×1920 竖屏对局视频：浏览器预览页由自动玩家 bot 实时操作，配音按事件触发，画面与解说都是玩家视角、无任何「自动/AI」标识。

| 环节 | 脚本 | 说明 |
| --- | --- | --- |
| 离线选种 | `web-preview/simulate.cjs` | Node 中跑完整对局，按「新特性是否出镜 + 成片时长」打分排序；`--write-seeds` 写出 `web-preview/seeds.json` |
| 自动玩家 | `web-preview/autoplayer.js` | UMD，浏览器与 Node 共用。规划时借用游戏自身的 `js/board.js` / `js/skills.js`（浏览器侧经 `window.__bundleRequire` 取到**同一份模块实例**），在草稿盘上复刻 `gamecore._lock` 的结算顺序：锁定 → 技能格落位 → 炮台开火 + 共鸣级联 → 行列消除 → 共鸣 → 半侧沉降 → 连锁。所以 bot 不只是会消行，还**主动用技能**：炮台瞄准人堆打、把共鸣格塞进即将成形的整行/整列里引爆 |
| 属性牌决策 | 同上 `chooseCardIndex` | 三选一按固定偏好顺序（炮台流优先），无随机 → 仿真选出的种子在录制页必然复现同一局 |
| 配音台词 | `tools/gen-narration.cjs` | Edge TTS（`zh-CN-YunxiNeural`）合成 `web-preview/media/narration/*.mp3` + `clips.json`；`--missing` 只重生成文案变过的条目；websocket 偶发失败自动退避重试 |
| 录制 | `web-preview/record.cjs` + `web-preview/recorder.js` | 无头 Edge（`--window-size=540,960 --force-device-scale-factor=2`）打开 `record.html`，页面内 `MediaRecorder` 录 H.264/AAC，结束后 `POST /__recording` 落盘 `web-preview/videos/<name>.mp4` 并修补 fMP4 时长 |
| 每日一条 | `tools/daily-record.cjs` | 按日期从 `seeds.json` 轮转取种子录制，命名 `gravity-cube-<yyyymmdd>.mp4` |
| 抽帧校验 | `web-preview/verify.cjs` | 按时间点抽帧，确认分辨率与关键画面（技能徽章、弹道、属性牌面板） |

### 导演层：新特性怎么被「讲」出来

`recorder.js` 不改游戏源码，只**包一层 `main.processEvents`**，在它排空 `core.events` 之前先读一遍事件队列，再按事件配音效与解说：

| 事件 | 表现 |
| --- | --- |
| `turret` | 开火「咻」+ 命中闷响；击落 >0 解说「炮台开火！」，≥6 格换成「这一发直接带走一整排」，11s 节流 |
| `resonance` | 上滑音 + 引爆低频；解说「共鸣引爆！」 |
| `clear`（`settled>0`，仅首次） | 解说「半侧沉降」：只有贴近消除线那一半滑动压实 |
| `levelup`（`skills=true`，仅首次） | 解说技能方块登场：金色炮台 / 青色共鸣 |
| `cards` / `cardpick`（bot 钩子 `onCardOffer` / `onCardPick`） | 解说「属性牌三选一」，选完再按牌系补一句（炮台 / 共鸣 / 通用）；对局在此暂停，`--cardhold`（默认 6500ms）保证牌面看得清、台词讲得完 |

排队台词带 6s 有效期（`ttl`），过期直接丢弃——新特性解说讲究此时此刻，宁可不说也不迟说；结算台词例外（`ttl: 20000`），保证战绩一定播得出来。

### 常用命令

```powershell
# 1) 离线选种（要求炮台/共鸣/属性牌/沉降全部出镜，并写入 seeds.json）
node web-preview/simulate.cjs --search 1..240 --finish 100000 --min-turret 3 --min-reso 1 --min-cards 2 --write-seeds

# 2) 生成配音（基础台词 + 种子池战绩台词；--missing 跳过未改文案，--prune 清掉换池后失效的战绩）
node tools/gen-narration.cjs --base --seed all --missing --prune

# 3) 录制（约 2.5 分钟，按真实时间录制）
node web-preview/record.cjs --seed 144 --finish 100000 --name gravity-cube-20261001

# 3b) 跳过前面几关（演示新特性时用，直接从第 N 关开局，积分接着上一关合格分累计）
node web-preview/record.cjs --seed 35 --startlevel 3 --finish 45000 --name demo-skills
#   ↑ 注意：level 越高技能格越密，炮台把刚堆好的一行打缺，消行数会明显下降
#     （实测 startlevel=3 三局 lines=0）。要「消行+沉降+技能+属性牌」同框，
#     优先用第 1 步选出的种子从第 1 关自然打到第 3 关。

# 4) 抽帧校验（fMP4 没有随机索引，用顺序播放采样而非 seek）
node web-preview/verify.cjs --file videos/gravity-cube-20261001.mp4 --times 43,74,77,106 --mode play --rate 8
```

最新成片：[web-preview/videos/gravity-cube-20261001.mp4](web-preview/videos/gravity-cube-20261001.mp4)
（1080×1920 / 2 分 38 秒 / 15.7 MB。实录战绩：2605 分、第 3 关、消 4 行、55 块；过关清场 2 次、炮台开火 6 次击落 27 格、共鸣引爆 2 次带走 18 格、半侧沉降 85 格、属性牌三选一 2 次（穿甲弹头 → 双联炮管，第 109 秒的双发弹幕就是它生效的样子），结尾播报的就是这几个真实数字。）

> **一致性保证**：`(gameSeed, botSeed, finishAfterMs)` 相同 ⇒ 离线仿真与浏览器录制逐位一致（属性牌暂停时长不计入对局时长，改 `--cardhold` 不会改局面）。
> `record.cjs` 结束时把实录的分数 / 关卡 / 消行数与 `seeds.json` 比对，输出 `narrationOk` / `levelMatch` / `linesMatch` / `featuresOk`；
> 出现 false 说明规则或 bot 权重改过，需要重跑第 1、2 步再录，否则结尾配音的战绩数字会对不上画面。

## 在抖音开发者工具中运行

1. 下载安装 [抖音开发者工具](https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/develop/developer-instrument/developer-instrument-update-and-download)
2. 打开工具 → 导入项目 → 选择本仓库目录
3. AppID：本项目已填入 AppID `ttb7bec10329c6ac6c02`（`project.config.json` 的 `appid` 字段），导入后工具会自动识别；如需更换，请在[抖音开放平台](https://developer.open-douyin.com/)获取新 AppID（形如 `tt` 开头）并替换该字段
4. 编译后即可在模拟器中游玩；真机预览用工具右上角「预览」扫码

> 注意：好友排行榜依赖开放数据域与云端托管数据，模拟器中可能不完整，请以真机为准。所有 `tt.*` 调用均有守卫，API 缺失时自动降级为本机排行，不会报错崩溃。

## 发布上线

完整流程见 [上线指南.md](./上线指南.md)。

## 调参

游戏数值集中在 `js/config.js`：

| 配置 | 默认值 | 说明 |
|---|---|---|
| `COLS`/`ROWS` | 20×20 | 棋盘尺寸 |
| `FALL_BASE` | 500ms | 第 1 关每格下落间隔 |
| `FALL_STEP` | 40ms | 每关加快量 |
| `FALL_MIN` | 80ms | 最快速度下限 |
| `HINT_BASE` | 1000ms | 第 1 关下落前提示时长 |
| `LEVEL_TARGETS` | [500, 1500, 3000, 5000, …, 27500] | 前 10 关的合格分（累计分数目标），**每关多少分合格直接改这里** |
| `LEVEL_TARGET_STEP` | 500 | 第 10 关之后按公式外推：第 n 关需再净得 `STEP × n` 分 |
| `SCORE_TABLE` | [0,100,250,500,800] | 同时消 1~4 行的基础分（×关卡数） |
| `BOARD_SCALE` | 1.0 | 棋盘（方块）整体缩放：调小方块更小，1 为铺满可用宽度 |

沉降规则与技能/构筑集中在同文件的 `SETTLE` / `SKILL` / `CARD`：

| 配置 | 默认值 | 说明 |
|---|---|---|
| `SETTLE.ROW_SIDE` | `'above'` | 消行时随之下沉的一侧：`above`＝消除线上方（默认，符合「往下沉」直觉）；`below`＝下方；`both`＝两侧都朝消除线贴合 |
| `SETTLE.COL_SIDE` | `'left'` | 消列时横向滑动的一侧：`left`／`right`／`both` |
| `SKILL.START_LEVEL` | 2 | 从第几关开始出现技能方块 |
| `SKILL.CHANCE` / `CHANCE_STEP` / `CHANCE_MAX` | 0.30 / 0.10 / 0.85 | 技能格出现概率（每拿一张「灵能灌注」+STEP，封顶 MAX） |
| `SKILL.WEIGHT` | turret 0.55 / resonance 0.45 | 两类技能格的出现权重 |
| `SKILL.BASE_CELL_SCORE` / `CELL_SCORE_STEP` | 20 / 5 | 技能消失每格基础分（×关卡数），「高能弹药」每层 +STEP |
| `SKILL.BULLET_FRAME` | 70ms | 子弹每走一格的动画时长（渲染与等待用） |
| `SKILL.CASCADE_LIMIT` | 160 | 共鸣级联最多引爆的共鸣格数（防同色大范围互相引爆死循环） |
| `SKILL.ACCENT` | 金 / 青 | 炮台、共鸣的徽章主色 |
| `CARD.INTERVAL` | 1000 | **每多少分弹一次属性牌三选一**（改这里即可调整节奏） |
| `CARD.CHOICES` | 3 | 每次发几张牌 |
| 牌池 | `js/skills.js` 的 `CARD_POOL` | 每张牌的名字/说明/上限/作用，加新牌就在这里加一条 |

平台能力配置集中在 `PLATFORM`（同文件）：

| 配置 | 默认值 | 说明 |
|---|---|---|
| `REWARDED_AD_UNIT_ID` | 文档示例占位 | **TODO**：替换为后台创建的激励视频广告位 ID |
| `INTERSTITIAL_AD_UNIT_ID` | 文档示例占位 | **TODO**：替换为后台创建的插屏广告位 ID |
| `SUBSCRIBE_TMPL_IDS` | 占位 | **TODO**：替换为后台「功能→订阅消息」创建的模板 ID |
| `ENABLE_IAP` | `false` | 内购入口开关；拿到版号并配置道具后改 `true` |
| `IAP` | coins_100 | 内购道具（productId / 价格 / 金币数） |
| `WELCOME_COINS` | 30 | 新手赠币 |
| `REVIVE_COIN_COST` | 30 | 金币复活消耗 |
| `AD_REWARD_COINS` | 50 | 看一次激励视频奖励 |
| `SIDEBAR_REWARD_COINS` | 60 | 每日侧边栏复访奖励 |

## 版本记录

### v1.3.1 — 技能手感与特效（本轮）

| 变更 | 代码位置 |
|---|---|
| **子弹不再打到自己人**：炮台格锁定时记下本块的全部格（`skill.own`），弹道经过这些格既不命中也不消耗穿透，直接穿过去打后面的方格 | `js/skills.js`（`ownSet`/`normIgnore`/`travelBullet`/`fireTurret`）、`js/gamecore.js`（`_lock`/`_fireTurret`） |
| **命中特效加强**：白热核心闪光 + 双层冲击波 + 8 道放射火花 + 四角碎块外飞，弹道命中点加粗十字/斜向火花，子弹尾迹 260→380ms；命中按击落格数触发棋盘**震屏**（0.26~0.3s 衰减）+ 震动反馈 | `js/render.js`（`drawImpactFx`/`drawTurretFx`/`bulletDuration`）、`js/main.js`（`_shake`/`updateFx`/`processEvents`） |
| **被技能消除的方格各自放出自己的技能**：共鸣波及到炮台格 → 就地补射一发；被能量弹击落的共鸣格 → 继续引爆；每一「步」独立成为事件、独立计分、独立出特效（`knock` 标记补射，漂浮字写「补射」） | `js/skills.js`（`cascadeSkills`）、`js/gamecore.js`（`_pushSkillStep`/`_resonance`/`_fireTurret`） |
| 录制可**跳过前面几关**：`node web-preview/record.cjs --seed 35 --startlevel 3`；测试 55/55，冒烟新增「穿过己方格 / 爆点 / 震屏 / 补射」断言 | `web-preview/record.cjs`、`web-preview/recorder.js`、`web-preview/smoke.cjs`、`test/core.test.cjs` |

> 兼容：旧接口 `Skills.cascadeResonance(board, seeds, limit)` 仍在（只做共鸣引爆、不触发炮台补射），供仿真与外部脚本调用。

### v1.3.0 — 玩法升级

- 半侧沉降（`SETTLE`）、过关清场且积分累加、炮台/共鸣技能格（`SKILL`）、属性牌三选一构筑（`CARD` + `CARD_POOL`）

## 技术说明

- 无第三方依赖，原生 Canvas 2D 渲染，CommonJS 模块
- 抖音小游戏 API（`tt.*`）与微信小游戏（`wx.*`）高度同源；本项目按该 API 面实现并全部做了特性守卫，若个别 API 在真机不可用会自动降级
- 竖屏（portrait），自适应屏幕尺寸与 DPR（上限 3x）
- 切后台自动暂停（`tt.onHide`）
