'use strict';
// Миниатюры арта городов.
//
// Зачем: интерфейс показывает исходники как есть — карточка персонажа рисует
// файл 1023×1537 в области 284×336, узел графа — в круге 36×36. На Париже это
// 74.6 МБ на сетке персонажей и 70.1 МБ на графе против ~1300 реально нужных
// пикселей в узле. Исходники — авторские материалы Рассказчика, их не трогаем;
// миниатюры складываем отдельно.
//
// Ресайз — тот же PowerShell + System.Drawing, что уменьшает арт библиотеки
// (tools/lib/image_resize.js). Нативных зависимостей вроде sharp в проекте нет
// сознательно: пользователь ставит его при каждом npm install из start.bat.

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { CITIES_DIR } = require('./db');
const { resizeImage } = require('../../tools/lib/image_resize');

// Ровно два размера, оба с запасом на dpr 2: 284 CSS у карточки сетки и 36 CSS
// у узла графа. Произвольные значения не принимаем — иначе один кривой запрос
// забьёт диск вариантами.
const THUMB_WIDTHS = new Set([640, 96]);

// Директория с ведущей точкой не попадает в обход городов (_firstCity/listCities
// отсекают /^[._]/), поэтому миниатюры не станут «городом» и не полезут в бэкап.
const THUMBS_DIRNAME = '.thumbs';

// Форматы, которые System.Drawing действительно читает. WebP среди них нет:
// GDI+ его не декодирует, и попытка ресайза упала бы с OutOfMemoryException.
const RESIZABLE_EXT = new Set(['.jpg', '.jpeg', '.png', '.bmp', '.gif']);

// Ресайз спавнит PowerShell и занимает ~300–400 мс. Сетка персонажей просит
// 38 картинок разом, и без ограничителя это 38 одновременных процессов —
// машина уходит в своп раньше, чем отдаст первую карточку. Четыре в параллель
// укладывают холодный прогон Парижа примерно в 3–4 секунды, один раз за жизнь
// файлов.
const MAX_PARALLEL_RESIZE = 4;
let _running = 0;
const _queue = [];
// Плюс дедупликация по конечному пути: два запроса на одну миниатюру (карточка
// и граф в соседних вкладках) должны разделить одну работу, а не делать её дважды.
const _inFlight = new Map();

function _acquire() {
  if (_running < MAX_PARALLEL_RESIZE) { _running++; return Promise.resolve(); }
  return new Promise(resolve => _queue.push(resolve));
}
function _release() {
  const next = _queue.shift();
  if (next) next();
  else _running--;
}

// Ключ инвалидации — путь + mtime + размер исходника: правка файла меняет ключ,
// старая миниатюра осиротеет и просто перестанет использоваться.
function thumbKey(relPath, stat, width) {
  const h = crypto.createHash('sha1')
    .update(relPath).update('|').update(String(stat.mtimeMs)).update('|').update(String(stat.size))
    .digest('hex').slice(0, 16);
  return `${h}-w${width}.jpg`;
}

/**
 * Разбирает путь вида `<city>/characters/<lin>/<slug>/art/<file>` и возвращает
 * абсолютные пути исходника и миниатюры — либо null, если путь недопустим.
 */
function resolveThumbTarget(relUrlPath, width) {
  if (!THUMB_WIDTHS.has(width)) return null;

  const decoded = relUrlPath.split('/').map(s => {
    try { return decodeURIComponent(s); } catch { return null; }
  });
  if (decoded.some(s => s === null)) return null;

  const parts = decoded.filter(Boolean);
  // '..' и абсолютные пути отсекаем до любых обращений к диску: этот роут
  // склеивает путь сам, ему не достаётся защиты express.static.
  if (parts.length < 2 || parts.some(p => p === '.' || p === '..' || path.isAbsolute(p))) return null;

  const city = parts[0];
  if (!/^[a-z0-9_]+$/.test(city)) return null;

  const srcAbs = path.join(CITIES_DIR, ...parts);
  const cityRoot = path.join(CITIES_DIR, city);
  // Финальная проверка выхода за пределы города — на случай хитрых кодировок.
  if (path.relative(cityRoot, srcAbs).startsWith('..')) return null;

  return {
    srcAbs,
    relPath: parts.join('/'),
    thumbsDir: path.join(cityRoot, THUMBS_DIRNAME),
    ext: path.extname(srcAbs).toLowerCase(),
  };
}

/**
 * Отдаёт путь к готовой миниатюре, создавая её при первом обращении.
 * @returns {Promise<string|null>} абсолютный путь или null, если миниатюру
 *   сделать нельзя (нет файла, неподходящий формат, ошибка ресайза) — вызывающий
 *   в этом случае обязан отдать исходник, а не ошибку.
 */
async function ensureThumb(relUrlPath, width) {
  const target = resolveThumbTarget(relUrlPath, width);
  if (!target) return null;
  if (!RESIZABLE_EXT.has(target.ext)) return null;

  let stat;
  try {
    stat = await fsp.stat(target.srcAbs);
    if (!stat.isFile()) return null;
  } catch { return null; }

  const thumbAbs = path.join(target.thumbsDir, thumbKey(target.relPath, stat, width));
  try {
    const t = await fsp.stat(thumbAbs);
    if (t.isFile() && t.size > 0) return thumbAbs;
  } catch { /* ещё не делали */ }

  if (_inFlight.has(thumbAbs)) return _inFlight.get(thumbAbs);

  const job = (async () => {
    await _acquire();
    try {
      await fsp.mkdir(target.thumbsDir, { recursive: true });
      // Пишем во временный файл и переименовываем: иначе параллельный запрос
      // (или упавший ресайз) оставил бы наполовину записанный JPEG под рабочим
      // именем, и он бы кэшировался как готовый.
      const tmp = `${thumbAbs}.${process.pid}.${Date.now()}.tmp`;
      try {
        resizeImage({ src: target.srcAbs, dst: tmp, width, format: 'jpeg', quality: 82 });
        await fsp.rename(tmp, thumbAbs);
      } catch (e) {
        await fsp.rm(tmp, { force: true }).catch(() => {});
        throw e;
      }
      return thumbAbs;
    } catch (e) {
      console.warn('[thumbs] не удалось сделать миниатюру', target.relPath, '-', e.message);
      return null;
    } finally {
      _release();
      _inFlight.delete(thumbAbs);
    }
  })();

  _inFlight.set(thumbAbs, job);
  return job;
}

module.exports = { ensureThumb, THUMB_WIDTHS, THUMBS_DIRNAME };
