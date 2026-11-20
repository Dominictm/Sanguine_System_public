'use strict';
// Обслуживание markdown-ссылок при перемещении карточек — техспека 2026-08-04 §B1.
//
// Первопричина: PUT /api/locations/:slug/district (привязка локации к району) физически
// переносит папку через fs.rename, но ссылки на старый путь («[Склад](../../../../locations/
// villet/sklad_kanal_yurk/sklad_kanal_yurk.md)» из модуля/хроники/архива) оставались
// битыми молча — ни ошибки, ни предупреждения. Кнопка «Проверка → Исправить
// автоматически» их не чинит: validate_links.ps1 -Fix работает только с изображениями.
//
// Алгоритм не новый: ровно это уже делала миграция округ→район
// (tools/migrations/002_district_rayon_paths.js), когда переносила все локации разом.
// Здесь он вынесен, чтобы у одиночного переноса и у миграции был один источник —
// логика внутри не менялась (сортировка по длине пути, граница (?=[/)]|$), BOM).

const fs = require('fs');
const path = require('path');

function _escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function _relPosix(root, p) { return path.relative(root, p).split(path.sep).join('/'); }

function _walkMd(dir, visit) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) _walkMd(fp, visit);
    else if (e.isFile() && e.name.endsWith('.md')) visit(fp);
  }
}

/**
 * Правит markdown-ссылки «<prefix>/<oldRel>» → «<prefix>/<newRel>» во всех .md файлах
 * города, на любой глубине «../» (матчится хвост пути, а не относительный префикс).
 *
 * @param {string} cityDir — абсолютный путь cities/<city>
 * @param {{oldRel: string, newRel: string}[]} renameMap — пути ОТНОСИТЕЛЬНО prefix-папки
 * @param {object}   [opts]
 * @param {string}   [opts.prefix='locations'] — 'locations' | 'characters' (§B3)
 * @param {Function} [opts.log]
 * @returns {{filesChanged: number, files: string[]}}
 */
function updateMdLinks(cityDir, renameMap, opts = {}) {
  const prefix = opts.prefix || 'locations';
  const log = typeof opts.log === 'function' ? opts.log : () => {};
  const map = (renameMap || []).filter(r => r && r.oldRel && r.newRel && r.oldRel !== r.newRel);
  if (!map.length) return { filesChanged: 0, files: [] };

  // Длинные пути первыми: иначе короткий путь-префикс перехватил бы совпадение,
  // предназначенное более длинному (например «luvr» vs «luvr/il_de_la_site»).
  const sorted = [...map].sort((a, b) => b.oldRel.length - a.oldRel.length);
  const files = [];

  _walkMd(cityDir, fp => {
    const raw = fs.readFileSync(fp, 'utf8');
    const hasBom = raw.charCodeAt(0) === 0xFEFF;
    let text = hasBom ? raw.slice(1) : raw;
    let touched = false;
    for (const { oldRel, newRel } of sorted) {
      // (?=[/)]|$) — граница пути: «villet/sklad» не должен матчиться внутри
      // «villet/sklad_2», а закрывающая «)» завершает markdown-ссылку.
      const re = new RegExp(_escapeRe(`${prefix}/${oldRel}`) + '(?=[/)]|$)', 'g');
      if (re.test(text)) {
        text = text.replace(re, `${prefix}/${newRel}`);
        touched = true;
      }
    }
    if (touched) {
      fs.writeFileSync(fp, (hasBom ? '﻿' : '') + text, 'utf8');
      files.push(_relPosix(cityDir, fp));
      log(`ссылки поправлены: ${_relPosix(cityDir, fp)}`);
    }
  });

  return { filesChanged: files.length, files };
}

/**
 * Обратный индекс: какие .md файлы города ссылаются на карточку. Тот же обход, что и
 * updateMdLinks, но без записи — нужен, чтобы предупредить перед удалением (§B2):
 * цель исчезает, автоподстановка нового пути невозможна.
 *
 * @returns {{count: number, files: string[]}}
 */
function findMdLinks(cityDir, rel, opts = {}) {
  const prefix = opts.prefix || 'locations';
  const re = new RegExp(_escapeRe(`${prefix}/${rel}`) + '(?=[/)]|$)');
  const files = [];
  _walkMd(cityDir, fp => {
    // Сама карточка ссылается на себя только через относительные пути внутри своей
    // папки — их этот матч не поймает, дополнительного исключения не требуется.
    if (re.test(fs.readFileSync(fp, 'utf8'))) files.push(_relPosix(cityDir, fp));
  });
  return { count: files.length, files };
}

/**
 * Пересчитывает ИСХОДЯЩИЕ относительные ссылки .md-файлов перенесённой папки (Б28).
 * Нужен, когда перенос меняет глубину вложенности: локация, созданная заполнением модуля,
 * лежит в locations/<район>/<модуль>/<локация>/, а после привязки к району — на уровень выше,
 * и «../../../../chronicles/…» начинает указывать мимо города.
 * Ссылки внутрь самой папки (art/…), абсолютные, внешние и якоря не трогаются.
 *
 * @param {string} oldDir — где папка лежала (абсолютный путь)
 * @param {string} newDir — где лежит сейчас (файлы читаются отсюда)
 * @returns {{filesChanged: number, links: number}}
 */
function rebaseMdLinks(oldDir, newDir) {
  let filesChanged = 0, links = 0;
  _walkMd(newDir, fp => {
    const raw = fs.readFileSync(fp, 'utf8');
    const hasBom = raw.charCodeAt(0) === 0xFEFF;
    const text = hasBom ? raw.slice(1) : raw;
    const fileNewDir = path.dirname(fp);
    const fileOldDir = path.join(oldDir, path.relative(newDir, fileNewDir));
    let touched = 0;
    const out = text.replace(/(\]\()(<?)(\.\.?\/[^)\s>]+)(>?)(?=[)\s])/g, (m, open, lt, href, gt) => {
      // split(/(?=[#?])/) давал БОЛЬШЕ двух частей («a.md#scene?v=2» → три), и всё после
      // второго разделителя молча терялось при переписывании ссылки. Режем по первому.
      const cut = href.search(/[#?]/);
      const p = cut === -1 ? href : href.slice(0, cut);
      const tail = cut === -1 ? '' : href.slice(cut);
      const target = path.resolve(fileOldDir, p);
      const inside = path.relative(oldDir, target);
      if (!inside.startsWith('..') && !path.isAbsolute(inside)) return m;   // цель переехала вместе с папкой
      const rel = path.relative(fileNewDir, target).split(path.sep).join('/');
      const next = (rel.startsWith('.') ? rel : './' + rel) + tail;
      if (next === href) return m;
      touched++;
      return open + lt + next + gt;
    });
    if (touched) {
      fs.writeFileSync(fp, (hasBom ? '﻿' : '') + out, 'utf8');
      filesChanged++; links += touched;
    }
  });
  return { filesChanged, links };
}

module.exports = { updateMdLinks, findMdLinks, rebaseMdLinks };
