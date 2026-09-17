#!/usr/bin/env node
'use strict';
// Wrapper / process guardian for server.js.
// Runs server.js as a child. When the child exits with code 75 (RESTART_CODE),
// the wrapper immediately relaunches it — the wrapper process itself never stops,
// so the terminal window stays open and no new browser tab is ever opened.
//
// Unexpected crashes (any other exit that ISN'T our own Ctrl-C/SIGTERM
// shutdown) are ALSO auto-restarted, with a short backoff and a crash-count
// limit — a dev server meant to run for hours during a live game session
// shouldn't silently die on one bad request and take the whole terminal down
// with it (see docs/audit/2026-07-28-session-feature-qa-report.md, находка №2).
//
// All child stdout/stderr is duplicated into a daily log file in addition to
// the terminal (stdio used to be plain 'inherit', so a crash's trace only
// ever existed in whichever terminal happened to be watching — nothing
// survived a headless/background/autostart run). Ctrl-C (SIGINT) / SIGTERM
// still stop everything cleanly, same as before — the guardian only treats
// exits it did NOT itself request as crashes.

const { spawn } = require('child_process');
const path      = require('path');
const fs        = require('fs');

const RESTART_CODE     = 75;
const SERVER           = path.join(__dirname, 'server.js');
const LOG_DIR           = path.join(__dirname, 'logs');
const CRASH_LIMIT       = 5;      // consecutive unexpected crashes before giving up
const CRASH_WINDOW_MS   = 60_000; // crash counter resets once this long passes without another crash
const CRASH_BACKOFF_MS  = 1000;

let _child        = null;
let _shuttingDown = false; // set right before WE kill the child (Ctrl-C/SIGTERM) — suppresses crash auto-restart
let _crashCount   = 0;
let _lastCrashAt  = 0;
let _logStream    = null;
let _logStreamDay = null;
let _logBomWritten = false; // UTF-8 BOM — один раз на файл, чтобы Get-Content/editor определили кодировку

// Strip ANSI escape sequences from a buffer (CSI: ESC[ ... letter).
// Работает на byte-level через latin1 round-trip — не ломает multi-byte UTF-8.
const ANSI_RE = /\x1b\[[0-9;]*[ -\/]*[@-~]/g;
function stripAnsi(buf) {
  return Buffer.from(buf.toString('latin1').replace(ANSI_RE, ''), 'latin1');
}

function openLogStream() {
  const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD — one file per day, appended across restarts
  if (_logStream && _logStreamDay === day) return _logStream;
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const logPath = path.join(LOG_DIR, `server-${day}.log`);
  _logStream?.end();
  // UTF-8 BOM при создании нового файла — PowerShell Get-Content по умолчанию
  // читает как ANSI (cp1251); BOM заставляет автоопределение UTF-8. Файл,
  // который существует, но пуст (0 байт), тоже переоткрываем с BOM.
  const isNew = !fs.existsSync(logPath) || fs.statSync(logPath).size === 0;
  _logStream = fs.createWriteStream(logPath, { flags: 'a', encoding: 'utf8' });
  if (isNew) _logStream.write('\uFEFF');
  _logStreamDay = day;
  _logBomWritten = true;
  return _logStream;
}

// Пишет чанк и в унаследованный поток терминала (как раньше делал plain
// 'inherit'), и в файл лога — падение сервера оставляет след, даже если
// консоль в этот момент никто не смотрел.
// В файл: ANSI escape-коды stripаются (лог — чистый UTF-8 текст).
function tee(childStream, parentStream) {
  childStream.on('data', chunk => {
    parentStream.write(chunk);
    openLogStream().write(stripAnsi(chunk));
  });
}

function start() {
  // FORCE_COLOR=1 для child: wrapper определяет, что его stdout — реальный
  // терминал, и сигналит серверу включить ANSI-цвета (иначе server.js,
  // чей stdout — pipe, по isTTY/hasColors не угадает и выведет «␛[2m»
  // буквально).
  const childEnv = {
    ...process.env,
    VTM_SUPERVISED: '1',
    ...(process.stdout.isTTY ? { FORCE_COLOR: '1' } : {}),
  };
  _child = spawn(process.execPath, [SERVER], {
    stdio: ['inherit', 'pipe', 'pipe'],
    // VTM_SUPERVISED tells server.js a guardian is watching for exit code 75,
    // so it may safely self-exit to restart. Without it the server won't kill itself.
    env:   childEnv,
    cwd:   __dirname,
  });

  tee(_child.stdout, process.stdout);
  tee(_child.stderr, process.stderr);

  _child.on('exit', (code, signal) => {
    if (code === RESTART_CODE) {
      console.log('\n  [wrapper] Перезапуск сервера...\n');
      setTimeout(start, 150);
      return;
    }
    if (_shuttingDown) {
      console.log(`\n  [wrapper] Сервер остановлен (code: ${code ?? signal}).\n`);
      process.exit(code ?? 1);
      return;
    }

    // Ни наш restart-код, ни наш собственный Ctrl-C/SIGTERM — значит сервер
    // упал сам. Логируем и пробуем перезапустить вместо того, чтобы тихо
    // умереть вместе с ним.
    const msg = `[wrapper] Сервер неожиданно упал (code: ${code ?? signal}).`;
    console.error('\n  ' + msg + '\n');
    openLogStream().write(`\n${new Date().toISOString()} ${msg}\n`);

    const now = Date.now();
    if (now - _lastCrashAt > CRASH_WINDOW_MS) _crashCount = 0;
    _lastCrashAt = now;
    _crashCount++;

    if (_crashCount > CRASH_LIMIT) {
      const giveUpMsg = `[wrapper] ${CRASH_LIMIT} падений подряд за минуту — прекращаю попытки автоперезапуска.`;
      console.error('\n  ' + giveUpMsg + '\n');
      openLogStream().write(`${new Date().toISOString()} ${giveUpMsg}\n`);
      process.exit(code ?? 1);
      return;
    }
    console.log(`  [wrapper] Попытка автоперезапуска ${_crashCount}/${CRASH_LIMIT}...\n`);
    setTimeout(start, CRASH_BACKOFF_MS);
  });

  _child.on('error', err => {
    console.error('[wrapper] Ошибка запуска сервера:', err.message);
    process.exit(1);
  });
}

// Propagate Ctrl-C to child
process.on('SIGINT',  () => { _shuttingDown = true; _child?.kill('SIGINT');  });
process.on('SIGTERM', () => { _shuttingDown = true; _child?.kill('SIGTERM'); });

start();
