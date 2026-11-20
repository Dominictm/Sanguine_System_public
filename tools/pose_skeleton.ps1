# Рисует скелет-позу (OpenPose-стиль) для ControlNet: стоящая фигура в полный рост.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File tools/pose_skeleton.ps1 `
#   -Preset standing -Width 1023 -Height 1537 -Out D:\ComfyUI\input\pose_standing.png
param(
  [string]$Preset = 'standing',
  [int]$Width = 1023,
  [int]$Height = 1537,
  [string]$Out = 'pose_standing.png'
)

Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap $Width, $Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::Black)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality

$cx = $Width / 2
$s = $Height / 1537  # масштаб от базового холста
$bone = New-Object System.Drawing.Pen ([System.Drawing.Color]::White, [int](14 * $s))
$joint = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::Red)
$jr = [int](16 * $s)

function Pt($x, $y) { return New-Object System.Drawing.PointF ([float]($x * $s), [float]($y * $s)) }
function Seg($x1, $y1, $x2, $y2) {
  $a = Pt $x1 $y1
  $b = Pt $x2 $y2
  $g.DrawLine($bone, $a, $b)
}
function Dot($x, $y) {
  $p = Pt $x $y
  $g.FillEllipse($joint, $p.X - $jr, $p.Y - $jr, $jr * 2, $jr * 2)
}

if ($Preset -eq 'standing') {
  # Голова: кольцо (OpenPose: круг без заливки)
  $hp = Pt -x 511 -y 175
  $hr = 62 * $s
  $g.DrawEllipse($bone, $hp.X - $hr, $hp.Y - $hr, $hr * 2, $hr * 2)
  # Шея, торс
  Seg 511 237 511 300; Seg 511 300 511 760
  # Руки: плечо -> локоть -> кисть (слегка согнуты)
  Seg 511 340 400 520; Seg 400 520 360 700
  Seg 511 340 622 520; Seg 622 520 662 700
  # Ноги: бедро -> колено -> стопа
  Seg 511 760 470 1090; Seg 470 1090 452 1410
  Seg 511 760 552 1090; Seg 552 1090 570 1410
  # Суставы
  Dot 511 300; Dot 400 520; Dot 360 700; Dot 622 520; Dot 662 700
  Dot 511 760; Dot 470 1090; Dot 452 1410; Dot 552 1090; Dot 570 1410
} else {
  throw "Unknown preset: $Preset"
}

$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Output "saved: $Out"
