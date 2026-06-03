# Walkthrough - Heureka Real-Time Stock Verifier (MVP)

We have successfully engineered and verified the updated codebase for the **Heureka Real-Time Stock Verifier MVP**, resolving all critical review feedback.

---

## Changes Implemented

We created a fully integrated, user-triggered MVP architecture across the following modules:

```
Skladem/
├── backend/               # Express Microservice API (Synchronous Scraping)
│   ├── src/
│   │   ├── server.js      # API router (delivering sync check & 15m caching, CORS enabled)
│   │   ├── database.js    # Persistent JSON db (reliability scoring & 15m TTL)
│   │   ├── scraper.js     # Puppeteer zero-selector element extractor
│   │   ├── analyzer.js    # Gemini Flash connection (with regex local fallback)
│   │   └── tests/
│   │       └── run.js     # Deterministic automated test runner
│   ├── package.json       # ESM config, Puppeteer, Cors, Google GenAI SDK (v2.7.0)
│   └── .env.example
├── extension/             # Chrome Extension (Manifest V3)
│   ├── manifest.json      # Declarations, storage + tabs permissions, host rules
│   ├── background.js      # Relays queries, handles local extension cache, 15s timeout limits
│   ├── content.js         # Injects "🛡️ Verify Stock" click trigger buttons & handles offline retries
│   ├── content.css        # Premium button styles, error states, and status hover tooltips
│   └── popup/             # Extension dashboard popup UI (HTML/CSS/JS)
└── prototype/             # Next.js + Tailwind CSS Sandbox Dashboard
    ├── app/
    │   ├── page.js        # Main scoreboard and interactive scraper playground
    │   ├── layout.js      # App layout metadata setup
    │   └── globals.css    # Custom Outfit fonts & scrollbar theme
    └── package.json
```

---

## Review Feedback Addressed

### 1. Synchronous Request Timeouts & Error UX
* Added a **15-second abort limit** in [background.js](file:///Users/peter/Data/AI/Skladem/extension/background.js) using standard `AbortController`.
* Configured [content.js](file:///Users/peter/Data/AI/Skladem/extension/content.js) to intercept backend connection drops or timeout cancellations. The trigger button is automatically re-enabled, its layout turns into a warning-red state (`⚠️ Server Offline (Retry)`), and the hover tooltip details the exact cause (timeout vs. server offline) to allow click-to-retry actions.
* Styles for the warning state added as `.hsv-btn-error` in [content.css](file:///Users/peter/Data/AI/Skladem/extension/content.css).

### 2. Inspector DOM Selectors Documented
We mapped out and implemented specific DOM classes matching Heureka's layout grid to safely hook our elements:
* **Target exit anchors**: `a[href*="/exit/"]`, `a[href*="redir"]`, `a.c-shop-name__link`, `a.c-offer__shop-link`.
* **Row containers**: `.c-offer`, `.o-offer`, `.c-shop-list__item`, `.c-offer-item`, `.shop-delivery`.
* **Price labels (injection points)**: `.c-offer__price`, `.c-offer__delivery`, `.price`, `.c-shop-delivery`.

### 3. Database Consistency
* Aligned the codebase on a **Custom File-based JSON Database** (`database.json`), ensuring consistent execution without local C++ SQLite build issues on macOS.

---

## Technical Flow Diagram (MVP)

1. The user visits a Heureka comparison listing.
2. `content.js` injects a custom `🛡️ Verify Stock` button next to each merchant offer.
3. When clicked, the button updates to `⏳ Verifying...`, and sends a verification request through the Service Worker (`background.js`) to the backend.
4. The backend (`server.js`) checks if that URL was verified in the last **15 minutes**.
   * **Cache Hit**: Returns cached availability status instantly.
   * **Cache Miss**: Opens a headless Puppeteer browser, extracts the buy snippet, asks Gemini Flash to parse, updates database scoring, and returns.
5. If the request succeeds: `content.js` replaces the trigger button with the corresponding status badge (Green/Orange/Red check or warning flag) with a descriptive hover tooltip.
6. If the request fails (timeout/offline): `content.js` re-enables the button, formats it as an error button, and shows the retry option.

---

## Verification Results

### 1. Automated Test Suite Logs
We ran the backend test suite to verify domain parsing, database scoring rules (score decay and recovery), and Czech/Slovak working days regex extraction heuristics. All tests passed successfully:

```
=== HEUREKA STOCK VERIFIER TEST SUITE ===
[Test Setup] Existing database cleared.

[Test 1] Testing domain parsing...
Domains extracted: [ 'alza.cz', 'czc.cz', 'subdomain.datart.cz' ]
✅ Domain parsing correct!

[Test 2] Testing database and scoring engine...
[DB] Database file not found. Creating a new one.
Initial score for test-shop.cz: 100
Mocking critical discrepancy (OUT_OF_STOCK)...
New score (expected 80): 80
Mocking warning discrepancy (DELAYED)...
New score (expected 70): 70
Mocking successful verification (IN_STOCK)...
New score (expected 72): 72
History count (expected 3): 3
Latest history event description: Verified in stock matches feed.
✅ Database scoring system validated!

[Test 3] Testing LLM analyzer fallback module...
[Analyzer][Fallback] Analyzed: OUT_OF_STOCK (null days) for URL: https://example.com/item1
[Analyzer][Fallback] Analyzed: DELAYED (4 days) for URL: https://example.com/item2
[Analyzer][Fallback] Analyzed: IN_STOCK (0 days) for URL: https://example.com/item3
...
✅ Analysis parser rules validated!

=== ALL TESTS PASSED SUCCESSFULLY ===
```

### 2. Launch Instructions
1. **Launch Backend**:
   Run the backend microservice inside `backend/`:
   ```bash
   npm start
   ```
2. **Load Chrome Extension**:
   * Open Chrome and navigate to `chrome://extensions`.
   * Enable "Developer mode" (toggle in top right).
   * Click "Load unpacked" and select the `Skladem/extension` folder.
   * Verify badges load when visiting `heureka.cz` product details and clicking the buttons.
3. **Launch Next.js Sandbox Dashboard**:
   Run the dashboard dev server inside `prototype/`:
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000` to interact with the sandbox simulator.
