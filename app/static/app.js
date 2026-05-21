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
  browse: { deck: null, page: 1, cards: [] },
  importFile: null,

  // Test setup selections
  testMode:      'mcq',
  testDirection: '1_and_2',
  bigTestMode:   'mcq',
  bigTestCount:  20,
};

// ── API ───────────────────────────────────────────────────────────────────────

async function api(method, path, body = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (App.token) headers['Authorization'] = `Bearer ${App.token}`;
  const opts = { method, headers };
  if (body !== null) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  if (res.status === 401) { logout(); return null; }
  return res;
}

async function apiUpload(path, formData) {
  const headers = App.token ? { 'Authorization': `Bearer ${App.token}` } : {};
  const res = await fetch(path, { method: 'POST', headers, body: formData });
  if (res.status === 401) { logout(); return null; }
  return res;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

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
    errEl.textContent = err.detail || 'Login failed.';
    errEl.classList.remove('hidden');
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

async function showHome() {
  showScreen('screen-home');

  const [decksRes, streakRes, weakestRes] = await Promise.all([
    api('GET', '/api/decks'),
    api('GET', '/api/progress/streak'),
    api('GET', '/api/progress/weakest?limit=5'),
  ]);

  if (!decksRes) return;

  App.decks = decksRes.ok ? await decksRes.json() : [];

  if (streakRes?.ok) {
    const s = await streakRes.json();
    const streakLine = document.getElementById('streak-line');
    streakLine.textContent = s.current_streak > 0
      ? `${s.current_streak}-day streak • ${s.total_days} days studied`
      : s.total_days > 0 ? `${s.total_days} days studied` : '';
  }

  if (weakestRes?.ok) {
    const weakest = await weakestRes.json();
    renderWeakest(weakest);
  }

  renderDecks(App.decks);
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

function renderDecks(decks) {
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

  container.innerHTML = Object.entries(byLang).map(([lang, langDecks]) => `
    <div class="lang-group" data-language="${esc(lang)}">
      <div class="lang-group-header">
        ${langPillHtml(lang)}
        <h3>${esc(lang)}</h3>
        <span class="text-secondary" style="font-size:.8rem">${langDecks.reduce((s,d) => s + d.card_count, 0)} cards</span>
      </div>
      <div class="topic-grid">
        ${langDecks.map(deck => `
          <div class="card topic-card" data-deck-id="${deck.id}">
            <div class="topic-card-header">
              <span class="topic-name">${esc(deck.topic)}</span>
              <span class="badge">${deck.card_count}</span>
            </div>
            <div class="topic-actions">
              <button class="btn-outline btn-sm" data-action="test" data-deck-id="${deck.id}">Test</button>
              <button class="btn-ghost btn-sm"   data-action="browse" data-deck-id="${deck.id}">Browse</button>
            </div>
          </div>`).join('')}
      </div>
    </div>`).join('');
}

document.getElementById('deck-container').addEventListener('click', e => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const deckId = parseInt(btn.dataset.deckId, 10);
  const deck   = App.decks.find(d => d.id === deckId);
  if (!deck) return;
  if (btn.dataset.action === 'test')   showTestSetup(deck);
  if (btn.dataset.action === 'browse') showBrowse(deck);
});

document.getElementById('nav-home').addEventListener('click', showHome);
document.getElementById('btn-big-test').addEventListener('click', showBigTestSetup);
document.getElementById('btn-test-home').addEventListener('click', () => showTestSetup(null));
document.getElementById('btn-nav-import').addEventListener('click', () => showImport(null));
document.getElementById('btn-nav-progress').addEventListener('click', showProgress);

// ── Test Setup ────────────────────────────────────────────────────────────────

function showTestSetup(preselectedDeck) {
  showScreen('screen-test-setup');

  const languages = [...new Set(App.decks.map(d => d.language))];
  const selLang   = document.getElementById('sel-language');
  selLang.innerHTML = languages.map(l => `<option value="${esc(l)}">${esc(l)}</option>`).join('');

  if (preselectedDeck) selLang.value = preselectedDeck.language;

  updateTopics(preselectedDeck?.id);
  renderModeGrid('test-mode-grid', App.testMode, lang => lang !== null);
  renderDirectionGrid(selLang.value);

  selLang.addEventListener('change', () => {
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

function renderDirectionGrid(language) {
  const native = hasNativeScript(language);
  const dirs   = native
    ? ['1_only', '2_only', '1_and_2', '3_only', '4_only', 'all_available', 'random']
    : ['1_only', '2_only', '1_and_2'];

  if (!dirs.includes(App.testDirection)) App.testDirection = '1_and_2';

  const grid = document.getElementById('test-dir-grid');
  grid.innerHTML = '';
  dirs.forEach(dir => {
    const btn = document.createElement('button');
    btn.className = `toggle-btn${App.testDirection === dir ? ' active' : ''}`;
    btn.textContent = DIR_LABELS[dir];
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
  const mcqBtn  = document.querySelector('#test-mode-grid .toggle-btn[data-mode="mcq"]');
  if (!mcqBtn) return;

  const tooFew = langCardCount < 4;
  mcqBtn.disabled = tooFew;
  warning.classList.toggle('hidden', !tooFew);
  if (tooFew && App.testMode === 'mcq') {
    App.testMode = 'true_false';
    document.querySelectorAll('#test-mode-grid .toggle-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === App.testMode);
    });
  }
}

function renderModeGrid(gridId, activeMode, _filter) {
  const grid  = document.getElementById(gridId);
  const modes = [
    { key: 'mcq',        label: 'Multiple Choice' },
    { key: 'true_false', label: 'True / False'    },
    { key: 'typing',     label: 'Typing'           },
  ];
  grid.innerHTML = '';
  modes.forEach(({ key, label }) => {
    const btn = document.createElement('button');
    btn.className     = `toggle-btn${activeMode === key ? ' active' : ''}`;
    btn.dataset.mode  = key;
    btn.textContent   = label;
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      if (gridId === 'test-mode-grid') App.testMode = key;
      else App.bigTestMode = key;
      grid.querySelectorAll('.toggle-btn').forEach(b => b.classList.toggle('active', b === btn));
    });
    grid.appendChild(btn);
  });
}

document.getElementById('btn-test-back').addEventListener('click', showHome);

document.getElementById('btn-test-start').addEventListener('click', async () => {
  const deckId    = parseInt(document.getElementById('sel-topic').value, 10);
  const cardCount = parseInt(document.getElementById('inp-card-count').value, 10) || 20;

  const res = await api('POST', '/api/quiz/start', {
    scope:      'test',
    deck_id:    deckId,
    mode:       App.testMode,
    direction:  App.testDirection,
    card_count: cardCount,
  });

  if (!res || !res.ok) {
    const err = await res?.json().catch(() => ({}));
    await showAlert(err.detail || 'Could not start quiz.');
    return;
  }

  const data = await res.json();
  initQuizState(data);
  showScreen('screen-quiz');
  renderQuizQuestion(data.question);
});

// ── Big Test Setup ────────────────────────────────────────────────────────────

function showBigTestSetup() {
  showScreen('screen-big-test-setup');
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
  const res = await api('POST', '/api/quiz/start', {
    scope:      'big_test',
    deck_id:    null,
    mode:       App.bigTestMode,
    direction:  '1_and_2',
    card_count: App.bigTestCount,
  });

  if (!res || !res.ok) {
    const err = await res?.json().catch(() => ({}));
    await showAlert(err.detail || 'Could not start Big Test.');
    return;
  }

  const data = await res.json();
  initQuizState(data);
  showScreen('screen-quiz');
  renderQuizQuestion(data.question);
});

// ── Quiz ─────────────────────────────────────────────────────────────────────

function initQuizState(data) {
  Object.assign(App.quiz, {
    sessionId:    data.session_id,
    mode:         data.mode,
    scope:        data.scope,
    direction:    data.direction,
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
  ['quiz-feedback', 'quiz-mcq', 'quiz-tf', 'quiz-typing', 'quiz-hint-row', 'quiz-native-display']
    .forEach(id => document.getElementById(id).classList.add('hidden'));
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

  if (question.type === 'mcq')        renderMcq(question);
  else if (question.type === 'true_false') renderTf(question);
  else                                     renderTyping();

  if (question.type === 'typing') document.getElementById('quiz-hint-row').classList.remove('hidden');
}

function renderMcq(question) {
  const grid = document.getElementById('quiz-mcq');
  grid.innerHTML = '';
  grid.classList.remove('hidden');

  question.options.forEach(opt => {
    const btn = document.createElement('button');
    btn.className = 'mcq-btn';
    btn.textContent = opt;
    btn.addEventListener('click', () => {
      grid.querySelectorAll('.mcq-btn').forEach(b => {
        b.disabled = true;
        if (b.textContent === String(question.correct_answer)) b.classList.add('correct');
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
  if (!res || !res.ok) { await showAlert('Failed to submit answer.'); return; }

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
  showFeedback(data.is_correct, data.correct_answer, data.question, diacriticsRemark);
}

function showFeedback(isCorrect, correctAnswer, nextQuestion, diacriticsRemark = false) {
  const fb = document.getElementById('quiz-feedback');
  fb.className = `feedback ${isCorrect ? 'correct' : 'wrong'}`;
  fb.classList.remove('hidden');

  document.getElementById('feedback-icon').textContent = isCorrect ? '✓' : '✗';
  document.getElementById('feedback-msg').textContent  = isCorrect ? 'Correct!' : 'Incorrect';

  const correctEl = document.getElementById('feedback-correct');
  const mode      = App.quiz.mode;

  if (!isCorrect) {
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
  btnNext.textContent = nextQuestion ? 'Next →' : 'See Results';
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

function showResults() {
  showScreen('screen-results');

  const { total, correct, answers } = App.quiz;
  const pct = total > 0 ? Math.round((correct / total) * 100) : 0;

  const ring = document.getElementById('score-ring');
  ring.textContent = `${pct}%`;
  ring.className   = `score-ring ${pct >= 80 ? 'great' : pct >= 50 ? 'ok' : 'poor'}`;
  document.getElementById('score-label').textContent = `${correct} correct out of ${total}`;

  const missed        = answers.filter(a => !a.is_correct);
  const missedSection = document.getElementById('missed-section');

  if (missed.length) {
    missedSection.classList.remove('hidden');
    document.getElementById('missed-tbody').innerHTML = missed.map(a => {
      const ca = a.correct_answer === 'true' ? 'True'
               : a.correct_answer === 'false' ? 'False'
               : esc(a.correct_answer);
      return `<tr>
        <td>${langPillHtml(a.language)} ${esc(a.question)}</td>
        <td class="cell-wrong">${esc(a.user_answer || '—')}</td>
        <td class="cell-correct">${ca}</td>
      </tr>`;
    }).join('');
  } else {
    missedSection.classList.add('hidden');
  }
}

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
  showScreen('screen-browse');
  await loadBrowsePage(1);
}

async function loadBrowsePage(page) {
  App.browse.page = page;
  const res = await api('GET', `/api/cards?deck_id=${App.browse.deck.id}&page=${page}&size=50`);
  if (!res || !res.ok) return;
  App.browse.cards = await res.json();
  renderBrowseCards(App.browse.cards);
  renderBrowsePagination(page);
}

function renderBrowseCards(cards) {
  const tbody = document.getElementById('browse-tbody');
  if (!cards.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:2rem;color:var(--text-secondary)">No cards found.</td></tr>';
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
  App.importFile = null;
  document.getElementById('inp-import-file').value = '';
  document.getElementById('drop-filename').classList.add('hidden');
  document.getElementById('import-result').classList.add('hidden');

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

function setImportFile(file) {
  App.importFile = file;
  const el = document.getElementById('drop-filename');
  el.textContent = file.name;
  el.classList.remove('hidden');
}

document.getElementById('btn-import-back').addEventListener('click', showHome);

document.getElementById('btn-import-submit').addEventListener('click', async () => {
  const language = _importLang();
  const topic    = _importTopic();
  const file     = App.importFile || fileInput.files[0];
  const resultEl = document.getElementById('import-result');

  if (!language) { await showAlert('Please enter a language name.'); return; }
  if (!topic)    { await showAlert('Please enter a topic name.'); return; }
  if (!file)     { await showAlert('Please select a file.'); return; }

  const formData = new FormData();
  formData.append('file', file);

  const res = await apiUpload(
    `/api/import?language=${encodeURIComponent(language)}&topic=${encodeURIComponent(topic)}`,
    formData,
  );
  if (!res) return;

  const data = await res.json();
  resultEl.classList.remove('hidden');

  if (res.ok) {
    if (data.rows_parsed === 0) {
      resultEl.className = 'import-result error';
      resultEl.textContent = 'No rows imported. Check your file has a word,meaning,native header and valid data.';
    } else {
      resultEl.className = 'import-result success';
      resultEl.innerHTML = `<strong>Import complete!</strong> Parsed: ${data.rows_parsed} · Inserted: ${data.rows_inserted} · Skipped: ${data.rows_skipped}`;
    }
  } else {
    resultEl.className = 'import-result error';
    resultEl.textContent = data.detail || 'Import failed.';
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

async function showProgress() {
  showScreen('screen-progress');

  const [streakRes, weakestRes, dashRes] = await Promise.all([
    api('GET', '/api/progress/streak'),
    api('GET', '/api/progress/weakest?limit=20'),
    api('GET', '/api/progress/dashboard'),
  ]);

  if (streakRes?.ok) {
    const s = await streakRes.json();
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
    const cards = await weakestRes.json();
    document.getElementById('progress-tbody').innerHTML = cards.length
      ? cards.map(c => `
          <tr>
            <td>${langPillHtml(c.language)}</td>
            <td><strong>${esc(c.word)}</strong><br><small class="text-secondary">${esc(c.meaning)}</small></td>
            <td>${c.total_seen}</td>
            <td>${c.total_seen ? Math.round((c.total_correct / c.total_seen) * 100) + '%' : '—'}</td>
            <td><span class="dir-badge">${DIR_LABELS[c.weakest_direction] || c.weakest_direction}</span></td>
          </tr>`).join('')
      : '<tr><td colspan="5" style="text-align:center;padding:2rem;color:var(--text-secondary)">No cards studied yet.</td></tr>';
  }

  if (dashRes?.ok) {
    const dash = await dashRes.json();
    document.getElementById('lang-stats-grid').innerHTML = (dash.languages || []).map(l => `
      <div class="card lang-stat-card">
        <div style="display:flex;align-items:center;gap:.4rem;margin-bottom:.5rem">
          ${langPillHtml(l.language)}
          <span style="font-weight:600;text-transform:capitalize">${esc(l.language)}</span>
        </div>
        <div class="lang-stat-rate">${l.total_seen ? Math.round(l.correct_rate * 100) + '%' : '—'}</div>
        <p class="text-secondary" style="font-size:.8rem">${l.total_cards} cards · ${l.total_seen} answered</p>
      </div>`).join('') || '<p class="text-secondary">No data yet.</p>';
  }
}

document.getElementById('btn-progress-back').addEventListener('click', showHome);

// ── Init ──────────────────────────────────────────────────────────────────────

(function init() {
  initTheme();
  if (App.token) showHome();
  else showScreen('screen-login');
}());
