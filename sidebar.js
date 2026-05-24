/**
 * WordLens — Sidebar (Side Panel) Script
 * Shows the detailed "Tell me more" explanation and recent lookup history.
 */

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const chipsContainer = document.getElementById('chips-container');
const contentEl      = document.getElementById('content');

// ─── State ────────────────────────────────────────────────────────────────────
let currentWord     = null;
let currentSentence = null;

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  await loadHistoryChips();

  // Check if background stored a pending lookup (from "Tell me more" click)
  const res = await sendMessage({ type: 'GET_SIDEBAR_PENDING' });
  if (res?.pending?.word) {
    lookupWord(res.pending.word, res.pending.sentence);
  }
}

// ─── History chips ────────────────────────────────────────────────────────────
async function loadHistoryChips() {
  const res = await sendMessage({ type: 'GET_HISTORY' });
  const history = res?.lookupHistory ?? [];

  chipsContainer.innerHTML = '';

  if (history.length === 0) {
    chipsContainer.innerHTML = '<span style="font-size:12px;color:#ccc;">No lookups yet</span>';
    return;
  }

  history.forEach(entry => {
    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.textContent = entry.word;
    if (entry.word === currentWord) chip.classList.add('active');

    chip.addEventListener('click', () => {
      lookupWord(entry.word, entry.sentence ?? '');
    });

    chipsContainer.appendChild(chip);
  });
}

// ─── Lookup ───────────────────────────────────────────────────────────────────
async function lookupWord(word, sentence) {
  currentWord     = word;
  currentSentence = sentence;

  // Highlight active chip
  document.querySelectorAll('.chip').forEach(c => {
    c.classList.toggle('active', c.textContent === word);
  });

  showLoading(word);

  const res = await sendMessage({ type: 'SIDEBAR_LOOKUP', word, sentence });

  if (!res?.success) {
    showError(res?.error ?? 'Could not retrieve a definition.');
    return;
  }

  renderResult(word, sentence, res.definition, res.complexity);

  // Refresh chips (history may have updated)
  await loadHistoryChips();
  document.querySelectorAll('.chip').forEach(c => {
    c.classList.toggle('active', c.textContent === word);
  });
}

// ─── Render ───────────────────────────────────────────────────────────────────
function showLoading(word) {
  contentEl.innerHTML = `
    <div id="word-header">
      <div id="word-title">${escHtml(word)}</div>
    </div>
    <div class="spinner-wrap">
      <div class="spinner"></div>
      <span>Getting in-depth explanation…</span>
    </div>`;
}

function showError(msg) {
  contentEl.innerHTML = `<div class="error-msg">⚠️ ${escHtml(msg)}</div>`;
}

function renderResult(word, sentence, rawDefinition, complexity) {
  const speakBtn = `<button id="speak-btn" title="Pronounce" aria-label="Pronounce ${escHtml(word)}">🔊</button>`;
  const badge    = `<span id="complexity-badge">Complexity level ${complexity}/10</span>`;

  // Convert Claude's numbered list text into HTML sections
  const formatted = formatDefinition(rawDefinition);

  contentEl.innerHTML = `
    <div id="word-header">
      <div id="word-title">${escHtml(word)}</div>
      ${speakBtn}
    </div>
    ${sentence ? `<div id="context-sentence">"${escHtml(truncate(sentence, 120))}"</div>` : ''}
    ${badge}
    <div id="definition-body">${formatted}</div>`;

  document.getElementById('speak-btn').addEventListener('click', () => {
    speakWord(word);
  });
}

/**
 * Convert Claude's plain-text response (with 1) 2) 3) headers) into
 * simple HTML with <h3> section headings and <p> paragraphs.
 */
function formatDefinition(text) {
  const SECTION_LABELS = {
    '1)': 'Full definition',
    '2)': 'Etymology & origin',
    '3)': 'Example sentences',
    '4)': 'Common misconceptions & nuances',
    '5)': 'Related words & concepts',
  };

  let html = '';
  let remaining = text;

  // Split on numbered section headers like "1)" or "1."
  const sectionRe = /(\d+[\)\.]\s)/g;
  const parts = text.split(sectionRe).filter(Boolean);

  if (parts.length <= 1) {
    // No numbered sections — render as plain paragraphs
    return text.split(/\n{2,}/).map(p => `<p>${escHtml(p.trim())}</p>`).join('');
  }

  let i = 0;
  while (i < parts.length) {
    const marker = parts[i]?.trim();
    const content = parts[i + 1] ?? '';
    const label = SECTION_LABELS[marker] ?? marker;

    if (label) html += `<h3>${escHtml(label)}</h3>`;
    html += content
      .split(/\n+/)
      .filter(l => l.trim())
      .map(l => `<p>${escHtml(l.trim())}</p>`)
      .join('');

    i += 2;
  }

  return html || `<p>${escHtml(text)}</p>`;
}

// ─── Speech ───────────────────────────────────────────────────────────────────
function speakWord(word) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(word));
}

// ─── Messaging ────────────────────────────────────────────────────────────────
function sendMessage(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, res => {
      if (chrome.runtime.lastError) {
        console.warn('[WordLens sidebar]', chrome.runtime.lastError.message);
        resolve(null);
      } else {
        resolve(res);
      }
    });
  });
}

// ─── Util ─────────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function truncate(str, max) {
  return str.length > max ? str.slice(0, max) + '…' : str;
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
init().catch(console.error);
