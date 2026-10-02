/* 精确探针：第 N 关第一块落下后，逐行列出「消行前 / 消行后」的填充列，判断有没有「又长回来」 */
const GameCore = require('../js/gamecore.js');
const { COLS, ROWS } = require('../js/config.js');

function mulberry32(a) {
  let t = a >>> 0;
  return function () {
    t += 0x6D2B79F5; let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function rows(core) {
  const out = [];
  for (let r = 0; r < ROWS; r++) {
    const cols = [];
    for (let c = 0; c < COLS; c++) if (core.board.grid[r][c]) cols.push(c);
    out.push(cols);
  }
  return out;
}

const lv = Number(process.argv[2] || 2);
const core = new GameCore({ rng: mulberry32(7) });
core.startLevel(lv);
const pre = rows(core);
console.log('第 ' + lv + ' 关  发的块=' + core.current.type + '  出生 y=' + core.current.y + ' x=' + core.current.x);
core.phase = 'fall';
core.hardDrop();
const post = rows(core);
const evs = core.drainEvents();
for (const e of evs) {
  const brief = {};
  for (const k of Object.keys(e)) brief[k] = Array.isArray(e[k]) ? (e[k].length > 6 ? '[' + e[k].length + ']' : e[k]) : e[k];
  console.log('事件 ' + JSON.stringify(brief));
}
console.log('消行数=' + core.lines + '  总格数 ' + pre.reduce((a, b) => a + b.length, 0) + ' → ' + post.reduce((a, b) => a + b.length, 0));
for (let r = ROWS - 5; r < ROWS; r++) {
  console.log('row' + r + '  前(' + pre[r].length + ') ' + pre[r].join(',') + '   |   后(' + post[r].length + ') ' + post[r].join(','));
}
const full = [];
for (let r = 0; r < ROWS; r++) if (post[r].length === COLS) full.push(r);
console.log('落下后仍然满的行：' + (full.length ? full.join(',') : '无') + '（满行＝还会再消一次）');
