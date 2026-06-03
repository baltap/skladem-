# CLAUDE.md

Guidance for **Claude** when co-developing the Heureka Real-Time Stock Verifier.
The companion file for Gemini (Antigravity CLI) is `ANTIGRAVITY.md` in the same directory.
Both agents share this workspace. Before writing code, check both files to avoid contradicting the other agent's work.

---

## Project

**Heureka Real-Time Stock Verifier** — a Chrome extension (and supporting backend) that detects stock status discrepancies between Heureka's XML feed data and the actual product pages of e-shops.

### Problem Statement

E-shops misreport "in stock" in their XML feeds to rank higher on Heureka. Because feeds sync with delays, users see outdated stock info, leading to frustration and canceled orders.

### Solution Architecture

An AI-powered stock verification pipeline:

1. **Sampling & Trigger** — microservice samples high-traffic Heureka product listings marked "in stock"
2. **Zero-Selector Scraping** — Puppeteer worker visits the merchant's product page, extracts HTML around "Add to Cart" / "Buy" buttons
3. **LLM Parsing** — passes HTML snippet to Gemini 3.5 Flash; returns structured JSON stock status
4. **Scoring Engine** — matches LLM output vs. XML feed; flags repeat offenders with a Stock Reliability Score
5. **Chrome Extension UI** — injects a green badge or warning flag directly into Heureka product listing pages

### Tech Stack

| Layer | Technology |
|---|---|
| Chrome Extension | Manifest V3, vanilla JS / content scripts |
| Backend API | Express (Node.js) |
| Scraper | Puppeteer |
| LLM | Gemini 3.5 Flash (Google AI API) |
| Database | JSON file (`database.json`) via async fs write-locking |
| Frontend prototype | Next.js + Tailwind CSS |

### Goals

- Working demo in ~96 hours (4-day sprint)
- No slide decks — live discrepancy detector as deliverable
- Propose dynamic rank demotion for merchants with low stock reliability

---

## Project Directory Structure

```
skladem/
├── extension/             # Chrome Extension (Manifest V3)
│   ├── manifest.json
│   ├── background.js      # Service worker
│   ├── content.js         # DOM injection & badge renderer
│   ├── popup/             # Extension popup UI
│   └── icons/
├── backend/               # Fastify microservice
│   ├── src/
│   │   ├── server.js      # API router
│   │   ├── scraper.js     # Puppeteer zero-selector worker
│   │   ├── analyzer.js    # Gemini 3.5 Flash integration
│   │   └── database.js    # Scoring engine + SQLite
│   ├── prompts/           # Versioned .txt prompt templates
│   ├── package.json
│   └── .env.example
├── prototype/             # Next.js / Tailwind dashboard
├── CLAUDE.md
└── ANTIGRAVITY.md
```

---

## Commands

> Update as each package is scaffolded.

- Install all: `npm install` (from repo root once workspaces set up)
- Run backend: `npm run dev` (from `/backend`)
- Build extension: `npm run build` (from `/extension`)
- Lint / format: `npm run lint` / `npm run format` (from `/backend`)
- Run tests: `npm test`

---

## Environment Variables

Set before running the backend. Load via `process.env` or a `.env` file (gitignored — never hardcode).

| Variable | Purpose | Default |
|---|---|---|
| `GEMINI_API_KEY` | Google AI API key for Gemini 3.5 Flash | — |
| `PORT` | Fastify microservice port | `3001` |

---

## Chrome Extension — Manifest V3 Rules

Non-negotiable. Violating these causes silent bugs that are hard to trace.

### Service Worker state
- The background service worker is **ephemeral** — it spins down after ~30 seconds of inactivity.
- **Never** store state in module-level variables in the service worker. They vanish on the next wake.
- All persistent state must use `chrome.storage.local` (or `chrome.storage.session` for tab-scoped data).
- Use `chrome.alarms` for background synchronization instead of `setInterval`.

### Async messaging
- Always use `async/await` over `.then()` chains.
- Message listeners that respond asynchronously **must** `return true` to keep the channel open:
  ```js
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    handleAsync(msg).then(sendResponse);
    return true; // required — omitting this silently breaks the response
  });
  ```

### Modules
- Prefer ESM (`import/export`) throughout. Never mix CommonJS and ES Modules.
- Content scripts support ESM via `"type": "module"` in `manifest.json`.

### Permissions
- Scope host permissions tightly: `https://*.heureka.cz/*`, `https://*.heureka.sk/*`, and the backend API origin only.

---

## Puppeteer — Zero-Selector Scraping Strategy

Goal: extract the purchase area without any site-specific CSS selectors.

1. Find interactive elements containing keywords: `košík`, `koupit`, `přidat`, `skladem`, `dostupnost`, `cart`, `buy`, `stock`, `add to cart`
2. Traverse 2–3 parent nodes to capture surrounding context (quantity inputs, delivery estimates, warning text)
3. Extract clean text + outer HTML snippet — **cap at 3 KB** to keep token cost and latency low
4. Block unnecessary resources to speed up page load: images, stylesheets, fonts, analytics scripts

---

## Gemini 3.5 Flash — Prompt & Output Contract

Treat Gemini as a **deterministic parsing function**, not a chatbot. Prompt templates live in `/backend/prompts/` as versioned `.txt` files — iterate them independently of application code.

Expected JSON output (strict — parse with `JSON.parse`, reject anything else):

```json
{
  "status": "IN_STOCK" | "OUT_OF_STOCK" | "DELAYED" | "UNKNOWN",
  "shipping_days": number | null,
  "confidence": 0.0,
  "reasoning": "brief explanation"
}
```

---

## Scoring Engine

- Initial reliability score: **S₀ = 100**
- On discrepancy: `S_new = max(0, S_old − (10 × SeverityMultiplier))`
  - `OUT_OF_STOCK` when feed says in stock → SeverityMultiplier = **2**
  - `DELAYED` (XML says 0 days, web says 7+ days) → SeverityMultiplier = **1**
- Recovery: **+2 per correct verification**, capped at 100

---

## Badge UI Spec

| State | Color | Hex | Notes |
|---|---|---|---|
| Verified in stock | Green | `#2ecc71` | Subtle pulse animation |
| Stock discrepancy | Red | `#e74c3c` | Warning flag icon |
| Delayed shipping | Orange | `#f39c12` | Clock icon |

Use Vanilla CSS for injected badges — no external stylesheets.

---

## AI Collaboration Note

This project is co-developed by **Claude** (Anthropic, via Cowork) and **Gemini 3.5 Flash** (Google, via Antigravity CLI `agy`).

- Claude's guidance file: `CLAUDE.md` (this file)
- Gemini's guidance file: `ANTIGRAVITY.md`
- Both agents share the same `/Skladem` workspace
- When in doubt about a decision the other agent made, read `ANTIGRAVITY.md` before overriding
