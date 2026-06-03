# Implementation Plan - Heureka Real-Time Stock Verifier (MVP)

This plan outlines the architecture and changes required to build the AI-powered real-time stock discrepancy detector for Heureka as an on-demand MVP.

---

## User Review Required

> [!IMPORTANT]
> **Gemini API Access**: The backend requires a `GEMINI_API_KEY` to run the Gemini Flash parsing. You will need to provide this in a `.env` file before running the backend.
>
> **Click-to-Trigger UX Flow**:
> Instead of scanning all e-shop listings automatically (which causes heavy API overhead), we inject a **"🛡️ Verify Stock"** button next to each merchant row in the comparison grid on Heureka.
> 1. The user clicks the button.
> 2. The button transforms into a spinner state: `"⏳ Verifying..."`.
> 3. The extension requests a real-time check from the backend.
> 4. The backend checks its cache first. If a result is found within the last 15 minutes, it returns immediately. If not, it runs the scraper and LLM parser.
> 5. The button is replaced with the final status badge (Green/Orange/Red) showing the results in a hover tooltip.

---

## Critical Gaps Resolved

### 1. Sync Request Timeout & Error States
Because Puppeteer startup + Gemini calls can take 5–15 seconds, a raw synchronous wait runs the risk of hitting Chrome message-port timeouts or hanging indefinitely if the backend server is offline.
* **Timeout Threshold**: Implement a strict **15-second timeout** on the extension side using `AbortController` in background fetches.
* **Error States**: If the backend is unreachable or times out, the content script will transition the spinner into an error button: `⚠️ Timeout / Server Offline (Click to retry)`. The user is never left in an infinite loading state.
* **Connection Health Indicator**: The extension popup checks the backend health on load and displays an explicit "Server: Online/Offline" status.

### 2. Heureka DOM Selector Specifications
To prevent injection layout breaks, the content script anchors the verification controls to these inspected Heureka DOM elements:
* **Outbound/Redirect Link Selection**: Finds target offers by identifying exit anchors:
  `a[href*="/exit/"]`, `a[href*="redir"]`, `a.c-shop-name__link`, `a.c-offer__shop-link`, `a.js-exit-link`.
* **Offer Container Row**: Identifies single merchant cards by bubbling up to parents with classes matching:
  `.c-offer`, `.o-offer`, `.c-shop-list__item`, `.c-offer-item`, `.shop-delivery`, or tag `li` under list containers.
* **Injection Target**: Inserts trigger buttons and status badges near the offer's pricing/delivery elements:
  `.c-offer__price`, `.c-offer__delivery`, `.price`, `.delivery`, `.c-shop-delivery`.

### 3. Database Specification
* **Database standard**: We use a **Custom File-based JSON Database** (`database.json`) persisted via asynchronous node `fs` write locking. This provides database-free portability, avoiding native binary compilation debt (`better-sqlite3` or `sqlite3` setup issues) on macOS environments during prototyping.

### 4. CORS Whitelisting
* The backend Express microservice uses `cors` to whitelist cross-origin requests originating from Chrome Extension wrappers (`chrome-extension://*`) to prevent browser blocking.

---

## Proposed Architecture

```
                                      [ E-Shop Page ]
                                             ▲
                                             │ (Scrapes HTML snippet)
┌──────────────────┐  Sync Request    ┌─────┴─────┐   LLM Parse    ┌──────────────┐
│ Chrome Extension ├─────────────────>│  Backend  ├───────────────>│ Gemini Flash │
│ (Content Script) │<─────────────────┤ Service   │<───────────────┤ API          │
└──────────────────┘  Result Status   └─────┬─────┘    JSON Status └──────────────┘
                                             │
                                       ┌─────▼─────┐
                                       │ Database  │
                                       │ (JSON DB) │
                                       └───────────┘
```

## Directory Structure

```
Skladem/
├── backend/               # Express Microservice API (Synchronous Scraping)
│   ├── src/
│   │   ├── server.js      # API router (delivering sync check & 15m caching)
│   │   ├── database.js    # Persistent JSON db (reliability scoring & 15m TTL)
│   │   ├── scraper.js     # Puppeteer zero-selector element extractor
│   │   ├── analyzer.js    # Gemini Flash connection (with regex local fallback)
│   │   └── tests/
│   │       └── run.js     # Deterministic automated test runner
│   ├── package.json       # ESM config, Puppeteer, Cors, Google GenAI SDK (v2.7.0)
│   └── .env.example
├── extension/             # Chrome Extension (Manifest V3)
│   ├── manifest.json      # Declarations, storage + tabs permissions, host rules
│   ├── background.js      # Relays queries & handles local extension cache
│   ├── content.js         # Injects "🛡️ Verify Stock" click trigger buttons
│   ├── content.css        # Premium button styles & status badge hover tooltips
│   └── popup/             # Extension dashboard popup UI (HTML/CSS/JS)
└── prototype/             # Next.js + Tailwind CSS Sandbox Dashboard
    ├── app/
    │   ├── page.js        # Main scoreboard and interactive scraper playground
    │   ├── layout.js      # App layout metadata setup
    │   └── globals.css    # Custom Outfit fonts & scrollbar theme
    └── package.json
```

---

## Verification Plan

### Automated Tests
* Run `npm test` inside `backend/` to verify mock scraper HTML parsing, working days regex extraction, and database score decay rules.

### Manual Verification
1. Open Heureka search/detail page.
2. Verify that every merchant row gets a custom `🛡️ Verify Stock` button injected.
3. Click one button: verify it shows a loading spinner, triggers Puppeteer/Gemini, and displays the correct badge (e.g. Green "Stock Verified" or Red "Discrepancy" depending on mock setup).
4. Verify clicking the button a second time returns the results instantly from cache.
5. Simulate server downtime: stop the backend, click verify, and confirm that the button changes to `⚠️ Timeout / Server Offline (Click to retry)` after 15 seconds.
