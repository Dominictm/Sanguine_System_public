'use strict';
// Мини-плеер музыки (music-player.js) — плавающая кнопка 🎵 рядом с кубиком 🎲,
// открывающая панель управления музыкой с любой страницы SPA.
//
// Спека: doc/design/archive/2026-10-11-floating-music-player-analysis.md
//
// Архитектура (решение Системного аналитика): <audio>-элементы НЕ перемещаются
// из карточек .audio-card (это сломало бы делегирование audio-library.js на
// .audio-lib-columns) — в #persistent-audio создаются КЛОНЫ. Клоны живут вне
// .page-секций и переживают navigate(), поэтому музыка не прерывается.
//
// Источник истины — audio-library.js: он диспатчит события
// audio:track-play / audio:preset-play / audio:stop-all / audio:volume-change,
// плеер на них подписан. Обратной связи (плеер → библиотека) нет намеренно:
// библиотека остаётся источником правды о том, что играет.

// ═══════════════════════════════════════════════════════════════
// Персистентные клоны аудио
// ═══════════════════════════════════════════════════════════════

const _mpAudios = new Map();   // trackId → HTMLAudioElement (клон в #persistent-audio)
let _mpHost = null;            // #persistent-audio (ленивая инициализация)

function _mpHostEl() {
  if (!_mpHost) _mpHost = document.getElementById('persistent-audio');
  return _mpHost;
}

// Клон для трека: создаётся один раз, дальше переиспользуется. src/loop/volume
// копируются из оригинала карточки (data-* на элементе) либо из _audioLibCache.
function _mpEnsureAudio(track) {
  const host = _mpHostEl();
  if (!host || !track) return null;
  let audioEl = _mpAudios.get(track.id);
  if (!audioEl) {
    audioEl = document.createElement('audio');
    audioEl.dataset.mpTrackId = track.id;
    audioEl.preload = 'none';
    host.appendChild(audioEl);
    _mpAudios.set(track.id, audioEl);
  }
  const url = track.url || _mpTrackUrl(track);
  if (url && audioEl.src !== new URL(url, location.href).href) audioEl.src = url;
  audioEl.loop = track.loop !== false;
  return audioEl;
}

function _mpTrackUrl(track) {
  return `/audio-lib/${track.filename || track.id}`;
}

function _mpTrackById(id) {
  if (!id) return null;
  return (_audioLibCache || []).find(t => t.id === id) || null;
}

// Все треки категории music — очередь для next/prev (решение В1).
function _mpMusicQueue() {
  return (_audioLibCache || []).filter(t => t.category === 'music');
}

// ═══════════════════════════════════════════════════════════════
// Состояние плеера
// ═══════════════════════════════════════════════════════════════

// { mode: 'empty'|'playing'|'preset', presetId, presetName, trackIds, trackId, paused }
let _mpState = { mode: 'empty', presetId: null, presetName: null, trackIds: [], trackId: null, paused: false };

let _mpEls = null;

function _mpBind() {
  if (_mpEls) return _mpEls;
  _mpEls = {
    fab:      document.getElementById('music-fab'),
    panel:    document.getElementById('music-panel'),
    close:    document.getElementById('music-close'),
    empty:    document.querySelector('#music-panel .music-state-empty'),
    playing:  document.querySelector('#music-panel .music-state-playing'),
    preset:   document.querySelector('#music-panel .music-state-preset'),
    title:    document.querySelector('#music-panel .music-track-title'),
    meta:     document.querySelector('#music-panel .music-track-meta'),
    playBtns: document.querySelectorAll('#music-panel [data-action="play-pause"]'),
    prevBtns: document.querySelectorAll('#music-panel [data-action="prev"]'),
    nextBtns: document.querySelectorAll('#music-panel [data-action="next"]'),
    stopBtns: document.querySelectorAll('#music-panel [data-action="stop"]'),
    volumes:  document.querySelectorAll('#music-panel [data-action="volume"]'),
    presetList:   document.querySelector('#music-panel .music-preset-list'),
    presetName:   document.querySelector('#music-panel .music-preset-name'),
    presetCur:    document.querySelector('#music-panel .music-preset-current'),
  };
  return _mpEls;
}

// ═══════════════════════════════════════════════════════════════
// Рендер панели
// ═══════════════════════════════════════════════════════════════

function _mpRender() {
  const el = _mpBind();
  if (!el.panel) return;
  const { mode, trackId, trackIds, presetName, paused } = _mpState;

  el.panel.dataset.state = mode;
  if (el.empty)   el.empty.hidden   = mode !== 'empty';
  if (el.playing) el.playing.hidden = mode !== 'playing';
  if (el.preset)  el.preset.hidden  = mode !== 'preset';

  const track = _mpTrackById(trackId);
  if (mode !== 'empty' && track) {
    if (el.title) el.title.textContent = track.title || track.id;
    const inPreset = mode === 'preset';
    if (el.meta) {
      el.meta.textContent = (presetName && inPreset ? presetName + ' · ' : '') +
        t(paused ? 'music.paused' : 'music.playing');
    }
    const audioEl = _mpAudios.get(trackId);
    if (audioEl) {
      el.volumes.forEach(s => { if (document.activeElement !== s) s.value = String(audioEl.volume); });
    }
  }

  const playGlyph = paused ? '▶' : '⏸';
  el.playBtns.forEach(b => {
    b.textContent = playGlyph;
    b.setAttribute('aria-pressed', String(!paused));
    b.setAttribute('aria-label', t(paused ? 'music.play' : 'music.pause'));
  });

  if (mode === 'preset' && el.presetList) {
    el.presetList.innerHTML = trackIds.map(id => {
      const tr = _mpTrackById(id);
      const active = id === trackId;
      return `<div class="music-preset-item${active ? ' active' : ''}" role="option" aria-selected="${active}" data-action="play-track" data-track-id="${escAttr(id)}" tabindex="0">${
        active && !paused ? '<span class="music-preset-item-playing" aria-hidden="true">♪</span>' : '<span class="music-preset-item-dot" aria-hidden="true">•</span>'
      }<span class="music-preset-item-title">${escHtml(tr ? (tr.title || tr.id) : id)}</span></div>`;
    }).join('');
    if (el.presetName && presetName) el.presetName.textContent = presetName;
    if (el.presetCur && track) el.presetCur.textContent = track.title || track.id;
  }
}

// ═══════════════════════════════════════════════════════════════
// Действия
// ═══════════════════════════════════════════════════════════════

async function _mpPlay(trackId, opts = {}) {
  const track = _mpTrackById(trackId);
  if (!track) return;
  const audioEl = _mpEnsureAudio(track);
  if (!audioEl) return;
  audioEl.volume = typeof opts.volume === 'number' ? opts.volume : audioEl.volume;
  _mpState.trackId = trackId;
  _mpState.paused = false;
  try {
    await audioEl.play();
  } catch (e) {
    showToast(t('music.playError') + e.message, 'error');
    _mpState.paused = true;
  }
  _mpRender();
}

function _mpStop({ keepState = false } = {}) {
  _mpAudios.forEach(a => { a.pause(); a.currentTime = 0; });
  if (!keepState) _mpState = { mode: 'empty', presetId: null, presetName: null, trackIds: [], trackId: null, paused: false };
  _mpRender();
}

// Очередь для next/prev: треки активного пресета, иначе все music-треки.
function _mpQueue() {
  if (_mpState.mode === 'preset' && _mpState.trackIds.length) return _mpState.trackIds;
  return _mpMusicQueue().map(t => t.id);
}

function _mpStep(delta) {
  const queue = _mpQueue();
  if (!queue.length) return;
  const i = queue.indexOf(_mpState.trackId);
  const next = queue[((i < 0 ? 0 : i + delta) % queue.length + queue.length) % queue.length];
  _mpPlay(next);
}

function _mpToggle() {
  const audioEl = _mpAudios.get(_mpState.trackId);
  if (!audioEl) {
    const q = _mpQueue();
    if (q.length) _mpPlay(q[0]);
    return;
  }
  if (audioEl.paused) {
    audioEl.play().then(() => { _mpState.paused = false; _mpRender(); })
                  .catch(e => showToast(t('music.playError') + e.message, 'error'));
  } else {
    audioEl.pause();
    _mpState.paused = true;
    _mpRender();
  }
}

// ═══════════════════════════════════════════════════════════════
// Открытие/закрытие панели + focus trap
// ═══════════════════════════════════════════════════════════════

function _mpOpen() {
  const el = _mpBind();
  el.panel.hidden = false;
  el.fab.setAttribute('aria-expanded', 'true');
  _mpRender();
  const first = el.panel.querySelector('#music-panel .music-state:not([hidden]) button, #music-panel input');
  if (first) first.focus();
}

function _mpClose() {
  const el = _mpBind();
  el.panel.hidden = true;
  el.fab.setAttribute('aria-expanded', 'false');
  el.fab.focus();
}

function _mpTrapTab(e) {
  const el = _mpBind();
  if (e.key !== 'Tab' || el.panel.hidden) return;
  const nodes = [...el.panel.querySelectorAll('button, input, [tabindex]:not([tabindex="-1"])')]
    .filter(n => !n.disabled && n.offsetParent !== null);
  if (!nodes.length) return;
  const first = nodes[0], last = nodes[nodes.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

// ═══════════════════════════════════════════════════════════════
// Инициализация
// ═══════════════════════════════════════════════════════════════

if (typeof document !== 'undefined' && document.getElementById('music-fab')) {
  const el = _mpBind();

  el.fab.addEventListener('click', () => (el.panel.hidden ? _mpOpen() : _mpClose()));
  el.close.addEventListener('click', _mpClose);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !el.panel.hidden) { _mpClose(); return; }
    _mpTrapTab(e);
  });

  // Клик вне панели и вне FAB — закрыть.
  document.addEventListener('pointerdown', e => {
    if (el.panel.hidden) return;
    if (el.panel.contains(e.target) || el.fab.contains(e.target)) return;
    el.panel.hidden = true;
    el.fab.setAttribute('aria-expanded', 'false');
  });

  // Делегирование кликов внутри панели.
  el.panel.addEventListener('click', e => {
    const item = e.target.closest('[data-action="play-track"]');
    if (item) { _mpPlay(item.dataset.trackId); return; }
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    switch (btn.dataset.action) {
      case 'play-pause': _mpToggle(); break;
      case 'stop':       _mpStop(); break;
      case 'next':       _mpStep(1); break;
      case 'prev':       _mpStep(-1); break;
      case 'open-library':
        _mpClose();
        if (typeof navigate === 'function') navigate('audio-library');
        break;
    }
  });

  // Enter/Space на элементе списка пресета (role=option, tabindex=0).
  el.panel.addEventListener('keydown', e => {
    const item = e.target.closest('[data-action="play-track"]');
    if (item && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); _mpPlay(item.dataset.trackId); }
  });

  // Громкость текущего трека (решение В3 — на трек).
  el.panel.addEventListener('input', e => {
    const slider = e.target.closest('[data-action="volume"]');
    if (!slider) return;
    const audioEl = _mpAudios.get(_mpState.trackId);
    if (audioEl) audioEl.volume = parseFloat(slider.value);
  });

  // ── Подписка на события audio-library.js ──

  // Одиночный трек запущен в библиотеке (в т.ч. вручную на странице «Звуки»).
  window.addEventListener('audio:track-play', e => {
    const { trackId, volume, loop } = e.detail || {};
    if (!trackId) return;
    const track = _mpTrackById(trackId);
    if (!track || track.category !== 'music') return; // эффекты — не наша забота
    const audioEl = _mpEnsureAudio(track);
    if (audioEl) {
      if (typeof volume === 'number') audioEl.volume = volume;
      if (typeof loop === 'boolean') audioEl.loop = loop;
    }
    _mpState = { mode: 'playing', presetId: null, presetName: null, trackIds: [], trackId, paused: false };
    _mpRender();
  });

  // Пресет запущен — показываем список его треков, клонируем и играем.
  window.addEventListener('audio:preset-play', e => {
    const { presetId, presetName, tracks } = e.detail || {};
    if (!tracks || !tracks.length) return;
    _mpStop({ keepState: true });
    const ids = [];
    for (const ct of tracks) {
      const track = _mpTrackById(ct.trackId);
      if (!track || track.category !== 'music') continue;
      const audioEl = _mpEnsureAudio(track);
      if (!audioEl) continue;
      audioEl.volume = typeof ct.volume === 'number' ? ct.volume : track.volume;
      audioEl.loop = ct.loop !== false;
      ids.push(track.id);
    }
    if (!ids.length) { _mpState.mode = 'empty'; _mpRender(); return; }
    _mpState = { mode: 'preset', presetId, presetName: presetName || '', trackIds: ids, trackId: ids[0], paused: false };
    _mpPlay(ids[0]);
    _mpRender();
  });

  // Стоп из библиотеки — глушим наши клоны и сбрасываем панель в empty.
  window.addEventListener('audio:stop-all', () => _mpStop());

  // Громкость изменена в библиотеке — синхронизируем клон.
  window.addEventListener('audio:volume-change', e => {
    const { trackId, volume } = e.detail || {};
    if (!trackId || typeof volume !== 'number') return;
    const audioEl = _mpAudios.get(trackId);
    if (audioEl) audioEl.volume = volume;
    if (trackId === _mpState.trackId) _mpRender();
  });

  // Трек удалён из библиотеки — убираем клон.
  window.addEventListener('audio:track-deleted', e => {
    const { trackId } = e.detail || {};
    const audioEl = _mpAudios.get(trackId);
    if (!audioEl) return;
    audioEl.pause();
    audioEl.remove();
    _mpAudios.delete(trackId);
    if (_mpState.trackId === trackId) _mpStop();
  });

  _mpRender();
}