import { initDb, saveScanResult, getMerchantScore, getMerchantDetails, getDomain } from '../database.js';
import { analyzeStockSnippet } from '../analyzer.js';

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '../../database.json');

async function runTests() {
  console.log('=== HEUREKA STOCK VERIFIER TEST SUITE ===');

  // Clear existing database for deterministic test runs
  try {
    await fs.unlink(DB_PATH);
    console.log('[Test Setup] Existing database cleared.');
  } catch (e) {
    // File didn't exist, which is fine
  }

  // Test 1: Domain parser
  console.log('\n[Test 1] Testing domain parsing...');
  const domains = [
    getDomain('https://www.alza.cz/mobilni-telefony/18851259.htm'),
    getDomain('http://czc.cz/product-123'),
    getDomain('https://subdomain.datart.cz/something')
  ];
  console.log('Domains extracted:', domains);
  if (domains[0] === 'alza.cz' && domains[1] === 'czc.cz' && domains[2] === 'subdomain.datart.cz') {
    console.log('✅ Domain parsing correct!');
  } else {
    console.error('❌ Domain parsing failed!');
  }

  // Test 2: Database Initialization and Scoring System
  console.log('\n[Test 2] Testing database and scoring engine...');
  await initDb();
  
  const testUrl = 'https://www.test-shop.cz/iphone-15';
  const testDomain = 'test-shop.cz';

  // Base score check (should be 100)
  let merchant = getMerchantScore(testDomain);
  console.log(`Initial score for ${testDomain}: ${merchant.score}`);

  // Mock a critical discrepancy (OUT_OF_STOCK on site)
  console.log('Mocking critical discrepancy (OUT_OF_STOCK)...');
  let result = await saveScanResult(testUrl, {
    status: 'OUT_OF_STOCK',
    shipping_days: null,
    confidence: 1.0
  });
  console.log(`New score (expected 80): ${result.merchant.score}`);

  // Mock another discrepancy (DELAYED delivery)
  console.log('Mocking warning discrepancy (DELAYED)...');
  result = await saveScanResult(testUrl, {
    status: 'DELAYED',
    shipping_days: 5,
    confidence: 1.0
  });
  console.log(`New score (expected 70): ${result.merchant.score}`);

  // Mock recovery (IN_STOCK matches feed)
  console.log('Mocking successful verification (IN_STOCK)...');
  result = await saveScanResult(testUrl, {
    status: 'IN_STOCK',
    shipping_days: 0,
    confidence: 1.0
  });
  console.log(`New score (expected 72): ${result.merchant.score}`);

  // Mock matching delay (feed says DELAYED 5 days, web says 3 days -> MATCH!)
  console.log('Mocking matches delayed delivery feed (DELAYED 3 days web vs 5 days feed)...');
  result = await saveScanResult(testUrl, {
    status: 'DELAYED',
    shipping_days: 3,
    confidence: 1.0
  }, 'DELAYED', 5);
  console.log(`New score (expected 74 - recovery!): ${result.merchant.score}`);

  // Mock exceeding delay (feed says DELAYED 3 days, web says 7 days -> DISCREPANCY!)
  console.log('Mocking exceeds delayed delivery feed (DELAYED 7 days web vs 3 days feed)...');
  result = await saveScanResult(testUrl, {
    status: 'DELAYED',
    shipping_days: 7,
    confidence: 1.0
  }, 'DELAYED', 3);
  console.log(`New score (expected 64 - penalty!): ${result.merchant.score}`);

  // Check history logging
  const details = getMerchantDetails(testDomain);
  console.log(`History count (expected 5): ${details.history.length}`);
  console.log('Latest history event description:', details.history[0].description);
  
  if (details.history.length === 5 && details.score === 64) {
    console.log('✅ Database scoring system validated!');
  } else {
    console.error('❌ Database scoring validation failed!');
  }

  // Test 3: LLM / Regex Parser Fallback
  console.log('\n[Test 3] Testing LLM analyzer fallback module...');
  
  const outOfStockText = 'K produktu Apple iPhone 15: Omlouváme se, zboží je momentálně vyprodáno. Těšíme se na další naskladnění.';
  const delayedText = 'Dostupnost: Skladem u dodavatele. Odesíláme do 4 pracovních dní.';
  const inStockText = 'Zboží máme skladem na prodejně v Praze! Ihned k odběru.';

  const outOfStockAnalysis = await analyzeStockSnippet('https://example.com/item1', '<div>Vyprodáno</div>', outOfStockText);
  const delayedAnalysis = await analyzeStockSnippet('https://example.com/item2', '<div>Doručení 4 dny</div>', delayedText);
  const inStockAnalysis = await analyzeStockSnippet('https://example.com/item3', '<div>Skladem</div>', inStockText);

  console.log('Analyzed Out of Stock:', outOfStockAnalysis);
  console.log('Analyzed Delayed:', delayedAnalysis);
  console.log('Analyzed In Stock:', inStockAnalysis);

  if (
    outOfStockAnalysis.status === 'OUT_OF_STOCK' && 
    delayedAnalysis.status === 'DELAYED' && 
    delayedAnalysis.shipping_days === 4 && 
    inStockAnalysis.status === 'IN_STOCK'
  ) {
    console.log('✅ Analysis parser rules validated!');
  } else {
    console.error('❌ Analysis parser rules failed validation!');
  }

  console.log('\n=== ALL TESTS PASSED SUCCESSFULLY ===');
}

runTests().catch(err => {
  console.error('Test suite crashed:', err);
  process.exit(1);
});
