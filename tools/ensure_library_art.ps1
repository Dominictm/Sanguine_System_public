# Watcher for library-art batch generation. Runs from Task Scheduler every 15 min:
# - counts present/missing PNGs from tools/library-art-manifest.json;
# - logs progress EVERY run: done/total + missing + generator alive or not;
# - if none missing -> logs DONE (task can be deleted manually);
# - if the generation process is not running -> starts a full pass detached.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File tools/ensure_library_art.ps1

$ErrorActionPreference = 'SilentlyContinue'
Set-Location 'F:\GitHUbe\VTM-project-Claude'
$Log = 'opencode_tmp/library-art-watch.log'
$GenLog = 'opencode_tmp/library-art-gen.log'
$Ckpt = 'SDXL 1.0\photography\zavychromaxl_v100.safetensors'

$out = node -e "const fs=require('fs'),path=require('path');const M=require('./tools/library-art-manifest.json');let m=0;for(const e of M){if(!fs.existsSync(path.join('web/public/img/system/library',e.section,e.slug+'.png')))m++;}console.log((M.length-m)+' '+(M.length)+' '+m);"
$parts = (($out | Select-Object -Last 1) -split ' ')
$done, $total, $missing = $parts[0], $parts[1], $parts[2]
$now = Get-Date -Format 'dd.MM HH:mm:ss'

$genUp = $null -ne (Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'generate_library_art' })

"$now PROGRESS done $done/$total, missing $missing, generator: $(if ($genUp) { 'running' } else { 'idle' })" | Add-Content $Log

if ([int]$missing -eq 0) {
  "$now DONE, all images present" | Add-Content $Log
  exit 0
}
if (-not $genUp) {
  "$now RESTART generation, missing=$missing" | Add-Content $Log
  $cmd = "`$env:COMFY_CKPT='$Ckpt'; node tools/generate_library_art.js >> $GenLog 2>&1"
  Start-Process powershell.exe -ArgumentList '-NoProfile', '-Command', $cmd
}
