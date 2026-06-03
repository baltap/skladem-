import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '../database.json');

// Memory cache of DB
let db = {
  scans: {},      // url -> { url, status, shipping_days, timestamp }
  merchants: {},  // domain -> { domain, score, history: [] }
};

// Queue for pending URLs to scrape
let queue = [];

export async function initDb() {
  try {
    const data = await fs.readFile(DB_PATH, 'utf-8');
    db = JSON.parse(data);
    // Ensure structure is correct
    db.scans = db.scans || {};
    db.merchants = db.merchants || {};
    console.log('[DB] Database loaded successfully.');
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('[DB] Database file not found. Creating a new one.');
      await saveDb();
    } else {
      console.error('[DB] Failed to load database, starting fresh:', error);
    }
  }
}

async function saveDb() {
  try {
    await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2), 'utf-8');
  } catch (error) {
    console.error('[DB] Error writing to database file:', error);
  }
}

// Extract main domain name from URL
export function getDomain(urlStr) {
  try {
    const url = new URL(urlStr);
    let host = url.hostname.replace('www.', '');
    return host;
  } catch (e) {
    return 'unknown_domain';
  }
}

// Save verify results and calculate scores
export async function saveScanResult(url, result, reportedStatus = 'IN_STOCK', reportedDays = 0) {
  const domain = getDomain(url);
  const timestamp = new Date().toISOString();

  // Create scan entry
  db.scans[url] = {
    url,
    status: result.status, // IN_STOCK, OUT_OF_STOCK, DELAYED, UNKNOWN
    shipping_days: result.shipping_days,
    timestamp
  };

  // Initialize merchant if not present
  if (!db.merchants[domain]) {
    db.merchants[domain] = {
      domain,
      score: 100,
      history: []
    };
  }

  const merchant = db.merchants[domain];
  
  // Decide if this check is a discrepancy
  let discrepancyDetected = false;
  let severity = 0; // 0 = fine, 1 = warning/delayed, 2 = critical mismatch (out of stock)
  let description = 'Verified stock availability matches Heureka feed.';

  if (result.status === 'OUT_OF_STOCK') {
    if (reportedStatus !== 'OUT_OF_STOCK') {
      discrepancyDetected = true;
      severity = 2;
      description = `Feed claims availability ("${reportedStatus}"), but website shows OUT OF STOCK.`;
    }
  } else if (result.status === 'DELAYED') {
    if (reportedStatus === 'IN_STOCK') {
      discrepancyDetected = true;
      severity = 1;
      description = `Feed reports immediately IN STOCK, but website shows delayed delivery (${result.shipping_days} days).`;
    } else if (reportedStatus === 'DELAYED') {
      if (result.shipping_days > reportedDays) {
        discrepancyDetected = true;
        severity = 1;
        description = `Feed reports delivery within ${reportedDays} days, but website shows longer delay (${result.shipping_days} days).`;
      } else {
        description = `Verified delay matches or is better than reported (${result.shipping_days} days website vs ${reportedDays} days feed).`;
      }
    } else if (reportedStatus === 'OUT_OF_STOCK') {
      description = `Website shows delayed stock, which exceeds feed reported OUT OF STOCK.`;
    }
  } else if (result.status === 'IN_STOCK') {
    if (reportedStatus === 'OUT_OF_STOCK' || reportedStatus === 'DELAYED') {
      description = `Website is IN STOCK, which matches or exceeds feed reported availability ("${reportedStatus}").`;
    }
  } else if (result.status === 'UNKNOWN') {
    description = 'Verification inconclusive (could not parse stock status).';
  }

  // Scoring algorithm implementation
  let scoreDiff = 0;
  if (discrepancyDetected) {
    // Deduct points based on severity
    scoreDiff = -10 * severity; 
  } else if (result.status !== 'UNKNOWN') {
    // Gradual recovery for successful scans (capped at 100)
    if (merchant.score < 100) {
      scoreDiff = 2;
    }
  }

  merchant.score = Math.max(0, Math.min(100, merchant.score + scoreDiff));
  
  // Record event in history
  merchant.history.unshift({
    timestamp,
    url,
    status: result.status,
    shipping_days: result.shipping_days,
    discrepancyDetected,
    scoreDiff,
    description
  });

  // Limit history length to latest 50 logs
  if (merchant.history.length > 50) {
    merchant.history = merchant.history.slice(0, 50);
  }

  await saveDb();
  
  return {
    scan: db.scans[url],
    merchant: {
      domain: merchant.domain,
      score: merchant.score
    }
  };
}

export function getCachedScan(url) {
  const scan = db.scans[url];
  if (!scan) return null;

  // Cache is fresh if under 15 minutes
  const scanTime = new Date(scan.timestamp).getTime();
  const now = new Date().getTime();
  const diffMinutes = (now - scanTime) / (1000 * 60);

  if (diffMinutes < 15) {
    return scan;
  }
  return null;
}

export function getMerchantScore(domain) {
  const merchant = db.merchants[domain];
  return merchant ? { domain: merchant.domain, score: merchant.score } : { domain, score: 100 };
}

export function getMerchantDetails(domain) {
  return db.merchants[domain] || { domain, score: 100, history: [] };
}

export function getAllMerchants() {
  return Object.values(db.merchants).sort((a, b) => a.score - b.score);
}

// Queue Management
export function addToQueue(url) {
  if (!queue.includes(url) && !db.scans[url]) {
    queue.push(url);
    return true;
  }
  return false;
}

export function getNextQueuedItem() {
  return queue.shift() || null;
}

export function getQueueStatus() {
  return {
    length: queue.length,
    items: [...queue]
  };
}
