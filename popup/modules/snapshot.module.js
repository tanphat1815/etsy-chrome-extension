import { applyDictionary } from '../../src/ui/renderer.js';
import { readUiSnapshot, writeUiSnapshot, clearUiSnapshots } from '../../src/cache/index.cache.js';

export function createSnapshotManager ({ app, els }) {
  function rebindOrderSyncButtons (syncSingle) {
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

  async function restoreUiSnapshot (syncSingle) {
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

    // rebind buttons in restored HTML
    rebindOrderSyncButtons(syncSingle);

    return true;
  }

  async function clearCache () {
    return await clearUiSnapshots();
  }

  return { saveUiSnapshot, restoreUiSnapshot, clearCache };
}
