/**
 * WordLens — Configuration
 *
 * Safe to commit. Secrets (API key, Stripe link) live in creds.json,
 * which is gitignored. background.js fetches creds.json at startup and
 * merges the values in at runtime — they never appear in this file.
 */

export const WL_CONFIG = {

  // Claude Haiku 4.5 — fast, cheap, and perfectly capable for word definitions.
  // Cost: ~$0.80/M input tokens vs $3.00/M for Sonnet. For a 4-sentence
  // definition task, Haiku quality is indistinguishable from Sonnet.
  CLAUDE_MODEL: 'claude-haiku-4-5-20251001',

  // Anthropic Messages API endpoint
  API_ENDPOINT: 'https://api.anthropic.com/v1/messages',

  // Milliseconds before the API call is considered timed out
  API_TIMEOUT_MS: 5000,

  // Milliseconds the user must hover before a lookup is triggered
  HOVER_DELAY_MS: 600,

  // Days before a cached response expires
  CACHE_TTL_DAYS: 7,

  // Characters extracted around the hovered word for sentence context
  CONTEXT_CHARS: 300,

  // Maximum entries kept in the feedback log
  MAX_FEEDBACK_LOG: 500,

  // Default vocabulary complexity score (1 = simple, 10 = academic)
  DEFAULT_COMPLEXITY: 5,

  // ── Lookup caps ──────────────────────────────────────────────────────────
  // Free users get this many AI lookups total (dictionary fallback still works)
  FREE_LOOKUP_LIMIT: 50,

  // Pro users get this many additional AI lookups on top of the free tier.
  // 500 × ~$0.0004 (Haiku cost) = ~$0.20 in API fees on a $2.99 sale → 93% margin.
  PRO_LOOKUP_BONUS: 500,

  // Maximum entries kept in the lookup history (for sidebar chips)
  MAX_HISTORY: 10,

  // Fallback dictionary
  FALLBACK_DICT_API: 'https://api.dictionaryapi.dev/api/v2/entries/en/',

  // Models available for BYOK (Bring Your Own Key) users to select in Settings
  BYOK_MODELS: [
    { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5 — fastest & cheapest' },
    { id: 'claude-sonnet-4-6',         label: 'Sonnet 4.6 — balanced'          },
    { id: 'claude-opus-4-7',           label: 'Opus 4.7 — most capable'        },
  ],

};
