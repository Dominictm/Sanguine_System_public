// ── i18n: интернационализация интерфейса (RU/EN) ───────────────────────────
// Легковесный слой перевода UI без модульной системы (вандал plain globals,
// как весь фронтенд). Язык хранится в localStorage['sanguine-lang']
// ('ru' | 'en', по умолчанию 'ru'); переключение — кнопка #btn-lang
// (рядом с #btn-theme) или хоткей L, применяется сразу с перезагрузкой
// страницы (тот же приём, что у темы). Словари — window.I18N_RU / I18N_EN
// (locale-ru.js / locale-en.js, подключаются ДО этого файла).
//
// Статичная разметка помечается data-i18n-атрибутами (см. applyI18n ниже),
// динамические строки (toast, confirm, результаты, лейблы рендера) вызывают
// t('module.сущность.действие', { params }).
//
// Подстановки: фрагмент «{{имя}}» в строке заменяется значением params.
// Плюралы: значение ключа — объект { one: '…', other: '…' }, ветка
// выбирается по params.count (1 → one, остальное → other).
//
// Анти-флеш: для языка, отличного от ru, в <head> ставится
// data-i18n-loading; CSS скрывает #app (html[data-i18n-loading] #app), пока
// applyI18n не применит переводы и не снимет флаг. Для ru (источник) флага
// нет — страница рендерится сразу.
(function () {
  'use strict';

  var KEY = 'sanguine-lang';
  var EN = 'en';

  function currentLang() {
    try { return localStorage.getItem(KEY) === EN ? EN : 'ru'; } catch (e) { return 'ru'; }
  }

  function dict() {
    return currentLang() === EN ? (window.I18N_EN || {}) : (window.I18N_RU || {});
  }

  // Значение по ключу: сначала активный словарь, затем RU как источник
  // (непереведённый ключ не должен ломать EN-режим).
  function resolve(key) {
    var v = dict()[key];
    if (v !== undefined) return v;
    if (currentLang() === EN && window.I18N_RU && window.I18N_RU[key] !== undefined) return window.I18N_RU[key];
    return undefined;
  }

  function render(v, params) {
    if (v == null) return '';
    if (typeof v === 'object') {
      var branch = params && Number(params.count) === 1 ? 'one' : 'other';
      v = v[branch] !== undefined ? v[branch] : (v.other !== undefined ? v.other : '');
    }
    if (typeof v !== 'string') v = String(v);
    if (!params) return v;
    return v.replace(/\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g, function (m, name) {
      var val = params[name];
      return val === undefined || val === null ? m : String(val);
    });
  }

  // Динамический перевод. Отсутствующий ключ отдаётся как сам ключ — ошибку
  // перевода видно прямо в интерфейсе, а не тихо в консоли.
  function t(key, params) {
    var v = resolve(key);
    if (v === undefined) return String(key);
    return render(v, params);
  }

  function setLang(lang) {
    var next = lang === EN ? EN : 'ru';
    try { localStorage.setItem(KEY, next); } catch (e) {}
    location.reload();
  }

  function toggle() {
    setLang(currentLang() === EN ? 'ru' : EN);
  }

  function _params(el) {
    var raw = el.getAttribute('data-i18n-params');
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  // ── Применение переводов к разметке (data-i18n-атрибуты) ────────────────
  // data-i18n            → textContent
  // data-i18n-title      → title + aria-label (у кнопок строка обычно одна)
  // data-i18n-aria       → только aria-label (когда отличается от title)
  // data-i18n-placeholder→ placeholder
  // data-i18n-tip        → data-tip (подсказка field-tip, читается fieldTip())
  // data-i18n-params     → JSON с параметрами подстановки (для всех выше)
  // Скаперован на root (если передан), иначе на document; в конце, при
  // полном применении, снимает анти-флеш и обновляет #btn-lang.
  function applyI18n(root) {
    var scope = root || document;
    var q = function (sel) { return Array.prototype.slice.call(scope.querySelectorAll(sel)); };

    q('[data-i18n]').forEach(function (el) {
      var v = resolve(el.getAttribute('data-i18n'));
      if (v !== undefined) el.textContent = render(v, _params(el));
    });
    q('[data-i18n-title]').forEach(function (el) {
      var v = resolve(el.getAttribute('data-i18n-title'));
      if (v !== undefined) {
        var s = render(v, _params(el));
        el.setAttribute('title', s);
        el.setAttribute('aria-label', s);
      }
    });
    q('[data-i18n-aria]').forEach(function (el) {
      var v = resolve(el.getAttribute('data-i18n-aria'));
      if (v !== undefined) el.setAttribute('aria-label', render(v, _params(el)));
    });
    q('[data-i18n-placeholder]').forEach(function (el) {
      var v = resolve(el.getAttribute('data-i18n-placeholder'));
      if (v !== undefined) el.setAttribute('placeholder', render(v, _params(el)));
    });
    q('[data-i18n-tip]').forEach(function (el) {
      var v = resolve(el.getAttribute('data-i18n-tip'));
      if (v !== undefined) el.setAttribute('data-tip', render(v, _params(el)));
    });
    // data-i18n-group-name → data-group-name (статическое имя группы меню:
    // читается в рейле/флайауте через dataset.groupName, см. scripts.js).
    q('[data-i18n-group-name]').forEach(function (el) {
      var v = resolve(el.getAttribute('data-i18n-group-name'));
      if (v !== undefined) el.setAttribute('data-group-name', render(v, _params(el)));
    });

    // Полное применение — только когда работает по всему документу.
    if (!root || root === document) {
      document.documentElement.removeAttribute('data-i18n-loading');
      document.documentElement.lang = currentLang();
      _updateLangBtn();
    }
  }

  // Кнопка #btn-lang: показывает язык, на который переключит (глобус + код),
  // в title/aria-label — полная подсказка с хоткеем L.
  function _updateLangBtn() {
    var btn = document.getElementById('btn-lang');
    if (!btn) return;
    var enActive = currentLang() === EN;
    var target = enActive ? { code: 'RU', name: t('lang.name.ru') } : { code: 'EN', name: t('lang.name.en') };
    btn.textContent = target.code;
    var label = t('lang.label', { lang: target.name });
    btn.setAttribute('title', label);
    btn.setAttribute('aria-label', label);
  }

  function init() {
    applyI18n(document);
    var btn = document.getElementById('btn-lang');
    if (btn) btn.addEventListener('click', toggle);

    // Хоткей L — по образцу темы: без модификаторов и не в поле ввода.
    document.addEventListener('keydown', function (e) {
      if (e.code !== 'KeyL' || e.metaKey || e.ctrlKey || e.altKey) return;
      var el = e.target;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      e.preventDefault();
      toggle();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // Публичный API (plain globals, как весь статический фронтенд).
  window.t = t;
  window.applyI18n = applyI18n;
  window.i18nLang = currentLang;
  window.i18nSetLang = setLang;
})();