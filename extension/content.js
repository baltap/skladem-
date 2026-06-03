// Wait for DOM content to be fully loaded
console.log('[Heureka Stock Verifier] Content script loaded (MVP mode with Feed Matcher).');

const TRIGGER_BTN_CLASS = 'heureka-stock-verifier-trigger';
const BADGE_CLASS = 'heureka-stock-verifier-badge';

/**
 * Scan Heureka offers and inject verification trigger buttons
 */
async function injectVerificationTriggers() {
  // Find all shop outbound or exit links using inspected Heureka classes
  const exitLinks = Array.from(document.querySelectorAll('a[href*="/exit/"], a[href*="redir"], a.c-shop-name__link, a.c-offer__shop-link, a.js-exit-link'));
  
  if (exitLinks.length === 0) {
    const anchors = document.querySelectorAll('a');
    for (const a of anchors) {
      if (a.href && (a.href.includes('/exit') || a.href.includes('/click') || a.href.includes('exit.'))) {
        exitLinks.push(a);
      }
    }
  }

  for (const link of exitLinks) {
    let container = findOfferContainer(link);
    if (!container || container.hasAttribute('data-hsv-processed')) continue;
    
    // Mark as processed immediately to prevent concurrent triggers from link duplicates
    container.setAttribute('data-hsv-processed', 'true');
    
    const reportedText = getHeurekaReportedStock(container);

    // ONLY show button if the listing says they are immediately in stock
    if (!isImmediatelyInStock(reportedText)) {
      continue;
    }

    // Check if we already injected a trigger or badge
    if (container.querySelector(`.${TRIGGER_BTN_CLASS}`) || container.querySelector(`.${BADGE_CLASS}`)) {
      continue;
    }

    const shopUrl = link.href;
    const shopName = getShopName(container) || 'E-shop';

    // Create trigger button
    const btn = document.createElement('button');
    btn.className = TRIGGER_BTN_CLASS;
    btn.innerHTML = `<span class="hsv-btn-icon">🛡️</span> Verify Stock`;
    btn.title = `Verify real-time stock status at ${shopName}`;

    // Add click handler to trigger verification
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      // Update button to loading state
      btn.disabled = true;
      btn.innerHTML = `<span class="hsv-btn-icon hsv-loading">⏳</span> Verifying...`;
      btn.classList.add('hsv-btn-loading');
      btn.classList.remove('hsv-btn-error');

      const reportedText = getHeurekaReportedStock(container);
      console.log(`[Heureka Stock Verifier] Tracing reported stock status text: "${reportedText}"`);

      // Request verification from background service worker
      chrome.runtime.sendMessage(
        { 
          type: 'VERIFY_URL', 
          url: shopUrl,
          reportedStockText: reportedText
        },
        (response) => {
          // Check for message channel errors or explicit backend failures
          if (chrome.runtime.lastError || !response || !response.success) {
            const errorMsg = response?.error || chrome.runtime.lastError?.message || 'Verification server is offline.';
            console.error('[Heureka Stock Verifier] Verification failed:', errorMsg);
            
            // Restore button to clickable retry state
            btn.disabled = false;
            btn.classList.remove('hsv-btn-loading');
            btn.classList.add('hsv-btn-error');
            btn.innerHTML = `<span class="hsv-btn-icon">⚠️</span> Server Offline (Retry)`;
            btn.title = `Error: ${errorMsg} Make sure your backend server is running and click to retry.`;
            return;
          }

          // Success: replace button with final status badge
          replaceButtonWithBadge(btn, response.status, response.shipping_days, response.merchantScore, reportedText);
        }
      );
    });

    injectElement(container, btn);
  }
}

/**
 * Replaces the trigger button with the final status badge
 */
function replaceButtonWithBadge(btnElement, status, shippingDays, score, reportedText) {
  const badge = document.createElement('div');
  badge.className = `${BADGE_CLASS} hsv-status-${status.toLowerCase()}`;
  
  let icon = '⚡';
  let text = 'Stock: Verified';
  let tooltip = 'Stock verification status matches e-shop XML feed.';

  switch (status) {
    case 'IN_STOCK':
      icon = '✓';
      text = 'Stock Verified';
      tooltip = `Real-Time check confirmed: Item is in stock! Merchant Reliability: ${score}%`;
      break;
    case 'OUT_OF_STOCK':
      icon = '⚠';
      text = 'Stock Mismatch';
      tooltip = `ALERT: Feed reported "${reportedText || 'In Stock'}", but website shows OUT OF STOCK! Merchant Reliability: ${score}%`;
      break;
    case 'DELAYED':
      icon = '⏰';
      text = `Delayed (${shippingDays}d)`;
      tooltip = `WARNING: Feed reported "${reportedText || 'In Stock'}", but website shows delayed delivery of ${shippingDays} days. Merchant Reliability: ${score}%`;
      break;
    case 'UNKNOWN':
    default:
      icon = '❓';
      text = 'Stock Unverified';
      tooltip = 'Could not establish real-time verification connection.';
      break;
  }

  badge.innerHTML = `
    <span class="hsv-icon">${icon}</span>
    <span class="hsv-text">${text}</span>
    <span class="hsv-tooltip">${tooltip}</span>
  `;

  btnElement.parentNode.replaceChild(badge, btnElement);
}

/**
 * Bubbles up from an outbound link to find its outermost offer row container
 */
function findOfferContainer(link) {
  let parent = link.parentElement;
  let matches = [];
  
  while (parent && parent.tagName.toLowerCase() !== 'body') {
    const list = parent.classList;
    const tagName = parent.tagName.toLowerCase();
    
    if (list) {
      if (
        list.contains('c-offer') || 
        list.contains('o-offer') || 
        list.contains('c-shop-list__item') || 
        list.contains('c-offer-item') ||
        tagName === 'li' && parent.parentElement && parent.parentElement.classList.contains('offers')
      ) {
        matches.push(parent);
      }
    }
    parent = parent.parentElement;
  }
  
  // Return the highest matching ancestor in the tree (closest to body)
  return matches.length > 0 ? matches[matches.length - 1] : null;
}

/**
 * Heuristically extracts the shop name from the container
 */
function getShopName(container) {
  const logoImg = container.querySelector('img[alt]');
  if (logoImg && logoImg.alt && !logoImg.alt.includes('Heureka')) {
    return logoImg.alt.replace('Logo ', '').trim();
  }
  
  const shopNameEl = container.querySelector('.c-shop-name, .shop-name, .c-offer__shop-name, a[class*="shop-name"]');
  if (shopNameEl) {
    return shopNameEl.innerText.trim();
  }

  return null;
}

function getCleanText(element) {
  if (!element) return '';
  const clone = element.cloneNode(true);
  const triggers = clone.querySelectorAll('.' + TRIGGER_BTN_CLASS);
  triggers.forEach(t => t.remove());
  const badges = clone.querySelectorAll('.' + BADGE_CLASS);
  badges.forEach(b => b.remove());
  return clone.innerText.replace(/\s+/g, ' ').trim();
}

/**
 * Extracts Heureka's reported stock/delivery badge text inside the row
 */
function isStockBadgeText(text) {
  if (!text) return false;
  const normalized = text.trim().toLowerCase();
  return normalized === 'skladem' || 
         normalized.startsWith('skladem ') || 
         normalized === 'skladom' || 
         normalized.startsWith('skladom ') || 
         normalized === 'ihned k odběru' || 
         normalized === 'ihneď k odberu' || 
         normalized === 'ihned k odberu';
}

/**
 * Extracts Heureka's reported stock/delivery badge text inside the row
 */
function getHeurekaReportedStock(container) {
  // 1. Search for the stock badge element to find the core availability node
  const elements = container.querySelectorAll('span, div, strong, a');
  let stockBadge = null;
  for (const el of elements) {
    // Skip our own elements
    if (el.classList.contains(TRIGGER_BTN_CLASS) || el.classList.contains(BADGE_CLASS)) {
      continue;
    }
    if (isStockBadgeText(el.innerText)) {
      stockBadge = el;
      break;
    }
  }

  // 2. If stock badge is found, search for its nearest delivery/availability column ancestor
  if (stockBadge) {
    const parentCol = stockBadge.parentElement ? stockBadge.parentElement.closest('.c-offer__delivery, .delivery, .c-shop-delivery, [class*="delivery"], [class*="availability"], [class*="shipping"]') : null;
    if (parentCol) {
      return getCleanText(parentCol);
    }
    // Fallback to stock badge parent
    if (stockBadge.parentElement) {
      return getCleanText(stockBadge.parentElement);
    }
    return getCleanText(stockBadge);
  }

  // 3. Fallback: Look for text in general delivery/availability badge containers
  const deliveryEl = container.querySelector('.c-offer__delivery, .delivery, .c-shop-delivery, [class*="availability"], [class*="delivery"]');
  if (deliveryEl) {
    return getCleanText(deliveryEl);
  }
  
  // 4. Fallback 2: check spans or divs that match shipping words
  for (const el of elements) {
    // Skip our own elements
    if (el.classList.contains(TRIGGER_BTN_CLASS) || el.classList.contains(BADGE_CLASS)) {
      continue;
    }
    
    const text = getCleanText(el);
    if (
      text.includes('Skladem') || 
      text.includes('Skladom') ||
      text.includes('doruč') || 
      text.includes('dnů') || 
      text.includes('dny') || 
      text.includes('dní') || 
      text.includes('dnu') || 
      text.includes('dni') || 
      text.includes('dňo') || 
      text.includes('dno') || 
      text.includes('Ihned') ||
      text.includes('Ihneď') ||
      text.includes('týd') ||
      text.includes('tyd') ||
      text.includes('týžd') ||
      text.includes('tyzd') ||
      text.includes('dodavat') ||
      text.includes('extern')
    ) {
      if (text.length < 50) return text;
    }
  }
  return ''; // Do NOT default to "Skladem" to prevent buttons on unparsed/out-of-stock listings
}

/**
 * Injects the element next to the stock/delivery badge in the container
 */
function injectElement(container, element) {
  // 1. Search for the exact green stock badge text element
  const elements = container.querySelectorAll('span, div, strong, a');
  let stockBadge = null;
  
  for (const el of elements) {
    // Skip our own elements
    if (el.classList.contains(TRIGGER_BTN_CLASS) || el.classList.contains(BADGE_CLASS)) {
      continue;
    }
    if (isStockBadgeText(el.innerText)) {
      stockBadge = el;
      break;
    }
  }

  if (stockBadge) {
    // Inject as a sibling directly after the green stock badge element
    stockBadge.parentNode.insertBefore(element, stockBadge.nextSibling);
    
    // Inline style overrides to ensure perfect sibling alignment
    element.style.marginLeft = '8px';
    element.style.marginTop = '0px';
    element.style.display = 'inline-flex';
    element.style.verticalAlign = 'middle';
  } else {
    // Fallback to price column
    const priceTarget = container.querySelector('.c-offer__price, .price');
    if (priceTarget) {
      priceTarget.appendChild(element);
    } else {
      container.appendChild(element);
    }
  }
}

/**
 * Heuristically checks if the Heureka stock label represents immediate stock availability
 */
function isImmediatelyInStock(text) {
  if (!text) return false;
  const normalized = text.toLowerCase();
  
  // Must contain "skladem"/"skladom" (in stock) or "ihned"/"ihneď" (immediate) or "dnes" (today)
  const hasInStockKeyword = 
    normalized.includes('skladem') || 
    normalized.includes('skladom') || 
    normalized.includes('ihned') || 
    normalized.includes('ihneď') || 
    normalized.includes('dnes');
  
  // Must NOT declare a delayed delivery (e.g. do 3 dnů, u dodavatele, etc.)
  const hasDelayedKeyword = 
    normalized.includes('dodavat') || 
    normalized.includes('extern') || 
    normalized.includes('partner') || 
    normalized.includes('do ') || 
    normalized.includes('dnů') || 
    normalized.includes('dny') || 
    normalized.includes('dní') ||
    normalized.includes('dnu') ||
    normalized.includes('dni') ||
    normalized.includes('dňo') ||
    normalized.includes('dno') ||
    normalized.includes('týd') ||
    normalized.includes('tyd') ||
    normalized.includes('týžd') ||
    normalized.includes('tyzd');
    
  return hasInStockKeyword && !hasDelayedKeyword;
}

// Run scanner on DOM load
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  injectVerificationTriggers();
} else {
  window.addEventListener('DOMContentLoaded', injectVerificationTriggers);
}

// Handle dynamically loaded items
const observer = new MutationObserver((mutations) => {
  let shouldScan = false;
  for (const mutation of mutations) {
    if (mutation.addedNodes.length > 0) {
      shouldScan = true;
      break;
    }
  }
  if (shouldScan) {
    clearTimeout(window.hsvScanTimeout);
    window.hsvScanTimeout = setTimeout(injectVerificationTriggers, 1000);
  }
});

observer.observe(document.body, { childList: true, subtree: true });
