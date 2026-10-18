'use strict';
// Временный «Режим только для чтения» для доступа по локальной сети.
// Спека: doc/design/2026-10-11-remote-readonly-fix-analysis.md (зафиксирована 2026-10-11).
//
// Когда сервер открыт в сеть (HOST=0.0.0.0), запросы с самой машины мастера
// (loopback: 127.0.0.0/8, ::1, ::ffff:127.x) получают полный доступ, а любые
// другие устройства сети — только чтение: GET/HEAD к данным города. Запись
// (POST/PUT/PATCH/DELETE), настройки, корзина, ИИ-провайдеры, бэкап и запуск
// процессов для них закрыты (403 + X-Read-Only: 1).
//
// Это заглушка до полноценного разграничения прав (роли, видимость «игрокам /
// мастеру», см. doc/design/2026-09-25-player-access-lan-analysis.md): читающий
// видит ВСЁ, включая заготовки мастера. Определение «свой/чужой» — только по
// адресу сокета (req.socket.remoteAddress), заголовки (X-Forwarded-For) и
// req.ip игнорируются; app.set('trust proxy', ...) не включать. За обратным
// прокси все запросы выглядели бы локальными, поэтому ставить сервер за прокси
// в этом режиме нельзя.
//
// Покрытие — только /api/ (решение В-С1): /city-img*, /audio-lib и public/
// отдаются сети как раньше (принятый риск до ролей, тест accepted-risk в all.test.js).
//
// REMOTE_READONLY=0 в .env возвращает прежнее поведение (сеть без ограничений).
// Любое другое/пустое значение (включая unset) = включено (решение В-С2).

// Нормализация: без trailing slash, чтобы '/api/backup' и '/api/backup/' матчились одинаково.
function norm(p) {
  const n = String(p || '').replace(/\/+$/, '');
  return n === '' ? '/' : n;
}

// GET-эндпоинты, закрытые для удалённых даже на чтение: раскрывают конфигурацию
// владельца, содержимое корзины, ходят к ИИ-провайдерам с его ключами, запускают
// процессы или отдают архивы бэкапа.
const REMOTE_DENY_GET = [
  '/api/settings',
  '/api/auth-status',
  '/api/trash',
  '/api/claude',
  '/api/lmstudio',
  '/api/openrouter',
  '/api/backup',
].map(norm);

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function remoteReadOnlyEnabled() {
  return process.env.REMOTE_READONLY !== '0';
}

function isLocalRequest(req) {
  const addr = req.socket?.remoteAddress || '';
  return addr === '::1' || addr.startsWith('127.') || addr.startsWith('::ffff:127.');
}

function isReadOnlyRequest(req) {
  return remoteReadOnlyEnabled() && !isLocalRequest(req);
}

function isDeniedForReadOnly(method, reqPath) {
  const n = norm(reqPath);
  if (!READ_METHODS.has(method)) return true;
  return REMOTE_DENY_GET.some(p => n === p || n.startsWith(p + '/'));
}

function accessMiddleware(req, res, next) {
  if (!req.path.startsWith('/api/')) return next();
  // Диагностика режима — только чтение; остальные методы идут через общий deny.
  if (norm(req.path) === '/api/access') {
    if (req.method === 'GET' || req.method === 'HEAD') {
      return res.json({ readOnly: isReadOnlyRequest(req), local: isLocalRequest(req) });
    }
    // POST /api/access и т.д. с удалённого — как любая запись → 403 ниже.
  }
  if (isReadOnlyRequest(req) && isDeniedForReadOnly(req.method, req.path)) {
    res.set('X-Read-Only', '1');
    return res.status(403).json({ error: 'Режим только для чтения: изменения доступны только на компьютере мастера', readOnly: true });
  }
  next();
}

module.exports = { accessMiddleware, isLocalRequest, isReadOnlyRequest, isDeniedForReadOnly, remoteReadOnlyEnabled, REMOTE_DENY_GET };
