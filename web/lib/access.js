'use strict';
// Временный «Режим только для чтения» для доступа по локальной сети.
// Спека: doc/design/archive/2026-10-11-remote-readonly-fix-analysis.md (зафиксирована 2026-10-11).
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

// Нормализация: без trailing slash, чтобы '/api/backup' и '/api/backup/' матчились одинаково,
// и в нижнем регистре — Express сопоставляет маршруты без учёта регистра, поэтому
// '/API/settings' доходит до того же обработчика, что и '/api/settings' (Б22).
function norm(p) {
  const n = String(p || '').replace(/\/+$/, '').toLowerCase();
  return n === '' ? '/' : n;
}

const isApiPath = p => /^\/api\//i.test(String(p || ''));

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
  '/api/comfyui',
  '/api/llamacpp',
].map(norm);

// Остальные первые сегменты /api/, открытые удалённым на чтение. Новый роутер обязан попасть
// либо сюда, либо в REMOTE_DENY_GET — иначе падает гард «полнота списков доступа» в all.test.js.
const REMOTE_OPEN_GET = [
  'access', 'audio', 'characters', 'chronicle', 'chronicles', 'cities', 'export', 'factions',
  'free-gen', 'graph', 'guide', 'influence', 'integrity', 'library', 'locations', 'modules', 'property',
  'rumors', 'search', 'status', 'threads', 'timeline', 'visitors', 'world-state',
  '__test',   // существует только при AI_MOCK
];

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

// ── Проверка заголовка Host (Б26, DNS rebinding) ──────────────────────────────
// Сайт, переназначивший своё имя на 127.0.0.1, обращается к серверу с loopback-сокета и
// совпадающими Origin/Host — остальные проверки он проходит. Отличает его только имя в Host.
// Разрешены: IP-адрес в любом виде (имя, а не адрес, нужно для переназначения — адрес подделать
// нельзя), localhost, имя этой машины и имена из ALLOWED_HOSTS в .env (через запятую).
// Порт не сверяется: атака держится на имени, а порт сервера может быть выбран на лету.
const os = require('os');
const net = require('net');

function allowedHostNames() {
  const extra = String(process.env.ALLOWED_HOSTS || '').split(',').map(h => h.trim().toLowerCase()).filter(Boolean);
  return new Set(['localhost', os.hostname().toLowerCase(), ...extra]);
}

// Имя хоста из заголовка без порта, в нижнем регистре; null — заголовок не разобрать.
function hostNameOf(header) {
  const h = String(header || '').trim().toLowerCase();
  if (!h || /[\s/\\@?#]/.test(h)) return null;
  const v6 = h.match(/^\[([0-9a-f:.]+)\](?::\d{1,5})?$/);
  if (v6) return net.isIPv6(v6[1]) ? `[${v6[1]}]` : null;
  const m = h.match(/^([a-z0-9._-]+)(?::\d{1,5})?$/);
  return m ? m[1].replace(/\.$/, '') : null;
}

function isHostAllowed(header, names = allowedHostNames()) {
  const name = hostNameOf(header);
  if (!name) return false;
  if (name.startsWith('[') || net.isIPv4(name)) return true;
  return names.has(name);
}

function hostMiddleware(req, res, next) {
  const header = req.headers.host;
  // Без Host (HTTP/1.0, простые скрипты) — только с этой же машины: браузер его шлёт всегда.
  if (header === undefined || header === '') {
    if (isLocalRequest(req)) return next();
  } else if (isHostAllowed(header)) return next();
  res.status(403).json({
    error: `Запрос отклонён: имя сервера «${String(header || '').slice(0, 80)}» не разрешено. `
      + 'Открой приложение по адресу localhost или по IP-адресу, либо добавь это имя в ALLOWED_HOSTS в web/.env.',
    hostDenied: true,
  });
}

function accessMiddleware(req, res, next) {
  if (!isApiPath(req.path)) return next();
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

module.exports = { accessMiddleware, hostMiddleware, isHostAllowed, hostNameOf, isLocalRequest, isReadOnlyRequest, isDeniedForReadOnly, remoteReadOnlyEnabled, isApiPath, REMOTE_DENY_GET, REMOTE_OPEN_GET };
