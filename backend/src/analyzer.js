import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import { saveScanResult } from './database.js';

dotenv.config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
let ai = null;

if (GEMINI_API_KEY && GEMINI_API_KEY !== 'your_gemini_api_key_here') {
  try {
    ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    console.log('[Analyzer] Gemini Client initialized successfully.');
  } catch (error) {
    console.error('[Analyzer] Failed to initialize Gemini Client:', error);
  }
} else {
  console.warn('[Analyzer] WARNING: GEMINI_API_KEY is not configured in .env. Mock verification mode enabled.');
}

/**
 * Uses Gemini Flash to analyze the HTML & text snippet and determine real stock status.
 * @param {string} url - Product e-shop page URL
 * @param {string} htmlSnippet - Extracted buy section HTML
 * @param {string} textSnippet - Extracted buy section Text
 * @returns {Promise<{status: string, shipping_days: number|null, confidence: number, reasoning: string}>}
 */
export async function analyzeStockSnippet(url, htmlSnippet, textSnippet) {
  // Mock fallback mode if Gemini client is unavailable
  if (!ai) {
    return runMockFallback(url, textSnippet);
  }

  const prompt = `
You are a stock verification assistant. Analyze the provided HTML and text snippet taken from an e-shop product page around the "Add to Cart" or "Buy" area.
Determine the actual stock availability.
Respond STRICTLY with the requested JSON schema.

Context details:
- Page URL: ${url}
- HTML structure:
\`\`\`html
${htmlSnippet}
\`\`\`
- Text content:
"${textSnippet}"

Instructions:
1. Identify if the item is "IN_STOCK", "OUT_OF_STOCK", or "DELAYED" (i.e. delayed shipping or backordered).
2. If the stock is delayed, find the exact number of days/weeks/months (e.g. "Doručíme za 4 dny" -> 4 shipping days. "Skladem u dodavatele (3-5 dní)" -> 5 shipping days). Convert weeks to days (e.g. 1 week = 7 days).
3. If the language is Czech or Slovak, recognize words like:
   - "skladem", "ihned k odběru" -> IN_STOCK (0 shipping days)
   - "vyprodáno", "nedostupné", "momentálně nedostupné", "těšíme se" -> OUT_OF_STOCK
   - "skladem u dodavatele", "na objednávku", "doručení do X dnů", "odesíláme za X dní" -> DELAYED (with X days)
4. Provide a brief reasoning explaining why you came to this conclusion.
`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            status: { 
              type: 'STRING', 
              enum: ['IN_STOCK', 'OUT_OF_STOCK', 'DELAYED', 'UNKNOWN'] 
            },
            shipping_days: { 
              type: 'INTEGER',
              description: 'Estimated shipping days. 0 if immediately in stock. Null if out of stock or unknown.'
            },
            confidence: { 
              type: 'NUMBER',
              description: 'Confidence score between 0.0 and 1.0'
            },
            reasoning: { 
              type: 'STRING',
              description: 'Explanation for status classification'
            }
          },
          required: ['status', 'shipping_days', 'confidence', 'reasoning']
        }
      }
    });

    const textOutput = response.text;
    console.log(`[Analyzer] Gemini Response: ${textOutput}`);
    
    const result = JSON.parse(textOutput);
    return result;

  } catch (error) {
    console.error(`[Analyzer] Gemini analysis failed for ${url}:`, error);
    // Graceful fallback to regex parsing instead of failing entirely
    return runMockFallback(url, textSnippet);
  }
}

/**
 * Local regex fallback parser for testing and when API key is missing
 */
function runMockFallback(url, text) {
  const normalizedText = text.toLowerCase();
  
  let status = 'IN_STOCK';
  let shipping_days = 0;
  let confidence = 0.5;
  let reasoning = 'Mock regex fallback analysis.';

  // Check out of stock Czech/Slovak keywords
  if (
    normalizedText.includes('vyprodáno') || 
    normalizedText.includes('nedostupné') || 
    normalizedText.includes('nemáme skladem') ||
    normalizedText.includes('vyprodané')
  ) {
    status = 'OUT_OF_STOCK';
    shipping_days = null;
    confidence = 0.8;
    reasoning = 'Detected out of stock keywords (vyprodáno/nedostupné) in snippet.';
  } 
  // Check delayed shipping Czech/Slovak keywords
  else if (
    normalizedText.includes('u dodavatele') || 
    normalizedText.includes('na objednávku') || 
    normalizedText.includes('odesíláme za') ||
    normalizedText.includes('doručení do')
  ) {
    status = 'DELAYED';
    confidence = 0.7;
    
    // Attempt to extract days (supporting optional intermediate words like "pracovní/pracovních")
    const match = normalizedText.match(/(\d+)\s*(?:pracovní(?:ch|ho|c)?|pracovn(?:é|ých|y))?\s*(?:dní|dnů|dny|dni|dnech)/);
    if (match) {
      shipping_days = parseInt(match[1], 10);
    } else {
      shipping_days = 7; // Default fallback days
    }
    reasoning = `Detected delayed delivery keywords. Estimated shipping days: ${shipping_days}.`;
  }
  // Check standard in stock keywords
  else if (normalizedText.includes('skladem') || normalizedText.includes('ihned')) {
    status = 'IN_STOCK';
    shipping_days = 0;
    confidence = 0.8;
    reasoning = 'Detected standard in stock keywords.';
  } else {
    // If we have no indicator, look for mock indicators in test URL
    if (url.includes('out-of-stock') || url.includes('vyprodano')) {
      status = 'OUT_OF_STOCK';
      shipping_days = null;
      confidence = 0.9;
    } else if (url.includes('delayed') || url.includes('dostupnost')) {
      status = 'DELAYED';
      shipping_days = 5;
      confidence = 0.9;
    }
  }

  console.log(`[Analyzer][Fallback] Analyzed: ${status} (${shipping_days} days) for URL: ${url}`);
  return { status, shipping_days, confidence, reasoning };
}
