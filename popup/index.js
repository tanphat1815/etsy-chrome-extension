import { getDomRefs } from '../src/ui/dom.js';
import {
  setText,
  setTeeinblueStatus,
  setMainStatus,
  showTargetState,
  clearOrdersList,
  renderOrderCard,
  setOrderLocalStatus,
  updateOrderCardUI,
  applyDictionary,
  t
} from '../src/ui/renderer.js';

import {
  buildPageKey,
  tokenFingerprint,
  readBootCache,
  writeBootCache,
  readUiSnapshot,
  writeUiSnapshot
} from '../src/cache/index.cache.js';

import {
  isOnSellerOrdersPage,
  extractOrdersMock
} from '../src/services/etsy.service.js';
import {
  checkConnectionByListOrders,
  getEtsyOrderById,
  updateEtsyOrderById
} from '../src/services/teeinblue.service.js';

import {
  recomputeNeedSyncFromTB,
  buildUpdatePayload
} from '../src/controllers/sync.controller.js';
import { syncLog } from '../src/utils/logger.js';

const STORAGE_KEY = 'teeinblueApiKey';

const els = getDomRefs();

const app = {
  token: '',
  connected: false,
  orders: [], // items currently rendered + their sync state
  pageKey: ''
};

window.app = app; // for debug, NÀO XONG NHỚ NHẮC T XOÁ CÁI NÀY :v

let connectTimer = null;
let scanAbort = null;

// Update popup UI when dictionary is loaded/changed
window.addEventListener('dictionary:updated', e => {
  const dict = e?.detail?.dictionary;
  if (dict) window.dictionary = dict;

  // 1) static UI
  applyDictionary(document);

  // 2) dynamic cards (pills text)
  if (app.orders && app.orders.length) {
    for (const item of app.orders) updateOrderCardUI(item);
  }
});

async function setLanguage () {
  if (!els.langSel) return;

  const cache = new Map(); // cache JSON by lang code

  // ../locales/example.json
  function getLocalePath (code) {
    // Use lower-case file name: locales/en.json
    return `../locales/${String(code).toLowerCase()}.json`;
  }

  async function loadDictionary (code) {
    if (cache.has(code)) return cache.get(code);

    const res = await fetch(getLocalePath(code), { cache: 'no-store' });
    if (!res.ok) {
      throw new Error(
        `Failed to load locale file: ${getLocalePath(code)} (${res.status})`
      );
    }

    const json = await res.json();
    cache.set(code, json);
    return json;
  }

  async function setLanguage (code) {
    try {
      const dict = await loadDictionary(code);

      // window.dictionary MUST be the JSON object of the selected language
      window.dictionary = dict;

      try {
        localStorage.setItem('lang', code);
      } catch (_) {}

      window.dispatchEvent(
        new CustomEvent('dictionary:updated', {
          detail: { lang: code, dictionary: dict }
        })
      );
    } catch (err) {
      console.error(err);

      // Fallback: if error -> use old dict or empty
      window.dictionary = window.dictionary || {};
      window.dispatchEvent(
        new CustomEvent('dictionary:error', {
          detail: { lang: code, error: String(err) }
        })
      );
    }
  }

  // Init: localStorage (higher priority) -> fallback to selected value
  const saved = (() => {
    try {
      return localStorage.getItem('lang');
    } catch (_) {
      return null;
    }
  })();

  const initialLang = saved || els.langSel.value || 'EN';
  els.langSel.value = initialLang;
  setLanguage(initialLang);

  // On change
  els.langSel.addEventListener('change', e => {
    const code = e.target.value;
    console.log('Language changed to', code);
    setLanguage(code);
  });
}

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
async function refreshTargetView () {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url || '';

  setText(els.currentUrl, url ? `Current tab: ${url}` : 'No active tab');

  const onTarget = isOnSellerOrdersPage(url);
  showTargetState(els.stateNotOnTarget, els.stateOnTarget, onTarget);

  const pageKey = buildPageKey(url, isOnSellerOrdersPage);
  app.pageKey = pageKey;

  return { url, onTarget, pageKey };
}

async function loadTokenFromStorage () {
  const stored = await chrome.storage.local.get([STORAGE_KEY]);
  const token = (stored?.[STORAGE_KEY] || '').trim();
  app.token = token;
  els.apiKeyInput.value = token;
  return token;
}

async function saveTokenToStorage (token) {
  await chrome.storage.local.set({ [STORAGE_KEY]: token });
}

async function checkConnect (token) {
  app.token = (token || '').trim();

  if (!app.token) {
    app.connected = false;
    setTeeinblueStatus(els.teeinblueStatus, '', 'muted');

    // cache status (avoid re-checking on reopen)
    await writeBootCache({
      key: app.pageKey,
      tokenFp: tokenFingerprint(app.token),
      teeinblueStatus: { text: '', kind: 'muted' }
    });

    await saveUiSnapshot();
    return;
  }

  setTeeinblueStatus(
    els.teeinblueStatus,
    t('status.checking_connection', {}, 'Checking connection ...'),
    'muted'
  );

  try {
    const res = await checkConnectionByListOrders(app.token);
    console.log('[ConnectCheck]', res.status, res.data);

    app.connected = !!res.ok;

    if (res.ok) {
      const text = t('status.connected', {}, 'Connected ✅');
      setTeeinblueStatus(els.teeinblueStatus, text, 'ok');

      // cache status (avoid re-checking on reopen)
      await writeBootCache({
        key: app.pageKey,
        tokenFp: tokenFingerprint(app.token),
        teeinblueStatus: { text, kind: 'ok' }
      });

      await saveUiSnapshot();
    } else {
      const text = t(
        'status.not_connected_http',
        { status: res.status },
        `Not connected ❌ (HTTP ${res.status})`
      );
      setTeeinblueStatus(els.teeinblueStatus, text, 'error');

      // cache status (avoid re-checking on reopen)
      await writeBootCache({
        key: app.pageKey,
        tokenFp: tokenFingerprint(app.token),
        teeinblueStatus: { text, kind: 'error' }
      });

      await saveUiSnapshot();
    }
  } catch (e) {
    console.log('[ConnectCheck] error', e);
    app.connected = false;

    const text = t(
      'status.request_failed',
      { message: e?.message || String(e) },
      `Request failed ❌ (${e?.message || String(e)})`
    );
    setTeeinblueStatus(els.teeinblueStatus, text, 'error');

    // cache status (avoid re-checking on reopen)
    await writeBootCache({
      key: app.pageKey,
      tokenFp: tokenFingerprint(app.token),
      teeinblueStatus: { text, kind: 'error' }
    });

    await saveUiSnapshot();
  }
}

function debounceConnectCheck () {
  const token = (els.apiKeyInput.value || '').trim();
  if (connectTimer) clearTimeout(connectTimer);
  connectTimer = setTimeout(async () => {
    await saveTokenToStorage(token);
    await checkConnect(token);
  }, 450);
}

async function scanAndCompare () {
  const token = (app.token || '').trim();
  if (!token) {
    setMainStatus(
      els.mainStatus,
      t('status.api_key_required', {}, 'Please input Teeinblue API Key first.'),
      'error'
    );
    return;
  }

  if (scanAbort) {
    try {
      scanAbort.abort();
    } catch (_) {}
  }
  scanAbort = new AbortController();

  els.scanBtn.disabled = true;
  els.syncAllBtn.disabled = true;

  setMainStatus(
    els.mainStatus,
    t(
      'status.scanning',
      {},
      'Scanning Etsy (mock) and comparing with Teeinblue...'
    ),
    'muted'
  );
  clearOrdersList(els.ordersList);
  app.orders = [];

  try {
    const extracted = await extractOrdersMock();
    console.log('Orders extracted from Etsy:', extracted);
    const candidates = [];

    for (const ex of extracted) {
      if (scanAbort.signal.aborted) break;

      const platformId = ex.platform_order_id;

      const tb = await getEtsyOrderById(token, platformId);
      console.log(
        '[GET]',
        platformId,
        tb.status,
        tb.status.toString().startsWith('2') ? tb.data : '__'
      );

      if (!tb.ok || !tb.data || typeof tb.data !== 'object') continue;

      const computed = recomputeNeedSyncFromTB(tb.data, {
        email: ex.email,
        shipping_address: ex.shipping_address
      });

      if (computed.emailNeedsSync || computed.addrNeedsSync) {
        candidates.push({
          platform_order_id: platformId,

          // extracted (etsy)
          email: ex.email,
          shipping_address: ex.shipping_address,

          // tb view
          tbEmail: computed.tbEmail,

          // state
          emailNeedsSync: computed.emailNeedsSync,
          addrNeedsSync: computed.addrNeedsSync,
          diffAddressKeys: computed.diffAddressKeys,

          // payload helper
          shipping_address_payload: computed.shipping_address_payload
        });
      }
    }

    app.orders = candidates;

    if (!candidates.length) {
      setMainStatus(
        els.mainStatus,
        t(
          'status.no_orders_need_sync',
          {},
          'No orders need syncing (based on current extract).'
        ),
        'ok'
      );
      return;
    }

    setMainStatus(
      els.mainStatus,
      t(
        'status.found_orders_need_sync',
        { count: candidates.length },
        `Found ${candidates.length} order(s) needing sync.`
      ),
      'ok'
    );

    for (const item of candidates) {
      els.ordersList.appendChild(
        renderOrderCard(item, async id => {
          await syncSingle(id);
        })
      );
    }

    // Translate newly rendered nodes (labels/buttons) based on current dictionary
    applyDictionary(els.ordersList);
    // Ensure pill text uses current language
    for (const item of app.orders) updateOrderCardUI(item);

    els.syncAllBtn.disabled = false;
  } catch (e) {
    setMainStatus(
      els.mainStatus,
      t(
        'status.scan_failed',
        { message: e?.message || String(e) },
        `Scan failed: ${e?.message || String(e)}`
      ),
      'error'
    );
  } finally {
    await saveUiSnapshot();
    els.scanBtn.disabled = false;
  }
}

function recomputeFromPutResponse (putData, item) {
  // Use PUT response: data.customer.email + data.address
  // to recompute need-sync
  return recomputeNeedSyncFromTB(putData, {
    email: item.email,
    shipping_address: item.shipping_address
  });
}

async function syncSingle (platformOrderId) {
  const token = (app.token || '').trim();
  const item = app.orders.find(x => x.platform_order_id === platformOrderId);
  if (!token || !item) return;

  const payload = buildUpdatePayload(item);
  if (!Object.keys(payload).length) {
    setOrderLocalStatus(
      platformOrderId,
      t('status.order.nothing_to_sync', {}, 'Nothing to sync.'),
      'muted'
    );
    syncLog(platformOrderId, 'skip', 'skip');
    await saveUiSnapshot();
    return;
  }

  setOrderLocalStatus(
    platformOrderId,
    t('status.order.syncing', {}, 'Syncing...'),
    'muted'
  );

  const putRes = await updateEtsyOrderById(token, platformOrderId, payload);
  console.log('[PUT]', platformOrderId, putRes.status, putRes.data);

  if (!putRes.ok) {
    syncLog(
      platformOrderId,
      payload.email ? 'failed' : 'skip',
      payload.shipping_address ? 'failed' : 'skip'
    );
    setOrderLocalStatus(
      platformOrderId,
      t(
        'status.order.sync_failed_http',
        { status: putRes.status },
        `Sync failed ❌ (HTTP ${putRes.status})`
      ),
      'error'
    );
    await saveUiSnapshot();
    return;
  }

  // Verified update using PUT response body
  if (!putRes.data || typeof putRes.data !== 'object') {
    syncLog(
      platformOrderId,
      payload.email ? 'ok' : 'skip',
      payload.shipping_address ? 'ok' : 'skip'
    );
    setOrderLocalStatus(
      platformOrderId,
      t(
        'status.order.put_ok_no_body',
        {},
        'PUT ok ✅ (no response body to verify)'
      ),
      'ok'
    );
    await saveUiSnapshot();
    return;
  }

  const after = recomputeFromPutResponse(putRes.data, item);

  // Update item state (from PUT response)
  item.tbEmail = after.tbEmail;
  item.emailNeedsSync = after.emailNeedsSync;
  item.addrNeedsSync = after.addrNeedsSync;
  item.diffAddressKeys = after.diffAddressKeys;
  item.shipping_address_payload = after.shipping_address_payload;

  // Minimal overlay logs: show if still need sync or not
  const emailStatus = payload.email
    ? item.emailNeedsSync
      ? 'need-sync'
      : 'ok'
    : 'skip';
  const addrStatus = payload.shipping_address
    ? item.addrNeedsSync
      ? 'need-sync'
      : 'ok'
    : 'skip';
  syncLog(platformOrderId, emailStatus, addrStatus);

  updateOrderCardUI(item);

  if (!item.emailNeedsSync && !item.addrNeedsSync) {
    setOrderLocalStatus(
      platformOrderId,
      t('status.order.all_synced', {}, 'All field(s) synced ✅'),
      'ok'
    );
  } else if (!item.emailNeedsSync && item.addrNeedsSync) {
    setOrderLocalStatus(
      platformOrderId,
      t(
        'status.order.email_synced_address_need',
        {},
        'Email synced ✅, Address needs sync ❌'
      ),
      'error'
    );
  } else if (item.emailNeedsSync && !item.addrNeedsSync) {
    setOrderLocalStatus(
      platformOrderId,
      t(
        'status.order.email_need_address_synced',
        {},
        'Email needs sync ❌, Address synced ✅'
      ),
      'error'
    );
  } else {
    setOrderLocalStatus(
      platformOrderId,
      t(
        'status.order.email_address_need',
        {},
        'Email and Address need sync ❌'
      ),
      'error'
    );
  }

  // Update Sync all button availability
  els.syncAllBtn.disabled = !app.orders.some(
    x => x.emailNeedsSync || x.addrNeedsSync
  );

  await saveUiSnapshot();
}

async function syncAll () {
  els.syncAllBtn.disabled = true;
  setMainStatus(
    els.mainStatus,
    t('status.syncing_all', {}, 'Syncing all orders...'),
    'muted'
  );

  for (const item of app.orders) {
    if (item.emailNeedsSync || item.addrNeedsSync) {
      await syncSingle(item.platform_order_id);
    }
  }

  setMainStatus(
    els.mainStatus,
    t('status.sync_all_completed', {}, 'Sync all completed.'),
    'ok'
  );
  els.syncAllBtn.disabled = !app.orders.some(
    x => x.emailNeedsSync || x.addrNeedsSync
  );

  await saveUiSnapshot();
}

function bindEvents () {
  els.redirectLink.addEventListener('click', async e => {
    e.preventDefault();
    await chrome.runtime.sendMessage({ type: 'OPEN_ETSY_ORDERS_AND_POPUP' });
    window.close();
  });

  els.apiKeyInput.addEventListener('input', debounceConnectCheck);

  els.apiKeyInput.addEventListener('keydown', async e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const token = (els.apiKeyInput.value || '').trim();
      await saveTokenToStorage(token);
      await checkConnect(token);
    }
  });

  // token "Sync" button: recheck connection
  els.submitBtn.addEventListener('click', async e => {
    e.preventDefault();
    const token = (els.apiKeyInput.value || '').trim();
    await saveTokenToStorage(token);
    await checkConnect(token);
  });

  els.scanBtn.addEventListener('click', scanAndCompare);
  els.syncAllBtn.addEventListener('click', syncAll);
}

function rebindOrderSyncButtons () {
  // Order card HAS [data-id] from `renderer.js` (wrap.dataset.id)
  document.querySelectorAll('.order[data-id]').forEach(card => {
    const id = card.dataset.id;
    const btn = card.querySelector('[data-role="btn-sync"]');
    if (!btn) return;

    // avoid adding multiple times if restore + bind again
    btn.replaceWith(btn.cloneNode(true));
    const newBtn = card.querySelector('[data-role="btn-sync"]');
    newBtn.addEventListener('click', () => syncSingle(id));
  });
}

async function saveUiSnapshot () {
  if (!app.pageKey) return;

  await writeUiSnapshot(app.pageKey, {
    orders: app.orders || [],
    ordersHtml: els.ordersList?.innerHTML || '',
    mainStatusText: els.mainStatus?.textContent || '',
    mainStatusClass: els.mainStatus?.className || '',
    tbStatusText: els.teeinblueStatus?.textContent || '',
    tbStatusClass: els.teeinblueStatus?.className || '',
    syncAllDisabled: !!els.syncAllBtn?.disabled
  });
}

async function restoreUiSnapshot () {
  if (!app.pageKey) return false;

  const snap = await readUiSnapshot(app.pageKey);
  if (!snap) return false;

  // restore data state for syncSingle()
  app.orders = Array.isArray(snap.orders) ? snap.orders : [];

  // restore UI
  if (typeof snap.ordersHtml === 'string') els.ordersList.innerHTML = snap.ordersHtml;

  if (snap.mainStatusClass) els.mainStatus.className = snap.mainStatusClass;
  if (snap.mainStatusText !== undefined) els.mainStatus.textContent = snap.mainStatusText;

  if (snap.tbStatusClass) els.teeinblueStatus.className = snap.tbStatusClass;
  if (snap.tbStatusText !== undefined) els.teeinblueStatus.textContent = snap.tbStatusText;

  if (typeof snap.syncAllDisabled === 'boolean') els.syncAllBtn.disabled = snap.syncAllDisabled;

  // i18n for restored nodes
  applyDictionary(els.ordersList);
  for (const item of app.orders) updateOrderCardUI(item);

  // rebind buttons in restored HTML
  rebindOrderSyncButtons();

  return true;
}

// Save snapshot when popup is going to be closed/hidden
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    saveUiSnapshot();
  }
});
window.addEventListener('pagehide', () => {
  saveUiSnapshot();
});

(async function main () {
  bindEvents();

  const ctx = await refreshTargetView();
  setLanguage();

  const token = await loadTokenFromStorage();

  // Restore snapshot first => keep orders list in case early-return
  await restoreUiSnapshot();

  const cache = await readBootCache();
  const samePage = cache?.key && cache.key === ctx.pageKey;
  const sameToken = cache?.tokenFp && cache.tokenFp === tokenFingerprint(token);

  // Same pageKey + same token => skip checkConnect
  if (samePage && sameToken) {
    if (cache?.teeinblueStatus?.text !== undefined) {
      setTeeinblueStatus(
        els.teeinblueStatus,
        cache.teeinblueStatus.text,
        cache.teeinblueStatus.kind || 'muted'
      );
    }
    await saveUiSnapshot();
    return;
  }

  // Record current key/token => avoid reopening popup, no re-init again
  await writeBootCache({ key: ctx.pageKey, tokenFp: tokenFingerprint(token) });

  if (token) checkConnect(token);
})();
