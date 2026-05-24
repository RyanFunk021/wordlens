# WordLens — Chrome Extension

Context-aware AI definitions for any word you hover over, powered by Claude.

**Repo:** https://github.com/RyanFunk021/wordlens

---

## ⚙️ Setup Before Loading

### 1 · Add your credentials

Create a **`creds.json`** file in the root of the project (it's gitignored — never committed):

```json
{
  "ANTHROPIC_API_KEY": "sk-ant-...",
  "STRIPE_PAYMENT_LINK": "https://buy.stripe.com/..."
}
```

- Get an Anthropic key at → https://console.anthropic.com
- Create a Stripe Payment Link at → https://dashboard.stripe.com/payment-links

`creds.json` is fetched by the background service worker at startup. It never touches content scripts or host-page JavaScript, and it is blocked from git by `.gitignore`. All other constants (model, timeouts, limits) live in the committable `config.js`.

---

### 2 · Generate extension icons

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

## 🔁 Cloning on a New Machine

```bash
git clone https://github.com/RyanFunk021/wordlens.git
cd wordlens
```

Then manually create `creds.json` — it won't be in the clone:

```json
{
  "ANTHROPIC_API_KEY": "sk-ant-...",
  "STRIPE_PAYMENT_LINK": "https://buy.stripe.com/..."
}
```

Then follow the icon generation and Chrome loading steps above.

---

## 📁 File Overview

| File | Purpose |
|------|---------|
| `creds.json` | **Gitignored.** Your API key + Stripe link. Create manually after cloning. |
| `config.js` | Safe to commit. Model ID and all tuneable constants (no secrets). |
| `manifest.json` | Extension manifest (Manifest V3) |
| `background.js` | Service worker — loads creds, Claude API calls, caching, lookup cap, side-panel control |
| `content.js` | Injected into every page — hover detection, tooltip, upsell banner |
| `content.css` | Tooltip styles (fully scoped under `#wl-tooltip-root`) |
| `sidebar.html/js` | Side-panel "Tell me more" deep-dive view |
| `settings.html/js/css` | Extension popup — usage stats, vocabulary profile, Pro upgrade |
| `icons/generate_icons.html` | Open in Chrome to generate and download the three PNG icons |

---

## 🧠 How It Works

1. You hover over any word for **600 ms** — a loading tooltip appears immediately.
2. WordLens extracts the **surrounding sentence** (up to 300 chars each side) for context.
3. A request is sent to the background service worker, which checks the **7-day cache** first. Cached lookups are free and don't count against any limit.
4. On a cache miss, the service worker checks the user's **remaining AI lookup quota**. If quota remains, it calls **Claude Haiku** (`claude-haiku-4-5-20251001`) with a complexity-aware prompt.
5. If Claude fails or times out (5 s), it falls back to **dictionaryapi.dev** and labels the result *(offline definition)*.
6. If the lookup quota is exhausted, the dictionary fallback fires silently and an **upsell banner** appears at the bottom of the tooltip.
7. The tooltip renders a **4-sentence description** + pronunciation button, feedback buttons, and "Tell me more →".
8. Clicking **👍 / 👎** nudges your vocabulary complexity score (±1, capped 1–10).
9. Clicking **Tell me more →** opens the **side panel** with a full etymology, examples, nuances, and related words.

---

## 💳 Monetisation & Access Tiers

WordLens has three ways to use it — no ads on any tier.

| Tier | AI lookups | Price | How |
|------|-----------|-------|-----|
| **Free** | 50 | $0 | Just install |
| **Pro** | 550 total (+500) | $2.99 one-time | Stripe payment |
| **BYOK** | Unlimited | $0 (you pay Anthropic directly) | Paste your API key in Settings |

**BYOK (Bring Your Own Key):**
Users can paste their own Anthropic API key into the Settings popup, pick a model (Haiku / Sonnet / Opus), and get unlimited lookups for free — they pay Anthropic directly at cost. The key is validated against the API before saving, stored in `chrome.storage.local`, and never leaves the device. BYOK users bypass the lookup cap entirely.

**What happens when the free limit is hit:**
- The dictionary fallback still fires so the extension never goes silent
- An amber upsell banner appears in the tooltip: *"You've used all 50 free AI lookups — Go Pro $2.99 →"*
- Clicking the banner opens the Settings popup (where they can also set up BYOK)

**Pro upgrade flow:**
After payment, set `isPro: true` via a background message (`SET_PRO`). Simplest no-backend approach: have the Stripe success page direct the user to:
```
chrome-extension://YOUR_EXTENSION_ID/settings.html?pro=1
```
Then check `?pro=1` in `settings.js` and call `sendMessage({ type: 'SET_PRO' })`.

**Why Haiku as the default:**
Defining a word in 4 sentences is a simple, structured task — Haiku handles it at ~$0.0004/lookup vs $0.002 for Sonnet. BYOK users who want higher quality output can select Sonnet or Opus in the model dropdown.

---

## 🛠 Customisation

All behavioural constants live in `config.js` (safe to commit, no secrets):

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
