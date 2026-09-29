/**
 * 抖音小游戏入口文件
 * game.json 中约定入口为 game.js
 */
const Main = require('./js/main.js');

const main = new Main();

// 浏览器预览/演示环境暴露实例（抖音环境无 window，自动跳过）
if (typeof window !== 'undefined') window.__game = main;
