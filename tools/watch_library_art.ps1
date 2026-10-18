# Watchdog for the library-art batch generation (tools/generate_library_art.js).
# - every 5 min checks whether the node generation process is alive;
# - restarts it if dead and images are still missing;
# - logs an hourly progress line to opencode_tmp/library-art-watch.log.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File tools/watch_library_art.ps1
# Stop: New-Item opencode_tmp/library-art-watch.stop (watchdog exits by itself).

$ErrorActionPreference = 'SilentlyContinue'
$Root = Join-Path $PSScriptRoot '..'
Set-Location $Root
$Log = 'opencode_tmp/library-art-watch.log'
$GenLog = 'opencode_tmp/library-art-gen.log'
$StopFlag = 'opencode_tmp/library-art-watch.stop'
$Ckpt = 'SDXL 1.0\photography\zavychromaxl_v100.safetensors'

function Missing-Count {
  $out = node -e "const fs=require('fs'),path=require('path');const M=require('./tools/library-art-manifest.json');let m=0;for(const e of M){if(!fs.existsSync(path.join('web/public/img/system/library',e.section,e.slug+'.png')))m++;}console.log(m);"
  return [int]($out | Select-Object -Last 1)
}

"[$(Get-Date -Format 'dd.MM HH:mm:ss')] watch start" | Add-Content $Log
$lastHourly = -1
while ($true) {
  if (Test-Path $StopFlag) {
    "[$(Get-Date -Format 'dd.MM HH:mm:ss')] stop flag found, exit" | Add-Content $Log
    break
  }
  $missing = Missing-Count
  if ($missing -eq 0) {
    "[$(Get-Date -Format 'dd.MM HH:mm:ss')] DONE, all images present" | Add-Content $Log
    break
  }
  $nodeUp = $null -ne (Get-Process node -ErrorAction SilentlyContinue)
  if (-not $nodeUp) {
    "[$(Get-Date -Format 'dd.MM HH:mm:ss')] node down, missing=$missing - restart" | Add-Content $Log
    $cmd = "`$env:COMFY_CKPT='$Ckpt'; node tools/generate_library_art.js >> $GenLog 2>&1"
    Start-Process powershell.exe -ArgumentList '-NoProfile', '-Command', $cmd
    Start-Sleep -Seconds 30
  }
  $h = (Get-Date).Hour
  if ($h -ne $lastHourly) {
    $lastHourly = $h
    "[$(Get-Date -Format 'dd.MM HH:mm:ss')] HOURLY missing=$missing" | Add-Content $Log
  }
  Start-Sleep -Seconds 300
}
