# WordLens — Chrome Extension

Context-aware AI definitions for any word you hover over, powered by Claude.

---

## ⚙️ Setup Before Loading

### 1 · Add your Anthropic API key

Open **`config.js`** and replace the placeholder:

```js
ANTHROPIC_API_KEY: 'YOUR_ANTHROPIC_API_KEY',
```

Get a key at → https://console.anthropic.com

> **Security note:** The key lives only in `config.js`, which is imported exclusively by the background service worker. It is never passed to content scripts or exposed to host-page JavaScript. `config.js` is listed in `.gitignore` — never commit it to a public repo.

---

### 2 · Add your Stripe payment link

In the same **`config.js`** file, replace:

```js
STRIPE_PAYMENT_LINK: 'https://buy.stripe.com/YOUR_LINK',
```

With your real Stripe Payment Link URL (create one at https://dashboard.stripe.com/payment-links).

After a successful purchase, use Stripe webhooks or a redirect URL to call a small backend that sets `isPro: true` in the extension's storage — **or** for a simpler no-backend approach, have your Stripe success page instruct the user to click a link like:

```
chrome-extension://YOUR_EXTENSION_ID/settings.html?pro=1
```

Then check `?pro=1` in `settings.js` and call `sendMessage({ type: 'SET_PRO' })`.

---

### 3 · Generate extension icons

Open **`icons/generate_icons.html`** in Chrome, click each Download button, and save:
- `icon16.png`  → `icons/icon16.png`
- `icon48.png`  → `icons/icon48.png`
- `icon128.png` → `icons/icon128.png`

---

## 🚀 Loading in Chrome (Developer Mode)

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **"Load unpacked"**
4. Select the **`wordlens/`** folder (the one containing `manifest.json`)
5. The WordLens icon appears in your toolbar — pin it for easy access

To **reload** after editing files: click the ↻ refresh button on the extension card at `chrome://extensions`.

---

## 📁 File Overview

| File | Purpose |
|------|---------|
| `manifest.json` | Extension manifest (Manifest V3) |
| `config.js` | API key, model ID, and all tuneable constants *(gitignored)* |
| `background.js` | Service worker — API calls, caching, lookup cap enforcement, side-panel control |
| `content.js` | Injected into every page — hover detection, tooltip, upsell banner |
| `content.css` | Tooltip styles (fully scoped under `#wl-tooltip-root`) |
| `sidebar.html/js` | Side-panel "Tell me more" deep-dive view |
| `settings.html/js/css` | Extension popup — usage stats, vocabulary profile, Pro upgrade |

---

## 🧠 How It Works

1. You hover over any word for **600 ms** — a loading tooltip appears immediately.
2. WordLens extracts the **surrounding sentence** (up to 300 chars each side) for context.
3. A request is sent to the background service worker, which checks the **7-day cache** first. Cached lookups are free and don't count against any limit.
4. On a cache miss, the service worker checks the user's **remaining AI lookup quota**. If quota remains, it calls **Claude Haiku** (`claude-haiku-4-5-20251001`) with a complexity-aware prompt.
5. If Claude fails or times out (5 s), it falls back to **dictionaryapi.dev** and labels the result *(offline definition)*.
6. If the lookup quota is exhausted, the dictionary fallback fires silently and an **upsell banner** appears at the bottom of the tooltip.
7. The tooltip renders a **4-sentence description** + pronunciation, feedback buttons, and "Tell me more →".
8. Clicking **👍 / 👎** nudges your vocabulary complexity score (±1, capped 1–10).
9. Clicking **Tell me more →** opens the **side panel** with a full etymology, examples, nuances, and related words.

---

## 💳 Monetisation — Lookup Cap Model

WordLens uses a **one-time purchase** model with no ads.

| Tier | AI lookups | Price |
|------|-----------|-------|
| Free | 50 | $0 |
| Pro | +500 (550 total) | $2.99 one-time |

**Why this works economically:**
- Model: **Claude Haiku 4.5** — ~$0.80/M input tokens (vs $3.00/M for Sonnet)
- Cost per lookup: ~$0.0004
- API cost for a Pro user burning all 550 lookups: **~$0.22**
- Margin on a $2.99 sale: **~93%**

**What happens when the free limit is hit:**
- The dictionary fallback still fires so the extension never goes silent
- An amber upsell banner appears in the tooltip: *"You've used all 50 free AI lookups — Go Pro $2.99 →"*
- Clicking the banner opens the Settings popup directly

**Why Haiku instead of Sonnet:**
Defining a word in 4 sentences at a given complexity level is a simple, structured task — Haiku handles it with output indistinguishable from Sonnet at a fraction of the cost. Sonnet (or Opus) would only be warranted for the sidebar's deeper explanation if you want to A/B test quality there.

---

## 🛠 Customisation

All behavioural constants live in `config.js`:

```js
CLAUDE_MODEL: 'claude-haiku-4-5-20251001', // swap to claude-sonnet-4-6 to upgrade quality
HOVER_DELAY_MS: 600,     // ms before tooltip fires
CACHE_TTL_DAYS: 7,       // cache lifetime
CONTEXT_CHARS:  300,     // sentence context radius (chars each side of word)
DEFAULT_COMPLEXITY: 5,   // starting vocab level (1 = simple, 10 = academic)
FREE_LOOKUP_LIMIT: 50,   // AI lookups available on the free tier
PRO_LOOKUP_BONUS:  500,  // additional AI lookups unlocked by Pro purchase
API_TIMEOUT_MS: 5000,    // ms before Claude call is abandoned and fallback fires
```

To change the pricing tiers, update `FREE_LOOKUP_LIMIT` and `PRO_LOOKUP_BONUS` — the Settings UI and upsell banner both read these values at runtime.
