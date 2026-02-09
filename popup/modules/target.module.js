import { setText, showTargetState } from '../../src/ui/renderer.js';
import { buildPageKey } from '../../src/cache/index.cache.js';
import { isOnSellerOrdersPage } from '../../src/services/etsy.service.js';

/**
 * Refreshes the target view by querying the active tab and determining if it's on a seller orders page.
 *
 * @async
 * @function refreshTargetView
 * @returns {Promise<{url: string, onTarget: boolean, pageKey: string}>} An object containing:
 *   - url: The URL of the active tab, or empty string if no active tab
 *   - onTarget: Boolean indicating if the current tab is on a seller orders page
 *   - pageKey: A generated page key based on the URL and page type
 */
export async function refreshTargetView ({ app, els }) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url || '';

  setText(els.currentUrl, url ? `Current tab: ${url}` : 'No active tab');

  const onTarget = isOnSellerOrdersPage(url);
  showTargetState(els.stateNotOnTarget, els.stateOnTarget, onTarget);

  const pageKey = buildPageKey(url, isOnSellerOrdersPage);
  app.pageKey = pageKey;

  return { url, onTarget, pageKey };
}
