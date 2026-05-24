/**
 * WordLens — Background Service Worker
 * Handles API calls, caching, complexity tracking, and side-panel control.
 */

import { WL_CONFIG } from './config.js';

// ─── Credentials (loaded from creds.json at startup) ─────────────────────────
// Secrets never live in config.js — they're fetched from the local creds.json
// file (gitignored) and merged here at runtime.

let WL_CREDS = {
  ANTHROPIC_API_KEY: '',
  STRIPE_PAYMENT_LINK: '',
};

async function loadCreds() {
  try {
    const url = chrome.runtime.getURL('creds.json');
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    WL_CREDS = { ...WL_CREDS, ...json };
    console.log('[WordLens] creds.json loaded. API key present:', !!WL_CREDS.ANTHROPIC_API_KEY);

    // Make the Stripe link available to the settings popup via storage
    if (WL_CREDS.STRIPE_PAYMENT_LINK) {
      await chrome.storage.local.set({ stripeLink: WL_CREDS.STRIPE_PAYMENT_LINK });
    }
  } catch (err) {
    console.error('[WordLens] Failed to load creds.json:', err.message,
      '— create creds.json in the extension folder with your ANTHROPIC_API_KEY.');
  }
}

// Load immediately — all message handlers await this implicitly via the
// credsReady promise so no handler fires before creds are in memory.
const credsReady = loadCreds();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function cacheKey(word, complexity) {
  return `wl_cache_${word.toLowerCase()}_${complexity}`;
}

async function getCached(word, complexity) {
  const key = cacheKey(word, complexity);
  const result = await chrome.storage.local.get(key);
  const entry = result[key];
  if (!entry) return null;

  const ageMs = Date.now() - entry.timestamp;
  const ttlMs = WL_CONFIG.CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;
  if (ageMs > ttlMs) {
    chrome.storage.local.remove(key);
    return null;
  }
  return entry.data;
}

async function setCached(word, complexity, data) {
  const key = cacheKey(word, complexity);
  await chrome.storage.local.set({
    [key]: { data, timestamp: Date.now() }
  });
}

async function getStorageData(keys) {
  return chrome.storage.local.get(keys);
}

async function setStorageData(obj) {
  return chrome.storage.local.set(obj);
}

// ─── Claude API ──────────────────────────────────────────────────────────────

function buildShortPrompt(word, sentence, score) {
  return `The word '${word}' appears in this sentence: '${sentence}'. Describe this word in exactly 4 sentences for someone at vocabulary complexity level ${score}/10. At level 1 use simple everyday language. At level 10 use precise academic or technical language. Your description should reflect the word's meaning in the context of the sentence provided.`;
}

function buildLongPrompt(word, sentence, score) {
  return `Give a thorough explanation of '${word}' (context: '${sentence}') for someone at complexity level ${score}/10. Include: 1) Full definition, 2) Etymology and origin, 3) Two example sentences, 4) Common misconceptions or nuances, 5) Related words or concepts.`;
}

/**
 * Resolves which API key and model to use.
 * BYOK (user-supplied key) takes priority over the developer key in creds.json.
 */
async function resolveApiCredentials() {
  const { userApiKey = '', userModel = '' } = await getStorageData({ userApiKey: '', userModel: '' });
  return {
    apiKey: userApiKey.trim() || WL_CREDS.ANTHROPIC_API_KEY,
    model:  userModel.trim()  || WL_CONFIG.CLAUDE_MODEL,
    isByok: !!userApiKey.trim(),
  };
}

async function callClaudeAPI(prompt) {
  const { apiKey, model } = await resolveApiCredentials();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WL_CONFIG.API_TIMEOUT_MS);

  try {
    const response = await fetch(WL_CONFIG.API_ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        // Required when calling the Anthropic API directly from a browser
        // context (including Chrome extension service workers).
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model,
        max_tokens: 512,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Claude API ${response.status}: ${body}`);
    }

    const json = await response.json();
    return json.content?.[0]?.text ?? null;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Dictionary fallback ──────────────────────────────────────────────────────

async function callDictionaryAPI(word) {
  try {
    const res = await fetch(`${WL_CONFIG.FALLBACK_DICT_API}${encodeURIComponent(word)}`);
    if (!res.ok) return null;
    const json = await res.json();

    const meanings = json[0]?.meanings ?? [];
    const parts = meanings.slice(0, 2).map(m => {
      const def = m.definitions[0]?.definition ?? '';
      return `(${m.partOfSpeech}) ${def}`;
    });

    return parts.length ? parts.join(' ') + ' (offline definition)' : null;
  } catch {
    return null;
  }
}

// ─── Storage helpers ──────────────────────────────────────────────────────────

async function getComplexity() {
  const { complexityScore } = await getStorageData({ complexityScore: WL_CONFIG.DEFAULT_COMPLEXITY });
  return Math.max(1, Math.min(10, complexityScore));
}

async function nudgeComplexity(delta) {
  const current = await getComplexity();
  const next = Math.max(1, Math.min(10, current + delta));
  await setStorageData({ complexityScore: next });
  return next;
}

async function appendFeedbackLog(entry) {
  const { feedbackLog = [] } = await getStorageData({ feedbackLog: [] });
  feedbackLog.push(entry);
  if (feedbackLog.length > WL_CONFIG.MAX_FEEDBACK_LOG) {
    feedbackLog.splice(0, feedbackLog.length - WL_CONFIG.MAX_FEEDBACK_LOG);
  }
  await setStorageData({ feedbackLog });
}

async function appendHistory(entry) {
  const { lookupHistory = [] } = await getStorageData({ lookupHistory: [] });
  // Deduplicate by word (keep most recent)
  const filtered = lookupHistory.filter(h => h.word.toLowerCase() !== entry.word.toLowerCase());
  filtered.unshift(entry);
  if (filtered.length > WL_CONFIG.MAX_HISTORY) filtered.length = WL_CONFIG.MAX_HISTORY;
  await setStorageData({ lookupHistory: filtered });
}

/**
 * Returns the total AI lookup limit for the user:
 *   free users  → FREE_LOOKUP_LIMIT
 *   pro users   → FREE_LOOKUP_LIMIT + PRO_LOOKUP_BONUS
 */
async function getLookupLimit() {
  const { isPro = false } = await getStorageData({ isPro: false });
  return isPro
    ? WL_CONFIG.FREE_LOOKUP_LIMIT + WL_CONFIG.PRO_LOOKUP_BONUS
    : WL_CONFIG.FREE_LOOKUP_LIMIT;
}

async function incrementUsage() {
  const { usageCount = 0 } = await getStorageData({ usageCount: 0 });
  const next = usageCount + 1;
  await setStorageData({ usageCount: next });
  return { usageCount: next };
}

// ─── Message handlers ─────────────────────────────────────────────────────────

async function handleLookupWord(request, sender) {
  const { word, sentence } = request;
  const complexity = await getComplexity();

  // Check cache first — cached results don't count against the limit
  const cached = await getCached(word, complexity);
  if (cached) {
    await appendHistory({ word, sentence, definition: cached, timestamp: Date.now() });
    const { usageCount } = await getStorageData({ usageCount: 0 });
    const limit = await getLookupLimit();
    return { success: true, definition: cached, complexity, usageCount, limit, fromCache: true };
  }

  // BYOK users have no lookup cap — they're paying for their own API usage
  const { isByok } = await resolveApiCredentials();
  const { usageCount: currentCount } = await getStorageData({ usageCount: 0 });
  const { isPro = false } = await getStorageData({ isPro: false });
  const limit = await getLookupLimit();

  if (!isByok && currentCount >= limit) {
    // Still return a dictionary fallback so the extension doesn't go silent
    const fallback = await callDictionaryAPI(word);
    return {
      success: true,
      definition: fallback ?? `No definition found for "${word}".`,
      complexity,
      usageCount: currentCount,
      limit,
      isPro,
      isByok: false,
      isOffline: true,
      limitReached: true,
    };
  }

  // Try Claude
  let definition = null;
  let isOffline = false;

  try {
    const prompt = buildShortPrompt(word, sentence, complexity);
    definition = await callClaudeAPI(prompt);
  } catch (err) {
    console.warn('[WordLens] Claude API failed:', err.message, '— falling back to dictionary');
  }

  if (!definition) {
    isOffline = true;
    definition = await callDictionaryAPI(word);
  }

  if (!definition) {
    return { success: false, error: 'No definition found.' };
  }

  if (!isOffline) {
    await setCached(word, complexity, definition);
  }

  // Only count against the cap for non-BYOK users
  let usageCount = currentCount;
  if (!isByok) {
    ({ usageCount } = await incrementUsage());
  }
  await appendHistory({ word, sentence, definition, timestamp: Date.now() });

  return { success: true, definition, complexity, usageCount, limit, isOffline, isByok };
}

async function handleSidebarLookup(request) {
  const { word, sentence } = request;
  const complexity = await getComplexity();
  const cKey = `wl_sidebar_${cacheKey(word, complexity)}`;

  const cached = await chrome.storage.local.get(cKey);
  if (cached[cKey]) {
    const ageMs = Date.now() - cached[cKey].timestamp;
    const ttlMs = WL_CONFIG.CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;
    if (ageMs <= ttlMs) return { success: true, definition: cached[cKey].data, complexity };
  }

  let definition = null;
  try {
    const prompt = buildLongPrompt(word, sentence, complexity);
    definition = await callClaudeAPI(prompt);
  } catch (err) {
    console.warn('[WordLens] Sidebar Claude call failed:', err.message);
  }

  if (!definition) {
    definition = await callDictionaryAPI(word);
    if (!definition) return { success: false, error: 'No definition found.' };
  }

  await chrome.storage.local.set({ [cKey]: { data: definition, timestamp: Date.now() } });
  return { success: true, definition, complexity };
}

async function handleFeedback(request) {
  const { word, feedback, domain } = request;
  const complexity = await getComplexity();

  let delta = 0;
  if (feedback === 'easy') delta = 1;
  else if (feedback === 'complex') delta = -1;

  const newComplexity = delta !== 0 ? await nudgeComplexity(delta) : complexity;

  await appendFeedbackLog({
    word,
    feedback,
    complexityAtTime: complexity,
    timestamp: Date.now(),
    domain: domain || ''
  });

  return { success: true, complexityScore: newComplexity };
}


async function handleGetStats() {
  const data = await getStorageData({
    usageCount: 0,
    complexityScore: WL_CONFIG.DEFAULT_COMPLEXITY,
    feedbackLog: [],
    lookupHistory: [],
    isPro: false,
    userApiKey: '',
    userModel: '',
  });
  const isByok = !!data.userApiKey?.trim();
  const limit = data.isPro
    ? WL_CONFIG.FREE_LOOKUP_LIMIT + WL_CONFIG.PRO_LOOKUP_BONUS
    : WL_CONFIG.FREE_LOOKUP_LIMIT;
  return {
    success: true,
    ...data,
    isByok,
    limit,
    freeLookupLimit: WL_CONFIG.FREE_LOOKUP_LIMIT,
    proLookupBonus:  WL_CONFIG.PRO_LOOKUP_BONUS,
    byokModels:      WL_CONFIG.BYOK_MODELS,
  };
}

async function handleGetHistory() {
  const { lookupHistory = [] } = await getStorageData({ lookupHistory: [] });
  return { success: true, lookupHistory };
}

async function handleGetSidebarPending() {
  const { sidebarPending } = await getStorageData({ sidebarPending: null });
  if (sidebarPending) {
    await chrome.storage.local.remove('sidebarPending');
  }
  return { success: true, pending: sidebarPending };
}

async function handleSetPro() {
  await setStorageData({ isPro: true });
  return { success: true };
}

async function handleResetProfile() {
  await setStorageData({
    complexityScore: WL_CONFIG.DEFAULT_COMPLEXITY,
    feedbackLog: [],
    lookupHistory: [],
    usageCount: 0,
    isPro: false,
  });
  // Clear all cache keys
  const all = await chrome.storage.local.get(null);
  const cacheKeys = Object.keys(all).filter(k => k.startsWith('wl_cache_') || k.startsWith('wl_sidebar_'));
  if (cacheKeys.length) await chrome.storage.local.remove(cacheKeys);
  return { success: true };
}

// ─── Router ──────────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

  // ⚠️  OPEN_SIDEBAR must call chrome.sidePanel.open() SYNCHRONOUSLY —
  // before any await — otherwise Chrome drops the user-gesture context
  // and the call silently fails. Handle it here, outside the async path.
  if (request.type === 'OPEN_SIDEBAR') {
    const tabId = sender.tab?.id;
    if (tabId) {
      chrome.sidePanel.open({ tabId }).catch(err =>
        console.warn('[WordLens] sidePanel.open failed:', err.message)
      );
    }
    // Write pending lookup data async after the gesture-sensitive call
    setStorageData({
      sidebarPending: {
        word:      request.word,
        sentence:  request.sentence,
        timestamp: Date.now(),
      }
    }).then(() => sendResponse({ success: true }));
    return true;
  }

  const handle = async () => {
    await credsReady; // ensure creds.json is loaded before any handler runs
    switch (request.type) {
      case 'LOOKUP_WORD':         return handleLookupWord(request, sender);
      case 'SIDEBAR_LOOKUP':      return handleSidebarLookup(request);
      case 'SUBMIT_FEEDBACK':     return handleFeedback(request);
      case 'GET_STATS':           return handleGetStats();
      case 'GET_HISTORY':         return handleGetHistory();
      case 'GET_SIDEBAR_PENDING': return handleGetSidebarPending();
      case 'SET_PRO':             return handleSetPro();
      case 'RESET_PROFILE':       return handleResetProfile();
      case 'OPEN_SETTINGS':       chrome.action.openPopup(); return { success: true };
      default:
        return { success: false, error: `Unknown message type: ${request.type}` };
    }
  };

  handle().then(sendResponse).catch(err => {
    console.error('[WordLens] Message handler error:', err);
    sendResponse({ success: false, error: err.message });
  });

  return true; // keep message channel open for async response
});

// Clean up expired cache entries on startup
chrome.runtime.onStartup.addListener(async () => {
  const all = await chrome.storage.local.get(null);
  const ttlMs = WL_CONFIG.CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;
  const expired = Object.entries(all)
    .filter(([k, v]) => k.startsWith('wl_cache_') && v?.timestamp && Date.now() - v.timestamp > ttlMs)
    .map(([k]) => k);
  if (expired.length) await chrome.storage.local.remove(expired);
});
