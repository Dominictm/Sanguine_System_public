'use strict';
// Ресайз растровых картинок через PowerShell + System.Drawing.
//
// Единственный на проект: тем же приёмом уменьшался арт библиотеки
// (resizeTo400() в generate_library_art.js), и он же нужен миниатюрам арта
// городов. Держим одну реализацию, чтобы правка интерполяции или кодека не
// расходилась между двумя копиями.
//
// Почему не sharp: это единственный нативный бинарник, который пришлось бы
// тянуть при каждом npm install у пользователя — решение владельца проекта
// обходиться средствами Windows.

const { spawnSync } = require('child_process');

// PowerShell-строка в одинарных кавычках: внутри неё спецсимволов нет вообще,
// кроме самой кавычки. Для путей это надёжнее двойных кавычек, где $ и `
// раскрываются.
function psString(value) {
  return "'" + String(value).replace(/'/g, "''") + "'";
}

/**
 * Уменьшает изображение и сохраняет результат в PNG или JPEG.
 *
 * @param {object} opts
 * @param {string} opts.src      абсолютный путь к исходнику
 * @param {string} opts.dst      абсолютный путь результата
 * @param {number} opts.width    целевая ширина, px
 * @param {number} [opts.height] целевая высота; без неё считается по пропорциям исходника
 * @param {'png'|'jpeg'} [opts.format='png']
 * @param {number} [opts.quality=82] качество JPEG (для PNG игнорируется)
 * @param {number} [opts.timeoutMs=60000]
 */
function resizeImage({ src, dst, width, height, format = 'png', quality = 82, timeoutMs = 60000 }) {
  if (!width || width < 1) throw new Error('resizeImage: не задана ширина');
  const isJpeg = format === 'jpeg';

  // Высоту, если не задана, считаем уже в PowerShell — иначе пришлось бы
  // отдельным процессом читать размеры исходника.
  const heightExpr = height
    ? String(Math.round(height))
    : '[Math]::Max(1, [int][Math]::Round($src.Height * ($w / $src.Width)))';

  const saveExpr = isJpeg
    ? `
$enc = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' } | Select-Object -First 1
$ep = New-Object System.Drawing.Imaging.EncoderParameters 1
$ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]${Math.round(quality)})
$dst.Save($dstPath, $enc, $ep)
$ep.Dispose()`.trim()
    : `$dst.Save($dstPath, [System.Drawing.Imaging.ImageFormat]::Png)`;

  // Формат пикселей разный: JPEG не умеет альфу, и 32bppArgb-битмап
  // сохраняется с мусором в прозрачных местах.
  const pixelFormat = isJpeg ? 'Format24bppRgb' : 'Format32bppArgb';

  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$srcPath = ${psString(src)}
$dstPath = ${psString(dst)}
$w = ${Math.round(width)}
$src = [System.Drawing.Image]::FromFile($srcPath)
try {
  $h = ${heightExpr}
  $dst = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::${pixelFormat})
  try {
    $g = [System.Drawing.Graphics]::FromImage($dst)
    try {
      $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      ${isJpeg ? '$g.Clear([System.Drawing.Color]::Black)' : ''}
      $g.DrawImage($src, 0, 0, $w, $h)
    } finally { $g.Dispose() }
    ${saveExpr}
  } finally { $dst.Dispose() }
} finally { $src.Dispose() }
`.trim();

  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (r.error) throw new Error('PowerShell resize не запустился: ' + r.error.message);
  if (r.status !== 0) {
    throw new Error('PowerShell resize failed: ' + (r.stderr ? r.stderr.toString() : 'exit ' + r.status));
  }
}

module.exports = { resizeImage };
