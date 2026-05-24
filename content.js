/**
 * WordLens — Content Script
 * Detects hovered words/phrases, shows AI-powered tooltip, handles feedback.
 */

(function () {
  'use strict';

  // ─── Constants ─────────────────────────────────────────────────────────────
  const HOVER_DELAY_MS = 600;
  const CONTEXT_CHARS  = 300;
  const TOOLTIP_ID     = 'wl-tooltip-root';

  // Tags whose text we skip (inputs, editable areas, etc.)
  const SKIP_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A',
    'CODE', 'PRE', 'SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME']);

  // ─── State ──────────────────────────────────────────────────────────────────
  let hoverTimer      = null;
  let tooltipEl       = null;
  let currentWord     = null;
  let currentSentence = null;
  let pendingAbort    = false;

  // ─── Word extraction ────────────────────────────────────────────────────────

  function getWordAtPoint(x, y) {
    // Prefer user-selected text (highlighted phrase)
    const sel = window.getSelection();
    if (sel && sel.toString().trim().length > 1) {
      const text = sel.toString().trim();
      if (sel.rangeCount > 0) {
        const sentence = getSentenceContext(sel.getRangeAt(0));
        return { word: text, sentence };
      }
    }

    // Get caret at pointer
    let range;
    if (document.caretRangeFromPoint) {
      range = document.caretRangeFromPoint(x, y);
    } else if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(x, y);
      if (pos) {
        range = document.createRange();
        range.setStart(pos.offsetNode, pos.offset);
        range.setEnd(pos.offsetNode, pos.offset);
      }
    }

    if (!range) return null;
    if (range.startContainer.nodeType !== Node.TEXT_NODE) return null;

    // Check parent tag is valid
    const parentEl = range.startContainer.parentElement;
    if (!parentEl) return null;
    if (SKIP_TAGS.has(parentEl.tagName)) return null;
    if (parentEl.isContentEditable) return null;

    // Expand range to surrounding word
    const textNode = range.startContainer;
    const text     = textNode.textContent;
    let   start    = range.startOffset;
    let   end      = range.startOffset;

    while (start > 0 && /[\w'-]/.test(text[start - 1])) start--;
    while (end < text.length && /[\w'-]/.test(text[end])) end++;

    if (end <= start) return null;

    const word = text.slice(start, end).replace(/^[''-]+|[''-]+$/g, '');
    if (!word || word.length < 2 || !/[a-zA-Z]/.test(word)) return null;

    range.setStart(textNode, start);
    range.setEnd(textNode, end);

    const sentence = getSentenceContext(range);
    return { word, sentence };
  }

  function getSentenceContext(range) {
    // Walk up to a block-level element for full sentence context
    const BLOCK_TAGS = new Set(['P', 'DIV', 'ARTICLE', 'SECTION', 'LI',
      'TD', 'TH', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
      'HEADER', 'FOOTER', 'MAIN', 'NAV', 'ASIDE', 'FIGCAPTION', 'CAPTION']);

    let node = range.startContainer;
    let block = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;

    while (block && block !== document.body) {
      if (BLOCK_TAGS.has(block.tagName)) break;
      block = block.parentElement;
    }

    const fullText = (block || document.body).textContent || '';

    // Find position of word in fullText
    const wordText  = range.toString().trim();
    const wordIndex = fullText.indexOf(wordText);

    if (wordIndex === -1) return fullText.slice(0, CONTEXT_CHARS * 2).trim();

    const s = Math.max(0, wordIndex - CONTEXT_CHARS);
    const e = Math.min(fullText.length, wordIndex + wordText.length + CONTEXT_CHARS);
    return fullText.slice(s, e).replace(/\s+/g, ' ').trim();
  }

  // ─── Tooltip DOM ────────────────────────────────────────────────────────────

  function removeTooltip() {
    const existing = document.getElementById(TOOLTIP_ID);
    if (existing) existing.remove();
    tooltipEl    = null;
    currentWord  = null;
    pendingAbort = true;
  }

  function positionTooltip(el, anchorX, anchorY) {
    const vpW = window.innerWidth;
    const vpH = window.innerHeight;
    const rect = el.getBoundingClientRect();

    let left = anchorX + 12;
    let top  = anchorY + 20;

    if (left + rect.width  > vpW - 8) left = anchorX - rect.width - 12;
    if (top  + rect.height > vpH - 8) top  = anchorY - rect.height - 8;
    if (left < 8)  left = 8;
    if (top  < 8)  top  = 8;

    el.style.left = `${left}px`;
    el.style.top  = `${top}px`;
  }

  function createLoadingTooltip(word, anchorX, anchorY) {
    removeTooltip();
    pendingAbort = false;

    const el = document.createElement('div');
    el.id        = TOOLTIP_ID;
    el.className = 'wl-tooltip';
    el.setAttribute('role', 'tooltip');
    el.innerHTML = `
      <div class="wl-header">
        <span class="wl-word">${escHtml(word)}</span>
        <button class="wl-btn-icon wl-speak" title="Pronounce" aria-label="Pronounce ${escHtml(word)}">🔊</button>
      </div>
      <div class="wl-body wl-loading">
        <span class="wl-spinner"></span>
        <span class="wl-loading-text">Looking up…</span>
      </div>`;

    document.body.appendChild(el);
    tooltipEl = el;

    positionTooltip(el, anchorX, anchorY);
    requestAnimationFrame(() => el.classList.add('wl-visible'));

    el.querySelector('.wl-speak').addEventListener('click', e => {
      e.stopPropagation();
      speakWord(word);
    });

    return el;
  }

  function renderTooltip(word, sentence, data, anchorX, anchorY) {
    // If the tooltip was closed while the request was in flight, bail
    if (pendingAbort) return;

    const el = document.getElementById(TOOLTIP_ID);
    if (!el) return;

    const {
      definition,
      isOffline   = false,
      usageCount  = 0,
      milestoneMessage = null
    } = data;

    chrome.storage.local.get({ isPro: false }, res => {
    buildTooltipContent(el, word, sentence, data, res.isPro, anchorX, anchorY);
  });
  }

  function buildTooltipContent(el, word, sentence, data, isPro, anchorX, anchorY) {
    const { definition, isOffline = false, limitReached = false, limit = 50 } = data;

    // Show upsell banner when free cap is hit (not for Pro users, not for cached results)
    const showUpsell = limitReached && !isPro;

    el.innerHTML = `
      <div class="wl-header">
        <span class="wl-word">${escHtml(word)}</span>
        <div class="wl-header-actions">
          <button class="wl-btn-icon wl-speak" title="Pronounce" aria-label="Pronounce ${escHtml(word)}">🔊</button>
          <button class="wl-btn-icon wl-fb-easy"    title="Too easy"    data-fb="easy">👍</button>
          <button class="wl-btn-icon wl-fb-complex" title="Too complex" data-fb="complex">👎</button>
        </div>
      </div>
      <div class="wl-body">
        ${isOffline ? '<span class="wl-offline-badge">offline</span>' : ''}
        <p class="wl-definition">${escHtml(definition)}</p>
      </div>
      <div class="wl-footer">
        <button class="wl-tell-more">Tell me more →</button>
      </div>
      ${showUpsell ? `
        <div class="wl-divider"></div>
        <div class="wl-upsell">
          <span class="wl-upsell-text">You've used all ${limit} free AI lookups.</span>
          <a class="wl-upsell-btn" href="#" id="wl-upgrade-link">Go Pro — $2.99 →</a>
        </div>` : ''}`;

    positionTooltip(el, anchorX, anchorY);

    // Bind events
    el.querySelector('.wl-speak').addEventListener('click', e => {
      e.stopPropagation();
      speakWord(word);
    });

    el.querySelectorAll('[data-fb]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const fb = btn.dataset.fb;
        submitFeedback(word, sentence, fb);
        btn.classList.add('wl-fb-sent');
        btn.disabled = true;
      });
    });

    el.querySelector('.wl-tell-more').addEventListener('click', e => {
      e.stopPropagation();
      openSidebar(word, sentence);
    });

    const upgradeLink = el.querySelector('#wl-upgrade-link');
    if (upgradeLink) {
      upgradeLink.addEventListener('click', e => {
        e.stopPropagation();
        chrome.runtime.sendMessage({ type: 'OPEN_SETTINGS' });
      });
    }
  }

  function showErrorTooltip(word, anchorX, anchorY, msg) {
    const el = document.getElementById(TOOLTIP_ID);
    if (!el) return;
    const display = msg || 'Could not retrieve a definition. Check your connection and API key.';
    el.innerHTML = `
      <div class="wl-header">
        <span class="wl-word">${escHtml(word)}</span>
      </div>
      <div class="wl-body">
        <p class="wl-definition wl-error-text">${escHtml(display)}</p>
      </div>`;
    positionTooltip(el, anchorX, anchorY);
  }

  // ─── Actions ────────────────────────────────────────────────────────────────

  function speakWord(word) {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(word);
    window.speechSynthesis.speak(utt);
  }

  function submitFeedback(word, sentence, feedback) {
    chrome.runtime.sendMessage({
      type: 'SUBMIT_FEEDBACK',
      word,
      feedback,
      domain: location.hostname
    });
  }

  function openSidebar(word, sentence) {
    // Log as 'expanded' feedback
    chrome.runtime.sendMessage({
      type: 'SUBMIT_FEEDBACK',
      word,
      feedback: 'expanded',
      domain: location.hostname
    });

    chrome.runtime.sendMessage({ type: 'OPEN_SIDEBAR', word, sentence });
  }

  // ─── Main hover flow ────────────────────────────────────────────────────────

  function showTooltipForWord(word, sentence, anchorX, anchorY) {
    currentWord     = word;
    currentSentence = sentence;

    createLoadingTooltip(word, anchorX, anchorY);

    // Fallback: if the background never replies within 10s, show an error
    // (can happen if the service worker wakes cold or creds.json is missing)
    const timeoutId = setTimeout(() => {
      showErrorTooltip(word, anchorX, anchorY, 'Request timed out. Try reloading the page.');
    }, 10000);

    chrome.runtime.sendMessage(
      { type: 'LOOKUP_WORD', word, sentence },
      response => {
        clearTimeout(timeoutId);

        // lastError fires when the extension was reloaded but the page wasn't —
        // tell the user to refresh rather than leaving the spinner up forever.
        if (chrome.runtime.lastError) {
          console.warn('[WordLens]', chrome.runtime.lastError.message);
          showErrorTooltip(word, anchorX, anchorY,
            chrome.runtime.lastError.message.includes('invalidated')
              ? 'Extension was reloaded — refresh this page.'
              : chrome.runtime.lastError.message
          );
          return;
        }

        if (!response) {
          showErrorTooltip(word, anchorX, anchorY, 'No response from background.');
          return;
        }

        if (response.success) {
          renderTooltip(word, sentence, response, anchorX, anchorY);
        } else {
          showErrorTooltip(word, anchorX, anchorY, response.error);
        }
      }
    );
  }

  // ─── Event listeners ────────────────────────────────────────────────────────

  function onMouseMove(e) {
    clearTimeout(hoverTimer);

    // Do not re-trigger while hovering over our own tooltip
    if (tooltipEl && tooltipEl.contains(e.target)) return;

    hoverTimer = setTimeout(() => {
      const result = getWordAtPoint(e.clientX, e.clientY);
      if (!result) return;

      // Don't re-fetch for the same word in the same position
      if (result.word === currentWord && document.getElementById(TOOLTIP_ID)) return;

      showTooltipForWord(result.word, result.sentence, e.clientX, e.clientY);
    }, HOVER_DELAY_MS);
  }

  function onMouseDown(e) {
    if (tooltipEl && !tooltipEl.contains(e.target)) {
      removeTooltip();
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') removeTooltip();
  }

  function onScroll() {
    clearTimeout(hoverTimer);
    removeTooltip();
  }

  // ─── Init ────────────────────────────────────────────────────────────────────

  function init() {
    document.addEventListener('mousemove', onMouseMove,  { passive: true });
    document.addEventListener('mousedown', onMouseDown,  { passive: true });
    document.addEventListener('keydown',   onKeyDown,    { passive: true });
    document.addEventListener('scroll',    onScroll,     { passive: true, capture: true });
  }

  // ─── Util ────────────────────────────────────────────────────────────────────

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Don't run in frames that aren't top-level documents
  if (window.self === window.top || document.contentType === 'text/html') {
    init();
  }
})();
