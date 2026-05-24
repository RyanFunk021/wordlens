/**
 * WordLens — Settings Popup Script
 * Displays usage stats, vocabulary profile, and Pro upgrade options.
 */

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const usageCountEl    = document.getElementById('usage-count');
const progressFillEl  = document.getElementById('progress-fill');
const progressHintEl  = document.getElementById('progress-hint');
const topWordsEl      = document.getElementById('top-words');
const complexitySlider = document.getElementById('complexity-slider');
const complexityValEl = document.getElementById('complexity-val');
const knowsWordsEl    = document.getElementById('knows-words');
const needsWordsEl    = document.getElementById('needs-words');
const resetBtn        = document.getElementById('reset-btn');
const confirmOverlay  = document.getElementById('confirm-overlay');
const cancelResetBtn  = document.getElementById('cancel-reset');
const confirmResetBtn = document.getElementById('confirm-reset');
const stripeBtn       = document.getElementById('stripe-btn');
const upgradeCard     = document.getElementById('upgrade-card');
const proOwnedCard    = document.getElementById('pro-owned-card');
const proBadge        = document.getElementById('pro-badge');

// These are filled in from GET_STATS response at runtime
let FREE_LIMIT = 50;
let PRO_BONUS  = 500;

// ─── Messaging helper ─────────────────────────────────────────────────────────
function sendMessage(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, res => {
      if (chrome.runtime.lastError) {
        console.warn('[WordLens settings]', chrome.runtime.lastError.message);
        resolve(null);
      } else {
        resolve(res);
      }
    });
  });
}

// ─── Data helpers ─────────────────────────────────────────────────────────────

/**
 * Count word frequencies from a combined source of history + feedback log.
 * Returns [{ word, count }, ...] sorted by count descending.
 */
function topWordsByFrequency(history, feedbackLog, n) {
  const freq = {};

  history.forEach(h => {
    const w = h.word.toLowerCase();
    freq[w] = (freq[w] ?? 0) + 1;
  });

  feedbackLog.forEach(f => {
    const w = f.word.toLowerCase();
    freq[w] = (freq[w] ?? 0) + 1;
  });

  return Object.entries(freq)
    .sort(([, a], [, b]) => b - a)
    .slice(0, n)
    .map(([word, count]) => ({ word, count }));
}

/** Words that received 👍 ('easy') feedback — top N unique. */
function easyWords(feedbackLog, n) {
  const seen = new Set();
  return feedbackLog
    .filter(f => f.feedback === 'easy')
    .reverse() // most recent first
    .filter(f => {
      const key = f.word.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, n)
    .map(f => f.word);
}

/** Words that received 👎 ('complex') feedback — top N unique. */
function complexWords(feedbackLog, n) {
  const seen = new Set();
  return feedbackLog
    .filter(f => f.feedback === 'complex')
    .reverse()
    .filter(f => {
      const key = f.word.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, n)
    .map(f => f.word);
}

// ─── Render helpers ───────────────────────────────────────────────────────────

function renderChips(container, words, emptyMsg) {
  if (!words || words.length === 0) {
    container.innerHTML = `<span class="empty-note">${emptyMsg}</span>`;
    return;
  }
  container.innerHTML = words
    .map(w => `<span class="word-chip">${escHtml(w)}</span>`)
    .join('');
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ─── Main render ──────────────────────────────────────────────────────────────
async function render() {
  const res = await sendMessage({ type: 'GET_STATS' });
  if (!res) return;

  const {
    usageCount      = 0,
    complexityScore = 5,
    feedbackLog     = [],
    lookupHistory   = [],
    isPro           = false,
    limit           = 50,
    freeLookupLimit = 50,
    proLookupBonus  = 500,
  } = res;

  FREE_LIMIT = freeLookupLimit;
  PRO_BONUS  = proLookupBonus;

  // ── Usage stats ────────────────────────────────────────────────────────────
  usageCountEl.textContent = usageCount.toLocaleString();

  const pct = Math.min(100, (usageCount / limit) * 100);
  progressFillEl.style.width = `${pct}%`;

  const remaining = Math.max(0, limit - usageCount);

  if (isPro) {
    progressHintEl.textContent = `${remaining.toLocaleString()} AI lookups remaining (Pro — ${limit} total)`;
    progressHintEl.style.color = '#22c55e';
  } else if (remaining === 0) {
    progressHintEl.textContent = `Free limit reached (${freeLookupLimit} lookups). Upgrade for ${proLookupBonus} more.`;
    progressHintEl.style.color = '#ef4444';
  } else {
    progressHintEl.textContent = `${remaining} of ${freeLookupLimit} free AI lookups remaining`;
    progressHintEl.style.color = '#888';
  }

  // Top 5 looked-up words
  const topWords = topWordsByFrequency(lookupHistory, feedbackLog, 5);
  renderChips(topWordsEl, topWords.map(t => t.word), 'No lookups yet.');

  // ── Vocabulary profile ─────────────────────────────────────────────────────
  complexitySlider.value      = complexityScore;
  complexityValEl.textContent = complexityScore;

  renderChips(knowsWordsEl,  easyWords(feedbackLog, 10),    'No 👍 feedback yet.');
  renderChips(needsWordsEl,  complexWords(feedbackLog, 10), 'No 👎 feedback yet.');

  // ── Pro state ──────────────────────────────────────────────────────────────
  if (isPro) {
    proBadge.classList.add('visible');
    upgradeCard.style.display    = 'none';
    proOwnedCard.classList.add('visible');
  } else {
    upgradeCard.style.display    = 'block';
    proOwnedCard.classList.remove('visible');
    proBadge.classList.remove('visible');
  }
}

// ─── Stripe button ────────────────────────────────────────────────────────────
async function initStripeLink() {
  // Pull link from config — background provides it via GET_STATS or we read
  // storage. Simplest: background stores STRIPE_LINK or we hard-code and
  // let user replace. For now, read from storage with a fallback placeholder.
  const { stripeLink } = await new Promise(resolve =>
    chrome.storage.local.get({ stripeLink: '' }, resolve)
  );

  stripeBtn.href = stripeLink || '#';

  // After user returns from Stripe payment page, background may have set isPro.
  // We poll once when the window regains focus (Stripe redirects back here).
  window.addEventListener('focus', () => render(), { once: true });
}

// ─── Reset ────────────────────────────────────────────────────────────────────
resetBtn.addEventListener('click', () => {
  confirmOverlay.classList.add('visible');
});

cancelResetBtn.addEventListener('click', () => {
  confirmOverlay.classList.remove('visible');
});

confirmResetBtn.addEventListener('click', async () => {
  confirmOverlay.classList.remove('visible');
  await sendMessage({ type: 'RESET_PROFILE' });
  await render();
});

// ─── Boot ─────────────────────────────────────────────────────────────────────
render().catch(console.error);
initStripeLink().catch(console.error);
