/**
 * 教学关（第 1~6 关）节奏自检脚本（开发用，非单测）
 * 运行：node tools/check-tutorial.cjs <种子> [最大落块数]
 *
 * 落点选择直接借用演示机器人那份真实规划器（web-preview/autoplayer.js 的 planPlacement：
 * 完整复刻「锁定→技能→消除→共鸣→半侧沉降→连锁」的结算再打分），所以这里量到的
 * 「几块过关 / 净增分 / 会不会卡住」接近真人水平，而不是无脑往中间堆的假数据。
 */
const GameCore = require('../js/gamecore.js');
const LevelPlan = require('../js/levelplan.js');
const AutoPlayer = require('../web-preview/autoplayer.js');
const { LEVEL_TARGETS, CARD, DIRS, PERP } = require('../js/config.js');

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function run(seedStr, maxLocks) {
  let s = 0;
  for (let i = 0; i < seedStr.length; i++) s = (s * 31 + seedStr.charCodeAt(i)) | 0;
  const rng = mulberry32(s >>> 0);
  const core = new GameCore({ rng });
  const log = [];
  let locks = 0, guard = 0, lastLevel = 1, stuckAt = 0;
  while (locks < (maxLocks || 120) && guard++ < 20000) {
    if (core.gameOver) { log.push('GAME OVER @level' + core.level + ' score ' + core.score + ' after ' + locks + ' 块'); break; }
    if (core.pendingCards) {
      const c = core.pendingCards[0];
      const meta = core.pendingCardsMeta || {};
      log.push('  [属性牌] 第' + core.level + '关 分数' + core.score + (meta.tutorial ? ' 教学(' + meta.tag + (meta.force ? '·不可跳过' : '') + ')' : ' 通用') + ' → 选「' + c.name + '」');
      core.pickCard(c.id);
      continue;
    }
    if (core.pendingLevelUp) {
      const rep = core.pendingLevelUp;
      log.push('  [过关结算] 第' + rep.level + '关 ' + (rep.name || '') + ' · 净增' + rep.gained
        + ' / 合格' + rep.target + ' · 落块' + rep.locks + ' · 消行' + rep.lines
        + ' · 炮台' + rep.turret + ' · 共鸣' + rep.resonance + ' · 牌' + rep.cardPicks
        + ' · ' + Math.max(1, Math.round(rep.ms / 1000)) + 's → 进第' + rep.next + '关');
      core.confirmLevelUp();
      continue;
    }
    if (!core.canControl()) { core.update(1000); continue; }
    // 机器人：用演示机器人的规划器选落点（旋转 → 平移 → 硬降）
    // mode='score'：像认真消行的玩家那样下（教学条也是这么教的），比 'survive' 更贴近真人节奏
    const plan = AutoPlayer.planPlacement(core.board, core.current, core.next ? core.next.type : null, 'score');
    if (plan) {
      for (let i = 0; i < plan.rotates; i++) core.rotate();
      for (let i = 0; i < plan.moves; i++) core.movePerp(plan.sign);
    }
    const lv = core.level;
    const stBefore = JSON.stringify(core.levelStats);
    core.hardDrop();
    locks++;
    if (core.level !== lv) {
      log.push('第 ' + lv + ' 关合格（' + core.score + ' 分 / ' + locks + ' 块）门槛进度(进关时):' + stBefore);
      if (core.level !== lv + 1) log.push('  !! 一次跨了 ' + (core.level - lv) + ' 关');
    }
    if (core.level === lastLevel) { stuckAt++; } else { lastLevel = core.level; stuckAt = 0; }
    if (core.level > 6) { log.push('第 7 关起进入正式关：score ' + core.score + ' / ' + locks + ' 块'); break; }
  }
  const rows = [];
  for (let r = 0; r < 6; r++) {
    const lv = r + 1;
    const plan = LevelPlan.planFor(lv);
    const gs = LevelPlan.gateStatus(lv, { clears: 0, turretKills: 0, resonanceKills: 0, cardPicks: 0 });
    rows.push('第' + lv + '关 合格分' + LEVEL_TARGETS[r] + ' · 预置' + (plan.setup || '-') + ' · 技能'
      + (plan.skill ? plan.skill.kind + '×' + plan.skill.chance : '-')
      + ' · 门槛[' + gs.items.map((it) => it.label).join(' + ') + ']'
      + (plan.card ? ' · 牌@净' + plan.card.minNet : ''));
  }
  return rows.join('\n') + '\n' + log.join('\n') + '\n(stuck ' + stuckAt + ' 块未升关)';
}

console.log(run(process.argv[2] || 'seed-A'));
