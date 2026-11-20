'use strict';
// Запись арта в карточку: файл <slug>_NN.<ext> в art/ + строка «- [Образ N](art/…)» в секции
// «## 🖼️ Изображения». Общая для ручной загрузки (POST …/upload-image) и принятия кандидата
// ComfyUI (spec doc/design/comfyui §4) — одно поведение, одни тесты.

const fs = require('fs').promises;
const path = require('path');
const { writeFileAtomic } = require('./db');

async function _nextArtFile(artDir, slug, ext, { positiveOnly }) {
  await fs.mkdir(artDir, { recursive: true });
  const existing = await fs.readdir(artDir).catch(() => []);
  const slugRe = new RegExp(`^${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_(\\d+)\\.[a-z]+$`, 'i');
  let nums = existing.map(f => { const m = slugRe.exec(f); return m ? parseInt(m[1], 10) : 0; });
  if (positiveOnly) nums = nums.filter(n => n > 0);
  const num = (nums.length ? Math.max(...nums) : 0) + 1;
  return { num, filename: `${slug}_${String(num).padStart(2, '0')}.${ext}` };
}

/** Персонаж: art/ в папке персонажа, правка карточки <slug>.md. → { filename, num } */
async function saveCharacterArt(charDir, slug, buffer, ext) {
  const artDir = path.join(charDir, 'art');
  const { num, filename } = await _nextArtFile(artDir, slug, ext, { positiveOnly: false });
  await writeFileAtomic(path.join(artDir, filename), buffer);

  const cardPath = path.join(charDir, `${slug}.md`);
  let card = await fs.readFile(cardPath, 'utf-8').catch(() => null);
  if (card) {
    // Normalise CRLF first so the \n-based lookahead below always matches —
    // cards checked out on Windows (core.autocrlf) are CRLF on disk.
    card = card.replace(/\r\n/g, '\n');
    const newLine = `- [Образ ${num}](art/${filename})`;
    if (card.includes('⏳ Изображение не предоставлено')) {
      card = card.replace('- ⏳ Изображение не предоставлено', newLine);
    } else {
      // Append inside ## 🖼️ Изображения section (before next ## or end of file).
      // When this is the LAST section (no следующего ##), `tail` is `\s*$` —
      // greedy, so it swallows ALL trailing blank lines already in the file.
      // Re-pasting `tail` verbatim after also adding our own `\n` before it
      // grew that trailing whitespace by one line on every single upload —
      // harmless individually, but a card that gets several images over time
      // (e.g. this route hit repeatedly, as in the test suite) accumulates
      // an ever-longer run of blank lines at EOF. Normalise EOF trailing
      // whitespace to exactly one `\n` instead of re-appending the old tail;
      // the `\n##` case (image section isn't last) is unaffected.
      card = card.replace(/(## 🖼️ Изображения\n)([\s\S]*?)(\n##|\s*$)/, (_, hdr, body, tail) => {
        const trimmed = body.replace(/\n+$/, '');
        return tail.startsWith('\n##')
          ? `${hdr}${trimmed}\n${newLine}\n${tail}`
          : `${hdr}${trimmed}\n${newLine}\n`;
      });
    }
    await writeFileAtomic(cardPath, card, 'utf-8');
  }
  return { filename, num };
}

/** Локация: art/ рядом с карточкой mdPath. → { filename, num } */
async function saveLocationArt(mdPath, slug, buffer, ext) {
  const artDir = path.join(path.dirname(mdPath), 'art');
  const { num, filename } = await _nextArtFile(artDir, slug, ext, { positiveOnly: true });
  await writeFileAtomic(path.join(artDir, filename), buffer);

  let card = await fs.readFile(mdPath, 'utf-8').catch(() => null);
  if (card) {
    // Normalise CRLF first so the \n-based lookahead below always matches —
    // cards checked out on Windows (core.autocrlf) are CRLF on disk.
    card = card.replace(/\r\n/g, '\n');
    const newLine = `- [Образ ${num}](art/${filename})`;
    if (/⏳[^\n]*изображение не предоставлено/i.test(card)) {
      card = card.replace(/- ⏳[^\n]*изображение не предоставлено[^\n]*/i, newLine);
    } else {
      // Как у персонажа: если раздел последний, хвост пустых строк не переносится — иначе карточка
      // росла на строку с каждым изображением.
      card = card.replace(/(## 🖼️ Изображения\n)([\s\S]*?)(\n##|\s*$)/, (_, hdr, body, tail) => {
        const trimmed = body.replace(/\n+$/, '');
        return tail.startsWith('\n##') ? `${hdr}${trimmed}\n${newLine}\n${tail}` : `${hdr}${trimmed}\n${newLine}\n`;
      });
    }
    await writeFileAtomic(mdPath, card, 'utf-8');
  }
  return { filename, num };
}

/** Район: art/ рядом с district.md, карточку НЕ правит — PUT /districts перезаписывает
 * district.md целиком (buildDistrictMd), любая секция в карточке была бы затёрта, поэтому
 * у района источник истины по картинкам — скан папки art/ (spec doc/design/district-images-2026-11-17).
 * → { filename, num } */
async function saveDistrictArt(districtDir, slug, buffer, ext) {
  const artDir = path.join(districtDir, 'art');
  const { num, filename } = await _nextArtFile(artDir, slug, ext, { positiveOnly: true });
  await writeFileAtomic(path.join(artDir, filename), buffer);
  return { filename, num };
}

// Промты изображения района — сайдкар art/prompts.json рядом с district.md (по той же
// причине, что и выше: секций в district.md быть не может). Битый/чужой JSON = «нет
// промтов», а не ошибка: GET /images не должен падать из-за содержимого сайдкара.
async function readDistrictPrompts(districtDir) {
  const raw = await fs.readFile(path.join(districtDir, 'art', 'prompts.json'), 'utf-8').catch(() => null);
  if (!raw) return { positive: '', negative: '' };
  try {
    const j = JSON.parse(raw);
    return { positive: String(j.positive || ''), negative: String(j.negative || '') };
  } catch { return { positive: '', negative: '' }; }
}

async function writeDistrictPrompts(districtDir, { positive, negative } = {}) {
  const artDir = path.join(districtDir, 'art');
  await fs.mkdir(artDir, { recursive: true });
  const json = JSON.stringify({ positive: String(positive || ''), negative: String(negative || '') }, null, 2);
  await writeFileAtomic(path.join(artDir, 'prompts.json'), json + '\n', 'utf-8');
}

module.exports = { saveCharacterArt, saveLocationArt, saveDistrictArt, readDistrictPrompts, writeDistrictPrompts };
