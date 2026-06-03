const BACKEND_URL = 'http://localhost:3000';

document.addEventListener('DOMContentLoaded', async () => {
  const apiStatus = document.getElementById('api-status');
  const currentTabName = document.getElementById('current-tab-name');
  const verifyBtn = document.getElementById('verify-btn');
  const verifyResult = document.getElementById('verify-result');
  const merchantList = document.getElementById('merchant-list');

  let currentTabUrl = '';

  // 1. Check API Health and fetch rankings
  try {
    const healthCheck = await fetch(`${BACKEND_URL}/api/merchants`);
    if (healthCheck.ok) {
      apiStatus.textContent = 'Server: Online';
      apiStatus.className = 'status-indicator online';
      const merchants = await healthCheck.json();
      renderMerchantList(merchants);
    } else {
      throw new Error();
    }
  } catch (e) {
    apiStatus.textContent = 'Server: Offline';
    apiStatus.className = 'status-indicator offline';
    merchantList.innerHTML = `
      <div class="loading-state">
        ❌ Cannot connect to verification server. Make sure your backend API is running on ${BACKEND_URL}.
      </div>
    `;
  }

  // 2. Determine current active tab
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url) {
      currentTabUrl = tab.url;
      const isHttp = currentTabUrl.startsWith('http://') || currentTabUrl.startsWith('https://');
      const isHeureka = currentTabUrl.includes('heureka.cz') || currentTabUrl.includes('heureka.sk');

      if (isHttp && !isHeureka) {
        // We are on a potential merchant e-shop detail page!
        try {
          const urlObj = new URL(currentTabUrl);
          currentTabName.textContent = urlObj.hostname;
          verifyBtn.disabled = false;
        } catch (e) {
          currentTabName.textContent = 'Invalid website URL';
        }
      } else if (isHeureka) {
        currentTabName.textContent = 'Heureka page (Verification badges active)';
      } else {
        currentTabName.textContent = 'Non-merchant page';
      }
    } else {
      currentTabName.textContent = 'No active webpage tab found';
    }
  } catch (err) {
    console.error('[Popup] Error reading current tab:', err);
    currentTabName.textContent = 'Cannot access current tab';
  }

  // 3. Trigger manual sync verification
  verifyBtn.addEventListener('click', async () => {
    if (!currentTabUrl) return;

    verifyBtn.disabled = true;
    verifyBtn.textContent = 'Verifying with Gemini...';
    verifyResult.className = 'result-box hidden';
    
    try {
      const response = await fetch(`${BACKEND_URL}/api/verify-sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ url: currentTabUrl })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Server returned verification error.');
      }

      const data = await response.json();
      
      // Update result box
      verifyResult.className = `result-box ${data.status.toLowerCase().replace('_', '-')}`;
      
      let statusHtml = `<strong>Status: ${data.status.replace('_', ' ')}</strong><br>`;
      if (data.status === 'IN_STOCK') {
        statusHtml += `✓ Verification confirmed. The item is currently in stock.`;
      } else if (data.status === 'DELAYED') {
        statusHtml += `⏰ Discrepancy! Delivery takes ${data.shipping_days} days.`;
      } else if (data.status === 'OUT_OF_STOCK') {
        statusHtml += `⚠ Critical Discrepancy! Item is sold out on website.`;
      } else {
        statusHtml += `❓ Parser was unable to determine status.`;
      }

      statusHtml += `<br><small>Merchant Score updated to: ${data.merchant.score}%</small>`;
      verifyResult.innerHTML = statusHtml;

      // Refresh merchant lists
      const listRes = await fetch(`${BACKEND_URL}/api/merchants`);
      if (listRes.ok) {
        renderMerchantList(await listRes.json());
      }

    } catch (err) {
      console.error('[Popup] Manual verification failed:', err);
      verifyResult.className = 'result-box out-of-stock';
      verifyResult.innerHTML = `<strong>Error:</strong> ${err.message || 'API connection failed.'}`;
    } finally {
      verifyBtn.disabled = false;
      verifyBtn.textContent = 'Check Current Tab';
    }
  });

  // Helper to render merchant rating elements
  function renderMerchantList(merchants) {
    if (!merchants || merchants.length === 0) {
      merchantList.innerHTML = `
        <div class="loading-state">
          💡 No verified merchants found yet. Start browsing or verify a page to populate metrics.
        </div>
      `;
      return;
    }

    merchantList.innerHTML = '';
    merchants.forEach(m => {
      let scoreClass = 'score-high';
      let progressClass = 'progress-high';

      if (m.score < 70) {
        scoreClass = 'score-low';
        progressClass = 'progress-low';
      } else if (m.score < 90) {
        scoreClass = 'score-mid';
        progressClass = 'progress-mid';
      }

      const item = document.createElement('div');
      item.className = 'merchant-item';
      item.innerHTML = `
        <div class="merchant-header">
          <span class="merchant-name" title="${m.domain}">${m.domain}</span>
          <span class="merchant-score-badge ${scoreClass}">${m.score}%</span>
        </div>
        <div class="progress-bar-container">
          <div class="progress-bar ${progressClass}" style="width: ${m.score}%"></div>
        </div>
      `;
      merchantList.appendChild(item);
    });
  }
});
