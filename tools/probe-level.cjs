/* 单独跑某一关：机器人（消行优先）打到 Game Over / 过关时的棋盘与门槛进度
 * 运行：node tools/probe-level.cjs <关卡> [种子]
 * 用途：教学关卡住时（落块很多却不升关），直接看这一关的门槛差什么、棋盘是不是被炸成两条永远填不满的竖井
 */
const GameCore = require('../js/gamecore.js');
const AutoPlayer = require('../web-preview/autoplayer.js');
const { COLS, ROWS } = require('../js/config.js');

function mulberry32(a) {
  let t = a >>> 0;
  return function () {
    t += 0x6D2B79F5; let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const LV = Number(process.argv[2] || 3);
const SEED = Number(process.argv[3] || 11);
const core = new GameCore({ rng: mulberry32(SEED) });
core.startLevel(LV);
let n = 0;
while (n < 70 && !core.gameOver) {
  if (core.pendingCards) { core.pickCard(core.pendingCards[0].id); continue; }
  if (core.pendingLevelUp) { console.log('过关了 @' + n + ' 块'); break; }
  const plan = AutoPlayer.planPlacement(core.board, core.current, core.next ? core.next.type : null, 'score');
  if (plan) {
    for (let i = 0; i < plan.rotates; i++) core.rotate();
    for (let i = 0; i < plan.moves; i++) core.movePerp(plan.sign);
    if (n < 2 || n % 8 === 0) console.log('第' + n + ' 块 ' + core.current.type + (core.current.skill ? '(' + core.current.skill.kind + ')' : '') + ' 计划 clears=' + plan.clears + ' kills=' + plan.kills);
  }
  core.hardDrop();
  n++;
}
console.log('关卡=' + LV + ' 种子=' + SEED + ' 块数=' + n + ' gameOver=' + core.gameOver + ' score=' + core.score + ' 门槛=' + JSON.stringify(core.gateStatus()));
console.log('levelStats=' + JSON.stringify(core.levelStats));
for (let r = 0; r < ROWS; r++) {
  let s = '';
  let k = '';
  for (let x = 0; x < COLS; x++) {
    s += core.board.grid[r][x] ? '#' : '.';
    k += core.board.skillAt(x, r) ? 'S' : '.';
  }
  console.log(String(r).padStart(2) + ' ' + s + '  ' + k);
}
