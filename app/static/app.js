'use strict';

// ── Constants ─────────────────────────────────────────────────────────────────

const LANG = {
  spanish:  { code: 'ES', cls: 'pill-es', native: false },
  norsk:    { code: 'NO', cls: 'pill-no', native: false },
  japanese: { code: 'JA', cls: 'pill-ja', native: true  },
  mandarin: { code: 'ZH', cls: 'pill-zh', native: true  },
  french:   { code: 'FR', cls: 'pill-fr', native: false },
  german:   { code: 'DE', cls: 'pill-de', native: false },
};

const DIR_LABELS = {
  '1_only':        'Word → Meaning',
  '2_only':        'Meaning → Word',
  '1_and_2':       'Both (1 & 2)',
  '3_only':        'Characters → Meaning',
  '4_only':        'Characters → Reading',
  'all_available': 'All directions',
  'random':        'Random',
};

const BIG_COUNT_OPTIONS = [10, 20, 50, 100];

const LANG_BCP47 = {
  spanish:  'es-ES',
  french:   'fr-FR',
  german:   'de-DE',
  norsk:    'nb-NO',
  japanese: 'ja-JP',
  mandarin: 'zh-CN',
};

const ACT_COLORS = {
  watching:  '#4361EE',
  listening: '#F4A261',
  reading:   '#22c55e',
  speaking:  '#E63946',
  writing:   '#7C3AED',
  gaming:    '#2A9D8F',
  other:     '#6B6B6B',
};

// ── State ─────────────────────────────────────────────────────────────────────

const App = {
  token:          sessionStorage.getItem('token'),
  hiddenLanguages: new Set(),
  decks:          [],
  quiz: {
    sessionId:  null,
    mode:       null,
    scope:      null,
    direction:  null,
    total:      0,
    answered:   0,
    correct:    0,
    question:   null,
    answers:    [],
    hintRevealed: [],
    hintPresses:  0,
  },
  browse:       { deck: null, page: 1, cards: [] },
  importFile:   null,
  lastUsedDeck: JSON.parse(sessionStorage.getItem('lastUsedDeck') || 'null'),
  ankiData:     null,   // { noteTypes: [...], selectedNtIdx: 0 } set when .apkg loaded

  // Test setup selections
  testMode:      'mcq',
  testDirection: '1_and_2',
  bigTestMode:      'mcq',
  bigTestCount:     20,
  totalRecallLangs: new Set(),
};

// ── API ───────────────────────────────────────────────────────────────────────

const _NETWORK_ERR = { ok: false, json: async () => ({ detail: null }) };

async function api(method, path, body = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (App.token) headers['Authorization'] = `Bearer ${App.token}`;
  const opts = { method, headers };
  if (body !== null) opts.body = JSON.stringify(body);
  try {
    const res = await fetch(path, opts);
    if (res.status === 401) { logout(); return null; }
    return res;
  } catch (_) { return _NETWORK_ERR; }
}

async function apiUpload(path, formData) {
  const headers = App.token ? { 'Authorization': `Bearer ${App.token}` } : {};
  try {
    const res = await fetch(path, { method: 'POST', headers, body: formData });
    if (res.status === 401) { logout(); return null; }
    return res;
  } catch (_) { return _NETWORK_ERR; }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

const _ERROR_MAP = {
  'No active cards available for this session':
    'This deck has no active cards to quiz. Import more vocabulary first.',
  'Deck has no active cards':
    'This deck has no active cards. Import more vocabulary first.',
  'deck_id is required for test scope':
    'Please select a deck before starting.',
  'Deck not found':
    'That deck no longer exists. Go back to Home and try again.',
  'Card not found':
    'That card no longer exists.',
  'Card already exists':
    'This card is already in the deck.',
  'Session not found':
    'This quiz session has expired. Please start a new quiz.',
  'Session already completed':
    'This quiz has already ended.',
  'Invalid credentials':
    'Incorrect username or password. Please try again.',
  'User not found':
    'Your account was not found. Please log in again.',
  'Only .csv and .tsv files are supported':
    'Only CSV (.csv) and TSV (.tsv) files are supported.',
};

const _NETWORK_MSG = "Couldn't reach the server. Check your connection and try again.";

function friendlyError(detail) {
  if (!detail) return _NETWORK_MSG;
  return _ERROR_MAP[detail] || detail;
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function titleCase(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : str;
}

async function speak(text, language) {
  if (!text) return;
  try {
    const res = await api('GET', `/api/tts?text=${encodeURIComponent(text)}&language=${encodeURIComponent(language || '')}`);
    if (res?.ok) {
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      if (window._ttsAudio) {
        window._ttsAudio.pause();
        URL.revokeObjectURL(window._ttsAudio._blobUrl);
      }
      const audio = new Audio(url);
      audio._blobUrl = url;
      window._ttsAudio = audio;
      audio.play();
      audio.onended = () => URL.revokeObjectURL(url);
      return;
    }
  } catch (_) { /* fall through to browser TTS */ }
  // Fallback: browser Web Speech API
  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = LANG_BCP47[language?.toLowerCase()] || 'en-US';
    window.speechSynthesis.speak(utt);
  }
}

// ── Daily goal ─────────────────────────────────────────────────────────────────

function _renderDailyGoal(goal, done) {
  const pct     = Math.min(100, Math.round((done / goal) * 100));
  const reached = done >= goal;
  document.getElementById('daily-goal-label').textContent =
    reached ? `Goal reached! ${done} cards today` : `Today: ${done} / ${goal} cards`;
  const bar = document.getElementById('daily-goal-bar');
  bar.style.width = `${pct}%`;
  bar.classList.toggle('goal-reached', reached);
  document.getElementById('home-daily-goal').classList.remove('hidden');
}

async function _fetchAndRenderDailyGoal() {
  const res = await api('GET', '/api/settings/daily-goal');
  if (!res?.ok) return;
  const data = await res.json();
  const wasReached = data.today_count - 1 < data.goal && data.today_count >= data.goal;
  _renderDailyGoal(data.goal, data.today_count);
  if (wasReached && Notification.permission === 'granted') {
    sendPushNotification('Goal reached! 🎉', `You studied ${data.today_count} cards today.`);
  }
}

document.getElementById('btn-set-goal').addEventListener('click', async () => {
  const res = await api('GET', '/api/settings/daily-goal');
  const current = res?.ok ? (await res.json()).goal : 20;
  const inp = document.getElementById('goal-modal-input');
  inp.value = String(current);
  document.getElementById('goal-modal-overlay').classList.remove('hidden');
  setTimeout(() => { inp.select(); }, 50);
});

document.getElementById('words-modal-close').addEventListener('click', () => {
  document.getElementById('words-modal-overlay').classList.add('hidden');
});

document.getElementById('goal-modal-cancel').addEventListener('click', () => {
  document.getElementById('goal-modal-overlay').classList.add('hidden');
});

document.getElementById('goal-modal-confirm').addEventListener('click', async () => {
  const val = parseInt(document.getElementById('goal-modal-input').value, 10);
  if (!val || val < 1 || val > 500) {
    await showAlert('Enter a number between 1 and 500.');
    return;
  }
  document.getElementById('goal-modal-overlay').classList.add('hidden');
  const res = await api('PUT', '/api/settings/daily-goal', { goal: val });
  if (res?.ok) await _fetchAndRenderDailyGoal();
});

document.getElementById('goal-modal-input').addEventListener('keydown', e => {
  if (e.key === 'Enter')  document.getElementById('goal-modal-confirm').click();
  if (e.key === 'Escape') document.getElementById('goal-modal-overlay').classList.add('hidden');
});

function showAlert(message, confirmText = 'OK') {
  return new Promise(resolve => {
    document.getElementById('modal-message').textContent = message;
    document.getElementById('modal-cancel').classList.add('hidden');
    const btn = document.getElementById('modal-confirm');
    btn.textContent = confirmText;
    btn.className = 'btn-primary';
    document.getElementById('modal-overlay').classList.remove('hidden');
    const handler = () => {
      document.getElementById('modal-overlay').classList.add('hidden');
      btn.removeEventListener('click', handler);
      resolve();
    };
    btn.addEventListener('click', handler);
  });
}

function showConfirm(message, confirmText = 'Confirm', danger = false) {
  return new Promise(resolve => {
    document.getElementById('modal-message').textContent = message;
    const cancel  = document.getElementById('modal-cancel');
    const confirm = document.getElementById('modal-confirm');
    cancel.classList.remove('hidden');
    confirm.textContent = confirmText;
    confirm.className = danger ? 'btn-danger' : 'btn-primary';
    document.getElementById('modal-overlay').classList.remove('hidden');
    const yes = () => { close(); resolve(true); };
    const no  = () => { close(); resolve(false); };
    function close() {
      document.getElementById('modal-overlay').classList.add('hidden');
      confirm.removeEventListener('click', yes);
      cancel.removeEventListener('click', no);
    }
    confirm.addEventListener('click', yes);
    cancel.addEventListener('click', no);
  });
}

function playSound(correct) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const pairs = correct ? [[523, 0], [659, 0.13]] : [[280, 0]];
    pairs.forEach(([freq, offset]) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = correct ? 'sine' : 'sawtooth';
      osc.frequency.value = freq;
      const t = ctx.currentTime + offset;
      gain.gain.setValueAtTime(0.22, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
      osc.start(t);
      osc.stop(t + 0.28);
    });
  } catch (_) {}
}

let _countdownTimeout = null;

function startCountdown(callback) {
  clearCountdown();
  const bar = document.getElementById('countdown-bar');
  bar.classList.remove('hidden');
  bar.style.transition = 'none';
  bar.style.width = '100%';
  requestAnimationFrame(() => requestAnimationFrame(() => {
    bar.style.transition = 'width 3s linear';
    bar.style.width = '0%';
  }));
  _countdownTimeout = setTimeout(() => { clearCountdown(); callback(); }, 3000);
}

function clearCountdown() {
  if (_countdownTimeout) { clearTimeout(_countdownTimeout); _countdownTimeout = null; }
  const bar = document.getElementById('countdown-bar');
  if (bar) { bar.classList.add('hidden'); bar.style.transition = 'none'; bar.style.width = '100%'; }
}


function setLoading(btn, loading) {
  if (loading) {
    btn.disabled = true;
    btn.classList.add('btn-loading');
  } else {
    btn.disabled = false;
    btn.classList.remove('btn-loading');
  }
}

function _deckSkeletonHtml() {
  const card = `
    <div class="card topic-card" style="display:flex;flex-direction:column;gap:.6rem;padding:1.1rem">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div class="skeleton sk-h-md sk-w-half"></div>
        <div class="skeleton sk-h-sm sk-w-qtr"></div>
      </div>
      <div style="display:flex;gap:.4rem">
        <div class="skeleton sk-h-sm" style="width:60px;border-radius:6px"></div>
        <div class="skeleton sk-h-sm" style="width:60px;border-radius:6px"></div>
      </div>
    </div>`;
  return `
    <div class="lang-group">
      <div class="lang-group-header" style="gap:.5rem">
        <div class="skeleton sk-h-md" style="width:32px;border-radius:4px"></div>
        <div class="skeleton sk-h-md sk-w-qtr"></div>
      </div>
      <div class="topic-grid">${card}${card}${card}</div>
    </div>`;
}

function _progressSkeletonHtml() {
  const row = `
    <tr>
      ${[32, 80, 40, 35, 90].map(w =>
        `<td><div class="skeleton sk-h-sm" style="width:${w}px"></div></td>`
      ).join('')}
    </tr>`;
  return `<div class="card" style="padding:1.25rem;margin-bottom:1.5rem">
    <div class="skeleton sk-h-lg sk-w-qtr" style="margin-bottom:.75rem"></div>
    <div class="skeleton sk-h-sm sk-w-full"></div>
  </div>
  <div class="table-wrap"><table class="data-table">
    <thead><tr><th>Language</th><th>Word</th><th>Seen</th><th>Rate</th><th>Struggles with</th></tr></thead>
    <tbody>${row.repeat(5)}</tbody>
  </table></div>`;
}

function parseImportPreview(file) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => {
      const raw       = e.target.result.replace(/^﻿/, '');          // strip BOM
      const istsv     = file.name.toLowerCase().endsWith('.tsv');
      const delim     = istsv ? '\t' : ',';
      const lines     = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n')  // normalise endings
                            .split('\n')
                            .filter(l => l.trim() && !l.startsWith('#'));

      if (!lines.length) { resolve({ error: 'File is empty or contains only comments.' }); return; }

      function splitRow(line) {
        const parts = line.split(delim).map(s => s.replace(/^"|"$/g, '').trim());
        if (parts.length === 1 && line.includes(delim)) {
          // outer-quoted row: re-split field value
          return parts[0].split(delim).map(s => s.trim());
        }
        return parts;
      }

      const headerParts = splitRow(lines[0]).map(s => s.toLowerCase());
      const hasValidHeader = headerParts[0] === 'word' && headerParts[1] === 'meaning';

      const dataLines  = lines.slice(1);
      const totalRows  = dataLines.filter(l => {
        const p = splitRow(l);
        return p[0] && p[1];
      }).length;

      const previewRows = dataLines.slice(0, 3).map(l => {
        const p = splitRow(l);
        return { word: p[0] || '', meaning: p[1] || '', native: p[2] || '' };
      });

      let warning = null;
      if (!hasValidHeader) {
        warning = `Header row looks wrong (found "${headerParts.slice(0,2).join('", "')}" — expected "word", "meaning"). The file may still import but check the format.`;
      } else if (totalRows === 0) {
        warning = 'No data rows detected after the header. Check the file content.';
      }

      resolve({ format: istsv ? 'TSV' : 'CSV', totalRows, hasValidHeader, previewRows, warning });
    };
    reader.onerror = () => resolve({ error: 'Could not read the file.' });
    reader.readAsText(file);
  });
}

function _detectLanguage(previewRows) {
  const words   = previewRows.slice(0, 10).map(r => r.word   || '').join(' ');
  const natives = previewRows.slice(0, 10).map(r => r.native || '').join(' ');
  if (/[一-鿿㐀-䶿]/.test(words))   return 'mandarin';  // CJK in word col
  if (/[぀-ヿ]/.test(natives))               return 'japanese';  // kana in native
  if (/ñ/.test(words))                               return 'spanish';
  if (/[ßäöü]/i.test(words))                        return 'german';
  if (/[øåæ]/i.test(words))                         return 'norsk';
  if (/[çèêœéàâôûî]/i.test(words))                 return 'french';
  return null;
}

function _langWarning(previewRows, selectedLang) {
  if (!selectedLang) return null;
  const detected = _detectLanguage(previewRows);
  if (detected && detected !== selectedLang.toLowerCase()) {
    const name = detected.charAt(0).toUpperCase() + detected.slice(1);
    return `This file looks like ${name} vocabulary but you selected ${selectedLang}. Double-check the language before importing.`;
  }
  return null;
}

function stripDiacritics(str) {
  return str.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

function langConfig(language) {
  return LANG[language.toLowerCase()] || { code: language.slice(0, 2).toUpperCase(), cls: 'pill-xx', native: false };
}

function langPillHtml(language) {
  const cfg = langConfig(language);
  return `<span class="lang-pill ${cfg.cls}">${cfg.code}</span>`;
}

function hasNativeScript(language) {
  return langConfig(language).native;
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────────

function _activeScreen() {
  const screens = [
    'screen-login', 'screen-home', 'screen-test-setup', 'screen-big-test-setup',
    'screen-quiz', 'screen-results', 'screen-browse', 'screen-import', 'screen-progress',
  ];
  return screens.find(id => !document.getElementById(id).classList.contains('hidden')) || '';
}

function _isTyping() {
  const a = document.activeElement;
  return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT');
}

document.addEventListener('keydown', e => {
  const modal = document.getElementById('modal-overlay');

  // ── Modal takes highest priority ─────────────────────────────────────────────
  if (!modal.classList.contains('hidden')) {
    if (e.key === 'Enter')  { e.preventDefault(); document.getElementById('modal-confirm').click(); }
    if (e.key === 'Escape') { e.preventDefault(); document.getElementById('modal-cancel').click(); }
    return;
  }

  const screen = _activeScreen();

  // ── Quiz screen ───────────────────────────────────────────────────────────────
  if (screen === 'screen-quiz') {
    const feedbackVisible = !document.getElementById('quiz-feedback').classList.contains('hidden');

    if (feedbackVisible) {
      if (e.key === 'Enter' && !_isTyping()) {
        e.preventDefault(); clearCountdown(); document.getElementById('btn-next').click();
      }
      return;
    }

    if (!_isTyping()) {
      // Flashcard shortcuts
      const fcSection = document.getElementById('quiz-flashcard');
      if (!fcSection.classList.contains('hidden')) {
        const revealBtn = document.getElementById('btn-reveal');
        const gradeEl   = document.getElementById('flashcard-grade');
        if (!revealBtn.classList.contains('hidden') && (e.key === ' ' || e.key === 'Enter')) {
          e.preventDefault(); revealFlashcard(); return;
        }
        if (!gradeEl.classList.contains('hidden')) {
          const gradeKeys = { '1': 'again', '2': 'hard', '3': 'good', '4': 'easy' };
          if (gradeKeys[e.key]) {
            e.preventDefault();
            gradeEl.querySelector(`[data-val="${gradeKeys[e.key]}"]`)?.click();
            return;
          }
        }
      }

      // 1–4: MCQ
      const mcqGrid = document.getElementById('quiz-mcq');
      if (!mcqGrid.classList.contains('hidden') && ['1','2','3','4'].includes(e.key)) {
        e.preventDefault();
        const btns = [...mcqGrid.querySelectorAll('.mcq-btn:not(:disabled)')];
        btns[parseInt(e.key) - 1]?.click();
        return;
      }

      // H: Hint
      if (e.key === 'h' || e.key === 'H') {
        const hintRow = document.getElementById('quiz-hint-row');
        const btnHint = document.getElementById('btn-hint');
        if (!hintRow.classList.contains('hidden') && !btnHint.disabled) {
          e.preventDefault(); btnHint.click(); return;
        }
      }
    }

    // Esc: End quiz
    if (e.key === 'Escape') {
      e.preventDefault(); document.getElementById('btn-quiz-exit').click(); return;
    }
  }

  // ── Browse screen ─────────────────────────────────────────────────────────────
  if (screen === 'screen-browse') {
    if (e.key === '/' && !_isTyping()) {
      e.preventDefault(); document.getElementById('inp-search').focus(); return;
    }
    if (e.key === 'Escape' && _isTyping()) {
      const inp = document.getElementById('inp-search');
      inp.value = ''; inp.blur();
      inp.dispatchEvent(new Event('input')); return;
    }
  }

  // ── General Escape → Back ─────────────────────────────────────────────────────
  if (e.key === 'Escape') {
    const backMap = {
      'screen-test-setup':      'btn-test-back',
      'screen-big-test-setup':  'btn-big-test-back',
      'screen-browse':          'btn-browse-back',
      'screen-import':          'btn-import-back',
      'screen-journal':         'btn-journal-back',
      'screen-essay':           'btn-essay-back',
      'screen-progress':        'btn-progress-back',
    };
    const backBtn = backMap[screen];
    if (backBtn) { e.preventDefault(); document.getElementById(backBtn).click(); }
  }
});

// ── Shortcuts tooltip toggle ──────────────────────────────────────────────────
document.getElementById('btn-shortcuts').addEventListener('click', e => {
  e.stopPropagation();
  document.getElementById('shortcuts-tooltip').classList.toggle('hidden');
});

document.addEventListener('click', e => {
  if (!e.target.closest('#shortcuts-wrap') && !e.target.closest('#shortcuts-tooltip') && !e.target.closest('#btn-shortcuts')) {
    document.getElementById('shortcuts-tooltip').classList.add('hidden');
  }
});

// ── Navigation ────────────────────────────────────────────────────────────────

function showScreen(id) {
  document.querySelectorAll('#main > section').forEach(s => s.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
  const isLogin = id === 'screen-login';
  document.getElementById('nav').classList.toggle('hidden', isLogin);
}

function _jwtUsername(token) {
  try { return JSON.parse(atob(token.split('.')[1])).username || ''; }
  catch { return ''; }
}

function _applyDemoBadge(token) {
  const badge = document.getElementById('nav-demo-badge');
  if (!badge) return;
  const isDemo = _jwtUsername(token).toLowerCase() === 'demo';
  badge.classList.toggle('hidden', !isDemo);
}

function logout() {
  sessionStorage.removeItem('token');
  App.token = null;
  document.getElementById('nav-demo-badge')?.classList.add('hidden');
  showScreen('screen-login');
}

// ── Theme ─────────────────────────────────────────────────────────────────────

function initTheme() {
  const saved = localStorage.getItem('lexio-theme');
  const pref  = saved || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', pref);
  document.getElementById('btn-theme').textContent = pref === 'dark' ? '☀' : '☽';
}

document.getElementById('btn-theme').addEventListener('click', () => {
  const cur  = document.documentElement.getAttribute('data-theme');
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('lexio-theme', next);
  document.getElementById('btn-theme').textContent = next === 'dark' ? '☀' : '☽';
});

// ── PWA / Push notifications ──────────────────────────────────────────────────

let _swRegistration = null;
let _pushSubscription = null;

async function initPWA() {
  if (!('serviceWorker' in navigator)) return;
  try {
    _swRegistration = await navigator.serviceWorker.register('/sw.js');
  } catch (_) { return; }

  // Only show the bell if push is supported and not already granted/denied
  if (!('PushManager' in window)) return;
  if (Notification.permission === 'denied') return;

  const btn = document.getElementById('btn-notif');
  if (Notification.permission === 'granted') {
    await _syncPushSubscription();
    btn.title = 'Notifications on';
    btn.style.opacity = '1';
  } else {
    btn.classList.remove('hidden');
  }
}

async function _syncPushSubscription() {
  if (!_swRegistration) return;
  const keyRes = await api('GET', '/api/push/vapid-public-key');
  if (!keyRes?.ok) return;
  const { public_key } = await keyRes.json();

  const sub = await _swRegistration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: _urlBase64ToUint8Array(public_key),
  });
  _pushSubscription = sub;

  const j = sub.toJSON();
  await api('POST', '/api/push/subscribe', {
    endpoint: j.endpoint,
    p256dh:   j.keys.p256dh,
    auth:     j.keys.auth,
  });
}

function _urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw     = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

async function sendPushNotification(title, body, url = '/') {
  await api('POST', '/api/push/notify', { title, body, url });
}

document.getElementById('btn-notif').addEventListener('click', async () => {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return;
  await _syncPushSubscription();
  const btn = document.getElementById('btn-notif');
  btn.title   = 'Notifications on';
  btn.style.opacity = '1';
  await showAlert('Notifications enabled! You\'ll be notified when you hit your daily goal.');
});

// ── Login ─────────────────────────────────────────────────────────────────────

document.getElementById('form-login').addEventListener('submit', async e => {
  e.preventDefault();
  const username = document.getElementById('inp-username').value.trim();
  const password = document.getElementById('inp-password').value;
  const errEl    = document.getElementById('login-err');
  const btn      = e.target.querySelector('[type="submit"]');

  setLoading(btn, true);
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });

  if (res.ok) {
    App.token = (await res.json()).access_token;
    sessionStorage.setItem('token', App.token);
    _applyDemoBadge(App.token);
    errEl.classList.add('hidden');
    initPWA();
    showHome();
  } else {
    const err = await res.json().catch(() => ({}));
    errEl.textContent = friendlyError(err?.detail);
    errEl.classList.remove('hidden');
    setLoading(btn, false);
  }
});

document.getElementById('btn-logout').addEventListener('click', async () => {
  if (await showConfirm('Log out?', 'Log out')) logout();
});

document.getElementById('btn-demo').addEventListener('click', async () => {
  const btn   = document.getElementById('btn-demo');
  const errEl = document.getElementById('login-err');
  errEl.classList.add('hidden');
  setLoading(btn, true);
  const res = await api('POST', '/api/auth/demo');
  setLoading(btn, false);
  if (!res?.ok) {
    const e = await res?.json().catch(() => ({}));
    errEl.textContent = friendlyError(e?.detail);
    errEl.classList.remove('hidden');
    return;
  }
  App.token = (await res.json()).access_token;
  sessionStorage.setItem('token', App.token);
  _applyDemoBadge(App.token);
  showHome();
});

// ── Home ──────────────────────────────────────────────────────────────────────

function _miniCalHtml(studiedDates) {
  const studied = new Set(studiedDates);
  const today   = new Date();
  return '<div class="mini-cal">' +
    Array.from({ length: 7 }, (_, i) => {
      const d   = new Date(today);
      d.setDate(d.getDate() - (6 - i));
      const iso = d.toISOString().split('T')[0];
      const cls = ['mini-sq', studied.has(iso) ? 'studied' : '', i === 6 ? 'today' : ''].filter(Boolean).join(' ');
      return `<div class="${cls}" title="${iso}"></div>`;
    }).join('') + '</div>';
}

async function _loadHiddenLanguages() {
  const res = await api('GET', '/api/settings/hidden-languages');
  if (res?.ok) {
    const { hidden } = await res.json();
    App.hiddenLanguages = new Set(hidden || []);
  }
}

async function toggleHiddenLanguage(language, hidden) {
  const res = await api('POST', '/api/settings/hidden-languages', { language, hidden });
  if (res?.ok) {
    const { hidden: updated } = await res.json();
    App.hiddenLanguages = new Set(updated);
  }
}

async function showHome() {
  showScreen('screen-home');
  document.getElementById('deck-container').innerHTML = _deckSkeletonHtml();
  document.getElementById('weakest-section').classList.add('hidden');  // kept in DOM, not shown on home
  document.getElementById('home-streak').classList.add('hidden');
  document.getElementById('home-quick-start').classList.add('hidden');
  _fetchAndRenderDailyGoal();

  const [decksRes, streakRes] = await Promise.all([
    api('GET', '/api/decks'),
    api('GET', '/api/progress/streak'),
    _loadHiddenLanguages(),
  ]);

  if (!decksRes) return;
  App.decks = decksRes.ok ? await decksRes.json() : [];

  // Fetch per-deck stats in parallel
  const statsMap = {};
  if (App.decks.length) {
    const statsArr = await Promise.all(
      App.decks.map(d =>
        api('GET', `/api/progress/stats?deck_id=${d.id}`)
          .then(r => r?.ok ? r.json() : null).catch(() => null)
      )
    );
    App.decks.forEach((d, i) => { if (statsArr[i]) statsMap[d.id] = statsArr[i]; });
  }

  // Streak strip
  if (streakRes?.ok) {
    const s = await streakRes.json();
    if (s.total_days > 0) {
      const el = document.getElementById('home-streak');
      el.innerHTML = `
        <div class="home-streak-num">${s.current_streak}</div>
        <div class="home-streak-meta">
          <span class="text-secondary" style="font-size:.78rem">day streak</span>
          ${_miniCalHtml(s.studied_dates_last_30 || [])}
        </div>`;
      el.classList.remove('hidden');
    }
  }

  // Quick-start card
  const lastDeck = App.lastUsedDeck && App.decks.find(d => d.id === App.lastUsedDeck.id);
  if (lastDeck) {
    const stats = statsMap[lastDeck.id];
    const seen  = stats?.cards_seen || 0;
    const el    = document.getElementById('home-quick-start');
    el.innerHTML = `
      <div class="home-quick-inner">
        <div class="home-quick-text">
          <div style="display:flex;align-items:center;gap:.4rem;margin-bottom:.15rem">
            ${langPillHtml(lastDeck.language)}
            <span class="home-quick-title">Continue studying <strong>${esc(titleCase(lastDeck.language))}</strong></span>
          </div>
          <span class="text-secondary" style="font-size:.8rem">${esc(lastDeck.topic)} · ${seen} / ${lastDeck.card_count} seen</span>
        </div>
        <button class="btn-primary btn-sm" id="btn-quick-start">Start</button>
      </div>`;
    el.classList.remove('hidden');
    document.getElementById('btn-quick-start').addEventListener('click', () => showTestSetup(lastDeck));
  }

  // Weakest section removed from home — visible in Progress screen only

  renderDecks(App.decks, statsMap);
}

function renderWeakest(cards) {
  const section = document.getElementById('weakest-section');
  const list    = document.getElementById('weakest-list');
  if (!cards.length) { section.classList.add('hidden'); return; }
  section.classList.remove('hidden');
  list.innerHTML = cards.map(c => `
    <div class="card weakest-card">
      <div style="display:flex;align-items:center;gap:.4rem;margin-bottom:.25rem">
        ${langPillHtml(c.language)}
        <span class="weakest-word">${esc(c.word)}</span>
      </div>
      <p class="weakest-meta">${esc(c.meaning)}</p>
      <p class="weakest-meta">${Math.round((1 - (c.weakness_score || 0)) * 100)}% correct</p>
    </div>`).join('');
}

function _langProgress(language, decks, statsMap) {
  const total = decks.filter(d => d.language === language).reduce((s, d) => s + d.card_count, 0);
  const seen  = decks.filter(d => d.language === language).reduce((s, d) => s + (statsMap[d.id]?.cards_seen || 0), 0);
  return total > 0 ? Math.round(seen / total * 100) : 0;
}

function renderDecks(decks, statsMap = {}) {
  const container = document.getElementById('deck-container');
  const noDecks   = document.getElementById('no-decks');

  if (!decks.length) {
    noDecks.classList.remove('hidden');
    container.innerHTML = '';
    return;
  }
  noDecks.classList.add('hidden');

  const byLang = {};
  for (const deck of decks) {
    if (!App.hiddenLanguages.has(deck.language))
      (byLang[deck.language] = byLang[deck.language] || []).push(deck);
  }

  container.innerHTML = Object.entries(byLang).map(([lang, langDecks]) => {
    const pct = _langProgress(lang, decks, statsMap);
    return `
    <div class="lang-group" data-language="${esc(lang)}">
      <div class="lang-group-header">
        ${langPillHtml(lang)}
        <h3>${esc(titleCase(lang))}</h3>
        ${pct > 0 ? `<span class="lang-pct">${pct}% studied</span>` : ''}
      </div>
      <div class="topic-grid">
        ${langDecks.map(deck => {
          const s    = statsMap[deck.id];
          const seen      = s?.cards_seen || 0;
          const remaining = Math.max(0, deck.card_count - seen);
          const pctD      = deck.card_count > 0 ? Math.round(seen / deck.card_count * 100) : 0;
          return `
          <div class="card topic-card" data-deck-id="${deck.id}">
            <div class="topic-card-header">
              <span class="topic-name">${esc(deck.topic)}</span>
              <span class="badge ${remaining === 0 ? 'badge-done' : ''}">${remaining === 0 ? '✓' : remaining}</span>
            </div>
            <div class="topic-progress">
              <div class="topic-progress-bar-bg">
                <div class="topic-progress-bar" style="width:${pctD}%"></div>
              </div>
              <span class="topic-progress-label">${seen} / ${deck.card_count} seen</span>
            </div>
            <div class="topic-actions">
              ${s?.due_count > 0 ? `<button class="btn-primary btn-sm" data-action="review" data-deck-id="${deck.id}">Review <span class="due-badge">${s.due_count}</span></button>` : ''}
              <button class="btn-primary btn-sm deck-test-btn" data-action="test" data-deck-id="${deck.id}">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" style="flex-shrink:0"><path d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z"/></svg>
                Test
              </button>
              <div class="deck-menu-wrap">
                <button class="btn-ghost btn-sm deck-menu-btn" data-action="menu" data-deck-id="${deck.id}" aria-label="More options">&#8943;</button>
                <div class="deck-menu-dropdown hidden" id="deck-menu-${deck.id}">
                  <button class="deck-menu-item" data-action="browse" data-deck-id="${deck.id}">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"/><path d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/></svg>
                    Browse
                  </button>
                  <button class="deck-menu-item" data-action="export" data-deck-id="${deck.id}">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"/></svg>
                    Export
                  </button>
                  <div class="deck-menu-divider"></div>
                  <button class="deck-menu-item deck-menu-danger" data-action="delete" data-deck-id="${deck.id}">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"/></svg>
                    Delete
                  </button>
                </div>
              </div>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  }).join('');
}

document.getElementById('deck-container').addEventListener('click', e => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const deckId = parseInt(btn.dataset.deckId, 10);
  const deck   = App.decks.find(d => d.id === deckId);
  if (!deck) return;

  if (btn.dataset.action === 'menu') {
    const dropdown = document.getElementById(`deck-menu-${deckId}`);
    document.querySelectorAll('.deck-menu-dropdown').forEach(d => { if (d !== dropdown) d.classList.add('hidden'); });
    dropdown.classList.toggle('hidden');
    return;
  }

  // Close any open dropdown before navigating
  document.querySelectorAll('.deck-menu-dropdown').forEach(d => d.classList.add('hidden'));

  if (btn.dataset.action === 'review') startReview(deck);
  if (btn.dataset.action === 'test')   showTestSetup(deck);
  if (btn.dataset.action === 'browse') showBrowse(deck);
  if (btn.dataset.action === 'export') exportDeck(deck);
  if (btn.dataset.action === 'delete') deleteDeck(deck);
});

// Close dropdowns when clicking outside
document.addEventListener('click', e => {
  if (!e.target.closest('.deck-menu-wrap')) {
    document.querySelectorAll('.deck-menu-dropdown').forEach(d => d.classList.add('hidden'));
  }
});

async function startReview(deck) {
  const res = await api('POST', '/api/quiz/start', {
    scope: 'review', deck_id: deck.id, mode: 'flashcard',
    direction: 'all_available', card_count: 50,
  });
  if (!res || !res.ok) {
    const e = await res?.json().catch(() => ({}));
    await showAlert(friendlyError(e?.detail));
    return;
  }
  const data = await res.json();
  initQuizState(data, deck.id);
  App.lastUsedDeck = { id: deck.id, language: deck.language, topic: deck.topic, card_count: deck.card_count };
  sessionStorage.setItem('lastUsedDeck', JSON.stringify(App.lastUsedDeck));
  showScreen('screen-quiz');
  renderQuizQuestion(data.question);
}

async function exportDeck(deck) {
  const res = await api('GET', `/api/decks/${deck.id}/export`);
  if (!res || !res.ok) { await showAlert('Could not export deck.'); return; }
  const text = await res.text();
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `${deck.language}_${deck.topic}.lex`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function deleteDeck(deck) {
  const confirmed = await showConfirm(
    `Permanently delete "${deck.language} / ${deck.topic}"? All ${deck.card_count} cards, stats and import history will be removed. This cannot be undone.`,
    'Delete', true
  );
  if (!confirmed) return;

  const res = await api('DELETE', `/api/decks/${deck.id}`);
  if (!res || !res.ok) {
    const e = await res?.json().catch(() => ({}));
    await showAlert(friendlyError(e?.detail));
    return;
  }

  if (App.lastUsedDeck?.id === deck.id) {
    App.lastUsedDeck = null;
    sessionStorage.removeItem('lastUsedDeck');
  }

  showHome();
}

document.getElementById('nav-home').addEventListener('click', showHome);
document.getElementById('no-decks-cta').addEventListener('click', () => showImport(null));
document.getElementById('progress-empty-cta').addEventListener('click', showHome);
document.getElementById('btn-big-test').addEventListener('click', showBigTestSetup);
document.getElementById('btn-nav-import').addEventListener('click', () => showImport(null));
document.getElementById('btn-nav-home-tab').addEventListener('click', showHome);
document.getElementById('btn-nav-journal').addEventListener('click', showJournal);
document.getElementById('btn-nav-essay').addEventListener('click', showEssay);
document.getElementById('btn-nav-progress').addEventListener('click', showProgress);

// ── Test Setup ────────────────────────────────────────────────────────────────

function showTestSetup(preselectedDeck) {
  showScreen('screen-test-setup');

  const languages = [...new Set(App.decks.map(d => d.language))].filter(l => !App.hiddenLanguages.has(l));
  const selLang   = document.getElementById('sel-language');
  const selTopic  = document.getElementById('sel-topic');
  selLang.innerHTML = languages.map(l => `<option value="${esc(l)}">${esc(titleCase(l))}</option>`).join('');

  if (preselectedDeck) selLang.value = preselectedDeck.language;

  const locked = !!preselectedDeck;
  selLang.disabled  = locked;
  selTopic.disabled = locked;

  updateTopics(preselectedDeck?.id);
  renderModeGrid('test-mode-grid', App.testMode, lang => lang !== null);
  renderDirectionGrid(selLang.value);

  selLang.addEventListener('change', () => {
    if (selLang.disabled) return;
    updateTopics(null);
    renderDirectionGrid(selLang.value);
    checkMcqAvailability(selLang.value);
  });
}

function updateTopics(preselectedDeckId) {
  const lang     = document.getElementById('sel-language').value;
  const selTopic = document.getElementById('sel-topic');
  const filtered = App.decks.filter(d => d.language === lang);
  selTopic.innerHTML = filtered.map(d => `<option value="${d.id}">${esc(d.topic)}</option>`).join('');
  if (preselectedDeckId) selTopic.value = String(preselectedDeckId);
}

const _LANG_EXAMPLES = {
  spanish:  { w: 'hola',        m: 'hello',  n: null         },
  french:   { w: 'café',        m: 'coffee', n: null         },
  german:   { w: 'Hund',        m: 'dog',    n: null         },
  norsk:    { w: 'hei',         m: 'hello',  n: null         },
  japanese: { w: 'konnichiwa',  m: 'hello',  n: 'こんにちは' },
  mandarin: { w: 'nǐ hǎo',      m: 'hello',  n: '你好'       },
};

function _dirExamples(language) {
  const e = _LANG_EXAMPLES[language?.toLowerCase()] || { w: 'word', m: 'meaning', n: null };
  return {
    '1_only':        `${e.w} → ${e.m}`,
    '2_only':        `${e.m} → ${e.w}`,
    '1_and_2':       `${e.w} ↔ ${e.m}`,
    '3_only':        e.n ? `${e.n} → ${e.m}` : null,
    '4_only':        e.n ? `${e.n} → ${e.w}` : null,
    'all_available': 'all directions',
    'random':        'random each card',
  };
}

function renderDirectionGrid(language) {
  const native   = hasNativeScript(language);
  const dirs     = native
    ? ['1_only', '2_only', '1_and_2', '3_only', '4_only', 'all_available', 'random']
    : ['1_only', '2_only', '1_and_2'];
  const examples = _dirExamples(language);

  if (!dirs.includes(App.testDirection)) App.testDirection = '1_and_2';

  const grid = document.getElementById('test-dir-grid');
  grid.innerHTML = '';
  dirs.forEach(dir => {
    const btn = document.createElement('button');
    btn.className = `toggle-btn dir-btn${App.testDirection === dir ? ' active' : ''}`;
    btn.innerHTML = `<span class="dir-btn-label">${DIR_LABELS[dir]}</span>
                     <span class="dir-btn-example">${examples[dir] || ''}</span>`;
    btn.addEventListener('click', () => {
      App.testDirection = dir;
      grid.querySelectorAll('.toggle-btn').forEach(b => b.classList.toggle('active', b === btn));
    });
    grid.appendChild(btn);
  });

  checkMcqAvailability(language);
}

function checkMcqAvailability(language) {
  const langCardCount = App.decks
    .filter(d => d.language === language)
    .reduce((max, d) => Math.max(max, d.language_card_count), 0);

  const warning = document.getElementById('mcq-warning');
  const mcqBtn  = document.querySelector('#test-mode-grid .mode-card[data-mode="mcq"]');
  if (!mcqBtn) return;

  const tooFew = langCardCount < 4;
  mcqBtn.disabled = tooFew;
  warning.classList.toggle('hidden', !tooFew);
  if (tooFew && App.testMode === 'mcq') {
    App.testMode = 'typing';
    document.querySelectorAll('#test-mode-grid .mode-card').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === App.testMode);
    });
  }
}

const MODE_INFO = [
  { key: 'mcq',        label: 'Multiple Choice', desc: 'Pick the correct answer from 4 options'  },
  { key: 'typing',     label: 'Typing',           desc: 'Type the answer from memory'              },
  { key: 'flashcard',  label: 'Flashcard',        desc: 'Reveal the answer and grade yourself'      },
];

function renderModeGrid(gridId, activeMode, _filter) {
  const grid = document.getElementById(gridId);
  grid.className = 'mode-grid-cards';
  grid.innerHTML = '';
  MODE_INFO.forEach(({ key, label, desc }) => {
    const btn = document.createElement('button');
    btn.className    = `mode-card${activeMode === key ? ' active' : ''}`;
    btn.dataset.mode = key;
    btn.innerHTML    = `<div class="mode-card-title">${label}</div>
                        <div class="mode-card-desc">${desc}</div>`;
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      if (gridId === 'test-mode-grid') App.testMode = key;
      else App.bigTestMode = key;
      grid.querySelectorAll('.mode-card').forEach(b => b.classList.toggle('active', b === btn));
    });
    grid.appendChild(btn);
  });
}

document.getElementById('btn-test-back').addEventListener('click', showHome);

document.getElementById('btn-test-start').addEventListener('click', async () => {
  const deckId    = parseInt(document.getElementById('sel-topic').value, 10);
  const cardCount = parseInt(document.getElementById('inp-card-count').value, 10) || 20;
  const btn = document.getElementById('btn-test-start');

  setLoading(btn, true);
  const res = await api('POST', '/api/quiz/start', {
    scope:      'test',
    deck_id:    deckId,
    mode:       App.testMode,
    direction:  App.testDirection,
    card_count: cardCount,
  });

  if (!res || !res.ok) {
    const err = await res?.json().catch(() => ({}));
    await showAlert(friendlyError(err?.detail));
    setLoading(btn, false);
    return;
  }

  const data = await res.json();
  setLoading(btn, false);
  initQuizState(data, deckId);

  // Remember last used deck for quick-start card on Home
  const deck = App.decks.find(d => d.id === deckId);
  if (deck) {
    App.lastUsedDeck = { id: deck.id, language: deck.language, topic: deck.topic, card_count: deck.card_count };
    sessionStorage.setItem('lastUsedDeck', JSON.stringify(App.lastUsedDeck));
  }

  showScreen('screen-quiz');
  renderQuizQuestion(data.question);
});

// ── Total Recall Setup ────────────────────────────────────────────────────────────

function _updateTotalRecallStart() {
  const btn   = document.getElementById('btn-big-start');
  const count = document.querySelectorAll('#total-recall-langs .lang-check-item.selected').length;
  btn.disabled = count < 2;
  btn.title    = count < 2 ? 'Select at least 2 languages to start' : '';
}

function showBigTestSetup() {
  showScreen('screen-big-test-setup');

  const langs = [...new Set(App.decks.map(d => d.language))].filter(l => !App.hiddenLanguages.has(l)).sort();
  App.totalRecallLangs = new Set(langs);

  const langContainer = document.getElementById('total-recall-langs');
  langContainer.innerHTML = langs.map(lang =>
    `<div class="lang-check-item selected" data-lang="${esc(lang)}">
       ${langPillHtml(lang)}<span>${esc(titleCase(lang))}</span>
     </div>`
  ).join('');

  langContainer.querySelectorAll('.lang-check-item').forEach(item => {
    item.addEventListener('click', () => {
      const lang = item.dataset.lang;
      if (App.totalRecallLangs.has(lang)) {
        App.totalRecallLangs.delete(lang);
        item.classList.remove('selected');
      } else {
        App.totalRecallLangs.add(lang);
        item.classList.add('selected');
      }
      _updateTotalRecallStart();
    });
  });

  _updateTotalRecallStart();

  renderModeGrid('big-mode-grid', App.bigTestMode, null);

  const countGrid = document.getElementById('big-count-grid');
  countGrid.innerHTML = '';
  BIG_COUNT_OPTIONS.forEach(n => {
    const btn = document.createElement('button');
    btn.className = `toggle-btn${App.bigTestCount === n ? ' active' : ''}`;
    btn.textContent = String(n);
    btn.addEventListener('click', () => {
      App.bigTestCount = n;
      countGrid.querySelectorAll('.toggle-btn').forEach(b => b.classList.toggle('active', b === btn));
    });
    countGrid.appendChild(btn);
  });
}

document.getElementById('btn-big-test-back').addEventListener('click', showHome);

document.getElementById('btn-big-start').addEventListener('click', async () => {
  // Read directly from DOM — single source of truth, no Set state issues
  const selectedLangs = [
    ...document.querySelectorAll('#total-recall-langs .lang-check-item.selected')
  ].map(el => el.dataset.lang).filter(Boolean);

  if (selectedLangs.length < 2) {
    await showAlert('Select at least 2 languages before starting Total Recall.');
    return;
  }
  const btn = document.getElementById('btn-big-start');
  setLoading(btn, true);
  const res = await api('POST', '/api/quiz/start', {
    scope:      'big_test',
    deck_id:    null,
    mode:       App.bigTestMode,
    direction:  '1_and_2',
    card_count: App.bigTestCount,
    languages:  selectedLangs,
  });

  if (!res || !res.ok) {
    const err = await res?.json().catch(() => ({}));
    await showAlert(friendlyError(err?.detail));
    setLoading(btn, false);
    return;
  }

  const data = await res.json();
  setLoading(btn, false);
  initQuizState(data, null);
  showScreen('screen-quiz');
  renderQuizQuestion(data.question);
});

// ── Quiz ─────────────────────────────────────────────────────────────────────

function initQuizState(data, deckId = null) {
  Object.assign(App.quiz, {
    sessionId:    data.session_id,
    mode:         data.mode,
    scope:        data.scope,
    direction:    data.direction,
    deckId:       deckId,
    total:        data.total,
    answered:     0,
    correct:      0,
    question:     data.question,
    answers:      [],
    hintRevealed: [],
    hintPresses:  0,
  });
  updateQuizProgress();
}

function updateQuizProgress() {
  const pct = App.quiz.total > 0 ? (App.quiz.answered / App.quiz.total) * 100 : 0;
  document.getElementById('quiz-progress-bar').style.width = `${pct}%`;
  document.getElementById('quiz-progress-label').textContent = `${App.quiz.answered} / ${App.quiz.total}`;
}

function renderQuizQuestion(question) {
  clearCountdown();
  App.quiz.question     = question;
  App.quiz.hintRevealed = [];
  App.quiz.hintPresses  = 0;

  // Hide all input panels and feedback
  ['quiz-feedback', 'quiz-mcq', 'quiz-typing', 'quiz-hint-row',
   'quiz-native-display', 'quiz-flashcard']
    .forEach(id => document.getElementById(id).classList.add('hidden'));
  document.getElementById('quiz-question').classList.remove('flashcard-front');
  document.getElementById('hint-display').textContent = '';
  document.getElementById('btn-hint').disabled = false;

  // Language pill
  document.getElementById('quiz-lang-pill').innerHTML =
    question.language ? langPillHtml(question.language) : '';

  // Native script display (direction 1: show native below word; directions 3 & 4: native IS the prompt)
  if (question.native) {
    const nativeEl = document.getElementById('quiz-native-display');
    nativeEl.textContent = question.native;
    nativeEl.classList.remove('hidden');
  }

  document.getElementById('quiz-question').textContent = question.question;

  // TTS button — hidden for meaning_to_word (speaking would reveal the answer)
  const speakText   = question.speak_text || question.question;
  const isMtoW      = question.resolved_direction === 'meaning_to_word';
  const ttsBtn      = document.getElementById('btn-tts');
  if (isMtoW) {
    ttsBtn.classList.add('hidden');
  } else {
    ttsBtn.classList.remove('hidden');
    ttsBtn.dataset.text = speakText;
    ttsBtn.dataset.lang = question.language || '';
  }

  if (question.type === 'mcq')             renderMcq(question);
  else if (question.type === 'flashcard')  renderFlashcard(question);
  else                                     renderTyping();

  if (question.type === 'typing') document.getElementById('quiz-hint-row').classList.remove('hidden');

  // Auto-speak on card appearance:
  // — flashcard: only when the prompt IS the foreign word (not meaning_to_word)
  // — MCQ / typing: only for word_to_meaning direction
  const autoSpeakNow =
    (question.type === 'flashcard' && speakText === question.question) ||
    (question.type !== 'flashcard' && question.resolved_direction === 'word_to_meaning');
  if (autoSpeakNow) speak(speakText, question.language);
}

function renderMcq(question) {
  const grid = document.getElementById('quiz-mcq');
  grid.innerHTML = '';
  grid.classList.remove('hidden');

  question.options.forEach((opt, idx) => {
    const btn = document.createElement('button');
    btn.className = 'mcq-btn';
    btn.dataset.value = opt;
    btn.innerHTML = `<span class="kbd-badge">${idx + 1}</span>${esc(opt)}`;
    btn.addEventListener('click', () => {
      grid.querySelectorAll('.mcq-btn').forEach(b => {
        b.disabled = true;
        if (b.dataset.value === String(question.correct_answer)) b.classList.add('correct');
        else if (b === btn) b.classList.add('wrong');
      });
      handleAnswer(opt, null);
    });
    grid.appendChild(btn);
  });
}


function renderTyping() {
  const wrap = document.getElementById('quiz-typing');
  wrap.classList.remove('hidden');
  const inp = document.getElementById('quiz-type-inp');
  inp.value = '';
  inp.disabled = false;
  document.getElementById('quiz-type-submit').disabled = false;
  setTimeout(() => inp.focus(), 50);
}

function renderFlashcard(question) {
  document.getElementById('quiz-question').classList.add('flashcard-front');
  const section   = document.getElementById('quiz-flashcard');
  const answerEl  = document.getElementById('flashcard-answer');
  const gradeEl   = document.getElementById('flashcard-grade');
  const revealBtn = document.getElementById('btn-reveal');
  answerEl.textContent = question.correct_answer;
  answerEl.classList.add('hidden');
  gradeEl.classList.add('hidden');
  gradeEl.querySelectorAll('.grade-btn').forEach(b => { b.disabled = false; });
  revealBtn.classList.remove('hidden');
  section.classList.remove('hidden');
}

function revealFlashcard() {
  document.getElementById('flashcard-answer').classList.remove('hidden');
  document.getElementById('btn-reveal').classList.add('hidden');
  document.getElementById('flashcard-grade').classList.remove('hidden');
}

document.getElementById('btn-reveal').addEventListener('click', revealFlashcard);

document.getElementById('btn-tts').addEventListener('click', () => {
  const btn = document.getElementById('btn-tts');
  speak(btn.dataset.text, btn.dataset.lang);
});

document.getElementById('flashcard-grade').querySelectorAll('.grade-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.getElementById('flashcard-grade').querySelectorAll('.grade-btn')
      .forEach(b => b.disabled = true);
    handleAnswer(btn.dataset.val, null);
  });
});

document.getElementById('quiz-type-inp').addEventListener('input', () => {
  const q = App.quiz.question;
  if (!q || q.type !== 'typing') return;
  const inp     = document.getElementById('quiz-type-inp');
  const input   = inp.value;
  const correct = String(q.correct_answer);
  if (input.toLowerCase().trim() === correct.toLowerCase().trim()) {
    inp.disabled = true;
    document.getElementById('quiz-type-submit').disabled = true;
    handleAnswer(input, null, false);
  }
});

document.getElementById('quiz-type-submit').addEventListener('click', () => {
  const inp    = document.getElementById('quiz-type-inp');
  const answer = inp.value.trim();
  if (!answer) return;
  const q       = App.quiz.question;
  const correct = String(q.correct_answer);
  const needsRemark = stripDiacritics(answer) === stripDiacritics(correct)
                   && answer.toLowerCase().trim() !== correct.toLowerCase().trim();
  inp.disabled = true;
  document.getElementById('quiz-type-submit').disabled = true;
  handleAnswer(answer, null, needsRemark);
});

document.getElementById('quiz-type-inp').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('quiz-type-submit').click();
});

async function handleAnswer(userAnswer, correctAnswer, diacriticsRemark = false) {
  const q    = App.quiz.question;
  const body = { card_id: q.card_id, direction: q.resolved_direction, user_answer: userAnswer };
  if (correctAnswer !== null) body.correct_answer = correctAnswer;

  const res = await api('POST', `/api/quiz/${App.quiz.sessionId}/answer`, body);
  if (!res || !res.ok) { const e = await res?.json().catch(()=>({})); await showAlert(friendlyError(e?.detail)); return; }

  const data = await res.json();
  App.quiz.answered++;
  if (data.is_correct) App.quiz.correct++;

  App.quiz.answers.push({
    question:       q.question,
    user_answer:    userAnswer,
    correct_answer: data.correct_answer,
    is_correct:     data.is_correct,
    language:       q.language || '',
  });

  updateQuizProgress();
  playSound(data.is_correct);

  // Flashcard: no feedback panel or countdown — advance immediately
  if (App.quiz.mode === 'flashcard') {
    if (data.question) renderQuizQuestion(data.question);
    else showResults();
    return;
  }

  showFeedback(data.is_correct, data.correct_answer, data.question, diacriticsRemark);
}

function showFeedback(isCorrect, correctAnswer, nextQuestion, diacriticsRemark = false) {
  const fb = document.getElementById('quiz-feedback');
  fb.className = `feedback ${isCorrect ? 'correct' : 'wrong'}`;
  fb.classList.remove('hidden');

  const mode = App.quiz.mode;

  const _gradeLabel = { again: 'Again', hard: 'Hard', good: 'Good', easy: 'Easy!' };
  const _lastAnswer = App.quiz.answers.at(-1)?.user_answer || '';
  document.getElementById('feedback-icon').textContent = isCorrect ? '✓' : '✗';
  document.getElementById('feedback-msg').textContent  =
    mode === 'flashcard'
      ? (_gradeLabel[_lastAnswer.toLowerCase()] || (isCorrect ? 'Good' : 'Again'))
      : (isCorrect ? 'Correct!' : 'Incorrect');

  const correctEl = document.getElementById('feedback-correct');

  if (mode === 'flashcard') {
    correctEl.classList.add('hidden');  // user already saw the answer
  } else if (!isCorrect) {
    const display = correctAnswer;
    correctEl.textContent = `Answer: ${display}`;
    correctEl.classList.remove('hidden');
  } else if (mode === 'typing' && diacriticsRemark) {
    correctEl.textContent = `Correct — proper spelling: ${correctAnswer}`;
    correctEl.classList.remove('hidden');
  } else if (mode === 'typing') {
    correctEl.textContent = `Answer: ${correctAnswer}`;
    correctEl.classList.remove('hidden');
  } else {
    correctEl.classList.add('hidden');
  }

  const btnNext = document.getElementById('btn-next');
  const nextLabel = nextQuestion ? 'Next →' : 'See Results';
  btnNext.innerHTML = `${nextLabel} <span class="kbd-badge" style="margin-left:.3rem">↵</span>`;
  const advance = () => nextQuestion ? renderQuizQuestion(nextQuestion) : showResults();
  btnNext.onclick = () => { clearCountdown(); advance(); };
  startCountdown(advance);

  // Auto-speak the foreign word during the countdown
  const q = App.quiz.question;
  if (q?.speak_text) speak(q.speak_text, q.language);
}

// ── Hint ──────────────────────────────────────────────────────────────────────

document.getElementById('btn-hint').addEventListener('click', async () => {
  const q = App.quiz.question;
  if (App.quiz.hintPresses >= 3) return;

  const res = await api('POST', '/api/quiz/hint', {
    correct_answer: String(q.correct_answer),
    revealed:       App.quiz.hintRevealed,
    direction:      q.resolved_direction,
  });
  if (!res || !res.ok) return;

  const data = await res.json();
  App.quiz.hintPresses++;
  App.quiz.hintRevealed = data.revealed || [];

  const hintDisplay = document.getElementById('hint-display');
  hintDisplay.textContent = data.show_full_reading ? String(q.correct_answer) : (data.masked || '');

  document.getElementById('btn-hint').disabled = App.quiz.hintPresses >= 3;
});

// ── Results ───────────────────────────────────────────────────────────────────

function _displayAnswer(a) {
  const ca = a.correct_answer === 'true' ? 'True'
           : a.correct_answer === 'false' ? 'False'
           : esc(a.correct_answer);
  const ua = esc(a.user_answer || '—');
  return { ca, ua };
}

function showResults() {
  showScreen('screen-results');
  _fetchAndRenderDailyGoal();

  const { total, correct, answers, scope, mode, direction, deckId } = App.quiz;
  const pct    = total > 0 ? Math.round((correct / total) * 100) : 0;
  const missed = answers.filter(a => !a.is_correct);

  // ── Score ring ──────────────────────────────────────────────────────────────
  const ring = document.getElementById('score-ring');
  ring.textContent = `${pct}%`;
  ring.className   = `score-ring ${pct >= 80 ? 'great' : pct >= 50 ? 'ok' : 'poor'}`;
  document.getElementById('score-label').textContent = `${correct} correct out of ${total}`;

  // ── Recommendation ──────────────────────────────────────────────────────────
  const recEl = document.getElementById('results-rec');
  let rec;
  if (pct >= 80) {
    rec = scope === 'big_test'
      ? 'Excellent work across all languages!'
      : 'Great session! Try Total Recall to challenge yourself across all languages.';
  } else if (pct >= 50) {
    rec = missed.length
      ? 'Good progress. Use Retry Missed below to reinforce the cards you got wrong.'
      : 'Good progress — keep practising to push higher.';
  } else {
    rec = missed.length
      ? 'Tough session. Focus on the missed cards below to build strength.'
      : 'Keep going — consistency is what drives improvement.';
  }
  recEl.textContent = rec;
  recEl.classList.remove('hidden');

  // ── Retry Missed button ─────────────────────────────────────────────────────
  const retryBtn = document.getElementById('btn-retry-missed');
  if (scope === 'test' && deckId && missed.length > 0) {
    retryBtn.textContent = `Retry Missed (${missed.length})`;
    retryBtn.classList.remove('hidden');
  } else {
    retryBtn.classList.add('hidden');
  }

  // ── Missed cards ────────────────────────────────────────────────────────────
  const missedSection = document.getElementById('missed-section');
  if (missed.length) {
    missedSection.classList.remove('hidden');
    document.getElementById('missed-tbody').innerHTML = missed.map(a => {
      const { ca, ua } = _displayAnswer(a);
      return `<tr>
        <td>${langPillHtml(a.language)} ${esc(a.question)}</td>
        <td class="answer-wrong">${ua}</td>
        <td class="answer-correct">${ca}</td>
      </tr>`;
    }).join('');
  } else {
    missedSection.classList.add('hidden');
  }

  // ── All answers (collapsed) ─────────────────────────────────────────────────
  const allSection = document.getElementById('all-answers-section');
  const allWrap    = document.getElementById('all-answers-wrap');
  const toggleBtn  = document.getElementById('btn-toggle-all');
  allSection.classList.remove('hidden');
  allWrap.classList.add('hidden');
  toggleBtn.textContent = `Show all answers ▶`;

  document.getElementById('all-answers-tbody').innerHTML = answers.map(a => {
    const { ca, ua } = _displayAnswer(a);
    const icon = a.is_correct ? '<span class="answer-tick">✓</span>' : '<span class="answer-cross">✗</span>';
    return `<tr>
      <td>${langPillHtml(a.language)} ${esc(a.question)}</td>
      <td>${ua}</td>
      <td class="${a.is_correct ? 'answer-correct' : 'answer-wrong'}">${ca}</td>
      <td>${icon}</td>
    </tr>`;
  }).join('');
}

document.getElementById('btn-toggle-all').addEventListener('click', () => {
  const wrap = document.getElementById('all-answers-wrap');
  const btn  = document.getElementById('btn-toggle-all');
  const open = wrap.classList.toggle('hidden');
  btn.textContent = open ? 'Show all answers ▶' : 'Hide all answers ▼';
});

document.getElementById('btn-retry-missed').addEventListener('click', async () => {
  const { deckId, mode, direction } = App.quiz;
  const missed = App.quiz.answers.filter(a => !a.is_correct);
  const btn = document.getElementById('btn-retry-missed');
  setLoading(btn, true);
  const res = await api('POST', '/api/quiz/start', {
    scope: 'test', deck_id: deckId, mode, direction,
    card_ids: missed.map(a => a.card_id),
  });
  if (!res || !res.ok) {
    const e = await res?.json().catch(() => ({}));
    await showAlert(friendlyError(e?.detail));
    setLoading(btn, false);
    return;
  }
  const data = await res.json();
  setLoading(btn, false);
  initQuizState(data, deckId);
  showScreen('screen-quiz');
  renderQuizQuestion(data.question);
});

document.getElementById('btn-quiz-exit').addEventListener('click', async () => {
  if (await showConfirm('End this quiz?', 'End Quiz', true)) showHome();
});

document.getElementById('btn-results-home').addEventListener('click', showHome);

// ── Browse (Phase 16) ─────────────────────────────────────────────────────────

async function showBrowse(deck) {
  App.browse.deck = deck;
  App.browse.page = 1;
  document.getElementById('browse-title').textContent = `${titleCase(deck.language)} / ${deck.topic}`;
  document.getElementById('inp-search').value = '';
  document.getElementById('btn-browse-export').classList.remove('hidden');
  document.getElementById('btn-browse-delete').classList.remove('hidden');
  showScreen('screen-browse');
  await loadBrowsePage(1);
}

document.getElementById('btn-browse-export').addEventListener('click', () => {
  if (App.browse.deck) exportDeck(App.browse.deck);
});

document.getElementById('btn-browse-delete').addEventListener('click', () => {
  if (App.browse.deck) deleteDeck(App.browse.deck);
});

async function loadBrowsePage(page) {
  App.browse.page = page;
  const res = await api('GET', `/api/cards?deck_id=${App.browse.deck.id}&page=${page}&size=50`);
  if (!res || !res.ok) return;
  App.browse.cards = await res.json();
  renderBrowseCards(App.browse.cards);
  renderBrowsePagination(page);
}

function renderBrowseCards(cards) {
  const tbody    = document.getElementById('browse-tbody');
  const emptyEl  = document.getElementById('browse-empty');
  const tableWrap = emptyEl.nextElementSibling;
  const isSearch = document.getElementById('inp-search').value.trim().length > 0;

  if (!cards.length && !isSearch) {
    emptyEl.classList.remove('hidden');
    tableWrap.classList.add('hidden');
    tbody.innerHTML = '';
    return;
  }

  emptyEl.classList.add('hidden');
  tableWrap.classList.remove('hidden');

  if (!cards.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:2rem;color:var(--text-secondary)">No cards match your search.</td></tr>';
    return;
  }

  tbody.innerHTML = cards.map(c => `
    <tr>
      <td>${esc(c.word)}</td>
      <td>${esc(c.meaning)}</td>
      <td>${c.native ? esc(c.native) : '<span style="color:var(--text-secondary)">—</span>'}</td>
      <td class="browse-actions">
        <button class="btn-ghost btn-sm btn-tts-row" data-speak="${esc(c.word)}" data-lang="${esc(App.browse.deck?.language || '')}" aria-label="Speak">🔊</button>
        <button class="btn-ghost btn-sm" data-edit-id="${c.id}" data-edit-word="${esc(c.word)}" data-edit-meaning="${esc(c.meaning)}" data-edit-native="${esc(c.native || '')}">Edit</button>
        <button class="btn-danger btn-sm" data-delete-id="${c.id}">Delete</button>
      </td>
    </tr>`).join('');
}

function renderBrowsePagination(page) {
  const el = document.getElementById('browse-pagination');
  el.innerHTML = '';
  if (page > 1) {
    const prev = document.createElement('button');
    prev.className = 'btn-outline btn-sm';
    prev.textContent = '← Prev';
    prev.onclick = () => loadBrowsePage(page - 1);
    el.appendChild(prev);
  }
  const lbl = document.createElement('span');
  lbl.className = 'text-secondary';
  lbl.textContent = `Page ${page}`;
  el.appendChild(lbl);
  if (App.browse.cards.length === 50) {
    const next = document.createElement('button');
    next.className = 'btn-outline btn-sm';
    next.textContent = 'Next →';
    next.onclick = () => loadBrowsePage(page + 1);
    el.appendChild(next);
  }
}

document.getElementById('browse-tbody').addEventListener('click', async e => {
  const ttsBtn = e.target.closest('[data-speak]');
  if (ttsBtn) { speak(ttsBtn.dataset.speak, ttsBtn.dataset.lang); return; }

  const editBtn = e.target.closest('[data-edit-id]');
  if (editBtn) { openCardEdit(editBtn); return; }

  const btn = e.target.closest('[data-delete-id]');
  if (!btn || !await showConfirm('Delete this card?', 'Delete', true)) return;
  const res = await api('DELETE', `/api/cards/${btn.dataset.deleteId}`);
  if (res?.status === 204) await loadBrowsePage(App.browse.page);
});

// ── Card edit modal ───────────────────────────────────────────────────────────

let _editingCardId = null;

function openCardEdit(btn) {
  _editingCardId = btn.dataset.editId;
  document.getElementById('card-edit-word').value    = btn.dataset.editWord;
  document.getElementById('card-edit-meaning').value = btn.dataset.editMeaning;
  document.getElementById('card-edit-native').value  = btn.dataset.editNative;
  document.getElementById('card-edit-err').classList.add('hidden');
  document.getElementById('card-edit-modal-overlay').classList.remove('hidden');
  document.getElementById('card-edit-word').focus();
}

function closeCardEdit() {
  document.getElementById('card-edit-modal-overlay').classList.add('hidden');
  _editingCardId = null;
}

document.getElementById('card-edit-cancel').addEventListener('click', closeCardEdit);

document.getElementById('card-edit-save').addEventListener('click', async () => {
  const word    = document.getElementById('card-edit-word').value.trim();
  const meaning = document.getElementById('card-edit-meaning').value.trim();
  const native  = document.getElementById('card-edit-native').value.trim();
  const errEl   = document.getElementById('card-edit-err');

  if (!word || !meaning) {
    errEl.textContent = 'Word and meaning are required.';
    errEl.classList.remove('hidden');
    return;
  }

  const saveBtn = document.getElementById('card-edit-save');
  setLoading(saveBtn, true);
  const res = await api('PATCH', `/api/cards/${_editingCardId}`, { word, meaning, native });
  setLoading(saveBtn, false);

  if (!res?.ok) {
    const data = await res?.json().catch(() => ({}));
    errEl.textContent = friendlyError(data?.detail);
    errEl.classList.remove('hidden');
    return;
  }

  closeCardEdit();
  await loadBrowsePage(App.browse.page);
});

document.getElementById('inp-search').addEventListener('input', e => {
  const q = e.target.value.toLowerCase();
  renderBrowseCards(App.browse.cards.filter(c =>
    c.word.toLowerCase().includes(q) || c.meaning.toLowerCase().includes(q)
  ));
});

document.getElementById('btn-browse-back').addEventListener('click', showHome);

// ── Import ────────────────────────────────────────────────────────────────────

function showImport(preselectedDeck) {
  App.importFile   = null;
  App.ankiData     = null;   // { noteTypes, selectedNtIdx }
  document.getElementById('inp-import-file').value  = '';
  document.getElementById('drop-filename').classList.add('hidden');
  document.getElementById('import-result').classList.add('hidden');
  document.getElementById('import-preview').classList.add('hidden');
  document.getElementById('anki-mapping').classList.add('hidden');
  document.getElementById('btn-import-submit').disabled = true;

  _populateImportLangSelect(preselectedDeck?.language || '');
  showScreen('screen-import');
}

const SUPPORTED_LANGS = ['spanish', 'mandarin', 'japanese', 'norsk', 'french', 'german'];

function _populateImportLangSelect(preselected) {
  const sel = document.getElementById('sel-import-lang');
  const inp = document.getElementById('inp-import-lang-new');

  // Show all supported languages including any extras in DB (hidden ones still importable)
  const existing = App.decks.map(d => d.language);
  const langs    = [...new Set([...SUPPORTED_LANGS, ...existing])].sort();

  sel.innerHTML = langs.map(l => `<option value="${esc(l)}">${esc(titleCase(l))}</option>`).join('');

  if (preselected && langs.includes(preselected)) sel.value = preselected;

  // No "New language" option — hide the text input entirely
  inp.classList.add('hidden');
  _populateImportTopicSelect(sel.value);
}

function _populateImportTopicSelect(language) {
  const sel    = document.getElementById('sel-import-topic');
  const inp    = document.getElementById('inp-import-topic-new');
  const topics = App.decks.filter(d => d.language === language).map(d => d.topic).sort();

  sel.innerHTML = topics.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('')
    + '<option value="__new__">+ New topic…</option>';

  const isNew = sel.value === '__new__';
  inp.classList.toggle('hidden', !isNew);
}

document.getElementById('sel-import-lang').addEventListener('change', () => {
  _populateImportTopicSelect(document.getElementById('sel-import-lang').value);
});

document.getElementById('sel-import-topic').addEventListener('change', () => {
  const inp = document.getElementById('inp-import-topic-new');
  inp.classList.toggle('hidden', document.getElementById('sel-import-topic').value !== '__new__');
  if (!inp.classList.contains('hidden')) inp.focus();
});

function _importLang() {
  return document.getElementById('sel-import-lang').value;
}

function _importTopic() {
  const sel = document.getElementById('sel-import-topic');
  return sel.value === '__new__'
    ? document.getElementById('inp-import-topic-new').value.trim()
    : sel.value;
}

const dropZone  = document.getElementById('drop-zone');
const fileInput = document.getElementById('inp-import-file');

dropZone.addEventListener('click', e => {
  if (e.target.tagName === 'LABEL' || e.target.closest('label')) return;
  fileInput.click();
});
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault(); dropZone.classList.remove('drag-over');
  if (e.dataTransfer.files.length) setImportFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', () => { if (fileInput.files.length) setImportFile(fileInput.files[0]); });

async function setImportFile(file) {
  App.importFile = file;
  App.ankiData   = null;
  document.getElementById('drop-filename').textContent = file.name;
  document.getElementById('drop-filename').classList.remove('hidden');
  document.getElementById('import-result').classList.add('hidden');
  document.getElementById('anki-mapping').classList.add('hidden');
  document.getElementById('import-preview').classList.add('hidden');

  const submitBtn = document.getElementById('btn-import-submit');

  // Route .apkg to Anki preview flow
  if (file.name.toLowerCase().endsWith('.apkg')) {
    await _handleAnkiFile(file);
    return;
  }

  // .lex — auto-fill language/topic from metadata, then show CSV preview
  if (file.name.toLowerCase().endsWith('.lex')) {
    await _handleLexFile(file);
    return;
  }

  const previewEl = document.getElementById('import-preview');

  if (file.size === 0) {
    previewEl.classList.add('hidden');
    submitBtn.disabled = true;
    return;
  }

  const result = await parseImportPreview(file);

  if (result.error) {
    previewEl.classList.add('hidden');
    const resultEl = document.getElementById('import-result');
    resultEl.className = 'import-result error';
    resultEl.textContent = result.error;
    resultEl.classList.remove('hidden');
    submitBtn.disabled = true;
    return;
  }

  document.getElementById('preview-format').textContent = result.format;
  document.getElementById('preview-count').textContent  =
    `${result.totalRows} row${result.totalRows !== 1 ? 's' : ''} detected`;

  document.getElementById('preview-tbody').innerHTML = result.previewRows.map(r => `
    <tr>
      <td>${esc(r.word)}</td>
      <td>${esc(r.meaning)}</td>
      <td>${r.native ? esc(r.native) : '<span style="color:var(--text-secondary)">—</span>'}</td>
    </tr>`).join('');

  _applyPreviewWarning(result.warning, result.previewRows);

  previewEl.classList.remove('hidden');
  submitBtn.disabled = false;
}

async function _handleLexFile(file) {
  const submitBtn = document.getElementById('btn-import-submit');
  submitBtn.disabled = true;

  const text = await file.text();
  let language = '', topic = '';
  for (const line of text.split('\n')) {
    if (!line.startsWith('#')) break;
    const lm = line.match(/^#\s*language:\s*(.+)/i);
    if (lm) language = lm[1].trim();
    const tm = line.match(/^#\s*topic:\s*(.+)/i);
    if (tm) topic = tm[1].trim();
  }

  // Auto-fill language
  if (language) {
    const langSel = document.getElementById('sel-import-lang');
    const exists  = [...langSel.options].some(o => o.value === language);
    if (exists) {
      langSel.value = language;
      _populateImportTopicSelect(language);
    }
  }

  // Auto-fill topic
  if (topic) {
    const topicSel  = document.getElementById('sel-import-topic');
    const matchDeck = App.decks.find(d => d.language === language && d.topic === topic);
    if (matchDeck) {
      topicSel.value = String(matchDeck.id);
      document.getElementById('inp-import-topic-new').classList.add('hidden');
    } else {
      topicSel.value = '__new__';
      const inp = document.getElementById('inp-import-topic-new');
      inp.value = topic;
      inp.classList.remove('hidden');
    }
  }

  // Show CSV preview (lex is CSV with metadata comments)
  const previewEl = document.getElementById('import-preview');
  const result    = await parseImportPreview(file);

  if (result.error) {
    previewEl.classList.add('hidden');
    const resultEl = document.getElementById('import-result');
    resultEl.className   = 'import-result error';
    resultEl.textContent = result.error;
    resultEl.classList.remove('hidden');
    return;
  }

  document.getElementById('preview-format').textContent = 'LEX';
  document.getElementById('preview-count').textContent  =
    `${result.totalRows} row${result.totalRows !== 1 ? 's' : ''} detected`;
  document.getElementById('preview-tbody').innerHTML = result.previewRows.map(r => `
    <tr>
      <td>${esc(r.word)}</td>
      <td>${esc(r.meaning)}</td>
      <td>${r.native ? esc(r.native) : '<span style="color:var(--text-secondary)">—</span>'}</td>
    </tr>`).join('');

  _applyPreviewWarning(result.warning, result.previewRows);
  previewEl.classList.remove('hidden');
  submitBtn.disabled = false;
}

function _applyPreviewWarning(formatWarning, previewRows) {
  const langWarn = _langWarning(previewRows || [], _importLang());
  const combined = [formatWarning, langWarn].filter(Boolean).join(' ');
  const warnEl   = document.getElementById('preview-warning');
  if (combined) {
    warnEl.textContent = combined;
    warnEl.classList.remove('hidden');
  } else {
    warnEl.classList.add('hidden');
  }
}

async function _handleAnkiFile(file) {
  const submitBtn = document.getElementById('btn-import-submit');
  submitBtn.disabled = true;
  const resultEl = document.getElementById('import-result');
  resultEl.classList.add('hidden');

  const formData = new FormData();
  formData.append('file', file);

  const res = await apiUpload('/api/import/anki/preview', formData);
  if (!res || !res.ok) {
    const e = await res?.json().catch(() => ({}));
    resultEl.className   = 'import-result error';
    resultEl.textContent = friendlyError(e?.detail);
    resultEl.classList.remove('hidden');
    return;
  }

  const data = await res.json();
  App.ankiData = { noteTypes: data.note_types, selectedNtIdx: 0 };

  _renderAnkiMapping();
  submitBtn.disabled = false;
}

function _renderAnkiMapping() {
  const { noteTypes, selectedNtIdx } = App.ankiData;
  const nt = noteTypes[selectedNtIdx];

  // Populate note-type selector
  const ntSel = document.getElementById('anki-note-type');
  ntSel.innerHTML = noteTypes.map((n, i) =>
    `<option value="${i}"${i === selectedNtIdx ? ' selected' : ''}>${esc(n.name)} (${n.fields.length} fields)</option>`
  ).join('');

  // Populate field dropdowns
  const noneOpt = '<option value="-1">— none —</option>';
  const fieldOpts = nt.fields.map((f, i) => `<option value="${i}">${esc(f)}</option>`).join('');

  document.getElementById('anki-field-word').innerHTML    = fieldOpts;
  document.getElementById('anki-field-meaning').innerHTML = fieldOpts;
  document.getElementById('anki-field-native').innerHTML  = noneOpt + fieldOpts;

  // Sensible defaults: word=0, meaning=1, native=2 if ≥3 fields
  document.getElementById('anki-field-word').value    = '0';
  document.getElementById('anki-field-meaning').value = nt.fields.length > 1 ? '1' : '0';
  document.getElementById('anki-field-native').value  = nt.fields.length > 2 ? '2' : '-1';

  _renderAnkiPreview();
  document.getElementById('anki-mapping').classList.remove('hidden');
}

function _renderAnkiPreview() {
  const nt       = App.ankiData.noteTypes[App.ankiData.selectedNtIdx];
  const fWord    = parseInt(document.getElementById('anki-field-word').value, 10);
  const fMeaning = parseInt(document.getElementById('anki-field-meaning').value, 10);
  const fNative  = parseInt(document.getElementById('anki-field-native').value, 10);

  const tbody = document.getElementById('anki-preview-tbody');
  tbody.innerHTML = (nt.sample_rows || []).map(row => {
    const word    = row[fWord]    ?? '—';
    const meaning = row[fMeaning] ?? '—';
    const native  = fNative >= 0 ? (row[fNative] || '—') : '—';
    return `<tr><td>${esc(word)}</td><td>${esc(meaning)}</td><td>${esc(native)}</td></tr>`;
  }).join('');

  document.getElementById('anki-preview-wrap').classList.remove('hidden');
}

// Anki UI event listeners
document.getElementById('anki-note-type').addEventListener('change', e => {
  App.ankiData.selectedNtIdx = parseInt(e.target.value, 10);
  _renderAnkiMapping();
});
['anki-field-word', 'anki-field-meaning', 'anki-field-native'].forEach(id => {
  document.getElementById(id).addEventListener('change', _renderAnkiPreview);
});

document.getElementById('btn-import-back').addEventListener('click', showHome);

document.getElementById('btn-import-submit').addEventListener('click', async () => {
  const language = _importLang();
  const topic    = _importTopic();
  const file     = App.importFile || fileInput.files[0];
  const resultEl = document.getElementById('import-result');
  const btn      = document.getElementById('btn-import-submit');

  if (!language) { await showAlert('Please enter a language name.'); return; }
  if (!topic)    { await showAlert('Please enter a topic name.'); return; }
  if (!file)     { await showAlert('Please select a file.'); return; }

  setLoading(btn, true);
  const formData = new FormData();
  formData.append('file', file);

  let res;
  if (App.ankiData) {
    // Anki .apkg confirm
    const nt      = App.ankiData.noteTypes[App.ankiData.selectedNtIdx];
    const fWord    = document.getElementById('anki-field-word').value;
    const fMeaning = document.getElementById('anki-field-meaning').value;
    const fNative  = document.getElementById('anki-field-native').value;
    const params   = new URLSearchParams({
      language, topic,
      note_type_id: nt.id,
      field_word: fWord,
      field_meaning: fMeaning,
      ...(fNative !== '-1' ? { field_native: fNative } : {}),
    });
    res = await apiUpload(`/api/import/anki/confirm?${params}`, formData);
  } else {
    // CSV / TSV
    res = await apiUpload(
      `/api/import?language=${encodeURIComponent(language)}&topic=${encodeURIComponent(topic)}`,
      formData,
    );
  }

  if (!res) return;
  const data = await res.json();
  setLoading(btn, false);
  resultEl.classList.remove('hidden');

  if (res.ok) {
    if (data.rows_parsed === 0) {
      resultEl.className   = 'import-result error';
      resultEl.textContent = 'No rows imported. Check your file has a word,meaning,native header and valid data.';
    } else {
      resultEl.className = 'import-result success';
      resultEl.innerHTML = `<strong>Import complete!</strong> Parsed: ${data.rows_parsed} · Inserted: ${data.rows_inserted} · Skipped: ${data.rows_skipped}`;
    }
  } else {
    resultEl.className   = 'import-result error';
    resultEl.textContent = friendlyError(data?.detail);
  }
});

// ── Progress ──────────────────────────────────────────────────────────────────

function _heatmapRange(daysMap) {
  const today   = new Date();
  const active  = Object.keys(daysMap || {}).sort();
  if (!active.length) return { totalDays: 7, label: 'This week', cellSize: 26 };
  const first     = new Date(active[0] + 'T00:00:00');
  const daysSince = Math.round((today - first) / 86400000);
  const weeks     = Math.min(13, Math.max(1, Math.ceil((daysSince + 1) / 7)));
  const label     = weeks === 1  ? 'This week'
                  : weeks === 13 ? 'Last 13 weeks'
                  : `Last ${weeks} weeks`;
  const cellSize  = Math.min(32, Math.max(13, Math.floor((195 - (weeks - 1) * 2) / weeks)));
  return { totalDays: weeks * 7, label, cellSize };
}

function _activityHeatmapHtml(daysMap, totalDays = 91, cellSize = 13) {
  const today = new Date();
  const cells = [];
  for (let i = totalDays - 1; i >= 0; i--) {
    const d   = new Date(today);
    d.setDate(d.getDate() - i);
    const iso = d.toISOString().split('T')[0];
    const day = daysMap?.[iso];
    let heat  = 0;
    if (day) {
      const score = (day.cards / 50) + (day.immersion_minutes / 90) + (day.essays * 0.5);
      heat = Math.min(4, Math.max(1, Math.ceil(score * 2)));
    }
    const cls = ['heat-cell', `heat-${heat}`, i === 0 ? 'heat-today' : ''].filter(Boolean).join(' ');
    const tipParts = [iso];
    if (day?.cards)             tipParts.push(`${day.cards} cards`);
    if (day?.immersion_minutes) tipParts.push(`${_fmtMins(day.immersion_minutes)} immersion`);
    if (day?.essays)            tipParts.push(`${day.essays} essay${day.essays > 1 ? 's' : ''}`);
    if (day?.immersion_detail?.length) tipParts.push(...day.immersion_detail.slice(0, 2));
    cells.push(`<div class="${cls}" data-tip="${tipParts.join('|')}"></div>`);
  }
  return `<div class="heat-grid" id="heat-grid" style="--heat-cell:${cellSize}px">${cells.join('')}</div>
    <div class="heat-legend">Less
      <div class="heat-legend-cells">
        <div class="heat-0"></div><div class="heat-1"></div><div class="heat-2"></div><div class="heat-3"></div><div class="heat-4"></div>
      </div>
    More</div>`;
}

const DIRECTION_LABELS = {
  'word_to_meaning':   'Word → Meaning',
  'meaning_to_word':   'Meaning → Word',
  'native_to_meaning': 'Characters → Meaning',
  'native_to_word':    'Characters → Reading',
};

function _profBadge(score) {
  // score = correct_rate × coverage — both dimensions must be strong
  if (score >= 0.70) return { label: 'Fluent',      cls: 'badge-fluent'      };
  if (score >= 0.45) return { label: 'Proficient',  cls: 'badge-proficient'  };
  if (score >= 0.20) return { label: 'Developing',  cls: 'badge-developing'  };
  return                    { label: 'Beginner',    cls: 'badge-beginner'    };
}

function _langColour(language) {
  const clsMap = { 'pill-es':'#E63946','pill-zh':'#F4A261','pill-ja':'#4361EE',
                   'pill-no':'#2A9D8F','pill-fr':'#7C3AED','pill-de':'#991B1B','pill-xx':'#6B6B6B' };
  return clsMap[langConfig(language).cls] || '#6B6B6B';
}

function _renderProficiency(languages) {
  const container = document.getElementById('lang-proficiency');
  container._lastLanguages = languages;
  if (!languages.length) { container.innerHTML = '<p class="text-secondary" style="font-size:.85rem">No study data yet.</p>'; return; }

  container.innerHTML = languages.map(l => {
    const coverage  = l.total_cards > 0 ? (l.cards_seen || 0) / l.total_cards : 0;
    const score     = (l.correct_rate || 0) * coverage;
    const scorePct  = Math.round(score * 100);          // drives bar + badge
    const correctPct = Math.round((l.correct_rate || 0) * 100);  // shown as label
    const covPct    = Math.round(coverage * 100);
    const badge     = _profBadge(score);
    const colour    = _langColour(l.language);
    const dirs   = Object.entries(l.directions || {});

    const dirRows = dirs.length
      ? dirs.map(([d, v]) => {
          const dPct = Math.round((v.rate || 0) * 100);
          return `<div class="prof-dir-row">
            <span class="prof-dir-label">${DIRECTION_LABELS[d] || d}</span>
            <div class="prof-dir-bg"><div class="prof-dir-bar" style="width:${dPct}%;background:${colour}"></div></div>
            <span class="prof-dir-rate">${dPct}%</span>
          </div>`;
        }).join('')
      : '<p class="prof-no-data">No direction data yet — complete a quiz to see breakdown.</p>';

    const srs      = l.srs_health || {new: 0, learning: 0, mature: 0, overdue: 0};
    const srsTotal = srs.new + srs.learning + srs.mature + srs.overdue || 1;
    const srsBar   = `
      <div class="srs-health">
        <div class="srs-bar">
          <div class="srs-seg srs-new"      style="width:${Math.round(srs.new/srsTotal*100)}%"      title="New: ${srs.new}"></div>
          <div class="srs-seg srs-learning" style="width:${Math.round(srs.learning/srsTotal*100)}%" title="Learning: ${srs.learning}"></div>
          <div class="srs-seg srs-mature"   style="width:${Math.round(srs.mature/srsTotal*100)}%"   title="Mature: ${srs.mature}"></div>
          <div class="srs-seg srs-overdue"  style="width:${Math.round(srs.overdue/srsTotal*100)}%"  title="Overdue: ${srs.overdue}"></div>
        </div>
        <div class="srs-legend">
          <span class="srs-legend-item"><span class="srs-legend-dot" style="background:var(--border)"></span>New ${srs.new}</span>
          <span class="srs-legend-item"><span class="srs-legend-dot" style="background:#F4A261"></span>Learning ${srs.learning}</span>
          <span class="srs-legend-item"><span class="srs-legend-dot" style="background:#22c55e"></span>Mature ${srs.mature}</span>
          ${srs.overdue ? `<span class="srs-legend-item"><span class="srs-legend-dot" style="background:#ef4444"></span>Overdue ${srs.overdue}</span>` : ''}
        </div>
      </div>`;

    const isHidden  = App.hiddenLanguages.has(l.language);
    const eyeTitle  = isHidden ? 'Show in app' : 'Hide from app';
    const eyeIcon   = isHidden
      ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88"/></svg>`
      : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"/><path d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/></svg>`;

    return `
      <div class="card prof-card ${isHidden ? 'prof-card-hidden' : ''}" data-lang="${esc(l.language)}">
        <div class="prof-header">
          ${langPillHtml(l.language)}
          <span class="prof-name">${esc(l.language)}</span>
          <span class="prof-badge ${badge.cls}">${badge.label}</span>
          <button class="prof-eye-btn" data-lang="${esc(l.language)}" data-hidden="${isHidden}" title="${eyeTitle}" onclick="event.stopPropagation()">${eyeIcon}</button>
          <span class="prof-expand">&#9658;</span>
        </div>
        <div class="prof-bar-row">
          <div class="prof-bar-bg">
            <div class="prof-bar" style="width:${scorePct}%;background:${colour}"></div>
          </div>
          <span class="prof-rate-label">${scorePct}%</span>
        </div>
        <p class="prof-coverage">${correctPct}% correct · ${l.cards_seen || 0} / ${l.total_cards} words seen (${covPct}% coverage)</p>
        ${srsBar}
        <div class="prof-directions">${dirRows}</div>
      </div>`;
  }).join('');

  container.querySelectorAll('.prof-card').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.closest('.prof-eye-btn')) return;
      card.classList.toggle('open');
    });
  });

  container.querySelectorAll('.prof-eye-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const lang      = btn.dataset.lang;
      const nowHidden = btn.dataset.hidden !== 'true';
      await toggleHiddenLanguage(lang, nowHidden);
      _renderProficiency(container._lastLanguages);
    });
  });
}

const _ptState = { col: 'weakness_score', dir: 'asc', page: 1 };
let _allWeakestCards = [];
const _PT_PAGE = 20;

function _renderWeakestTable() {
  const cards = [..._allWeakestCards].sort((a, b) => {
    let av = a[_ptState.col] ?? 0, bv = b[_ptState.col] ?? 0;
    if (typeof av === 'string') { av = av.toLowerCase(); bv = String(bv).toLowerCase(); }
    return _ptState.dir === 'asc' ? (av < bv ? -1 : av > bv ? 1 : 0)
                                  : (av > bv ? -1 : av < bv ? 1 : 0);
  });

  const total  = cards.length;
  const pages  = Math.ceil(total / _PT_PAGE) || 1;
  const start  = (_ptState.page - 1) * _PT_PAGE;
  const slice  = cards.slice(start, start + _PT_PAGE);

  document.getElementById('progress-tbody').innerHTML = slice.length
    ? slice.map(c => `<tr>
        <td>${langPillHtml(c.language)}</td>
        <td><strong>${esc(c.word)}</strong><br><small class="text-secondary">${esc(c.meaning)}</small></td>
        <td>${c.total_seen}</td>
        <td>${c.total_seen ? Math.round((c.total_correct / c.total_seen) * 100) + '%' : '—'}</td>
        <td><span class="dir-badge">${DIR_LABELS[c.weakest_direction] || c.weakest_direction}</span></td>
      </tr>`).join('')
    : '<tr><td colspan="5" style="text-align:center;padding:2rem;color:var(--text-secondary)">No cards studied at least twice yet.</td></tr>';

  document.querySelectorAll('#progress-table-head th[data-col]').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.col === _ptState.col)
      th.classList.add(_ptState.dir === 'asc' ? 'sort-asc' : 'sort-desc');
  });

  const pg = document.getElementById('progress-pagination');
  pg.innerHTML = '';
  if (pages > 1) {
    if (_ptState.page > 1) {
      const p = document.createElement('button');
      p.className = 'btn-outline btn-sm'; p.textContent = '← Prev';
      p.onclick = () => { _ptState.page--; _renderWeakestTable(); };
      pg.appendChild(p);
    }
    const lbl = document.createElement('span');
    lbl.className = 'text-secondary';
    lbl.textContent = `Page ${_ptState.page} of ${pages}`;
    pg.appendChild(lbl);
    if (_ptState.page < pages) {
      const n = document.createElement('button');
      n.className = 'btn-outline btn-sm'; n.textContent = 'Next →';
      n.onclick = () => { _ptState.page++; _renderWeakestTable(); };
      pg.appendChild(n);
    }
  }
}

document.getElementById('progress-table-head').addEventListener('click', e => {
  const th = e.target.closest('[data-col]');
  if (!th) return;
  const col = th.dataset.col;
  _ptState.dir = _ptState.col === col && _ptState.dir === 'asc' ? 'desc' : 'asc';
  _ptState.col = col;
  _ptState.page = 1;
  _renderWeakestTable();
});

// ── Journal ───────────────────────────────────────────────────────────────────

const ACTIVITY_COLOURS = {
  watching: 'act-watching', listening: 'act-listening', reading: 'act-reading',
  speaking: 'act-speaking', writing: 'act-writing',   gaming: 'act-gaming', other: 'act-other',
};

const RESOURCE_TYPE_LABELS = {
  podcast: { creator: 'Channel',   detail: 'Episode title'   },
  tv_show: { creator: 'Show',      detail: 'Episode'         },
  movie:   { creator: 'Title',     detail: 'Year'            },
  music:   { creator: 'Artist',    detail: 'Track / Album'   },
  video:   { creator: 'Channel',   detail: 'Video title'     },
  book:    { creator: 'Author',    detail: 'Chapter / Page'  },
  app:     { creator: 'App name',  detail: 'Feature / Mode'  },
  other:   { creator: 'Name',      detail: 'Details'         },
};

function _updateResourceLabels() {
  const type   = document.getElementById('journal-resource-type')?.value || 'other';
  const labels = RESOURCE_TYPE_LABELS[type] || RESOURCE_TYPE_LABELS.other;
  const cLabel = document.getElementById('journal-creator-label');
  const dLabel = document.getElementById('journal-detail-label');
  if (cLabel) cLabel.childNodes[0].textContent = labels.creator + ' ';
  if (dLabel) dLabel.childNodes[0].textContent = labels.detail + ' ';
  const cInput = document.getElementById('journal-resource-creator');
  const dInput = document.getElementById('journal-resource-detail');
  if (cInput) cInput.placeholder = labels.creator;
  if (dInput) dInput.placeholder = labels.detail;
}

document.getElementById('journal-resource-type')
  ?.addEventListener('change', _updateResourceLabels);

let _journalRating    = 0;
let _journalPage      = 1;
const _JOURNAL_LIMIT  = 20;

function _fmtMins(mins) {
  const h = Math.floor(mins / 60), m = mins % 60;
  return h > 0 ? `${h}h${m > 0 ? ` ${m}m` : ''}` : `${m}m`;
}

function _stars(n) { return n ? '★'.repeat(n) + '☆'.repeat(5 - n) : ''; }

async function showJournal() {
  showScreen('screen-journal');
  _journalRating = 0;
  document.querySelectorAll('.rating-star').forEach(s => s.classList.remove('active'));
  _updateResourceLabels();

  // Set today's date
  document.getElementById('journal-date').valueAsDate = new Date();

  // Populate language dropdowns (journal log uses visible langs only; history filter shows all)
  const langs       = [...new Set(App.decks.map(d => d.language))].sort();
  const visibleLangs = langs.filter(l => !App.hiddenLanguages.has(l));
  const langSel = document.getElementById('journal-lang');
  langSel.innerHTML = visibleLangs.map(l => `<option value="${esc(l)}">${esc(titleCase(l))}</option>`).join('');

  const filterSel = document.getElementById('journal-filter-lang');
  filterSel.innerHTML = '<option value="">All languages</option>' +
    langs.map(l => `<option value="${esc(l)}">${esc(titleCase(l))}</option>`).join('');

  _journalPage = 1;
  await _loadJournalStats();
  await _loadJournalHistory();
}

async function _loadJournalStats() {
  const res = await api('GET', '/api/immersion/stats');
  if (!res?.ok) return;
  const s  = await res.json();
  const el = document.getElementById('journal-stats');

  if (s.total_entries === 0) { el.classList.add('hidden'); return; }

  const byLangAct = s.by_lang_activity || {};
  const topLangs  = Object.entries(s.by_language || {}).sort((a, b) => b[1] - a[1]);

  const langRows = topLangs.map(([lang, mins]) => `
    <div class="jstat-lang-row">
      <div class="jstat-lang-left">
        ${langPillHtml(lang)}
        <span class="jstat-lang-name">${esc(titleCase(lang))}</span>
      </div>
      <div class="jstat-lang-bar">${_actMixHtml(byLangAct[lang])}</div>
      <span class="jstat-lang-val">${_fmtMins(mins)}</span>
    </div>`).join('');

  const usedActs = [...new Set(Object.values(byLangAct).flatMap(a => Object.keys(a)))];
  const legend   = usedActs.map(a =>
    `<span><span class="act-legend-dot" style="background:${ACT_COLORS[a] || '#6B6B6B'}"></span>${a}</span>`
  ).join('');

  const weekLabel  = s.week_minutes > 0
    ? _fmtMins(s.week_minutes)
    : 'No activity';
  const weekSub    = s.week_entries
    ? `${s.week_entries} session${s.week_entries !== 1 ? 's' : ''} this week`
    : 'nothing logged yet this week';

  el.innerHTML = `
    <div class="jstat-hero-row">
      <div class="jstat-hero">
        <span class="jstat-hero-label">This week</span>
        <span class="jstat-hero-num">${weekLabel}</span>
        <span class="jstat-hero-sub">${weekSub}</span>
      </div>
      <div class="jstat-secondary">
        <div class="jstat-sec-item">
          <span class="jstat-sec-num">${_fmtMins(s.total_minutes)}</span>
          <span class="jstat-sec-label">all time</span>
        </div>
        <div class="jstat-sec-divider"></div>
        <div class="jstat-sec-item">
          <span class="jstat-sec-num">${s.total_entries}</span>
          <span class="jstat-sec-label">sessions</span>
        </div>
      </div>
    </div>
    ${topLangs.length ? `
    <div class="jstat-langs">
      <span class="jstat-langs-label">By language</span>
      ${langRows}
      ${legend ? `<div class="act-legend" style="margin-top:.4rem">${legend}</div>` : ''}
    </div>` : ''}`;

  el.classList.remove('hidden');
}

function _resourceDisplay(e) {
  if (e.resource_type) {
    const typeLabel = e.resource_type.replace('_', ' ');
    const parts     = [e.resource_creator, e.resource_detail].filter(Boolean).map(esc);
    const detail    = parts.length ? parts.join(' — ') : '';
    return `<span class="resource-type-tag">${esc(typeLabel)}</span>${detail ? ' ' + detail : ''}`;
  }
  return esc(e.resource || '');
}

async function _loadJournalHistory() {
  const lang   = document.getElementById('journal-filter-lang').value;
  const params = new URLSearchParams({ limit: _JOURNAL_LIMIT, page: _journalPage });
  if (lang) params.set('language', lang);

  const res = await api('GET', `/api/immersion?${params}`);
  if (!res?.ok) return;
  const entries = await res.json();

  const container = document.getElementById('journal-history');
  if (!entries.length && _journalPage === 1) {
    container.innerHTML = '<p class="text-secondary" style="font-size:.85rem;padding:.5rem 0">No sessions logged yet. Log your first session above.</p>';
  } else {
    container.innerHTML = entries.map(e => `
      <div class="journal-entry" id="jentry-${e.id}">
        <div class="je-header">
          <div class="je-header-left">
            <span class="activity-badge ${ACTIVITY_COLOURS[e.activity_type] || 'act-other'}">${esc(e.activity_type)}</span>
            ${langPillHtml(e.language)}
            <span class="je-duration">${_fmtMins(e.duration_minutes)}</span>
            ${e.rating ? `<span class="journal-stars">${_stars(e.rating)}</span>` : ''}
          </div>
          <button class="je-delete" onclick="deleteJournalEntry(${e.id})" title="Delete entry">×</button>
        </div>
        <div class="je-resource">${_resourceDisplay(e)}</div>
        <div class="je-meta">${new Date(e.logged_at).toLocaleDateString(undefined, {year:'numeric',month:'short',day:'numeric'})}</div>
        ${e.notes ? `<div class="je-notes">"${esc(e.notes)}"</div>` : ''}
        <div class="je-actions">
          <button class="btn-ghost btn-sm jaf-toggle" data-entry="${e.id}" data-lang="${esc(e.language)}">+ Add word</button>
          <button class="btn-ghost btn-sm ptx-toggle" data-entry="${e.id}" data-lang="${esc(e.language)}">⛏ Parse text</button>
          ${e.word_count > 0 ? `<button class="jaf-word-count" data-entry="${e.id}" data-lang="${esc(e.language)}">${e.word_count} word${e.word_count !== 1 ? 's' : ''}</button>` : ''}
        </div>
      </div>
      <div class="jaf-form hidden" id="jaf-${e.id}" data-lang="${esc(e.language)}" data-entry="${e.id}">
        <table class="jaf-table">
          <thead><tr><th>Word</th><th>Meaning</th><th>Native (optional)</th><th></th></tr></thead>
          <tbody class="jaf-rows">
            <tr class="jaf-row">
              <td><input class="jaf-word"    type="text" placeholder="Word"></td>
              <td><input class="jaf-meaning" type="text" placeholder="Meaning"></td>
              <td><input class="jaf-native"  type="text" placeholder="—"></td>
              <td><button class="btn-ghost btn-sm jaf-remove-row" title="Remove">×</button></td>
            </tr>
          </tbody>
        </table>
        <div class="jaf-actions">
          <button class="btn-ghost btn-sm jaf-add-row" data-entry="${e.id}">+ Add row</button>
          <button class="btn-primary btn-sm jaf-submit" data-entry="${e.id}">Save all</button>
          <button class="btn-ghost   btn-sm jaf-cancel" data-entry="${e.id}">Cancel</button>
          <span class="jaf-status"></span>
        </div>
      </div>
      <div class="ptx-panel hidden" id="ptx-${e.id}" data-lang="${esc(e.language)}" data-entry="${e.id}">
        <textarea class="ptx-textarea" placeholder="Paste ${titleCase(e.language)} text here…"></textarea>
        <div class="ptx-actions">
          <button class="btn-primary btn-sm ptx-extract" data-entry="${e.id}">Extract words</button>
          <button class="btn-ghost   btn-sm ptx-close"   data-entry="${e.id}">Cancel</button>
          <span class="ptx-status"></span>
        </div>
        <div class="ptx-results hidden"></div>
      </div>`).join('');
  }

  const pg = document.getElementById('journal-pagination');
  pg.innerHTML = '';
  if (_journalPage > 1) {
    const p = document.createElement('button');
    p.className = 'btn-outline btn-sm'; p.textContent = '← Prev';
    p.onclick = () => { _journalPage--; _loadJournalHistory(); };
    pg.appendChild(p);
  }
  if (entries.length === _JOURNAL_LIMIT) {
    const n = document.createElement('button');
    n.className = 'btn-outline btn-sm'; n.textContent = 'Next →';
    n.onclick = () => { _journalPage++; _loadJournalHistory(); };
    pg.appendChild(n);
  }
}

async function deleteJournalEntry(id) {
  if (!await showConfirm('Delete this log entry?', 'Delete', true)) return;
  const res = await api('DELETE', `/api/immersion/${id}`);
  if (res?.status === 204) {
    await _loadJournalStats();
    await _loadJournalHistory();
  }
}

// Rating stars
document.getElementById('journal-rating').querySelectorAll('.rating-star').forEach(btn => {
  btn.addEventListener('click', () => {
    const val = parseInt(btn.dataset.val, 10);
    _journalRating = _journalRating === val ? 0 : val;
    document.querySelectorAll('.rating-star').forEach((s, i) =>
      s.classList.toggle('active', i < _journalRating)
    );
  });
});

// Quick duration buttons
document.querySelectorAll('.journal-quick').forEach(btn => {
  btn.addEventListener('click', () => {
    const inp = document.getElementById('journal-duration');
    inp.value = Math.max(1, (parseInt(inp.value, 10) || 0) + parseInt(btn.dataset.add, 10));
  });
});

// ── Parse text from journal ───────────────────────────────────────────────────

document.getElementById('journal-history').addEventListener('click', e => {
  // Toggle parse-text panel
  const toggleBtn = e.target.closest('.ptx-toggle');
  if (toggleBtn) {
    const panel = document.getElementById(`ptx-${toggleBtn.dataset.entry}`);
    if (!panel) return;
    const opening = panel.classList.contains('hidden');
    // Close all other ptx panels first
    document.querySelectorAll('.ptx-panel').forEach(p => p.classList.add('hidden'));
    if (opening) {
      panel.classList.remove('hidden');
      panel.querySelector('.ptx-textarea')?.focus();
    }
    return;
  }

  // Close button
  const closeBtn = e.target.closest('.ptx-close');
  if (closeBtn) {
    document.getElementById(`ptx-${closeBtn.dataset.entry}`)?.classList.add('hidden');
    return;
  }

  // Extract button
  const extractBtn = e.target.closest('.ptx-extract');
  if (extractBtn) { _ptxExtract(extractBtn.dataset.entry); return; }

  // Select-all chips
  const selAllBtn = e.target.closest('.ptx-select-all');
  if (selAllBtn) {
    const panel = document.getElementById(`ptx-${selAllBtn.dataset.entry}`);
    panel?.querySelectorAll('.ptx-word-chip:not(.known)').forEach(c => c.classList.add('selected'));
    _ptxSyncTable(selAllBtn.dataset.entry);
    return;
  }

  // Word chip toggle
  const chip = e.target.closest('.ptx-word-chip:not(.known)');
  if (chip) {
    chip.classList.toggle('selected');
    _ptxSyncTable(chip.closest('.ptx-panel').dataset.entry);
    return;
  }

  // Save selected
  const saveBtn = e.target.closest('.ptx-save');
  if (saveBtn) { _ptxSave(saveBtn.dataset.entry); return; }
});

function _ptxSyncTable(entryId) {
  const panel    = document.getElementById(`ptx-${entryId}`);
  const results  = panel?.querySelector('.ptx-results');
  if (!panel || !results) return;

  const selected = [...panel.querySelectorAll('.ptx-word-chip.selected')];
  const tbody    = results.querySelector('.ptx-tbody');
  if (!tbody) return;

  // Add rows for newly selected chips, remove rows for deselected
  const selectedWords = new Set(selected.map(c => c.dataset.word));
  tbody.querySelectorAll('tr[data-word]').forEach(row => {
    if (!selectedWords.has(row.dataset.word)) row.remove();
  });
  selected.forEach(chip => {
    const word = chip.dataset.word;
    if (!tbody.querySelector(`tr[data-word="${CSS.escape(word)}"]`)) {
      const row = document.createElement('tr');
      row.dataset.word = word;
      row.innerHTML = `
        <td><input class="ptx-inp-word"    value="${esc(word)}"                   placeholder="Word"></td>
        <td><input class="ptx-inp-meaning" value="${esc(chip.dataset.meaning || '')}" placeholder="Meaning"></td>
        <td><input class="ptx-inp-native"  value="${esc(chip.dataset.native  || '')}" placeholder="—"></td>`;
      tbody.appendChild(row);
    }
  });

  const saveRow = results.querySelector('.ptx-save-row');
  if (saveRow) saveRow.style.display = selected.length ? '' : 'none';
}

async function _ptxExtract(entryId) {
  const panel    = document.getElementById(`ptx-${entryId}`);
  const lang     = panel.dataset.lang;
  const text     = panel.querySelector('.ptx-textarea').value.trim();
  const statusEl = panel.querySelector('.ptx-status');
  const results  = panel.querySelector('.ptx-results');

  if (!text) { statusEl.textContent = 'Paste some text first.'; return; }

  const extractBtn = panel.querySelector('.ptx-extract');
  setLoading(extractBtn, true);
  statusEl.textContent = '';
  results.classList.add('hidden');

  const res = await api('POST', '/api/journal/parse-text', { text, language: lang });
  setLoading(extractBtn, false);

  if (!res?.ok) {
    const err = await res?.json().catch(() => ({}));
    statusEl.textContent = friendlyError(err?.detail);
    return;
  }

  const data    = await res.json();
  const isCjk   = data.cjk;
  const newWords = data.new   || [];
  const known    = data.known || [];

  if (!newWords.length && !known.length) {
    statusEl.textContent = 'No words found in the text.';
    return;
  }

  statusEl.textContent = `${data.total} word${data.total !== 1 ? 's' : ''} found`;

  const newChips = newWords.map(w => `
    <span class="ptx-word-chip selected"
          data-word="${esc(w.word)}" data-meaning="${esc(w.meaning)}" data-native="${esc(w.native)}">
      ${esc(w.word)}${w.meaning ? `<span style="font-size:.72rem;color:var(--text-secondary);margin-left:.2rem">${esc(w.meaning)}</span>` : ''}
    </span>`).join('');

  const knownChips = known.length ? `
    <div class="ptx-section-label" style="margin-top:.6rem">Already in your deck (${known.length})</div>
    <div class="ptx-word-grid">${known.map(w => `
      <span class="ptx-word-chip known" data-word="${esc(w.word)}">${esc(w.word)}</span>`
    ).join('')}</div>` : '';

  const meaningHint = isCjk
    ? '' : '<p style="font-size:.75rem;color:var(--text-secondary);margin:.3rem 0 .5rem">Fill in meanings before saving.</p>';

  results.innerHTML = `
    <div class="ptx-section-label">
      New words (${newWords.length})
      <button class="ptx-select-all" data-entry="${entryId}" style="margin-left:.5rem">Select all</button>
    </div>
    <div class="ptx-word-grid">${newChips}</div>
    ${knownChips}
    ${meaningHint}
    <table class="ptx-table" style="${newWords.length ? '' : 'display:none'}">
      <thead><tr><th>Word</th><th>Meaning</th><th>Native</th></tr></thead>
      <tbody class="ptx-tbody"></tbody>
    </table>
    <div class="ptx-save-row" style="margin-top:.5rem;display:flex;align-items:center;gap:.5rem;flex-wrap:wrap">
      <button class="btn-primary btn-sm ptx-save"  data-entry="${entryId}">Save selected</button>
      <button class="btn-ghost   btn-sm ptx-close" data-entry="${entryId}">Cancel</button>
      <span class="ptx-save-status" style="font-size:.8rem"></span>
    </div>`;

  results.classList.remove('hidden');
  _ptxSyncTable(entryId);
}

async function _ptxSave(entryId) {
  const panel    = document.getElementById(`ptx-${entryId}`);
  const lang     = panel.dataset.lang;
  const statusEl = panel.querySelector('.ptx-save-status');
  const saveBtn  = panel.querySelector('.ptx-save');
  const rows     = [...panel.querySelectorAll('.ptx-tbody tr[data-word]')];

  const words = rows.map(row => ({
    word:    row.querySelector('.ptx-inp-word')?.value.trim(),
    meaning: row.querySelector('.ptx-inp-meaning')?.value.trim(),
    native:  row.querySelector('.ptx-inp-native')?.value.trim() || null,
  })).filter(w => w.word);

  if (!words.length) { statusEl.textContent = 'Select at least one word.'; return; }

  setLoading(saveBtn, true);
  statusEl.textContent = '';

  const deckRes = await api('POST', '/api/decks', { language: lang, topic: 'journal' });
  if (!deckRes?.ok) { setLoading(saveBtn, false); statusEl.textContent = 'Could not find deck.'; return; }
  const deck = await deckRes.json();

  let added = 0, skipped = 0;
  for (const w of words) {
    const res = await api('POST', '/api/cards',
      { deck_id: deck.id, word: w.word, meaning: w.meaning || '(no meaning)', native: w.native, source_log_id: parseInt(entryId) });
    if (res?.status === 201)  added++;
    else if (res?.status === 409) skipped++;
  }

  setLoading(saveBtn, false);
  const parts = [];
  if (added)   parts.push(`${added} saved`);
  if (skipped) parts.push(`${skipped} already in deck`);
  statusEl.textContent = parts.join(', ') + '.';

  if (added) await _loadJournalHistory();
}

// ── Add word from journal ──────────────────────────────────────────────────────

function _jafNewRow() {
  const tr = document.createElement('tr');
  tr.className = 'jaf-row';
  tr.innerHTML = `
    <td><input class="jaf-word"    type="text" placeholder="Word"></td>
    <td><input class="jaf-meaning" type="text" placeholder="Meaning"></td>
    <td><input class="jaf-native"  type="text" placeholder="—"></td>
    <td><button class="btn-ghost btn-sm jaf-remove-row" title="Remove">×</button></td>`;
  return tr;
}

function _jafReset(form) {
  const tbody = form.querySelector('.jaf-rows');
  tbody.innerHTML = '';
  tbody.appendChild(_jafNewRow());
  form.querySelector('.jaf-status').textContent = '';
  form.classList.add('hidden');
}

document.getElementById('journal-history').addEventListener('click', async e => {
  // Toggle form open/closed
  const toggleBtn = e.target.closest('.jaf-toggle');
  if (toggleBtn) {
    const form = document.getElementById(`jaf-${toggleBtn.dataset.entry}`);
    form.classList.toggle('hidden');
    if (!form.classList.contains('hidden')) form.querySelector('.jaf-word').focus();
    return;
  }

  // Add a row
  const addRowBtn = e.target.closest('.jaf-add-row');
  if (addRowBtn) {
    const form = document.getElementById(`jaf-${addRowBtn.dataset.entry}`);
    const row  = _jafNewRow();
    form.querySelector('.jaf-rows').appendChild(row);
    row.querySelector('.jaf-word').focus();
    return;
  }

  // Remove a row (keep at least one)
  const removeBtn = e.target.closest('.jaf-remove-row');
  if (removeBtn) {
    const tbody = removeBtn.closest('.jaf-rows');
    if (tbody.querySelectorAll('.jaf-row').length > 1) removeBtn.closest('.jaf-row').remove();
    return;
  }

  // Cancel
  const cancelBtn = e.target.closest('.jaf-cancel');
  if (cancelBtn) {
    _jafReset(document.getElementById(`jaf-${cancelBtn.dataset.entry}`));
    return;
  }

  // Open word count modal
  const countBtn = e.target.closest('.jaf-word-count');
  if (countBtn) {
    const logId = countBtn.dataset.entry;
    const lang  = countBtn.dataset.lang;
    document.getElementById('words-modal-title').textContent =
      `Words from this ${lang} session`;
    document.getElementById('words-modal-list').innerHTML =
      '<p class="text-secondary" style="font-size:.85rem">Loading…</p>';
    document.getElementById('words-modal-overlay').classList.remove('hidden');
    const res = await api('GET', `/api/immersion/${logId}/words`);
    if (!res?.ok) {
      document.getElementById('words-modal-list').innerHTML =
        '<p class="text-secondary" style="font-size:.85rem">Could not load words.</p>';
      return;
    }
    const words = await res.json();
    document.getElementById('words-modal-list').innerHTML = words.length
      ? `<table class="data-table"><thead><tr><th>Word</th><th>Meaning</th><th>Native</th></tr></thead>
         <tbody>${words.map(w => `<tr>
           <td>${esc(w.word)}</td>
           <td>${esc(w.meaning)}</td>
           <td>${w.native ? esc(w.native) : '<span style="color:var(--text-secondary)">—</span>'}</td>
         </tr>`).join('')}</tbody></table>`
      : '<p class="text-secondary" style="font-size:.85rem">No words saved from this entry.</p>';
    return;
  }

  // Submit all rows
  const submitBtn = e.target.closest('.jaf-submit');
  if (!submitBtn) return;

  const form   = document.getElementById(`jaf-${submitBtn.dataset.entry}`);
  const lang   = form.dataset.lang;
  const logId  = parseInt(form.dataset.entry, 10);
  const status = form.querySelector('.jaf-status');

  const rows = [...form.querySelectorAll('.jaf-row')].map(tr => ({
    word:    tr.querySelector('.jaf-word').value.trim(),
    meaning: tr.querySelector('.jaf-meaning').value.trim(),
    native:  tr.querySelector('.jaf-native').value.trim() || null,
  })).filter(r => r.word && r.meaning);

  if (!rows.length) {
    status.textContent = 'Fill in at least one word and meaning.';
    status.style.color = 'var(--danger)';
    return;
  }

  setLoading(submitBtn, true);
  status.textContent = '';

  const deckRes = await api('POST', '/api/decks', { language: lang, topic: 'journal' });
  if (!deckRes?.ok) {
    setLoading(submitBtn, false);
    status.textContent = 'Could not find deck.';
    status.style.color = 'var(--danger)';
    return;
  }
  const deck = await deckRes.json();

  let added = 0, skipped = 0;
  for (const row of rows) {
    const res = await api('POST', '/api/cards',
      { deck_id: deck.id, word: row.word, meaning: row.meaning, native: row.native, source_log_id: logId });
    if (res?.status === 201)    added++;
    else if (res?.status === 409) skipped++;
  }

  setLoading(submitBtn, false);
  const parts = [];
  if (added)   parts.push(`${added} added`);
  if (skipped) parts.push(`${skipped} already in deck`);
  status.textContent = parts.join(', ') + '.';
  status.style.color = added ? 'var(--success)' : 'var(--text-secondary)';

  if (added) {
    // Refresh this entry's word count badge
    await _loadJournalHistory();
  } else {
    setTimeout(() => { _jafReset(form); }, 2000);
  }
});

// Filter change
document.getElementById('journal-filter-lang').addEventListener('change', () => {
  _journalPage = 1;
  _loadJournalHistory();
});

document.getElementById('essay-filter-lang').addEventListener('change', _loadEssayHistory);

// Submit log
document.getElementById('btn-journal-log').addEventListener('click', async () => {
  const language         = document.getElementById('journal-lang').value;
  const activity_type    = document.getElementById('journal-activity').value;
  const resource_type    = document.getElementById('journal-resource-type').value;
  const resource_creator = document.getElementById('journal-resource-creator').value.trim() || null;
  const resource_detail  = document.getElementById('journal-resource-detail').value.trim() || null;
  const duration_minutes = parseInt(document.getElementById('journal-duration').value, 10);
  const notes            = document.getElementById('journal-notes').value.trim() || null;
  const dateVal          = document.getElementById('journal-date').value;
  const errEl            = document.getElementById('journal-err');
  errEl.classList.add('hidden');

  if (!duration_minutes || duration_minutes < 1) {
    errEl.textContent = 'Duration must be at least 1 minute.';
    errEl.classList.remove('hidden');
    return;
  }

  const logged_at = dateVal ? new Date(dateVal + 'T12:00:00').toISOString() : new Date().toISOString();

  const btn = document.getElementById('btn-journal-log');
  setLoading(btn, true);
  const res = await api('POST', '/api/immersion', {
    language, activity_type,
    resource_type, resource_creator, resource_detail,
    duration_minutes, notes, rating: _journalRating || null, logged_at,
  });
  setLoading(btn, false);

  if (!res?.ok) {
    const e = await res?.json().catch(() => ({}));
    errEl.textContent = friendlyError(e?.detail);
    errEl.classList.remove('hidden');
    return;
  }

  // Reset form
  document.getElementById('journal-resource-creator').value = '';
  document.getElementById('journal-resource-detail').value  = '';
  document.getElementById('journal-notes').value            = '';
  document.getElementById('journal-duration').value         = '30';
  _journalRating = 0;
  document.querySelectorAll('.rating-star').forEach(s => s.classList.remove('active'));
  _journalPage = 1;
  await _loadJournalStats();
  await _loadJournalHistory();
});

document.getElementById('btn-journal-back').addEventListener('click', showHome);

// ── Essay ─────────────────────────────────────────────────────────────────────

const _CAT_LABELS   = { grammar: 'Grammar', spelling: 'Spelling', punctuation: 'Punctuation', diacritics: 'Diacritics', fluency: 'Fluency' };
const _CAT_WEIGHTS  = { grammar: 30, spelling: 20, punctuation: 15, diacritics: 20, fluency: 15 };
const _CAT_COLOURS  = { grammar: '#4361EE', spelling: '#22c55e', punctuation: '#f59e0b', diacritics: '#E63946', fluency: '#2A9D8F' };

async function _loadEssayHistory() {
  const lang = document.getElementById('essay-filter-lang').value;
  const url  = `/api/essay/history?limit=20${lang ? `&language=${encodeURIComponent(lang)}` : ''}`;
  const res  = await api('GET', url);
  if (!res?.ok) return;
  const items = await res.json();
  document.getElementById('essay-history-tbody').innerHTML = items.length
    ? items.map(item => `<tr>
        <td>${new Date(item.submitted_at).toLocaleDateString()}</td>
        <td>${langPillHtml(item.language)}</td>
        <td>${item.word_count}</td>
        <td><strong>${Math.round(item.overall_score)}%</strong></td>
        <td><button class="btn-ghost btn-sm" onclick="loadEssay(${item.id})">View</button></td>
      </tr>`).join('')
    : '<tr><td colspan="5" style="text-align:center;padding:1.5rem;color:var(--text-secondary)">No essays yet.</td></tr>';
  document.getElementById('essay-history-section').classList.remove('hidden');
}

async function showEssay() {
  showScreen('screen-essay');
  document.getElementById('essay-result').classList.add('hidden');
  document.getElementById('essay-lang-warning').classList.add('hidden');
  document.getElementById('essay-form-card').classList.remove('hidden');
  document.getElementById('essay-form-err').classList.add('hidden');
  document.getElementById('essay-textarea').value = '';
  document.getElementById('essay-word-count').textContent = '0 words';
  document.getElementById('btn-essay-submit').disabled = true;

  const langs     = [...new Set(App.decks.map(d => d.language))].sort();
  const langList  = langs.length ? langs : SUPPORTED_LANGS;
  const visLangs  = langList.filter(l => !App.hiddenLanguages.has(l));

  document.getElementById('sel-essay-lang').innerHTML =
    visLangs.map(l => `<option value="${esc(l)}">${esc(titleCase(l))}</option>`).join('');

  document.getElementById('essay-filter-lang').innerHTML =
    '<option value="">All languages</option>' +
    langList.map(l => `<option value="${esc(l)}">${esc(titleCase(l))}</option>`).join('');

  await _loadEssayHistory();
}

document.getElementById('essay-textarea').addEventListener('input', () => {
  const words = document.getElementById('essay-textarea').value.trim().split(/\s+/).filter(Boolean).length;
  document.getElementById('essay-word-count').textContent = `${words} word${words !== 1 ? 's' : ''}`;
  document.getElementById('btn-essay-submit').disabled = words < 20;
});

document.getElementById('btn-essay-submit').addEventListener('click', async () => {
  const language = document.getElementById('sel-essay-lang').value;
  const text     = document.getElementById('essay-textarea').value.trim();
  const btn      = document.getElementById('btn-essay-submit');
  const errEl    = document.getElementById('essay-form-err');
  errEl.classList.add('hidden');

  setLoading(btn, true);
  const res = await api('POST', '/api/essay/submit', { language, text });
  setLoading(btn, false);

  const warningEl = document.getElementById('essay-lang-warning');
  warningEl.classList.add('hidden');

  if (!res || !res.ok) {
    const e = await res?.json().catch(() => ({}));
    const detail = e?.detail;
    if (detail?.code === 'language_mismatch') {
      errEl.textContent = `This essay looks like ${detail.detected}, not ${detail.selected}. Please check your language selection or rewrite in ${detail.selected}.`;
    } else {
      errEl.textContent = friendlyError(typeof detail === 'string' ? detail : detail?.message);
    }
    errEl.classList.remove('hidden');
    return;
  }

  const data = await res.json();

  if (data.warning?.code === 'language_uncertain') {
    const w = data.warning;
    document.getElementById('essay-lang-warning-text').textContent =
      `Heads up: this essay may be in ${w.detected}, not ${w.selected}. The evaluation was run anyway — scores may be inaccurate if the language is wrong.`;
    warningEl.classList.remove('hidden');
  }

  _renderEssayResult(data.evaluation);
  document.getElementById('essay-form-card').classList.add('hidden');
  document.getElementById('essay-result').classList.remove('hidden');
  await _loadEssayHistory();
});

function _essayCatsHtml(ev) {
  return Object.entries(_CAT_LABELS).map(([key, label]) => {
    const cat = ev.categories?.[key] || {};
    const s   = Math.round(cat.score ?? 100);
    const col = _CAT_COLOURS[key];
    const wt  = _CAT_WEIGHTS[key];
    return `<div class="essay-cat-bar">
      <div class="essay-cat-header">
        <span>${label}</span>
        <span class="essay-cat-score">${s}/100 <span class="text-secondary">(${wt}% weight)</span></span>
      </div>
      <div class="essay-bar-bg"><div class="essay-bar" style="width:${s}%;background:${col}"></div></div>
    </div>`;
  }).join('');
}

function _essayErrorsHtml(ev) {
  const groups = Object.entries(_CAT_LABELS).map(([key, label]) => {
    const errors = ev.categories?.[key]?.errors || [];
    if (!errors.length) return '';
    const items = errors.map(e => `
      <div class="essay-error-item">
        <span class="essay-error-original">"${esc(e.original || '')}"</span>
        <span class="essay-error-issue">${esc(e.issue || '')}</span>
        <span class="essay-error-fix">&#10140; ${esc(e.correction || '')}</span>
      </div>`).join('');
    return `<div class="essay-error-group"><h4>${label} errors</h4>${items}</div>`;
  }).join('');
  return groups || '<p class="text-secondary" style="font-size:.85rem">No specific errors flagged.</p>';
}

function _renderEssayResult(ev) {
  const score = Math.round(ev.overall_score || 0);
  const ring  = document.getElementById('essay-score-ring');
  ring.textContent = `${score}%`;
  ring.className   = `score-ring ${score >= 80 ? 'great' : score >= 50 ? 'ok' : 'poor'}`;
  document.getElementById('essay-feedback').textContent   = ev.overall_feedback || '';
  document.getElementById('essay-categories').innerHTML   = _essayCatsHtml(ev);
  document.getElementById('essay-errors').innerHTML       = _essayErrorsHtml(ev);
}

function _renderEssayModal(ev, language, meta, text = '') {
  const score   = Math.round(ev.overall_score || 0);
  const grade   = score >= 80 ? 'great' : score >= 50 ? 'ok' : 'poor';
  const overlay = document.getElementById('essay-modal-overlay');

  const ring = document.getElementById('essay-modal-ring');
  ring.textContent = `${score}%`;
  ring.className   = `score-ring ${grade}`;

  const scoreCard = document.getElementById('essay-modal-score-card');
  scoreCard.className = `essay-modal-score-card ${grade}`;

  document.getElementById('essay-modal-lang-pill').innerHTML = langPillHtml(language || '');
  document.getElementById('essay-modal-meta').textContent    = meta || '';
  document.getElementById('essay-modal-text').textContent    = text || '';

  // Reset essay toggle to collapsed
  const toggleBtn  = document.getElementById('btn-essay-modal-toggle');
  const textWrap   = document.getElementById('essay-modal-text-wrap');
  toggleBtn.classList.remove('open');
  textWrap.classList.add('hidden');

  overlay.querySelector('.essay-modal-feedback').textContent  = ev.overall_feedback || '';
  overlay.querySelector('.essay-modal-categories').innerHTML  = _essayCatsHtml(ev);
  overlay.querySelector('.essay-modal-errors').innerHTML      = _essayErrorsHtml(ev);
  overlay.classList.remove('hidden');
}

document.getElementById('btn-essay-modal-toggle').addEventListener('click', () => {
  const btn  = document.getElementById('btn-essay-modal-toggle');
  const wrap = document.getElementById('essay-modal-text-wrap');
  const open = wrap.classList.toggle('hidden');
  btn.classList.toggle('open', !open);
});

document.getElementById('btn-essay-new').addEventListener('click', () => {
  document.getElementById('essay-result').classList.add('hidden');
  document.getElementById('essay-form-card').classList.remove('hidden');
  document.getElementById('essay-textarea').value = '';
  document.getElementById('essay-word-count').textContent = '0 words';
  document.getElementById('btn-essay-submit').disabled = true;
});

async function loadEssay(id) {
  const res = await api('GET', `/api/essay/${id}`);
  if (!res?.ok) return;
  const data = await res.json();
  const meta = `${data.word_count} words · ${new Date(data.submitted_at).toLocaleDateString()}`;
  _renderEssayModal(data.evaluation, data.language, meta, data.text);
}

document.getElementById('essay-modal-close').addEventListener('click', () => {
  document.getElementById('essay-modal-overlay').classList.add('hidden');
});

document.getElementById('btn-essay-back').addEventListener('click', showHome);
document.getElementById('essay-lang-warning-dismiss').addEventListener('click', () => {
  document.getElementById('essay-lang-warning').classList.add('hidden');
});

// ── Progress ──────────────────────────────────────────────────────────────────

function _sparklineHtml(trend, w = 110, h = 32) {
  if (!trend?.length) return '';
  if (trend.length === 1) {
    const col = trend[0].score >= 70 ? '#22c55e' : trend[0].score >= 50 ? '#F4A261' : '#ef4444';
    return `<span style="font-size:.9rem;font-weight:700;color:${col}">${trend[0].score}%</span>`;
  }
  const scores = trend.map(t => t.score);
  const min    = Math.min(...scores);
  const max    = Math.max(...scores);
  const range  = (max - min) || 1;
  const step   = w / (scores.length - 1);
  const pts    = scores.map((s, i) => `${+(i * step).toFixed(1)},${+(h - ((s - min) / range) * (h - 4) - 2).toFixed(1)}`).join(' ');
  const last   = scores[scores.length - 1];
  const first  = scores[0];
  const col    = last >= first ? '#22c55e' : '#ef4444';
  const arrow  = last > first ? '↑' : last < first ? '↓' : '→';
  const lx     = +((scores.length - 1) * step).toFixed(1);
  const ly     = +(h - ((last - min) / range) * (h - 4) - 2).toFixed(1);
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="overflow:visible;flex-shrink:0">
    <polyline points="${pts}" fill="none" stroke="${col}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${lx}" cy="${ly}" r="2.5" fill="${col}"/>
  </svg><span style="font-size:.82rem;font-weight:700;color:${col};margin-left:.35rem">${last}% ${arrow}</span>`;
}

function _actMixHtml(byActivity) {
  if (!byActivity) return '';
  const total = Object.values(byActivity).reduce((a, b) => a + b, 0);
  if (!total) return '';
  const segs = Object.entries(byActivity)
    .sort((a, b) => b[1] - a[1])
    .map(([act, mins]) => {
      const pct = Math.round(mins / total * 100);
      return `<div class="act-seg" style="width:${pct}%;background:${ACT_COLORS[act] || '#6B6B6B'}" title="${act}: ${_fmtMins(mins)}"></div>`;
    }).join('');
  return `<div class="act-bar">${segs}</div>`;
}

function _renderStudyInvestment(dashLangs, immStats) {
  const el = document.getElementById('study-investment');
  const ct = document.getElementById('study-investment-content');
  if (!dashLangs?.length) { el.classList.add('hidden'); return; }

  const quizByLang = Object.fromEntries(dashLangs.map(l => [l.language, l.quiz_cards_total || 0]));
  const imByLang   = immStats?.by_language || {};
  const langs      = [...new Set([...Object.keys(quizByLang), ...Object.keys(imByLang)])];
  if (!langs.length) { el.classList.add('hidden'); return; }

  const maxQuiz = Math.max(...langs.map(l => quizByLang[l] || 0), 1);
  const maxIm   = Math.max(...langs.map(l => imByLang[l]   || 0), 1);

  const rows = langs
    .sort((a, b) => (quizByLang[b] || 0) + (imByLang[b] || 0) - ((quizByLang[a] || 0) + (imByLang[a] || 0)))
    .map(lang => {
      const qCards = quizByLang[lang] || 0;
      const iMins  = imByLang[lang]   || 0;
      const qPct   = Math.round(qCards / maxQuiz * 100);
      const iPct   = Math.round(iMins  / maxIm   * 100);
      return `<div class="invest-row">
        ${langPillHtml(lang)}
        <span class="invest-lang-name">${esc(lang)}</span>
        <div class="invest-bars">
          <div class="invest-bar-row">
            <div class="invest-bar-bg"><div class="invest-bar-fill" style="width:${qPct}%;background:#4361EE"></div></div>
            <span class="invest-bar-val">${qCards.toLocaleString()} cards</span>
          </div>
          <div class="invest-bar-row">
            <div class="invest-bar-bg"><div class="invest-bar-fill" style="width:${iPct}%;background:#2A9D8F"></div></div>
            <span class="invest-bar-val">${iMins ? _fmtMins(iMins) : '—'}</span>
          </div>
        </div>
      </div>`;
    }).join('');

  ct.innerHTML = `
    <div class="invest-header">
      <span><span class="invest-header-dot" style="background:#4361EE"></span>Quiz cards answered</span>
      <span><span class="invest-header-dot" style="background:#2A9D8F"></span>Immersion time</span>
    </div>
    ${rows}`;
  el.classList.remove('hidden');
}

function _initHeatmapTooltip() {
  const grid    = document.getElementById('heat-grid');
  const tooltip = document.getElementById('heatmap-tooltip');
  if (!grid || !tooltip) return;

  grid.addEventListener('mouseover', e => {
    const cell = e.target.closest('.heat-cell');
    if (!cell?.dataset.tip) return;
    const parts = cell.dataset.tip.split('|');
    tooltip.innerHTML = `<strong>${parts[0]}</strong>${parts.slice(1).map(p => `<br>${p}`).join('')}`;
    tooltip.style.display = 'block';
    const r = cell.getBoundingClientRect();
    tooltip.style.left = `${Math.min(r.left + window.scrollX, window.innerWidth - 230)}px`;
    tooltip.style.top  = `${r.top + window.scrollY - tooltip.offsetHeight - 8}px`;
  });
  grid.addEventListener('mouseout', e => {
    if (!e.relatedTarget?.closest?.('.heat-cell')) tooltip.style.display = 'none';
  });
  grid.addEventListener('click', e => {
    const cell = e.target.closest('.heat-cell');
    if (!cell?.dataset.tip) return;
    const parts = cell.dataset.tip.split('|');
    tooltip.innerHTML = `<strong>${parts[0]}</strong>${parts.slice(1).map(p => `<br>${p}`).join('')}`;
    tooltip.style.display = tooltip.style.display === 'none' ? 'block' : 'none';
    if (tooltip.style.display === 'block') {
      const r = cell.getBoundingClientRect();
      tooltip.style.left = `${Math.min(r.left + window.scrollX, window.innerWidth - 230)}px`;
      tooltip.style.top  = `${r.top + window.scrollY - tooltip.offsetHeight - 8}px`;
    }
  });
}

async function showProgress() {
  showScreen('screen-progress');
  document.getElementById('progress-empty').classList.add('hidden');
  document.getElementById('streak-card').innerHTML      = _progressSkeletonHtml();
  document.getElementById('progress-tbody').innerHTML   = '';
  document.getElementById('lang-proficiency').innerHTML = '';
  document.getElementById('profile-writing').classList.add('hidden');
  document.getElementById('profile-immersion').classList.add('hidden');
  document.getElementById('study-investment').classList.add('hidden');
  document.getElementById('heatmap-tooltip').style.display = 'none';

  const [streakRes, weakestRes, dashRes, essayRes, immersionRes, dailyRes] = await Promise.all([
    api('GET', '/api/progress/streak'),
    api('GET', '/api/progress/weakest?limit=500'),
    api('GET', '/api/progress/dashboard'),
    api('GET', '/api/essay/stats'),
    api('GET', '/api/immersion/stats'),
    api('GET', '/api/progress/daily-activity?days=91'),
  ]);

  let daysMap = {};
  if (dailyRes?.ok) { const d = await dailyRes.json(); daysMap = d.days || {}; }

  if (streakRes?.ok) {
    const s = await streakRes.json();
    if (s.total_days === 0) {
      document.getElementById('progress-empty').classList.remove('hidden');
      document.getElementById('streak-card').innerHTML = '';
      return;
    }
    document.getElementById('streak-card').innerHTML = `
      <div class="streak-inner">
        <div class="streak-left">
          ${(r => `<p class="streak-grid-label">${r.label}</p>${_activityHeatmapHtml(daysMap, r.totalDays, r.cellSize)}`)(_heatmapRange(daysMap))}
        </div>
        <div class="streak-right">
          <div class="streak-stat">
            <span class="streak-stat-num">${s.current_streak}</span>
            <span class="streak-stat-lbl">day streak</span>
          </div>
          <div class="streak-stat">
            <span class="streak-stat-num">${s.longest_streak}</span>
            <span class="streak-stat-lbl">best streak</span>
          </div>
          <div class="streak-stat">
            <span class="streak-stat-num">${s.total_days}</span>
            <span class="streak-stat-lbl">days studied</span>
          </div>
          <div class="streak-stat">
            <span class="streak-stat-num">${s.avg_cards_per_day ?? 0}</span>
            <span class="streak-stat-lbl">avg cards/day</span>
          </div>
          <div class="streak-stat">
            <span class="streak-stat-num">${daysMap[new Date().toISOString().split('T')[0]]?.cards ?? 0}</span>
            <span class="streak-stat-lbl">cards today</span>
          </div>
          <span class="streak-today-pill ${s.studied_today ? 'streak-today-yes' : 'streak-today-no'}">
            ${s.studied_today ? '✓ studied today' : '○ not yet today'}
          </span>
        </div>
      </div>`;
    _initHeatmapTooltip();
  }

  if (weakestRes?.ok) {
    _allWeakestCards = await weakestRes.json();
    _ptState.page = 1;
    _renderWeakestTable();
  }

  let dashData = null;
  if (dashRes?.ok) {
    dashData = await dashRes.json();
    _renderProficiency(dashData.languages || []);
  }

  let immData = null;
  if (immersionRes?.ok) immData = await immersionRes.json();

  _renderStudyInvestment(dashData?.languages, immData);

  // Writing section — sparklines per language
  if (essayRes?.ok) {
    const e = await essayRes.json();
    if (e.total > 0) {
      const trend = e.trend_by_language || {};
      const sparkRows = Object.entries(e.by_language)
        .sort((a, b) => b[1].avg_score - a[1].avg_score)
        .map(([lang, v]) => `
          <div class="essay-spark-row">
            <div class="essay-spark-left">
              ${langPillHtml(lang)}
              <span style="font-size:.82rem;text-transform:capitalize">${esc(lang)}</span>
              <span class="text-secondary" style="font-size:.75rem">${v.count} essay${v.count > 1 ? 's' : ''}</span>
            </div>
            <div class="essay-spark-right">${_sparklineHtml(trend[lang])}</div>
          </div>`).join('');
      document.getElementById('profile-writing-content').innerHTML = `
        <div class="journal-stats" style="border:none;padding:0;margin-bottom:.75rem">
          <div class="journal-stat"><span class="journal-stat-num">${e.total}</span><span class="journal-stat-label">essays</span></div>
          <div class="journal-stat"><span class="journal-stat-num">${e.average_score}%</span><span class="journal-stat-label">avg score</span></div>
          <div class="journal-stat"><span class="journal-stat-num">${e.best_score}%</span><span class="journal-stat-label">best</span></div>
        </div>
        ${sparkRows}`;
      document.getElementById('profile-writing').classList.remove('hidden');
    }
  }

  // Immersion section — activity mix stacked bars
  if (immData?.total_entries > 0) {
    const byLangAct  = immData.by_lang_activity || {};
    const topLangs   = Object.entries(immData.by_language || {}).sort((a, b) => b[1] - a[1]);
    const actMixRows = topLangs.map(([lang, mins]) => `
      <div class="act-mix-row">
        ${langPillHtml(lang)}
        <span class="act-mix-lang">${esc(lang)}</span>
        ${_actMixHtml(byLangAct[lang])}
        <span style="font-size:.75rem;color:var(--text-secondary);white-space:nowrap;margin-left:.4rem">${_fmtMins(mins)}</span>
      </div>`).join('');
    const usedActs = [...new Set(Object.values(byLangAct).flatMap(a => Object.keys(a)))];
    const legend   = usedActs.map(a =>
      `<span><span class="act-legend-dot" style="background:${ACT_COLORS[a] || '#6B6B6B'}"></span>${a}</span>`
    ).join('');
    document.getElementById('profile-immersion-content').innerHTML = `
      <div class="journal-stats" style="border:none;padding:0;margin-bottom:.75rem">
        <div class="journal-stat"><span class="journal-stat-num">${_fmtMins(immData.total_minutes)}</span><span class="journal-stat-label">total</span></div>
        <div class="journal-stat"><span class="journal-stat-num">${_fmtMins(immData.week_minutes)}</span><span class="journal-stat-label">this week</span></div>
        <div class="journal-stat"><span class="journal-stat-num">${immData.total_entries}</span><span class="journal-stat-label">sessions</span></div>
      </div>
      ${actMixRows}
      ${legend ? `<div class="act-legend">${legend}</div>` : ''}`;
    document.getElementById('profile-immersion').classList.remove('hidden');
  }
}

document.getElementById('btn-progress-back').addEventListener('click', showHome);

// ── Reset ─────────────────────────────────────────────────────────────────────

const _RESET_PHRASES = {
  soft: [
    "He went galumphing back",
    "And burbled as it came",
    "He chortled in his joy",
    "All mimsy were the borogoves",
    "Beware the Jabberwock my son",
    "The mome raths outgrabe",
    "Did gyre and gimble",
    "My beamish boy",
  ],
  hard: [
    "Twas brillig and the slithy toves",
    "The vorpal blade went snicker snack",
    "Came whiffling through the tulgey wood",
    "The Jabberwock with eyes of flame",
    "And as in uffish thought he stood",
    "Long time the manxome foe he sought",
    "O frabjous day Callooh Callay",
    "Did gyre and gimble in the wabe",
  ],
};

let _resetType = null;

function _openResetModal(type) {
  _resetType = type;
  const phrases  = _RESET_PHRASES[type];
  const phrase   = phrases[Math.floor(Math.random() * phrases.length)];
  const isSoft   = type === 'soft';

  document.getElementById('reset-modal-title').textContent =
    isSoft ? 'Soft Reset' : 'Hard Reset — this cannot be undone';
  document.getElementById('reset-modal-desc').textContent = isSoft
    ? 'All quiz history, card statistics, essays and journal entries will be permanently deleted. Your decks and vocabulary cards will be kept.'
    : 'Every deck, card, statistic, essay and journal entry will be permanently deleted. Only your username and password will remain.';
  document.getElementById('reset-modal-phrase').textContent = phrase;
  document.getElementById('reset-modal-input').value = '';
  document.getElementById('reset-modal-input').classList.remove('match');
  document.getElementById('reset-modal-confirm').disabled = true;
  document.getElementById('reset-modal-hint').classList.remove('hidden');
  document.getElementById('reset-modal-overlay').classList.remove('hidden');
  setTimeout(() => document.getElementById('reset-modal-input').focus(), 80);
}

document.getElementById('btn-soft-reset').addEventListener('click', () => _openResetModal('soft'));
document.getElementById('btn-hard-reset').addEventListener('click', () => _openResetModal('hard'));

document.getElementById('reset-modal-cancel').addEventListener('click', () => {
  document.getElementById('reset-modal-overlay').classList.add('hidden');
});

document.getElementById('reset-modal-input').addEventListener('input', e => {
  const expected = document.getElementById('reset-modal-phrase').textContent;
  const matches  = e.target.value === expected;
  e.target.classList.toggle('match', matches);
  document.getElementById('reset-modal-confirm').disabled = !matches;
});

document.getElementById('reset-modal-confirm').addEventListener('click', async () => {
  const btn = document.getElementById('reset-modal-confirm');
  setLoading(btn, true);
  const res = await api('POST', '/api/settings/reset', { type: _resetType });
  setLoading(btn, false);
  document.getElementById('reset-modal-overlay').classList.add('hidden');
  if (!res?.ok) { await showAlert('Reset failed. Please try again.'); return; }
  const msg = _resetType === 'soft'
    ? 'Statistics cleared. Your vocabulary is intact.'
    : 'All data wiped. Starting fresh.';
  await showAlert(msg);
  showHome();
});

// ── Init ──────────────────────────────────────────────────────────────────────

(function init() {
  initTheme();
  if (App.token) { _applyDemoBadge(App.token); initPWA(); showHome(); }
  else showScreen('screen-login');
}());
