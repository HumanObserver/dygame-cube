# Generate icons for the mini-game at multiple sizes (600 main upload / 512 / 144 backup).
# All drawing happens in a 512x512 design space, scaled natively via ScaleTransform
# (vector re-render per size, no bitmap upscaling blur).
# Design matches actual in-game visuals: dark-blue gradient bg (#0f1220 -> #1c2140),
# faint board grid, centered T-tetromino using real piece colors,
# four direction arrows = random gravity; large accent arrow (#ff4d6d) = current gravity (down).
# Compliance: full-bleed square (no rounded canvas), no text/badge/watermark/QR/contact info.
# ASCII-only source to avoid PS 5.1 GBK mis-decoding of UTF-8 without BOM.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

function Mix($a, $b, [double]$t) {
  [System.Drawing.Color]::FromArgb(255,
    [int][Math]::Round($a.R + ($b.R - $a.R) * $t),
    [int][Math]::Round($a.G + ($b.G - $a.G) * $t),
    [int][Math]::Round($a.B + ($b.B - $a.B) * $t))
}

function RoundedRect([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

function Draw-Cell($g, [float]$x, [float]$y, [float]$size, [float]$r, $color) {
  $shadow = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(90, 0, 0, 0))
  $g.FillPath($shadow, (RoundedRect ($x + 5) ($y + 8) $size $size $r))

  $cellRect = [System.Drawing.RectangleF]::new($x, $y, $size, $size)
  $lg = [System.Drawing.Drawing2D.LinearGradientBrush]::new($cellRect, $color, $color, 90.0)
  $blend = New-Object System.Drawing.Drawing2D.ColorBlend
  $blend.Colors = [System.Drawing.Color[]]@(
    (Mix $color ([System.Drawing.Color]::White) 0.42),
    $color,
    (Mix $color ([System.Drawing.Color]::Black) 0.22))
  $blend.Positions = [single[]]@(0.0, 0.5, 1.0)
  $lg.InterpolationColors = $blend
  $path = RoundedRect $x $y $size $size $r
  $g.FillPath($lg, $path)

  $pen = [System.Drawing.Pen]::new((Mix $color ([System.Drawing.Color]::Black) 0.45), 2.0)
  $g.DrawPath($pen, $path)

  $gloss = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(46, 255, 255, 255))
  $g.FillPath($gloss, (RoundedRect ($x + 8) ($y + 7) ($size - 16) ($size * 0.38) ($r * 0.7)))
}

function Pt([float]$x, [float]$y) { [System.Drawing.PointF]::new($x, $y) }

function Draw-Arrow($g, $pts, $color, [int]$shadowAlpha) {
  if ($shadowAlpha -gt 0) {
    $sh = [System.Drawing.PointF[]]@($pts | ForEach-Object { [System.Drawing.PointF]::new($_.X + 3, $_.Y + 6) })
    $sb = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb($shadowAlpha, 0, 0, 0))
    $sp = New-Object System.Drawing.Drawing2D.GraphicsPath
    $sp.AddPolygon($sh)
    $g.FillPath($sb, $sp)
  }
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $p.AddPolygon([System.Drawing.PointF[]]$pts)
  $b = [System.Drawing.SolidBrush]::new($color)
  $g.FillPath($b, $p)
}

function Render-Icon([int]$S, [string]$outPath) {
  $k = $S / 512.0
  $bmp = New-Object System.Drawing.Bitmap($S, $S)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $g.ScaleTransform([float]$k, [float]$k)   # draw in 512 design space

  # background gradient (game BG_TOP -> BG_BOTTOM)
  $bgTop = [System.Drawing.Color]::FromArgb(255, 15, 18, 32)     # #0f1220
  $bgBot = [System.Drawing.Color]::FromArgb(255, 28, 33, 64)     # #1c2140
  $bgRect = [System.Drawing.RectangleF]::new(0, 0, 512, 512)
  $bgBrush = [System.Drawing.Drawing2D.LinearGradientBrush]::new($bgRect, $bgTop, $bgBot, 90.0)
  $g.FillRectangle($bgBrush, 0, 0, 512, 512)

  # faint board grid
  $gridPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(13, 255, 255, 255), 1.0)
  for ($i = 64; $i -lt 512; $i += 64) {
    $g.DrawLine($gridPen, $i, 0, $i, 512)
    $g.DrawLine($gridPen, 0, $i, 512, $i)
  }

  # soft cyan halo behind the piece
  $glowPath = New-Object System.Drawing.Drawing2D.GraphicsPath
  $glowPath.AddEllipse([System.Drawing.RectangleF]::new(86, 86, 340, 340))
  $pgb = [System.Drawing.Drawing2D.PathGradientBrush]::new($glowPath)
  $pgb.CenterColor = [System.Drawing.Color]::FromArgb(40, 0, 229, 255)
  $pgb.SurroundColors = [System.Drawing.Color[]]@([System.Drawing.Color]::FromArgb(0, 0, 229, 255))
  $pgb.CenterPoint = [System.Drawing.PointF]::new(256, 256)
  $g.FillPath($pgb, $glowPath)

  # block cells (real game COLORS)
  $cyan   = [System.Drawing.Color]::FromArgb(255, 0, 229, 255)    # I #00e5ff
  $yellow = [System.Drawing.Color]::FromArgb(255, 255, 213, 0)    # O #ffd500
  $purple = [System.Drawing.Color]::FromArgb(255, 179, 136, 255)  # T #b388ff
  $green  = [System.Drawing.Color]::FromArgb(255, 105, 240, 174)  # S #69f0ae
  $accent = [System.Drawing.Color]::FromArgb(255, 255, 77, 109)   # ACCENT #ff4d6d

  Draw-Cell $g 215 171 82 14 $cyan     # T top cell
  Draw-Cell $g 127 259 82 14 $yellow   # row2 left
  Draw-Cell $g 215 259 82 14 $purple   # row2 center
  Draw-Cell $g 303 259 82 14 $green    # row2 right

  # gravity arrows
  $small = [System.Drawing.Color]::FromArgb(165, 236, 240, 255)   # translucent white
  Draw-Arrow $g @( (Pt 256 95), (Pt 222 141), (Pt 290 141) ) $small 0    # up
  Draw-Arrow $g @( (Pt 51 256), (Pt 97 222), (Pt 97 290) ) $small 0      # left
  Draw-Arrow $g @( (Pt 461 256), (Pt 415 222), (Pt 415 290) ) $small 0   # right
  Draw-Arrow $g @( (Pt 256 455), (Pt 204 371), (Pt 308 371) ) $accent 70 # down (current gravity)

  $g.Dispose()
  $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}

# ---------- render all sizes ----------
$out600 = Join-Path $PSScriptRoot 'icon-600.png'
$out512 = Join-Path $PSScriptRoot 'icon-512.png'
$out144 = Join-Path $PSScriptRoot 'icon-144.png'
Render-Icon 600 $out600
Render-Icon 512 $out512
Render-Icon 144 $out144

# ---------- pixel verification on the 600x600 main upload ----------
$check = New-Object System.Drawing.Bitmap($out600)
$points = [ordered]@{
  'corner(2,2)~bg'           = @(2, 2)
  'topcell(300,246)~cyan'    = @(300, 246)
  'midcell(300,352)~purple'  = @(300, 352)
  'leftcell(197,352)~yellow' = @(197, 352)
  'rightcell(403,352)~green' = @(403, 352)
  'bigarrow(300,492)~pink'   = @(300, 492)
  'smallL(88,300)~white'     = @(88, 300)
  'smallR(512,300)~white'    = @(512, 300)
  'smallU(300,141)~white'    = @(300, 141)
  'gap(300,300)~dark'        = @(300, 300)
}
foreach ($k2 in $points.Keys) {
  $c = $check.GetPixel($points[$k2][0], $points[$k2][1])
  '{0,-28} RGB({1},{2},{3})' -f $k2, $c.R, $c.G, $c.B
}
$check.Dispose()

foreach ($f in @($out600, $out512, $out144)) {
  $b = New-Object System.Drawing.Bitmap([string]$f)
  '{0}: {1}x{2}, {3} bytes' -f (Split-Path $f -Leaf), $b.Width, $b.Height, (Get-Item $f).Length
  $b.Dispose()
}
