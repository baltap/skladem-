import puppeteer from 'puppeteer';

// Regular expressions to search for buy buttons or stock details
const BUY_BUTTON_KEYWORDS = /košík|koupit|přidat|vložit|skladem|dostupnost|koupě|buy|cart|stock/i;

// Block lists to speed up page loads dramatically
const BLOCKED_RESOURCES = ['image', 'stylesheet', 'font', 'media', 'manifest', 'other'];
const BLOCKED_URL_PATTERNS = [
  'google-analytics.com',
  'googletagmanager.com',
  'facebook.net',
  'analytics',
  'doubleclick',
  'adsystem',
  'hotjar'
];

/**
 * Resolves redirects and extracts stock-related HTML snippet using zero-selector heuristics
 * @param {string} url - Target e-shop URL
 * @returns {Promise<{htmlSnippet: string, textSnippet: string, resolvedUrl: string}>}
 */
export async function scrapeProductPage(url) {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1280,800'
      ]
    });

    const page = await browser.newPage();
    
    // Set user agent to resemble a real browser
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    // Set viewport
    await page.setViewport({ width: 1280, height: 800 });

    // Enable request interception to block images/styles/analytics
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const resourceType = request.resourceType();
      const requestUrl = request.url();
      
      const shouldBlock = 
        BLOCKED_RESOURCES.includes(resourceType) || 
        BLOCKED_URL_PATTERNS.some(pattern => requestUrl.includes(pattern));

      if (shouldBlock) {
        request.abort();
      } else {
        request.continue();
      }
    });

    console.log(`[Scraper] Navigating to: ${url}`);
    
    // Go to the page and wait until network is mostly idle, catching timeouts to fail gracefully
    try {
      await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: 12000
      });
    } catch (e) {
      console.warn(`[Scraper] Navigation to ${url} on networkidle2 timed out, proceeding with current state...`);
    }

    const resolvedUrl = page.url();
    console.log(`[Scraper] Resolved landing URL: ${resolvedUrl}`);

    // Wait a brief moment for any deferred script execution rendering stock statuses
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Zero-selector parser script to run inside browser context
    const extractionResult = await page.evaluate((buyBtnRegexStr) => {
      const regex = new RegExp(buyBtnRegexStr, 'i');
      
      // 1. Helper to find candidate elements (buttons, inputs, divs acting as buttons)
      const elements = Array.from(document.querySelectorAll('button, a, input[type="button"], input[type="submit"], [role="button"], div, span'));
      
      let bestCandidates = [];

      for (const el of elements) {
        // Filter out hidden or tiny elements
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;

        // Check if text content matches buy or cart triggers
        const text = (el.innerText || el.value || '').trim();
        if (text && regex.test(text)) {
          // Score candidate based on tag and properties
          let score = 0;
          const tag = el.tagName.toLowerCase();
          const elClass = (el.className || '').toString().toLowerCase();
          const elId = (el.id || '').toString().toLowerCase();
          
          if (tag === 'button') score += 10;
          if (tag === 'a') score += 5;
          if (elClass.includes('cart') || elClass.includes('buy') || elClass.includes('basket')) score += 10;
          if (elId.includes('cart') || elId.includes('buy') || elId.includes('basket')) score += 10;
          
          // Avoid matching huge wrapper divs
          if (el.children.length > 5 && tag === 'div') score -= 15;

          // Penalize elements inside header, nav, footer, or menu structures
          // Refined to ignore product-specific header classes like "product-header" or "product-info-header"
          let ancestor = el.parentElement;
          let isInHeaderOrNav = false;
          while (ancestor && ancestor.tagName.toLowerCase() !== 'body') {
            const aTag = ancestor.tagName.toLowerCase();
            const aClass = (ancestor.className || '').toString().toLowerCase();
            const aId = (ancestor.id || '').toString().toLowerCase();
            
            const isSiteHeaderOrNav = 
              aTag === 'header' || aTag === 'nav' || aTag === 'footer' ||
              ((aClass.includes('header') || aId.includes('header')) && !aClass.includes('product') && !aId.includes('product') && !aClass.includes('detail') && !aId.includes('detail')) ||
              aClass.includes('menu') || aId.includes('menu') ||
              aClass.includes('nav') || aId.includes('nav') ||
              aClass.includes('footer') || aId.includes('footer');

            if (isSiteHeaderOrNav) {
              isInHeaderOrNav = true;
              break;
            }
            ancestor = ancestor.parentElement;
          }
          if (isInHeaderOrNav) {
            score -= 30; // Strong penalty to push header navigation/mini-carts below product buy buttons
          }

          // Reward strong action verbs
          const lowerText = text.toLowerCase();
          if (
            lowerText.includes('koupit') || 
            lowerText.includes('přidat') || 
            lowerText.includes('vložit') || 
            lowerText.includes('buy') || 
            lowerText.includes('add') || 
            lowerText.includes('order') || 
            lowerText.includes('objednat')
          ) {
            score += 15;
          }

          bestCandidates.push({ element: el, score });
        }
      }

      // Sort by best score desc
      bestCandidates.sort((a, b) => b.score - a.score);
      
      let snippetElement = null;
      if (bestCandidates.length > 0) {
        // Get the best button and bubble up to grab the purchase context (price, availability statement)
        let node = bestCandidates[0].element;
        
        let levels = 0;
        // Bubble up 5 levels to capture nearby details like price/stock badges
        while (node.parentElement && levels < 5) {
          const parentTag = node.parentElement.tagName.toLowerCase();
          const parentClass = (node.parentElement.className || '').toString().toLowerCase();
          const parentId = (node.parentElement.id || '').toString().toLowerCase();
          
          if (
            parentTag === 'body' || 
            parentTag === 'html' || 
            parentTag === 'main' || 
            parentTag === 'header' || 
            parentTag === 'footer' ||
            parentClass.includes('container') ||
            parentClass.includes('wrapper') ||
            parentClass.includes('pux-') ||
            parentId.includes('container') ||
            parentId.includes('wrapper')
          ) {
            break; // Keep node under main structural wrappers
          }
          
          if (parentTag === 'form') {
            node = node.parentElement; // Include the form element
            break;
          }
          
          node = node.parentElement;
          levels++;
        }
        snippetElement = node;
      }

      // Fallback: If no good buy button is found, grab the body text surrounding stock words
      if (!snippetElement) {
        const bodyText = document.body.innerText || '';
        // Find positions of stock words
        const stockRegex = /sklad|doruč|dostup|stock|delivery/i;
        const match = stockRegex.exec(bodyText);
        
        if (match) {
          const index = match.index;
          const start = Math.max(0, index - 500);
          const end = Math.min(bodyText.length, index + 1000);
          return {
            htmlSnippet: '<!-- Fallback: Text only -->',
            textSnippet: bodyText.substring(start, end).replace(/\s+/g, ' ').trim()
          };
        }
        
        // Absolute fallback: return main element text or first 2000 chars of body
        return {
          htmlSnippet: '<!-- Absolute Fallback -->',
          textSnippet: bodyText.substring(0, 1500).replace(/\s+/g, ' ').trim()
        };
      }

      // Clean HTML helper: strip attributes that bloat tokens (class, style, data-*)
      const cleanElement = snippetElement.cloneNode(true);
      const allNodes = cleanElement.querySelectorAll('*');
      
      // Keep only simple structure to fit LLM window & limit cost
      cleanElement.removeAttribute('class');
      cleanElement.removeAttribute('style');
      for (const node of allNodes) {
        // Strip tags we don't need
        if (['script', 'style', 'svg', 'path', 'img', 'noscript'].includes(node.tagName.toLowerCase())) {
          node.remove();
          continue;
        }
        
        // Strip bloat attributes
        const attrs = Array.from(node.attributes);
        for (const attr of attrs) {
          if (attr.name !== 'id' && attr.name !== 'href' && attr.name !== 'value' && attr.name !== 'disabled') {
            node.removeAttribute(attr.name);
          }
        }
      }

      return {
        htmlSnippet: cleanElement.outerHTML.substring(0, 4000), // Hard cap to prevent Gemini token bloat
        textSnippet: snippetElement.innerText.replace(/\s+/g, ' ').trim().substring(0, 1500)
      };
    }, BUY_BUTTON_KEYWORDS.source);

    return {
      htmlSnippet: extractionResult.htmlSnippet,
      textSnippet: extractionResult.textSnippet,
      resolvedUrl
    };

  } catch (error) {
    console.error(`[Scraper] Error scraping ${url}:`, error);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}
