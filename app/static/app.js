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

// ── State ─────────────────────────────────────────────────────────────────────

const App = {
  token:        sessionStorage.getItem('token'),
  decks:        [],
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

      // T / F: True–False
      const tfRow = document.getElementById('quiz-tf');
      if (!tfRow.classList.contains('hidden')) {
        if (e.key === 't' || e.key === 'T') {
          e.preventDefault(); tfRow.querySelector('[data-val="true"]:not(:disabled)')?.click(); return;
        }
        if (e.key === 'f' || e.key === 'F') {
          e.preventDefault(); tfRow.querySelector('[data-val="false"]:not(:disabled)')?.click(); return;
        }
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

function logout() {
  sessionStorage.removeItem('token');
  App.token = null;
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
    errEl.classList.add('hidden');
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

document.getElementById('btn-demo').addEventListener('click', () => {
  document.getElementById('inp-username').value = 'demo';
  document.getElementById('inp-password').value = 'demo';
  document.getElementById('form-login').requestSubmit();
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

async function showHome() {
  showScreen('screen-home');
  document.getElementById('deck-container').innerHTML = _deckSkeletonHtml();
  document.getElementById('weakest-section').classList.add('hidden');  // kept in DOM, not shown on home
  document.getElementById('home-streak').classList.add('hidden');
  document.getElementById('home-quick-start').classList.add('hidden');

  const [decksRes, streakRes] = await Promise.all([
    api('GET', '/api/decks'),
    api('GET', '/api/progress/streak'),
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
            <span class="home-quick-title">Continue studying <strong>${esc(lastDeck.language)}</strong></span>
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
    (byLang[deck.language] = byLang[deck.language] || []).push(deck);
  }

  container.innerHTML = Object.entries(byLang).map(([lang, langDecks]) => {
    const pct = _langProgress(lang, decks, statsMap);
    return `
    <div class="lang-group" data-language="${esc(lang)}">
      <div class="lang-group-header">
        ${langPillHtml(lang)}
        <h3>${esc(lang)}</h3>
        ${pct > 0 ? `<span class="lang-pct">${pct}% studied</span>` : ''}
      </div>
      <div class="topic-grid">
        ${langDecks.map(deck => {
          const s    = statsMap[deck.id];
          const seen = s?.cards_seen || 0;
          const pctD = deck.card_count > 0 ? Math.round(seen / deck.card_count * 100) : 0;
          return `
          <div class="card topic-card" data-deck-id="${deck.id}">
            <div class="topic-card-header">
              <span class="topic-name">${esc(deck.topic)}</span>
              <span class="badge">${deck.card_count}</span>
            </div>
            <div class="topic-progress">
              <div class="topic-progress-bar-bg">
                <div class="topic-progress-bar" style="width:${pctD}%"></div>
              </div>
              <span class="topic-progress-label">${seen} / ${deck.card_count} seen</span>
            </div>
            <div class="topic-actions" style="margin-top:.5rem">
              ${s?.due_count > 0 ? `<button class="btn-primary btn-sm" data-action="review" data-deck-id="${deck.id}">Review <span class="due-badge">${s.due_count}</span></button>` : ''}
              <button class="btn-outline btn-sm" data-action="test"   data-deck-id="${deck.id}">Test</button>
              <button class="btn-ghost btn-sm"   data-action="browse" data-deck-id="${deck.id}">Browse</button>
              <button class="btn-ghost btn-sm"   data-action="export" data-deck-id="${deck.id}">Export</button>
              <button class="btn-danger btn-sm"  data-action="delete" data-deck-id="${deck.id}">Delete</button>
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
  if (btn.dataset.action === 'review') startReview(deck);
  if (btn.dataset.action === 'test')   showTestSetup(deck);
  if (btn.dataset.action === 'browse') showBrowse(deck);
  if (btn.dataset.action === 'export') exportDeck(deck);
  if (btn.dataset.action === 'delete') deleteDeck(deck);
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
document.getElementById('btn-test-home').addEventListener('click', () => showTestSetup(null));
document.getElementById('btn-nav-import').addEventListener('click', () => showImport(null));
document.getElementById('btn-nav-home-tab').addEventListener('click', showHome);
document.getElementById('btn-nav-progress').addEventListener('click', showProgress);

// ── Test Setup ────────────────────────────────────────────────────────────────

function showTestSetup(preselectedDeck) {
  showScreen('screen-test-setup');

  const languages = [...new Set(App.decks.map(d => d.language))];
  const selLang   = document.getElementById('sel-language');
  const selTopic  = document.getElementById('sel-topic');
  selLang.innerHTML = languages.map(l => `<option value="${esc(l)}">${esc(l)}</option>`).join('');

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
    App.testMode = 'true_false';
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
  const btn = document.getElementById('btn-big-start');
  const ok  = App.totalRecallLangs.size >= 2;
  btn.disabled = !ok;
  btn.title    = ok ? '' : 'Select at least 2 languages to start';
}

function showBigTestSetup() {
  showScreen('screen-big-test-setup');

  const langs = [...new Set(App.decks.map(d => d.language))].sort();
  App.totalRecallLangs = new Set(langs);

  const langContainer = document.getElementById('total-recall-langs');
  langContainer.innerHTML = langs.map(lang =>
    `<div class="lang-check-item selected" data-lang="${esc(lang)}">
       ${langPillHtml(lang)}<span>${esc(lang)}</span>
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
  if (App.totalRecallLangs.size < 2) {
    await showAlert('Select at least 2 languages before starting Total Recall.');
    return;
  }
  const btn = document.getElementById('btn-big-start');
  setLoading(btn, true);
  const selectedLangs = [...App.totalRecallLangs];
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
  ['quiz-feedback', 'quiz-mcq', 'quiz-tf', 'quiz-typing', 'quiz-hint-row',
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

  if (question.type === 'mcq')             renderMcq(question);
  else if (question.type === 'true_false') renderTf(question);
  else if (question.type === 'flashcard')  renderFlashcard(question);
  else                                     renderTyping();

  if (question.type === 'typing')    document.getElementById('quiz-hint-row').classList.remove('hidden');
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

function renderTf(question) {
  const row = document.getElementById('quiz-tf');
  row.classList.remove('hidden');
  row.querySelectorAll('.tf-btn').forEach(b => { b.disabled = false; b.className = 'tf-btn'; });
}

document.getElementById('quiz-tf').querySelectorAll('.tf-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const q       = App.quiz.question;
    const correct = String(q.correct_answer).toLowerCase();
    const userVal = btn.dataset.val;
    document.getElementById('quiz-tf').querySelectorAll('.tf-btn').forEach(b => {
      b.disabled = true;
      if (b.dataset.val === correct)              b.classList.add('correct');
      else if (b === btn && userVal !== correct)  b.classList.add('wrong');
    });
    handleAnswer(userVal, correct);
  });
});

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
    const display = correctAnswer === 'true' ? 'True' : correctAnswer === 'false' ? 'False' : correctAnswer;
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
    card_count: missed.length, shuffle: true,
  });
  if (!res || !res.ok) {
    const e = await res?.json().catch(() => ({}));
    await showAlert(friendlyError(e?.detail));
    setLoading(btn, false);
    return;
  }
  const data = await res.json();
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
  document.getElementById('browse-title').textContent = `${deck.language} / ${deck.topic}`;
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
      <td><button class="btn-danger btn-sm" data-delete-id="${c.id}">Delete</button></td>
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
  const btn = e.target.closest('[data-delete-id]');
  if (!btn || !await showConfirm('Delete this card?', 'Delete', true)) return;
  const res = await api('DELETE', `/api/cards/${btn.dataset.deleteId}`);
  if (res?.status === 204) await loadBrowsePage(App.browse.page);
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

  // Always show the 4 supported languages; also include any extras already in DB
  const existing = App.decks.map(d => d.language);
  const langs    = [...new Set([...SUPPORTED_LANGS, ...existing])].sort();

  sel.innerHTML = langs.map(l => `<option value="${esc(l)}">${esc(l)}</option>`).join('');

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

function _streakCalendarHtml(studiedDates) {
  const studied = new Set(studiedDates);
  const today   = new Date();
  let html      = '<div class="streak-calendar">';
  for (let i = 29; i >= 0; i--) {
    const d    = new Date(today);
    d.setDate(d.getDate() - i);
    const iso  = d.toISOString().split('T')[0];
    const cls  = [
      'day-sq',
      studied.has(iso) ? 'studied' : '',
      i === 0 ? 'today' : '',
    ].filter(Boolean).join(' ');
    html += `<div class="${cls}" title="${iso}"></div>`;
  }
  return html + '</div>';
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

    return `
      <div class="card prof-card" data-lang="${esc(l.language)}">
        <div class="prof-header">
          ${langPillHtml(l.language)}
          <span class="prof-name">${esc(l.language)}</span>
          <span class="prof-badge ${badge.cls}">${badge.label}</span>
          <span class="prof-expand">&#9658;</span>
        </div>
        <div class="prof-bar-row">
          <div class="prof-bar-bg">
            <div class="prof-bar" style="width:${scorePct}%;background:${colour}"></div>
          </div>
          <span class="prof-rate-label">${scorePct}%</span>
        </div>
        <p class="prof-coverage">${correctPct}% correct · ${l.cards_seen || 0} / ${l.total_cards} words seen (${covPct}% coverage)</p>
        <div class="prof-directions">${dirRows}</div>
      </div>`;
  }).join('');

  container.querySelectorAll('.prof-card').forEach(card => {
    card.addEventListener('click', () => card.classList.toggle('open'));
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

async function showProgress() {
  showScreen('screen-progress');
  document.getElementById('progress-empty').classList.add('hidden');
  document.getElementById('streak-card').innerHTML    = _progressSkeletonHtml();
  document.getElementById('progress-tbody').innerHTML = '';
  document.getElementById('lang-proficiency').innerHTML = '';

  const [streakRes, weakestRes, dashRes] = await Promise.all([
    api('GET', '/api/progress/streak'),
    api('GET', '/api/progress/weakest?limit=500'),
    api('GET', '/api/progress/dashboard'),
  ]);

  if (streakRes?.ok) {
    const s = await streakRes.json();
    if (s.total_days === 0) {
      document.getElementById('progress-empty').classList.remove('hidden');
      document.getElementById('streak-card').innerHTML = '';
      return;
    }
    document.getElementById('streak-card').innerHTML = `
      <div class="streak-top">
        <div class="streak-number">${s.current_streak}</div>
        <span class="text-secondary">day streak</span>
        <span class="text-secondary" style="margin-left:auto">${s.total_days} days studied</span>
      </div>
      <p class="text-secondary" style="font-size:.8rem;margin-bottom:.5rem">
        Last 30 days — ${s.studied_today ? 'studied today ✓' : 'not studied today'}
      </p>
      ${_streakCalendarHtml(s.studied_dates_last_30 || [])}`;
  }

  if (weakestRes?.ok) {
    _allWeakestCards = await weakestRes.json();
    _ptState.page = 1;
    _renderWeakestTable();
  }

  if (dashRes?.ok) {
    const dash = await dashRes.json();
    _renderProficiency(dash.languages || []);
  }
}

document.getElementById('btn-progress-back').addEventListener('click', showHome);

// ── Init ──────────────────────────────────────────────────────────────────────

(function init() {
  initTheme();
  if (App.token) showHome();
  else showScreen('screen-login');
}());
