import { URLS } from './src/config/urls.js';
import { isOnSellerOrdersPage } from './src/services/etsy.service.js';

let pendingOpenPopup = null; // { tabId, windowId }

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'OPEN_ETSY_ORDERS_AND_POPUP') return;
  
  (async () => {
    const tab = await chrome.tabs.create({
      url: URLS.ETSY.SELLER_ORDERS_URL,
      active: true
    });

    pendingOpenPopup = { tabId: tab.id, windowId: tab.windowId };
    sendResponse({ ok: true });
  })().catch((err) => {
    pendingOpenPopup = null;
    sendResponse({ ok: false, error: String(err) });
  });

  return true;
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!pendingOpenPopup) return;
  if (tabId !== pendingOpenPopup.tabId) return;
  if (changeInfo.status !== 'complete') return;

  // check if still on seller orders page
  const url = tab?.url || '';
  if (!isOnSellerOrdersPage(url)) return;

  try {
    // Chrome version >= 127
    if (chrome.action?.openPopup) {
      await chrome.action.openPopup({ windowId: pendingOpenPopup.windowId });
    }
  } finally {
    pendingOpenPopup = null;
  }
});
