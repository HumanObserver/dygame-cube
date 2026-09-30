/**
 * 将 CommonJS 游戏模块打包为浏览器单文件 bundle（零第三方依赖）
 * 用法: node web-preview/build.cjs  →  生成 web-preview/bundle.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, 'bundle.js');

const FILES = [
  'js/config.js',
  'js/tetromino.js',
  'js/board.js',
  'js/skills.js',
  'js/gamecore.js',
  'js/render.js',
  'js/input.js',
  'js/platform.js',
  'js/rank.js',
  'js/main.js',
  'game.js',
];

function build() {
  const parts = [];
  parts.push('/* 自动生成，请勿手改；构建：node web-preview/build.cjs */');
  parts.push('(function(){');
  parts.push('var defs={},cache={};');
  parts.push('function register(id,fn){defs[id]=fn;}');
  parts.push('function resolve(fromId,toId){');
  parts.push('  var p=fromId.split("/");p.pop();');
  parts.push('  toId.split("/").forEach(function(s){');
  parts.push('    if(s==="."||s==="")return;');
  parts.push('    if(s==="..")p.pop();else p.push(s);');
  parts.push('  });');
  parts.push('  return p.join("/");');
  parts.push('}');
  parts.push('function req(id,fromId){');
  parts.push('  var full=fromId?resolve(fromId,id):id;');
  parts.push('  if(cache[full])return cache[full].exports;');
  parts.push('  var fn=defs[full];');
  parts.push('  if(!fn)throw new Error("[bundle] module not found: "+full);');
  parts.push('  var mod={exports:{}};cache[full]=mod;');
  parts.push('  fn(mod,mod.exports,function(p){return req(p,full);});');
  parts.push('  return mod.exports;');
  parts.push('}');
  for (const f of FILES) {
    const code = fs.readFileSync(path.join(ROOT, f), 'utf8');
    parts.push('register(' + JSON.stringify(f) + ',function(module,exports,require){');
    parts.push(code);
    parts.push('});');
  }
  /* 暴露模块取用口：autoplayer 等录制/仿真脚本用它拿到「与游戏同一份实例」的
   * Board / Skills / config，从而让 bot 的前瞻模拟与真实规则零漂移。 */
  parts.push('if(typeof window!=="undefined"){window.__bundleRequire=function(id){return req(id,null);};}');
  parts.push('req("game.js");');
  parts.push('})();');
  fs.writeFileSync(OUT, parts.join('\n'), 'utf8');
  return OUT;
}

if (require.main === module) {
  console.log('bundle written:', build());
}

module.exports = build;
