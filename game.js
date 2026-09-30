/**
 * 抖音小游戏入口文件
 * game.json 中约定入口为 game.js
 */
// ⚠️ 侧边栏复访官方指南要求：必须在 game.js 运行时机「同步」注册 tt.onShow 监听，
// 注册过晚会收不到从侧边栏复访进入的启动回调，导致用户无法领取奖励。
const platform = require('./js/platform.js');
platform.init();

const Main = require('./js/main.js');

const main = new Main();

// 浏览器预览/演示环境暴露实例（抖音环境无 window，自动跳过）
if (typeof window !== 'undefined') window.__game = main;
