import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { 
  initDb, 
  getCachedScan, 
  getMerchantScore, 
  getMerchantDetails, 
  getAllMerchants,
  saveScanResult,
  getDomain
} from './database.js';
import { scrapeProductPage } from './scraper.js';
import { analyzeStockSnippet } from './analyzer.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

/**
 * Parses Heureka's DOM stock text into structured status & delivery days
 */
function parseHeurekaReportedStatus(text) {
  if (!text) return { status: 'IN_STOCK', shipping_days: 0 };
  
  const normalized = text.toLowerCase();
  
  // 1. Check for Out of Stock indicators
  if (
    normalized.includes('vyprodáno') || 
    normalized.includes('nedostupné') || 
    normalized.includes('nemáme skladem') ||
    normalized.includes('vyprodané')
  ) {
    return { status: 'OUT_OF_STOCK', shipping_days: null };
  }
  
  // 2. Check for delayed shipping indicators
  if (
    normalized.includes('dodavatele') || 
    normalized.includes('objednávku') || 
    normalized.includes('odesíláme za') ||
    normalized.includes('doručení do') ||
    normalized.includes('do ') || 
    normalized.includes('dnů') ||
    normalized.includes('dny') || 
    normalized.includes('dní') ||
    normalized.includes('pracov')
  ) {
    // Attempt to extract days (using our Czech working days regex matcher)
    const match = normalized.match(/(\d+)\s*(?:pracovní(?:ch|ho|c)?|pracovn(?:é|ých|y))?\s*(?:dní|dnů|dny|dni|dnech)/);
    const shipping_days = match ? parseInt(match[1], 10) : 3; // Default to 3 days generic delay
    return { status: 'DELAYED', shipping_days };
  }
  
  // 3. Default to In Stock (0 days)
  return { status: 'IN_STOCK', shipping_days: 0 };
}

// Main MVP API verification endpoint (synchronous lookup/scrape)
app.get('/api/verify', async (req, res) => {
  const { url, force, reported_text } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'Missing product URL query parameter.' });
  }

  try {
    const domain = getDomain(url);
    const reported = parseHeurekaReportedStatus(reported_text);
    console.log(`[API] Parsed reported feed status: ${reported.status} (${reported.shipping_days} days) for text: "${reported_text}"`);
    
    // 1. Check database cache first (15 min freshness limit in database.js)
    const cached = getCachedScan(url);
    if (cached && force !== 'true') {
      console.log(`[API] Cache hit for: ${url}`);
      const merchant = getMerchantScore(domain);
      return res.json({
        cached: true,
        status: cached.status,
        shipping_days: cached.shipping_days,
        timestamp: cached.timestamp,
        merchantScore: merchant.score
      });
    }

    // 2. Cache miss: trigger synchronous Puppeteer scrape + Gemini analysis
    console.log(`[API] Cache miss. Starting synchronous verification for: ${url}`);
    const scrapeData = await scrapeProductPage(url);
    const analysis = await analyzeStockSnippet(url, scrapeData.htmlSnippet, scrapeData.textSnippet);
    const saved = await saveScanResult(url, analysis, reported.status, reported.shipping_days);
    
    res.json({
      cached: false,
      status: saved.scan.status,
      shipping_days: saved.scan.shipping_days,
      timestamp: saved.scan.timestamp,
      merchantScore: saved.merchant.score
    });

  } catch (error) {
    console.error('[API] Verification failed:', error);
    res.status(500).json({ error: error.message || 'Verification process failed.' });
  }
});

// Sync verify endpoint (POST-based helper for Dashboard simulator)
app.post('/api/verify-sync', async (req, res) => {
  const { url, reportedStatus, reportedDays } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'Missing product URL in request body.' });
  }

  try {
    console.log(`[API] Synchronous dashboard verification requested for: ${url}`);
    const scrapeData = await scrapeProductPage(url);
    const analysis = await analyzeStockSnippet(url, scrapeData.htmlSnippet, scrapeData.textSnippet);
    const saved = await saveScanResult(
      url, 
      analysis, 
      reportedStatus || 'IN_STOCK', 
      reportedDays !== undefined ? reportedDays : 0
    );
    
    res.json({
      success: true,
      url: saved.scan.url,
      status: saved.scan.status,
      shipping_days: saved.scan.shipping_days,
      timestamp: saved.scan.timestamp,
      merchant: saved.merchant
    });
  } catch (error) {
    console.error('[API] Sync verification failed:', error);
    res.status(500).json({ error: error.message || 'Verification process failed.' });
  }
});

// Retrieve single merchant score and history
app.get('/api/merchants/:domain', (req, res) => {
  const { domain } = req.params;
  res.json(getMerchantDetails(domain));
});

// Retrieve all merchant reliability scores
app.get('/api/merchants', (req, res) => {
  res.json(getAllMerchants());
});

// Start Server
async function start() {
  await initDb();
  
  app.listen(PORT, () => {
    console.log(`[API] MVP Server listening on port ${PORT}`);
  });
}

start();
