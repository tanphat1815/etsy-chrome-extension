import { URLS } from '../config/urls.js';
import { isOnSellerOrdersPage } from '../services/etsy.service.js';
import { popupWorkerType } from '../constants/serviceWorkers.schema.js';

let pendingOpenPopup = null; // { tabId, windowId }

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== popupWorkerType.OPEN_ETSY_ORDERS_AND_POPUP) return;

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

  const url = tab?.url || '';
  if (!isOnSellerOrdersPage(url)) return;

  try {
    if (chrome.action?.openPopup) {
      await chrome.windows.update(pendingOpenPopup.windowId, { focused: true });
      await chrome.action.openPopup({ windowId: pendingOpenPopup.windowId });
    }
  } finally {
    pendingOpenPopup = null;
  }
});
