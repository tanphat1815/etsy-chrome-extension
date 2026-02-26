import { getDomRefs } from '../src/ui/dom.js';
import { applyDictionary, setTeeinblueStatus } from '../src/ui/renderer.js';

import { popupWorkerType } from '../src/constants/serviceWorkers.schema.js';

import { readBootCache, writeBootCache, tokenFingerprint } from '../src/cache/index.cache.js';

import { openLog } from '../src/utils/logger.js';

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

function initHamburgerMenu () {
  const btn = document.getElementById('menuBtn');
  const menu = document.getElementById('menuDropdown');
  if (!btn || !menu) return;

  const close = () => {
    menu.classList.add('hidden');
    btn.setAttribute('aria-expanded', 'false');
  };

  const open = () => {
    menu.classList.remove('hidden');
    btn.setAttribute('aria-expanded', 'true');
  };

  const toggle = () => {
    const isOpen = !menu.classList.contains('hidden');
    isOpen ? close() : open();
  };

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggle();
  });

  // Close when clicking any menu item
  menu.addEventListener('click', (e) => {
    const target = e.target;
    if (target && target.closest('button')) close();
  });

  // Close on outside click
  document.addEventListener('click', (e) => {
    if (menu.classList.contains('hidden')) return;
    const t = e.target;
    if (btn.contains(t) || menu.contains(t)) return;
    close();
  });

  // Close on ESC
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    close();
  });
}

function initLanguageDropdown () {
  const select = document.getElementById('languageSelect');
  const btn = document.getElementById('langBtn');
  const menu = document.getElementById('langMenu');
  if (!select || !btn || !menu) return;

  const flagMap = {
    EN: '🇬🇧',
    FR: '🇫🇷',
    DE: '🇩🇪',
    IT: '🇮🇹',
    ES: '🇪🇸',
    PT: '🇵🇹',
    VI: '🇻🇳'
  };

  const flagEl = btn.querySelector('.lang-btn__flag');
  const codeEl = btn.querySelector('.lang-btn__code');

  const setBtnLabel = (code) => {
    const c = String(code || 'EN').toUpperCase();
    if (flagEl) flagEl.textContent = flagMap[c] || '🏳️';
    if (codeEl) codeEl.textContent = c;
  };

  const close = () => {
    menu.classList.add('hidden');
    btn.setAttribute('aria-expanded', 'false');
  };

  const open = () => {
    menu.classList.remove('hidden');
    btn.setAttribute('aria-expanded', 'true');
  };

  const toggle = () => {
    const isOpen = !menu.classList.contains('hidden');
    isOpen ? close() : open();
  };

  // init label from select
  // first init from selected lang in localStorage
  // if no localStorage, init from select value (default EN)
  const code = localStorage.getItem('lang') || select.value || 'EN';
  setBtnLabel(code);

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggle();
  });

  menu.addEventListener('click', (e) => {
    const opt = e.target.closest('.lang-option');
    if (!opt) return;

    const code = opt.getAttribute('data-lang');
    if (!code) return;

    select.value = code;
    setBtnLabel(code);

    // trigger existing setLanguage() logic
    select.dispatchEvent(new Event('change', { bubbles: true }));

    close();
  });

  // If select changes by other logic, keep UI in sync
  select.addEventListener('change', () => {
    setBtnLabel(select.value);
  });

  document.addEventListener('click', (e) => {
    if (menu.classList.contains('hidden')) return;
    const t = e.target;
    if (btn.contains(t) || menu.contains(t)) return;
    close();
  });

  // close on ESC
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    close();
  });
}

function bindEvents () {
  els.redirectLink.addEventListener('click', async e => {
    e.preventDefault();
    await chrome.runtime.sendMessage({ type: popupWorkerType.OPEN_ETSY_ORDERS_AND_POPUP });
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

  els.resetBtn.addEventListener('click', async e => {
    e.preventDefault();
    e.stopPropagation();

    await snapshot.clearCache();

    // Clear CURRENT UI
    app.orders = [];
    orders.resetAllOrders();
    els.syncAllBtn.disabled = true;

    // recheck connect again
    const token = (els.apiKeyInput.value || '').trim();
    await saveTokenToStorage(token, STORAGE_KEY);
    await connect.checkConnect(token);

    // Re-evaluate current tab + recompute pageKey
    await refreshTargetView({ app, els });

    // reset main status
    els.mainStatus.textContent = '';

    // Re-apply dictionary
    applyDictionary(document);

  });

  els.showLogBtn.addEventListener('click', openLog);

  els.scanBtn.addEventListener('click', orders.scanAndCompare);
  els.syncAllBtn.addEventListener('click', orders.syncAll);

  // UI-only
  initHamburgerMenu();
  initLanguageDropdown();
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
