import { getDomRefs } from '../src/ui/dom.js';
import { applyDictionary, setTeeinblueStatus } from '../src/ui/renderer.js';

import { readBootCache, writeBootCache, tokenFingerprint } from '../src/cache/index.cache.js';

import { registerDictionaryUpdatedListener, setLanguage } from './modules/i18n.module.js';
import { refreshTargetView } from './modules/target.module.js';
import { loadTokenFromStorage, saveTokenToStorage } from './modules/token.module.js';
import { createSnapshotManager } from './modules/snapshot.module.js';
import { createConnectController } from './modules/connect.module.js';
import { createOrdersController } from './modules/orders.module.js';

const STORAGE_KEY = 'teeinblueApiKey';

const els = getDomRefs();

const app = {
  token: '',
  connected: false,
  orders: [], // items currently rendered + their sync state
  pageKey: ''
};

window.app = app; // for debug, NÀO XONG NHỚ NHẮC T XOÁ CÁI NÀY :v

// 1) i18n: applyDictionary for the whole popup on dictionary change
registerDictionaryUpdatedListener({ applyDictionary });

// 2) snapshot manager (persist UI/orders list between popup opens)
const snapshot = createSnapshotManager({ app, els });

// 3) orders controller (scan/compare/sync)
const orders = createOrdersController({ app, els, snapshot });

// 4) connect controller (token input -> check connect)
const connect = createConnectController({
  app,
  els,
  saveTokenToStorage: (token) => saveTokenToStorage(token, STORAGE_KEY),
  saveUiSnapshot: snapshot.saveUiSnapshot
});

function bindEvents () {
  els.redirectLink.addEventListener('click', async e => {
    e.preventDefault();
    await chrome.runtime.sendMessage({ type: 'OPEN_ETSY_ORDERS_AND_POPUP' });
    window.close();
  });

  els.apiKeyInput.addEventListener('input', connect.debounceConnectCheck);

  els.apiKeyInput.addEventListener('keydown', async e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const token = (els.apiKeyInput.value || '').trim();
      await saveTokenToStorage(token, STORAGE_KEY);
      await connect.checkConnect(token);
    }
  });

  // token "Sync" button: recheck connection
  els.submitBtn.addEventListener('click', async e => {
    e.preventDefault();
    const token = (els.apiKeyInput.value || '').trim();
    await saveTokenToStorage(token, STORAGE_KEY);
    await connect.checkConnect(token);
  });

  els.scanBtn.addEventListener('click', orders.scanAndCompare);
  els.syncAllBtn.addEventListener('click', orders.syncAll);
}

// Save snapshot when popup is going to be closed/hidden
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    snapshot.saveUiSnapshot();
  }
});
window.addEventListener('pagehide', () => {
  snapshot.saveUiSnapshot();
});

(async function main () {
  bindEvents();

  const ctx = await refreshTargetView({ app, els });
  setLanguage(els);

  const token = await loadTokenFromStorage({ app, els, storageKey: STORAGE_KEY });

  // Restore snapshot first => keep orders list in case early-return
  await snapshot.restoreUiSnapshot(orders.syncSingle);

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
    await snapshot.saveUiSnapshot();
    return;
  }

  // Record current key/token => avoid reopening popup, no re-init again
  await writeBootCache({ key: ctx.pageKey, tokenFp: tokenFingerprint(token) });

  if (token) connect.checkConnect(token);
})();
