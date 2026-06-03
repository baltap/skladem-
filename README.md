# Heureka Real-Time Stock Verifier

An intelligent, real-time verification pipeline designed to detect stock status discrepancies between Heureka's XML feed data and actual e-shop product pages, flagging unreliable merchants with a custom Stock Reliability Score.

---

## 📋 Table of Contents
1. [About the Project](#-about-the-project)
2. [Overview](#-overview)
3. [Problem Statement](#-problem-statement)
4. [Architecture](#-architecture)
5. [Tech Stack](#%EF%B8%8F-tech-stack)
6. [Directory Structure](#-directory-structure)
7. [Getting Started](#-getting-started)
8. [System Rules & Mechanics](#-system-rules--mechanics)
   - [Zero-Selector Scraping](#zero-selector-scraping)
   - [Gemini LLM Analysis](#gemini-llm-analysis)
   - [Scoring Engine](#scoring-engine)
9. [AI Collaboration](#-ai-collaboration)

---

## ℹ️ About the Project

The **Heureka Real-Time Stock Verifier** is a prototype proof-of-concept designed during a 4-hour development sprint. It demonstrates how autonomous AI scrapers can verify e-commerce merchant inventory claims dynamically and without reliance on brittle, site-specific CSS selectors. By comparing scraping results against Heureka XML feeds, it holds merchants accountable and protects buyers from phantom stock.

---

## 🔍 Overview

The **Heureka Real-Time Stock Verifier** is a prototype ecosystem built to protect consumers and Heureka's platform reputation from outdated or intentionally misleading "in stock" reports. By pairing high-traffic XML feed sampling with Puppeteer scrapers, Gemini AI page analyzers, and a Chrome Extension overlay, the system provides real-time transparency directly to users.

---

## ⚠️ Problem Statement

E-shops often misreport or delay updating their "in stock" status in Heureka's XML feeds to rank higher on search results. Because feeds sync asynchronously, users frequently navigate to merchant sites only to find the item out of stock, causing frustration, bounce rates, and canceled orders.

---

## 🏗️ Architecture

The system orchestrates client-side DOM injection, a background microservice, automated scraping, and LLM text analysis.

```
                  ┌──────────────────────────────┐
                  │    Heureka Product Page      │
                  └──────────────┬───────────────┘
                                 │
                         (1) Injects Badges
                                 │
                                 ▼
                  ┌──────────────────────────────┐
                  │  Chrome Extension Content JS │
                  └──────────────┬───────────────┘
                                 │
                         (2) Fetch Verification
                                 │
                                 ▼
                  ┌──────────────────────────────┐
                  │  Fastify Backend API Server  │
                  └───────┬──────────────┬───────┘
                          │              │
             (3) Scrape   │              │ (5) Save/Query Score
                          ▼              ▼
                  ┌──────────────┐┌──────────────┐
                  │  Puppeteer   ││    SQLite    │
                  │  Browser JS  ││   Database   │
                  └───────┬──────┘└──────────────┘
                          │
               (4) Analyze Page Snippet
                          │
                          ▼
                  ┌──────────────┐
                  │ Gemini Flash │
                  │    3.5 API   │
                  └──────────────┘
```

---

## 🛠️ Tech Stack

| Layer | Technology | Description |
| :--- | :--- | :--- |
| **Chrome Extension** | Manifest V3 (Vanilla JS) | Content scripts for DOM badge rendering & popup dashboard |
| **Backend API** | Node.js (Fastify / Express) | Orchestrates scraping schedules and serving scores |
| **Scraper** | Puppeteer | Headless scraping targeting checkout / purchase areas |
| **AI Classifier** | Gemini 3.5 Flash | Parses raw checkout HTML into structured stock state |
| **Database** | SQLite / JSON File DB | Records verification history and reliability scoring |
| **Dashboard** | Next.js + Tailwind CSS | Merchant reliability dashboard & monitoring prototype |

---

## 📂 Directory Structure

```
skladem/
├── extension/             # Chrome Extension (Manifest V3)
│   ├── manifest.json
│   ├── background.js      # Ephemeral service worker
│   ├── content.js         # DOM injection & badge rendering
│   ├── content.css        # Badge styling (Vanilla CSS)
│   └── popup/             # Extension UI panel
├── backend/               # Fastify backend service
│   ├── src/
│   │   ├── server.js      # Express / Fastify server routing
│   │   ├── scraper.js     # Puppeteer zero-selector logic
│   │   ├── analyzer.js    # Gemini 3.5 Flash client
│   │   └── database.js    # Scoring engine & local storage
│   ├── prompts/           # Versioned text prompt templates
│   └── .env.example
├── prototype/             # Next.js & Tailwind monitoring dashboard
├── CLAUDE.md              # Claude development guidance file
└── ANTIGRAVITY.md         # Gemini development guidance file
```

---

## 🚀 Getting Started

### Prerequisites
- Node.js (v18+)
- A Google AI / Gemini API Key

### Backend Setup
1. Navigate to the backend directory:
   ```bash
   cd backend
   ```
2. Copy the environment variables template:
   ```bash
   cp .env.example .env
   ```
3. Set your `GEMINI_API_KEY` in the `.env` file.
4. Install dependencies and run in development mode:
   ```bash
   npm install
   # Run backend API
   npm run dev
   ```

### Chrome Extension Installation
1. Open Google Chrome and go to `chrome://extensions/`.
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** (top-left button).
4. Select the `/extension` directory of this repository.

### Prototype Dashboard Setup
1. Navigate to the prototype directory:
   ```bash
   cd prototype
   ```
2. Install dependencies and start the dev server:
   ```bash
   npm install
   npm run dev
   ```
3. Open `http://localhost:3000` to view the merchant status dashboard.

---

## ⚙️ System Rules & Mechanics

### Zero-Selector Scraping
To stay resilient against website redesigns, the Puppeteer worker avoids site-specific CSS selectors. Instead, it:
1. Searches for interactive purchase/cart elements (e.g., `košík`, `koupit`, `skladem`, `dostupnost`, `add to cart`).
2. Climbs up 2-3 DOM parent nodes to capture surrounding contextual text and elements.
3. Extracts and cleans the outer HTML chunk (strictly limited to **3 KB** to keep tokens and latency low).

### Gemini LLM Analysis
The raw HTML snippet is evaluated by Gemini 3.5 Flash using strict prompts. It parses the page context to return a deterministic JSON payload:
```json
{
  "status": "IN_STOCK" | "OUT_OF_STOCK" | "DELAYED" | "UNKNOWN",
  "shipping_days": number | null,
  "confidence": 0.95,
  "reasoning": "Brief explanation of status findings."
}
```

### Scoring Engine
Merchants start with a **Stock Reliability Score ($S_0$) of 100**. Discrepancies reduce the score:
- **Out of stock** (Feed says in stock, web says out of stock): $-20$ (Severity Multiplier 2)
- **Delayed shipping** (Feed says 0 days, web says 7+ days): $-10$ (Severity Multiplier 1)
- **Recovery**: $+2$ per successful, matching verification up to a maximum of 100.

---

## 🤖 AI Collaboration

This repository is co-developed using a multi-agent model consisting of:
- **Claude 3.5 Sonnet** (via Cowork, guided by `CLAUDE.md`)
- **Gemini 3.5 Flash** (via Antigravity, guided by `ANTIGRAVITY.md`)
