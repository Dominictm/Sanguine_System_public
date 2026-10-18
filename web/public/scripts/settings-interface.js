// ═══════════════════════════════════════════════════════════════
// Страница «Интерфейс» (Настройки → 🎨): блоки «Язык» и «Дизайн»,
// переехавшие из футера сайдбара (спека interface-settings).
// Сегмент-контрол — клон выбора AI-провайдера: настоящие radio,
// кольцо фокуса на плашке, выбор виден не только цветом.
// ═══════════════════════════════════════════════════════════════

// Подсветка текущей темы (дергается и из scripts.js apply() при смене
// хоткеем T, пока открыта страница).
function initInterfaceThemes(active) {
  const cur = active
    || (typeof window.sanguineCurrentTheme === 'function' ? window.sanguineCurrentTheme() : 'blood');
  document.querySelectorAll('#iface-themes input[name="iface-theme"]').forEach(inp => {
    inp.checked = inp.value === cur;
    inp.closest('.seg-tile')?.setAttribute('aria-checked', String(inp.value === cur));
  });
}

function initInterfaceLang() {
  const cur = typeof window.i18nLang === 'function' ? window.i18nLang() : 'ru';
  document.querySelectorAll('#iface-lang input[name="iface-lang"]').forEach(inp => {
    inp.checked = inp.value === cur;
    inp.closest('.seg-tile')?.setAttribute('aria-checked', String(inp.value === cur));
  });
}

document.getElementById('iface-themes')?.addEventListener('change', e => {
  const inp = e.target.closest?.('input[name="iface-theme"]');
  if (!inp || typeof window.sanguineSelectTheme !== 'function') return;
  window.sanguineSelectTheme(inp.value);
});

document.getElementById('iface-lang')?.addEventListener('change', e => {
  const inp = e.target.closest?.('input[name="iface-lang"]');
  if (!inp || typeof window.i18nSetLang !== 'function') return;
  window.i18nSetLang(inp.value); // с перезагрузкой, как было у #btn-lang
});

initInterfaceThemes();
initInterfaceLang();
