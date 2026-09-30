<#
  软著申请材料生成器：源程序代码 PDF + 操作说明书 PDF
  用法：pwsh -File 软著材料/generate.ps1 [-SoftwareName 引力方块游戏软件] [-Version V1.0]
  依赖：Microsoft Edge（headless 打印 PDF）。运行环境无独立 Node 时也能工作。
  产物：软著材料/源程序代码.html|.pdf、软著材料/操作说明书.html|.pdf、软著材料/img/*.png
#>
param(
  [string]$SoftwareName = '引力方块游戏软件',
  [string]$Version = 'V1.0',
  [string]$EdgePath = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$mat  = $PSScriptRoot
$img  = Join-Path $mat 'img'
New-Item -ItemType Directory -Force -Path $img | Out-Null
Copy-Item (Join-Path $repo 'web-preview\shots\*.png') $img -Force

$fullName = $SoftwareName + $Version   # 页眉用的“软件名称+版本号”

function HtmlEnc([string]$s) { [System.Net.WebUtility]::HtmlEncode($s) }

# ============================================================
# 一、源程序代码（全部代码，每页 50 行，页眉含软件名称+版本号+页码）
# ============================================================
$codeFiles = @(
  'game.js',
  'js/config.js', 'js/tetromino.js', 'js/board.js', 'js/gamecore.js',
  'js/render.js', 'js/input.js', 'js/platform.js', 'js/rank.js', 'js/main.js',
  'openDataContext/index.js'
)
$lines = New-Object System.Collections.Generic.List[string]
foreach ($f in $codeFiles) {
  $lines.Add(('/* ======== 文件: {0} ======== */' -f $f))
  $content = Get-Content (Join-Path $repo ($f -replace '/', '\')) -Encoding UTF8
  foreach ($l in $content) { $lines.Add((($l -replace "`t", '    ')).TrimEnd()) }
}
while ($lines.Count -gt 0 -and $lines[$lines.Count - 1] -eq '') { $lines.RemoveAt($lines.Count - 1) }

$perPage = 50
$codePageCount = [Math]::Ceiling($lines.Count / $perPage)

$cssCode = @'
@page { size: A4; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; color: #000; }
body { font-family: "Microsoft YaHei", "SimSun", sans-serif; }
.page { width: 21cm; height: 29.6cm; padding: 11mm 12mm; page-break-after: always; overflow: hidden; }
.page:last-child { page-break-after: auto; }
.hdr { display: flex; justify-content: space-between; font-size: 9pt; border-bottom: 1.2pt solid #000; padding-bottom: 1.5mm; margin-bottom: 2.5mm; }
pre.code { font-family: Consolas, "Courier New", "Microsoft YaHei", monospace; font-size: 7.2pt; line-height: 10.8pt; margin: 0; white-space: pre; overflow: hidden; }
'@

$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">')
[void]$sb.AppendLine("<title>$fullName 源程序代码</title><style>$cssCode</style></head><body>")
for ($p = 0; $p -lt $codePageCount; $p++) {
  $chunk = $lines | Select-Object -Skip ($p * $perPage) -First $perPage
  $body = ($chunk | ForEach-Object { HtmlEnc $_ }) -join "`n"
  [void]$sb.AppendLine('<div class="page">')
  [void]$sb.AppendLine("<div class=""hdr""><span>$(HtmlEnc $fullName) 源程序</span><span>第 $($p+1) 页 / 共 $codePageCount 页</span></div>")
  [void]$sb.AppendLine("<pre class=""code"">$body</pre>")
  [void]$sb.AppendLine('</div>')
}
[void]$sb.AppendLine('</body></html>')
$codeHtml = Join-Path $mat '源程序代码.html'
[System.IO.File]::WriteAllText($codeHtml, $sb.ToString(), (New-Object System.Text.UTF8Encoding($true)))
"源程序：$($lines.Count) 行 → $codePageCount 页（每页 $perPage 行）"

# ============================================================
# 二、操作说明书（含界面截图）
# ============================================================
$cssDoc = @'
@page { size: A4; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; color: #000; }
body { font-family: "Microsoft YaHei", "SimSun", sans-serif; font-size: 10.5pt; line-height: 1.75; }
.page { width: 21cm; height: 29.6cm; padding: 14mm 16mm; page-break-after: always; overflow: hidden; }
.page:last-child { page-break-after: auto; }
.hdr { display: flex; justify-content: space-between; font-size: 9pt; border-bottom: 1.2pt solid #000; padding-bottom: 1.5mm; margin-bottom: 4mm; }
h1 { font-size: 17pt; text-align: center; margin: 6mm 0 4mm; }
h2 { font-size: 13pt; margin: 5mm 0 2mm; border-left: 4pt solid #000; padding-left: 3mm; }
p { margin: 2mm 0; text-align: justify; }
table { border-collapse: collapse; width: 100%; margin: 2mm 0; font-size: 10pt; }
td, th { border: 0.6pt solid #444; padding: 1.5mm 2.5mm; text-align: left; vertical-align: top; }
th { background: #eee; }
figure { margin: 3mm 0; text-align: center; page-break-inside: avoid; }
figure img { width: 150px; border: 0.6pt solid #999; }
figcaption { font-size: 9pt; color: #333; margin-top: 1mm; }
.figrow { display: flex; justify-content: center; gap: 10mm; }
.center { text-align: center; }
.small { font-size: 9.5pt; }
'@

function Img([string]$file, [string]$cap) {
  "<figure><img src=""img/$file"" alt=""""><figcaption>$(HtmlEnc $cap)</figcaption></figure>"
}

$pages = New-Object System.Collections.Generic.List[string]

# ---- P1 软件基本信息 ----
$pages.Add(@"
<h1>$(HtmlEnc $SoftwareName)<br>操作说明书</h1>
<p class="center small">版本号：$(HtmlEnc $Version)</p>
<h2>软件基本信息</h2>
<table>
<tr><th style="width:32%">软件全称</th><td>$(HtmlEnc $SoftwareName)</td></tr>
<tr><th>软件简称</th><td>引力方块</td></tr>
<tr><th>版本号</th><td>$(HtmlEnc $Version)</td></tr>
<tr><th>著作权人</th><td>＿＿＿＿＿＿＿＿（以申请表填写为准）</td></tr>
<tr><th>开发方式</th><td>独立开发</td></tr>
<tr><th>开发完成日期</th><td>2026 年 9 月（以申请表填写为准）</td></tr>
<tr><th>编程语言</th><td>JavaScript</td></tr>
<tr><th>源程序量</th><td>约 2500 行</td></tr>
<tr><th>软件分类</th><td>应用软件 · 休闲益智类方块消除小游戏</td></tr>
<tr><th>运行环境</th><td>Android / iOS 智能手机上的抖音 App 及其小游戏运行环境</td></tr>
<tr><th>开发环境</th><td>Windows 10/11，抖音开发者工具，Node.js 18+</td></tr>
</table>
"@)

# ---- P2 软件概述 ----
$pages.Add(@"
<h2>一、软件概述</h2>
<p>《引力方块》是一款休闲益智类方块消除小游戏软件，无剧情与角色设定，场景为一个 20×20 的方格棋盘。方块从棋盘中心生成，下落方向在上、下、左、右四个方向中随机产生；正式下落前以箭头提示方块类型与方向，重力一侧的棋盘边缘高亮显示。玩家点击屏幕按钮或使用点按、滑动手势，控制方块移动、旋转和快速落底；填满任意整行或整列即消除得分，消除后剩余方块整体下沉，可触发连锁消除。每消除 8 行升 1 关，下落速度逐关加快，棋盘中心被堵满则本局结束并进入结算。</p>
<p>软件包含分数结算、本机排行榜与好友排行榜、金币奖励、复活续玩、订阅提醒、添加到桌面等功能。玩家进入游戏后点击开始按钮即可游玩。</p>
<p>软件采用 JavaScript 语言开发，基于 Canvas 2D 自绘渲染，不依赖第三方图形库；纯逻辑层（方块定义与旋转、棋盘碰撞与消除判定、游戏状态机）与渲染层、输入层分离，可在服务端环境独立进行单元测试（28 个用例）与集成冒烟测试；对运行平台的全部接口调用均做特性守卫与自动降级处理，保证在不同版本运行环境中的兼容性与稳定性。</p>
"@)

# ---- P3 启动与主菜单 ----
$pages.Add(@"
<h2>二、软件启动与主菜单</h2>
<p>本软件为小游戏，无需安装。用户打开抖音 App，搜索“引力方块”并点击进入，即可启动软件；也可通过扫描小游戏二维码、好友分享卡片、添加到桌面后的图标等方式启动。</p>
<p>启动后进入主菜单，界面元素如下：</p>
<table>
<tr><th style="width:36%">元素</th><th>功能说明</th></tr>
<tr><td>标题“引力方块”与副标题</td><td>软件名称与玩法概述（四向重力 · 方块消除玩法）</td></tr>
<tr><td>最高分 / 金币</td><td>展示本机历史最高分与当前金币余额</td></tr>
<tr><td>开始游戏</td><td>进入对局</td></tr>
<tr><td>排行榜</td><td>查看本机排行与好友排行</td></tr>
<tr><td>玩法说明</td><td>查看操作与规则说明页</td></tr>
<tr><td>侧边栏奖励</td><td>侧边栏复访任务入口，每日复访可领取金币（可领取时高亮）</td></tr>
<tr><td>添加到桌面 / 订阅提醒 / 免费金币</td><td>桌面快捷方式、订阅消息提醒、观看激励视频得金币</td></tr>
</table>
$(Img '1-menu.png' '图 1 主菜单')
"@)

# ---- P4 对局界面与提示 ----
$pages.Add(@"
<h2>三、对局界面与下落前提示</h2>
<p>点击“开始游戏”进入对局界面。顶部信息栏显示分数、关卡、行数与金币；棋盘上方另有“下一个”面板，提前展示下一方块的类型与下落方向。</p>
<p>每个方块从棋盘正中心生成，其下落方向（重力方向）在上下左右四个方向中随机产生，重力一侧的棋盘边缘高亮显示。方块正式下落前会短暂停留并闪烁，同时以大号箭头预告方块类型与下落方向，给玩家预留判断时间；提示时长随关卡提升而缩短。</p>
$(Img '2-hint.png' '图 2 下落前提示：大号箭头预告方块类型与重力方向')
"@)

# ---- P5 操作方式 ----
$pages.Add(@"
<h2>四、操作方式</h2>
<p>对局中可通过屏幕按钮与手势两种方式操作方块：</p>
<table>
<tr><th style="width:36%">按钮</th><th>功能</th></tr>
<tr><td>◀ / ▶</td><td>沿垂直于重力的方向移动方块</td></tr>
<tr><td>旋转</td><td>顺时针旋转方块（含踢墙修正）</td></tr>
<tr><td>落下</td><td>方块沿重力方向直达底部并锁定</td></tr>
<tr><td>暂停</td><td>暂停对局，弹出“继续游戏 / 重新开始 / 返回主页”面板；切换至后台时也会自动暂停</td></tr>
</table>
<table>
<tr><th style="width:36%">手势</th><th>功能</th></tr>
<tr><td>点击棋盘</td><td>旋转方块</td></tr>
<tr><td>沿重力方向滑动</td><td>方块快速落底</td></tr>
<tr><td>垂直于重力方向滑动</td><td>方块横向移动</td></tr>
</table>
"@)

# ---- P6 下落与消除 ----
$pages.Add(@"
<h2>五、方块下落、消除与沉降</h2>
<p>方块锁定后，若填满任意整行或整列即触发消除并获得分数；同时消除的行/列数越多，得分越高（单次消除 1~4 行基础分 100/250/500/800，乘以当前关卡数）。</p>
<p>消除后场上剩余方块整体沿重力方向下沉落底，不悬空；下沉若凑齐新的整行/整列将触发连锁消除，一并计数计分。</p>
<div class="figrow">
$(Img '3-fall.png' '图 3 方块沿重力方向下落')
$(Img '4-clear.png' '图 4 填满整行触发消除')
</div>
"@)

# ---- P7 关卡系统 ----
$pages.Add(@"
<h2>六、关卡系统</h2>
<p>每累计消除 8 行升 1 关。随关卡提升，方块每格下落间隔由 500 毫秒逐关缩短 40 毫秒，最快至 80 毫秒；下落前提示时长同步缩短，难度渐进提升。升级时界面弹出“第 N 关 · 速度提升”提示。</p>
$(Img '5-levelup.png' '图 5 升级提示')
"@)

# ---- P8 结算与复活 ----
$pages.Add(@"
<h2>七、游戏结束、结算与复活</h2>
<p>当棋盘中心区域被堵满、新方块无法生成时，本局结束并进入结算页，展示本局分数、消除行数与关卡，并刷新本机最高分纪录。</p>
<p>结算页提供“复活继续”（每局限一次）：可观看激励视频广告复活，或消耗 30 金币复活，复活后保留当前分数继续对局；另有“再来一局”“排行榜”“分享给好友”“返回主页”等操作。</p>
$(Img '6-gameover.png' '图 6 结算页')
"@)

# ---- P9 排行榜 ----
$pages.Add(@"
<h2>八、排行榜系统</h2>
<p>排行榜页包含两部分：本机 TOP10 排行（本地持久化存储，始终可用）与好友排行榜（基于开放数据域与云端托管数据，登录抖音后展示好友间的分数排名，仅展示昵称与分数）。历史对局结束后若进入本机前十，将写入本机排行。</p>
$(Img '7-rank.png' '图 7 排行榜页')
"@)

# ---- P10 金币与奖励 ----
$pages.Add(@"
<h2>九、金币与奖励系统</h2>
<p>金币为软件内虚拟奖励，仅用于游戏内复活，不涉及真实货币兑换。获取与消耗途径如下：</p>
<table>
<tr><th style="width:50%">途径</th><th>金币变动</th></tr>
<tr><td>首次进入（新手赠币）</td><td>+30</td></tr>
<tr><td>观看一次激励视频</td><td>+50</td></tr>
<tr><td>每日侧边栏复访领奖</td><td>+60</td></tr>
<tr><td>结算页金币复活</td><td>-30</td></tr>
</table>
<p>侧边栏复访流程：主菜单点击“侧边栏奖励”→ 按引导将软件添加至抖音侧边栏 → 次日经侧边栏重新进入软件 → 领取当日金币奖励，每日限一次。</p>
"@)

# ---- P11 平台能力 ----
$pages.Add(@"
<h2>十、平台能力接入</h2>
<table>
<tr><th style="width:30%">能力</th><th>说明</th></tr>
<tr><td>侧边栏复访</td><td>支持跳转抖音侧边栏场景并识别启动来源，实现每日复访奖励；宿主不支持时入口自动隐藏</td></tr>
<tr><td>添加到桌面</td><td>一键将软件图标添加到手机桌面</td></tr>
<tr><td>订阅消息</td><td>用户可订阅提醒消息（授权弹窗由平台提供）</td></tr>
<tr><td>激励视频广告</td><td>观看广告获得金币或复活机会</td></tr>
<tr><td>插屏广告</td><td>结算页展示，90 秒节流，避免打扰</td></tr>
<tr><td>内购能力</td><td>接口已接入但默认关闭（开关 ENABLE_IAP=false），当前版本不产生任何真实支付行为</td></tr>
</table>
<p>以上能力均实现特性守卫：接口不可用时自动降级，不影响基础玩法。</p>
"@)

# ---- P12 模块组成与隐私 ----
$pages.Add(@"
<h2>十一、功能模块组成</h2>
<table>
<tr><th style="width:34%">模块（源文件）</th><th>职责</th></tr>
<tr><td>game.js</td><td>软件入口</td></tr>
<tr><td>js/config.js</td><td>常量配置（棋盘、速度、计分、配色、平台能力开关）</td></tr>
<tr><td>js/tetromino.js</td><td>7 种方块定义与旋转算法（纯逻辑）</td></tr>
<tr><td>js/board.js</td><td>棋盘网格：碰撞、锁定、行列消除与沉降（纯逻辑）</td></tr>
<tr><td>js/gamecore.js</td><td>核心状态机：提示→下落→锁定→升级（纯逻辑）</td></tr>
<tr><td>js/render.js</td><td>Canvas 2D 渲染与界面布局</td></tr>
<tr><td>js/input.js</td><td>触摸手势识别（点按 / 滑动）</td></tr>
<tr><td>js/platform.js</td><td>平台能力封装：侧边栏 / 桌面 / 订阅 / 广告 / 内购 / 金币</td></tr>
<tr><td>js/rank.js</td><td>排行榜：本地存储 + 云端托管 + 分享</td></tr>
<tr><td>js/main.js</td><td>主控制器：游戏循环与场景切换</td></tr>
<tr><td>openDataContext/index.js</td><td>开放数据域：好友排行榜渲染（独立上下文）</td></tr>
</table>
<h2>十二、数据与隐私说明</h2>
<p>本软件仅使用平台云端托管数据保存好友排行分数，不收集、不上传其他任何个人信息；本机最高分、金币与排行数据存储于用户设备本地。</p>
"@)

$sb2 = New-Object System.Text.StringBuilder
[void]$sb2.AppendLine('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">')
[void]$sb2.AppendLine("<title>$fullName 操作说明书</title><style>$cssDoc</style></head><body>")
$docPageCount = $pages.Count
for ($p = 0; $p -lt $docPageCount; $p++) {
  [void]$sb2.AppendLine('<div class="page">')
  [void]$sb2.AppendLine("<div class=""hdr""><span>$(HtmlEnc $fullName) 操作说明书</span><span>第 $($p+1) 页 / 共 $docPageCount 页</span></div>")
  [void]$sb2.AppendLine($pages[$p])
  [void]$sb2.AppendLine('</div>')
}
[void]$sb2.AppendLine('</body></html>')
$docHtml = Join-Path $mat '操作说明书.html'
[System.IO.File]::WriteAllText($docHtml, $sb2.ToString(), (New-Object System.Text.UTF8Encoding($true)))
"操作说明书：$docPageCount 页"

# ============================================================
# 三、HTML → PDF（Edge 无头打印，须用绝对路径）
# ============================================================
if (-not (Test-Path $EdgePath)) { throw "未找到 Edge：$EdgePath" }
function ConvertTo-Pdf([string]$html, [string]$pdf) {
  if (Test-Path $pdf) { Remove-Item $pdf -Force }
  $uri = ([System.Uri]$html).AbsoluteUri
  # 经 cmd 调用以吞掉 Edge 的无害 stderr（PS5.1 下 stderr 重定向会触发 NativeCommandError）
  cmd /c "`"$EdgePath`" --headless --disable-gpu --no-sandbox --no-pdf-header-footer --print-to-pdf-no-header --print-to-pdf=`"$pdf`" `"$uri`" 2>nul" | Out-Null
  for ($i = 0; $i -lt 30 -and -not (Test-Path $pdf); $i++) { Start-Sleep -Milliseconds 500 }
  if (-not (Test-Path $pdf)) { throw "PDF 生成失败：$pdf" }
  Start-Sleep -Milliseconds 500
  "{0} → {1} KB" -f (Split-Path $pdf -Leaf), [Math]::Round((Get-Item $pdf).Length / 1KB)
}
ConvertTo-Pdf $codeHtml (Join-Path $mat '源程序代码.pdf')
ConvertTo-Pdf $docHtml  (Join-Path $mat '操作说明书.pdf')
"完成。"
