/**
 * WordLens — Settings Popup Script
 * Displays usage stats, vocabulary profile, BYOK, and Pro upgrade options.
 */

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const usageCountEl     = document.getElementById('usage-count');
const progressFillEl   = document.getElementById('progress-fill');
const progressHintEl   = document.getElementById('progress-hint');
const topWordsEl       = document.getElementById('top-words');
const complexitySlider = document.getElementById('complexity-slider');
const complexityValEl  = document.getElementById('complexity-val');
const knowsWordsEl     = document.getElementById('knows-words');
const needsWordsEl     = document.getElementById('needs-words');
const resetBtn         = document.getElementById('reset-btn');
const confirmOverlay   = document.getElementById('confirm-overlay');
const cancelResetBtn   = document.getElementById('cancel-reset');
const confirmResetBtn  = document.getElementById('confirm-reset');
const stripeBtn        = document.getElementById('stripe-btn');
const upgradeCard      = document.getElementById('upgrade-card');
const proOwnedCard     = document.getElementById('pro-owned-card');
const proBadge         = document.getElementById('pro-badge');

// BYOK refs
const byokStatus       = document.getElementById('byok-status');
const byokStatusText   = document.getElementById('byok-status-text');
const byokClearBtn     = document.getElementById('byok-clear-btn');
const byokForm         = document.getElementById('byok-form');
const byokKeyInput     = document.getElementById('byok-key-input');
const byokSaveBtn      = document.getElementById('byok-save-btn');
const byokError        = document.getElementById('byok-error');
const byokModelSelect  = document.getElementById('byok-model-select');

// Filled in from GET_STATS at runtime
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

function topWordsByFrequency(history, feedbackLog, n) {
  const freq = {};
  history.forEach(h => { const w = h.word.toLowerCase(); freq[w] = (freq[w] ?? 0) + 1; });
  feedbackLog.forEach(f => { const w = f.word.toLowerCase(); freq[w] = (freq[w] ?? 0) + 1; });
  return Object.entries(freq)
    .sort(([, a], [, b]) => b - a)
    .slice(0, n)
    .map(([word]) => ({ word }));
}

function easyWords(feedbackLog, n) {
  const seen = new Set();
  return feedbackLog.filter(f => f.feedback === 'easy').reverse()
    .filter(f => { const k = f.word.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, n).map(f => f.word);
}

function complexWords(feedbackLog, n) {
  const seen = new Set();
  return feedbackLog.filter(f => f.feedback === 'complex').reverse()
    .filter(f => { const k = f.word.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, n).map(f => f.word);
}

function renderChips(container, words, emptyMsg) {
  container.innerHTML = words?.length
    ? words.map(w => `<span class="word-chip">${escHtml(w)}</span>`).join('')
    : `<span class="empty-note">${emptyMsg}</span>`;
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#039;');
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
    isByok          = false,
    limit           = 50,
    freeLookupLimit = 50,
    proLookupBonus  = 500,
    byokModels      = [],
    userModel       = '',
  } = res;

  FREE_LIMIT = freeLookupLimit;
  PRO_BONUS  = proLookupBonus;

  // ── Usage stats ──────────────────────────────────────────────────────────────
  usageCountEl.textContent = usageCount.toLocaleString();

  if (isByok) {
    progressFillEl.style.width      = '100%';
    progressFillEl.style.background = 'var(--blue)';
    progressHintEl.textContent      = 'Unlimited — using your own API key';
    progressHintEl.style.color      = 'var(--blue)';
  } else {
    progressFillEl.style.background = 'var(--green)';
    const pct       = Math.min(100, (usageCount / limit) * 100);
    const remaining = Math.max(0, limit - usageCount);
    progressFillEl.style.width = `${pct}%`;

    if (isPro) {
      progressHintEl.textContent = `${remaining.toLocaleString()} AI lookups remaining (Pro — ${limit} total)`;
      progressHintEl.style.color = 'var(--green)';
    } else if (remaining === 0) {
      progressHintEl.textContent = `Free limit reached (${freeLookupLimit} lookups). Upgrade for ${proLookupBonus} more.`;
      progressHintEl.style.color = 'var(--danger)';
    } else {
      progressHintEl.textContent = `${remaining} of ${freeLookupLimit} free AI lookups remaining`;
      progressHintEl.style.color = '#888';
    }
  }

  const topWords = topWordsByFrequency(lookupHistory, feedbackLog, 5);
  renderChips(topWordsEl, topWords.map(t => t.word), 'No lookups yet.');

  // ── Vocabulary profile ───────────────────────────────────────────────────────
  complexitySlider.value      = complexityScore;
  complexityValEl.textContent = complexityScore;
  renderChips(knowsWordsEl, easyWords(feedbackLog, 10),    'No 👍 feedback yet.');
  renderChips(needsWordsEl, complexWords(feedbackLog, 10), 'No 👎 feedback yet.');

  // ── BYOK section ─────────────────────────────────────────────────────────────
  renderByok(isByok, byokModels, userModel);

  // ── Pro state ────────────────────────────────────────────────────────────────
  if (isPro) {
    proBadge.classList.add('visible');
    upgradeCard.style.display = 'none';
    proOwnedCard.classList.add('visible');
  } else {
    upgradeCard.style.display = 'block';
    proOwnedCard.classList.remove('visible');
    proBadge.classList.remove('visible');
  }
}

// ─── BYOK ─────────────────────────────────────────────────────────────────────

function renderByok(isByok, models, savedModel) {
  // Populate model dropdown
  byokModelSelect.innerHTML = models.map(m =>
    `<option value="${escHtml(m.id)}" ${m.id === savedModel ? 'selected' : ''}>${escHtml(m.label)}</option>`
  ).join('');

  if (isByok) {
    byokStatus.style.display = 'flex';
    byokStatusText.textContent = `Active · ${byokModelSelect.options[byokModelSelect.selectedIndex]?.text.split('—')[0].trim() ?? ''}`;
    byokForm.style.display = 'none';
  } else {
    byokStatus.style.display = 'none';
    byokForm.style.display = 'block';
  }
}

byokSaveBtn.addEventListener('click', async () => {
  const key = byokKeyInput.value.trim();
  byokError.style.display = 'none';

  if (!key.startsWith('sk-ant-')) {
    byokError.textContent = 'Key should start with "sk-ant-". Check your Anthropic console.';
    byokError.style.display = 'block';
    return;
  }

  byokSaveBtn.textContent = 'Saving…';
  byokSaveBtn.disabled = true;

  // Quick validation — fire a tiny test call
  const valid = await testApiKey(key, byokModelSelect.value);

  if (!valid) {
    byokError.textContent = 'Could not verify this key. Check that it is active and has credits.';
    byokError.style.display = 'block';
    byokSaveBtn.textContent = 'Save';
    byokSaveBtn.disabled = false;
    return;
  }

  await chrome.storage.local.set({ userApiKey: key, userModel: byokModelSelect.value });
  byokKeyInput.value = '';
  byokSaveBtn.textContent = 'Save';
  byokSaveBtn.disabled = false;
  await render();
});

byokClearBtn.addEventListener('click', async () => {
  await chrome.storage.local.set({ userApiKey: '', userModel: '' });
  await render();
});

// Save model selection immediately when changed (affects both active and inactive state)
byokModelSelect.addEventListener('change', async () => {
  const { userApiKey = '' } = await new Promise(r => chrome.storage.local.get({ userApiKey: '' }, r));
  if (userApiKey) {
    await chrome.storage.local.set({ userModel: byokModelSelect.value });
    byokStatusText.textContent = `Active · ${byokModelSelect.options[byokModelSelect.selectedIndex]?.text.split('—')[0].trim() ?? ''}`;
  }
});

/**
 * Fire a minimal API call to verify the key before saving.
 * Uses the cheapest model and 1 token to minimise cost (~$0.00001).
 */
async function testApiKey(key, model) {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: model || 'claude-haiku-4-5-20251001',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'Hi' }],
      }),
      signal: AbortSignal.timeout(6000),
    });
    return res.ok || res.status === 400; // 400 = bad request body, but key is valid
  } catch {
    return false;
  }
}

// ─── Stripe button ────────────────────────────────────────────────────────────
async function initStripeLink() {
  const { stripeLink } = await new Promise(resolve =>
    chrome.storage.local.get({ stripeLink: '' }, resolve)
  );
  stripeBtn.href = stripeLink || '#';
  window.addEventListener('focus', () => render(), { once: true });
}

// ─── Reset ────────────────────────────────────────────────────────────────────
resetBtn.addEventListener('click', () => confirmOverlay.classList.add('visible'));
cancelResetBtn.addEventListener('click', () => confirmOverlay.classList.remove('visible'));

confirmResetBtn.addEventListener('click', async () => {
  confirmOverlay.classList.remove('visible');
  await sendMessage({ type: 'RESET_PROFILE' });
  await render();
});

// ─── Boot ─────────────────────────────────────────────────────────────────────
render().catch(console.error);
initStripeLink().catch(console.error);
