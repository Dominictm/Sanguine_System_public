'use strict';
// Монитор CPU / RAM / GPU / VRAM на время генерации llama.cpp (спека §2.7).
// GPU — один долгоживущий процесс (nvidia-smi -lms или typeperf), а не новый
// процесс каждую секунду. Нет данных → gpu: null («н/д» в UI).
// LLAMACPP_MONITOR=off — без внешних процессов (тесты): только CPU/RAM.

const os = require('os');
const { spawn } = require('child_process');

function _cpuTimes() {
  let idle = 0, total = 0;
  for (const c of os.cpus()) {
    const t = c.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.irq + t.idle;
  }
  return { idle, total };
}

function createMonitor(onSample) {
  let timer = null, gpuProc = null, prev = null;
  let gpu = null; // { util, memUsedMb, memTotalMb }

  function _lines(proc, onLine) {
    let buf = '';
    proc.stdout.on('data', d => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) !== -1) { onLine(buf.slice(0, i).trim()); buf = buf.slice(i + 1); }
    });
  }

  function _startNvidia() {
    const p = spawn('nvidia-smi', ['--query-gpu=utilization.gpu,memory.used,memory.total', '--format=csv,noheader,nounits', '-lms', '1000'], { windowsHide: true });
    p.on('error', () => { if (gpuProc === p) { gpuProc = null; _startTypeperf(); } });
    _lines(p, line => {
      // По строке на видеокарту за тик; берём первую (основная для llama.cpp).
      const [u, used, total] = line.split(',').map(s => Number(s.trim()));
      if (Number.isFinite(u)) gpu = { util: u, memUsedMb: used, memTotalMb: total };
    });
    gpuProc = p;
  }

  function _startTypeperf() {
    if (process.platform !== 'win32') return;
    const p = spawn('typeperf', ['\\GPU Engine(*engtype_3D)\\Utilization Percentage', '\\GPU Adapter Memory(*)\\Dedicated Usage', '-si', '1'], { windowsHide: true });
    let header = null;
    p.on('error', () => { if (gpuProc === p) gpuProc = null; });
    _lines(p, line => {
      if (!line.startsWith('"')) return;
      const cols = line.split('","').map(s => s.replace(/^"|"$/g, ''));
      if (!header) { header = cols; return; }
      let util = 0, mem = 0, seen = false;
      cols.forEach((v, i) => {
        const n = Number(v); if (!Number.isFinite(n) || i === 0) return;
        seen = true;
        if (/Utilization Percentage/i.test(header[i])) util += n;
        else if (/Dedicated Usage/i.test(header[i])) mem += n;
      });
      if (seen) gpu = { util: Math.min(100, Math.round(util)), memUsedMb: Math.round(mem / 1048576), memTotalMb: null };
    });
    gpuProc = p;
  }

  function sample() {
    const now = _cpuTimes();
    let cpu = null;
    if (prev) {
      const dt = now.total - prev.total;
      cpu = dt > 0 ? Math.round(100 * (1 - (now.idle - prev.idle) / dt)) : null;
    }
    prev = now;
    const total = os.totalmem();
    return {
      cpu,
      ram: { usedMb: Math.round((total - os.freemem()) / 1048576), totalMb: Math.round(total / 1048576) },
      gpu: gpu ? { ...gpu } : null,
      at: Date.now(),
    };
  }

  return {
    start() {
      if (timer) return;
      prev = _cpuTimes();
      gpu = null;
      if (process.env.LLAMACPP_MONITOR !== 'off') _startNvidia();
      timer = setInterval(() => { try { onSample(sample()); } catch { /* монитор не должен ронять генерацию */ } }, 1000);
      timer.unref?.();
    },
    stop() {
      if (timer) { clearInterval(timer); timer = null; }
      if (gpuProc) { try { gpuProc.kill(); } catch { /* уже вышел */ } gpuProc = null; }
    },
    sample,
  };
}

module.exports = { createMonitor };
