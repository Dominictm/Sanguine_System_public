'use strict';
// Свободный сценарий (spec doc/design/free-generation FR14): правка сплошного текста
// (scenario-free.md) и участников (секция «## 👥 Участники» файла модуля). Локации модуля —
// общий подресурс ./locations.js, финал — PUT …/finale (./fields.js).
const express = require('express');
const {
  path, fs, serverError, chroniclesDir, reqCity, writeFileAtomic, sanitizeInlineText,
  FREE_SCENARIO_FILE, moduleKind, renderParticipants, _hasTraversal,
} = require('./shared');

const NAMES_MAX = 50;

async function loadFreeModule(req, res) {
  const city = reqCity(req);
  const { chr, mod } = req.params;
  if (_hasTraversal(chr, mod)) { res.status(400).json({ error: 'Недопустимое имя' }); return null; }
  const modDir  = path.join(chroniclesDir(city), chr, 'modules', mod);
  const modFile = path.join(modDir, `${mod}.md`);
  const raw = await fs.readFile(modFile, 'utf-8').catch(() => null);
  if (raw === null) { res.status(404).json({ error: 'Модуль не найден' }); return null; }
  if (moduleKind(raw) !== 'free') { res.status(409).json({ error: 'Модуль не является свободным сценарием' }); return null; }
  return { modDir, modFile, raw };
}

module.exports = function freeModuleRouter() {
  const router = express.Router();

  router.put('/api/chronicles/:chr/modules/:mod/free-scenario', express.json({ limit: '2mb' }), async (req, res) => {
    try {
      const m = await loadFreeModule(req, res);
      if (!m) return;
      const text = String(req.body?.text ?? '').replace(/\r\n?/g, '\n').trim();
      await writeFileAtomic(path.join(m.modDir, FREE_SCENARIO_FILE), text ? text + '\n' : '', 'utf-8');
      res.json({ ok: true });
    } catch (e) { serverError(res, e); }
  });

  router.put('/api/chronicles/:chr/modules/:mod/participants', express.json(), async (req, res) => {
    try {
      const m = await loadFreeModule(req, res);
      if (!m) return;
      const clean = v => [...new Set((Array.isArray(v) ? v : [])
        .map(n => sanitizeInlineText(String(n || '')).trim()).filter(Boolean))].slice(0, NAMES_MAX);
      const pcs = clean(req.body?.pcs), npcs = clean(req.body?.npcs).filter(n => !pcs.includes(n));
      const raw = m.raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
      const block = renderParticipants(pcs, npcs);
      const sectRe = /^##\s*👥\s*Участники[ \t]*\n[\s\S]*?(?=\n---|\n##[^#]|$(?![\s\S]))/m;
      const next = sectRe.test(raw) ? raw.replace(sectRe, () => block.trimEnd() + '\n')
                                    : raw.trimEnd() + '\n\n---\n\n' + block;
      await writeFileAtomic(m.modFile, next, 'utf-8');
      res.json({ ok: true, pcs, npcs });
    } catch (e) { serverError(res, e); }
  });

  return router;
};
