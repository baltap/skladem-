const BACKEND_URL = 'http://localhost:3000';
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes (aligned with database cache)

// Listen for messages from content scripts or popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'VERIFY_URL') {
    (async () => {
      let timeoutId;
      try {
        const { url, reportedStockText = '' } = message;
        const cacheKey = `scan_${url}`;
        
        // 1. Check extension local storage cache
        const cachedData = await chrome.storage.local.get(cacheKey);
        const now = Date.now();

        if (cachedData[cacheKey]) {
          const { status, shipping_days, timestamp, merchantScore } = cachedData[cacheKey];
          if (now - timestamp < CACHE_TTL_MS) {
            console.log(`[Background] Cache hit for: ${url}`);
            sendResponse({
              success: true,
              cached: true,
              status,
              shipping_days,
              merchantScore
            });
            return;
          }
        }

        // 2. Fetch from backend API with a 15-second abort timeout
        console.log(`[Background] Cache miss. Fetching status for: ${url} (Reported text: "${reportedStockText}")`);
        
        const controller = new AbortController();
        timeoutId = setTimeout(() => controller.abort(), 15000); // 15 seconds limit

        const apiResponse = await fetch(
          `${BACKEND_URL}/api/verify?url=${encodeURIComponent(url)}&reported_text=${encodeURIComponent(reportedStockText)}`,
          { signal: controller.signal }
        );
        
        clearTimeout(timeoutId);

        if (!apiResponse.ok) {
          throw new Error(`API server returned status ${apiResponse.status}`);
        }

        const data = await apiResponse.json();

        // 3. Cache the verified status
        const scanResult = {
          status: data.status,
          shipping_days: data.shipping_days,
          merchantScore: data.merchantScore,
          timestamp: now
        };
        await chrome.storage.local.set({ [cacheKey]: scanResult });

        sendResponse({
          success: true,
          cached: false,
          status: data.status,
          shipping_days: data.shipping_days,
          merchantScore: data.merchantScore
        });

      } catch (error) {
        if (timeoutId) clearTimeout(timeoutId);
        console.error('[Background] Verification check failed:', error);
        
        let errorMsg = 'Failed to contact verification server.';
        if (error.name === 'AbortError') {
          errorMsg = 'Request timed out after 15 seconds.';
        } else if (error.message && error.message.includes('Failed to fetch')) {
          errorMsg = 'Verification server is offline.';
        }
        
        sendResponse({
          success: false,
          error: errorMsg
        });
      }
    })();

    return true; // Keep message channel open for async response
  }
});
