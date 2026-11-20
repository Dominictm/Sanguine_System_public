// ── Неполные данные перед генерацией: диалоги добора из Библиотеки ─────────────
// Спека doc/design/archive/generation-retry-preflight §7 ADR-2, §8.2, §9.3. Сервер отвечает
// 409 GEN_PREFLIGHT, пока пользователь не решил, как быть с пустыми полями персонажей;
// эта обёртка window.fetch (внешний слой над обёрткой llama.cpp) показывает диалоги и
// повторяет запрос с заголовком X-Gen-Preflight. Вызывающий код видит только итог:
// ответ генерации или GEN_PREFLIGHT_DECLINED (отказ — без тоста, см. showAiError).
(function () {
  'use strict';

  const _inner = window.fetch.bind(window);
  // Подтверждённые наборы пропусков — повторно не спрашиваем до перезагрузки страницы (L5).
  const _confirmed = new Set();

  const _missKey = list => list.map(m => `${m.slug}:${m.field}:${m.reason}:${m.value || ''}`).sort().join('|');

  function _fillLine(f) {
    return t('preflight.fillItem', { name: f.name, values: f.values.map(libBareName).join(', ') });
  }
  function _missLine(m) {
    const key = 'preflight.reason.' + m.reason;
    const field = t('preflight.field.' + m.field);
    const txt = t(key, { name: m.name, value: m.value || '', field });
    return txt === key ? `${m.name} — ${field}` : txt;
  }

  function _withHeader(init, value) {
    const headers = new Headers(init.headers || {});
    headers.set('X-Gen-Preflight', value);
    return { ...init, headers };
  }

  function _declined() {
    return new Response(JSON.stringify({ ok: false, code: 'GEN_PREFLIGHT_DECLINED', error: t('preflight.declined') }),
      { status: 409, headers: { 'Content-Type': 'application/json' } });
  }

  async function _readPreflight(resp) {
    if (resp.status !== 409) return null;
    try {
      const d = await resp.clone().json();
      return d && d.code === 'GEN_PREFLIGHT' ? d : null;
    } catch { return null; }
  }

  // → строка решений для заголовка или null (пользователь отменил генерацию).
  async function _decide(d, tokens) {
    let missing = Array.isArray(d.missing) ? d.missing : [];
    const fill = Array.isArray(d.fill) ? d.fill : [];
    let applied = null;
    if (fill.length && !tokens.has('apply') && !tokens.has('nofill')) {
      const r = await showConfirm(t('preflight.fillMsg'), {
        items: fill.map(_fillLine), confirmText: t('preflight.add'), cancelText: t('preflight.noAdd'), dismissValue: null,
      });
      if (r === null) return null;
      if (r) { tokens.add('apply'); applied = fill; }
      else {
        tokens.add('nofill');
        missing = [...missing, ...fill.map(f => ({ slug: f.slug, name: f.name, field: f.field, reason: 'field-empty', value: '' }))];
      }
    }
    if (missing.length && !tokens.has('confirm')) {
      const key = _missKey(missing);
      if (!_confirmed.has(key)) {
        const ok = await showConfirm(t('preflight.missingMsg'), {
          items: missing.map(_missLine), confirmText: t('preflight.confirm'), cancelText: t('preflight.close'),
        });
        if (!ok) return null;
        _confirmed.add(key);
      }
      tokens.add('confirm');
    }
    return { applied };
  }

  window.fetch = async function (input, init) {
    if (!init || String(init.method || 'GET').toUpperCase() !== 'POST') return _inner(input, init);
    let resp = await _inner(input, init);
    let d = await _readPreflight(resp);
    if (!d) return resp;
    const tokens = new Set();
    let applied = null;
    // Сервер пересчитывает пропуски на каждом повторе; три круга — с запасом на изменившиеся данные.
    for (let round = 0; d && round < 3; round++) {
      const res = await _decide(d, tokens);
      if (!res) return _declined();
      applied = applied || res.applied;
      resp = await _inner(input, _withHeader(init, [...tokens].join(',')));
      d = await _readPreflight(resp);
    }
    if (d) return resp; // данные продолжают меняться — отдаём 409 как есть, вызывающий покажет ошибку
    // Что сервер действительно записал — заголовок X-Gen-Preflight-Applied (слаги). Он есть и тогда,
    // когда сама генерация потом упала (нет внешности, ошибка модели), и его нет, если запрос
    // отбит раньше проверки (429, 404) — так тост не врёт.
    const done = new Set(String(resp.headers.get('X-Gen-Preflight-Applied') || '').split(',').filter(Boolean).map(decodeURIComponent));
    const shown = (applied || []).filter(f => done.has(f.slug));
    if (shown.length) {
      showToast(t('preflight.addedToast', { items: shown.map(_fillLine).join('; ') }), 'success');
      window.dispatchEvent(new CustomEvent('sanguine:character-updated', { detail: { slugs: [...done] } }));
    }
    return resp;
  };
})();
