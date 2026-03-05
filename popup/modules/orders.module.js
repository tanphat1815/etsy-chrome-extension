import {
  clearOrdersList,
  renderOrderCard,
  updateAddressCompareTable,
  setMainStatus,
  setOrderLocalStatus,
  applyDictionary,
  t
} from '../../src/ui/renderer.js';
import { ordersWorkerType } from '../../src/constants/serviceWorkers.schema.js';

import { extractOrders } from '../../src/services/etsy.service.js';
import { updateEtsyOrderById } from '../../src/services/teeinblue.service.js';

import { recomputeNeedSyncFromTB, buildUpdatePayload } from '../../src/controllers/sync.controller.js';
import { syncLog } from '../../src/utils/logger.js';

export function createOrdersController ({ app, els, snapshot }) {
  let scanJobId = '';
  let scanPollTimer = null;

  // Used for incremental consume from job.candidates when popup is open
  let lastCandidateCount = 0;

  // IMPORTANT: de-dupe across:
  // - push messages (TB_SCAN_CANDIDATE)
  // - polling (TB_SCAN_GET_STATE)
  // - restored snapshot DOM when popup re-opened
  const ordersById = new Map(); // platform_order_id -> item|null (null if only DOM exists)

  let snapshotTimer = null;
  function scheduleSaveUiSnapshot () {
    if (snapshotTimer) clearTimeout(snapshotTimer);
    snapshotTimer = setTimeout(() => {
      snapshot.saveUiSnapshot().catch(() => {});
    }, 200);
  }

  function rebuildDedupeIndexFromAppOrders () {
    const unique = [];
    const seen = new Set();

    ordersById.clear();

    for (const item of (app.orders || [])) {
      const id = item?.platform_order_id || '';
      if (!id) continue;
      if (seen.has(id)) continue;

      seen.add(id);
      unique.push(item);
      ordersById.set(id, item);
    }

    app.orders = unique;
  }

  function dedupeOrdersListDom () {
    const seen = new Set();

    els.ordersList
      .querySelectorAll('.order[data-id]')
      .forEach((card) => {
        const id = card?.dataset?.id || '';
        if (!id) return;

        if (seen.has(id)) {
          card.remove();
          return;
        }

        seen.add(id);

        // ignore in-memory item
        if (!ordersById.has(id)) ordersById.set(id, null);
      });

    // Use DOM unique card count as baseline for incremental candidates consume on reopen
    lastCandidateCount = Math.max(lastCandidateCount, seen.size);
  }

  function primeDedupeStateFromUI () {
    rebuildDedupeIndexFromAppOrders();
    dedupeOrdersListDom();
  }

  function upsertCandidate (item, { render = true } = {}) {
    const id = item?.platform_order_id || '';
    if (!id) return false;

    const existing = ordersById.get(id);

    // Already existed in memory or in snapshot
    if (ordersById.has(id)) {
      if (existing == null) {
        // upgrade placeholder => real item
        // to avoid blocking syncSingle when not finish scanning
        ordersById.set(id, item);
      } else {
        ordersById.set(id, item);
      }

      const idx = (app.orders || []).findIndex(x => x?.platform_order_id === id);
      if (idx >= 0) app.orders[idx] = item;
      else app.orders.push(item);

      return false;
    }

    // If card already exists in DOM (restored snapshot), NOT render again
    const existingCard = els.ordersList.querySelector(`.order[data-id="${id}"]`);
    if (existingCard) {
      ordersById.set(id, item);

      const idx = (app.orders || []).findIndex(x => x?.platform_order_id === id);
      if (idx >= 0) app.orders[idx] = item;
      else app.orders.push(item);

      return false;
    }

    // new id
    ordersById.set(id, item);

    const idx = (app.orders || []).findIndex(x => x?.platform_order_id === id);
    if (idx >= 0) app.orders[idx] = item;
    else app.orders.push(item);

    if (!render) return false;

    const card = renderOrderCard(item, async (orderId) => {
      await syncSingle(orderId);
    });

    els.ordersList.appendChild(card);

    // translate new card (just appended)
    applyDictionary(card);

    // enable/disable Sync All by current `app.orders`
    els.syncAllBtn.disabled = !app.orders.some(x => x.emailNeedsSync || x.addrNeedsSync);

    return true;
  }

  function appendNewCandidates (allCandidates) {
    const list = Array.isArray(allCandidates) ? allCandidates : [];
    if (!list.length) return false;

    // If job.candidates got reset => re-consume
    if (list.length < lastCandidateCount) lastCandidateCount = 0;

    let appended = false;

    for (let i = lastCandidateCount; i < list.length; i++) {
      const item = list[i];
      const didAppend = upsertCandidate(item, { render: true });
      if (didAppend) appended = true;
    }

    lastCandidateCount = Math.max(lastCandidateCount, list.length);

    // enable/disable Sync All by current app.orders
    els.syncAllBtn.disabled = !app.orders.some(x => x.emailNeedsSync || x.addrNeedsSync);

    return appended;
  }

  // translate generic contents/ order card
  function patchOrderCardI18n (item) {
    const card = document.querySelector(`.order[data-id="${item.platform_order_id}"]`);
    if (!card) return;

    const pillEmail = card.querySelector('[data-role="pill-email"]');
    const pillAddr = card.querySelector('[data-role="pill-address"]');
    const diffEl = card.querySelector('[data-role="diff-keys"]');
    const tbEmailEl = card.querySelector('[data-role="tb-email"]');
    const btn = card.querySelector('[data-role="btn-sync"]');

    if (pillEmail) {
      pillEmail.className = `pill ${item.emailNeedsSync ? 'error' : 'ok'}`;
      pillEmail.dataset.i18n = item.emailNeedsSync
        ? 'orders.pills.email_override'
        : 'orders.pills.email_ok';
      delete pillEmail.dataset.i18nVars;
      pillEmail.textContent = item.emailNeedsSync ? 'Email Override' : 'Email OK';
    }

    if (pillAddr) {
      pillAddr.className = `pill ${item.addrNeedsSync ? 'error' : 'ok'}`;

      if (item.addrNeedsSync) {
        const count = item.diffAddressKeys?.length || 0;
        pillAddr.dataset.i18n = 'orders.pills.address_override';
        pillAddr.dataset.i18nVars = JSON.stringify({ count });
        pillAddr.textContent = `Address Override (${count})`;
      } else {
        pillAddr.dataset.i18n = 'orders.pills.address_ok';
        delete pillAddr.dataset.i18nVars;
        pillAddr.textContent = 'Address OK';
      }
    }

    if (diffEl) {
      diffEl.textContent = item.diffAddressKeys?.length ? item.diffAddressKeys.join(', ') : '—';
    }

    if (tbEmailEl) {
      tbEmailEl.textContent = item.tbEmail || '—';
    }

    if (btn) {
      btn.disabled = !item.emailNeedsSync && !item.addrNeedsSync;
    }

    // Translate everything in this card using data-i18n + data-i18n-vars
    applyDictionary(card);
  }

  function countOrdersNeedSync (app) {
    return (app.orders || [])
      .filter(x => 
        (x.emailNeedsSync || x.addrNeedsSync)
        && !['fulfilled', 'canceled'].includes(x.tbFinancialStatus)
      ).length;
  }

  async function stopScanPoll () {
    if (scanPollTimer) {
      clearInterval(scanPollTimer);
      scanPollTimer = null;
    }
  }

  async function pollScanJob () {
    if (!scanJobId) return;

    const state = await chrome.runtime.sendMessage({
      type: ordersWorkerType.SCAN_GET_STATE,
      jobId: scanJobId
    });

    if (!state?.ok || !state?.job) return;

    if (state.job.pageKey && app.pageKey && state.job.pageKey !== app.pageKey) return;

    const job = state.job;
    const total = job.progress?.total ?? 0;
    const processed = job.progress?.processed ?? 0;

    //render incrementally whenever candidates grow
    const appended = appendNewCandidates(job.candidates || []);

    // save snapshot only when there is new UI
    if (appended) {
      scheduleSaveUiSnapshot();
    }

    if (job.status === 'running') {
      setMainStatus(
        els.mainStatus,
        t(
          'status.scanning_progress',
          { processed, total, found: app.orders.length },
          `Scanning... (${processed}/${total}) | Found: ${app.orders.length} Teeinblue's order(s)`
        ),
        'muted'
      );
      els.mainStatus.dataset.i18n = 'status.scanning_progress';
      els.mainStatus.dataset.i18nVars = JSON.stringify({ processed, total, found: app.orders.length });
      return;
    }

    // stop polling when finished / cancelled / error
    await stopScanPoll();

    if (job.status !== 'done') {
      setMainStatus(
        els.mainStatus,
        t(
          'status.scan_failed',
          { message: job.status },
          `Scan stopped: ${job.status}`
        ),
        'error'
      );
      els.mainStatus.dataset.i18n = 'status.scan_failed';
      els.mainStatus.dataset.i18nVars = JSON.stringify({ message: job.status });

      els.scanBtn.disabled = false;
      scheduleSaveUiSnapshot();
      return;
    }

    // check finish => candidates may still not rendered items => check if not empty then render
    appendNewCandidates(job.candidates || []);
    scheduleSaveUiSnapshot();

    const totalFound = app.orders.length;
    const needSyncCount = countOrdersNeedSync(app);

    if (!totalFound) {
      setMainStatus(
        els.mainStatus,
        t('status.no_orders_need_sync', {}, 'No orders need syncing (based on current extract).'),
        'ok'
      );
      els.mainStatus.dataset.i18n = 'status.no_orders_need_sync';
      els.syncAllBtn.disabled = true;
    } else {
      setMainStatus(
        els.mainStatus,
        t(
          'status.found_orders_need_sync',
          { count: totalFound, needSync: needSyncCount },
          `Found ${totalFound} mismatched order(s), ${needSyncCount} can be synced.`
        ),
        'ok'
      );
      els.mainStatus.dataset.i18n = 'status.found_orders_need_sync';
      els.mainStatus.dataset.i18nVars = JSON.stringify({ count: totalFound, needSync: needSyncCount });

      els.syncAllBtn.disabled = !needSyncCount;
    }

    els.scanBtn.disabled = false;
  }

  async function startScanPoll () {
    await stopScanPoll();
    scanPollTimer = setInterval(pollScanJob, 800);
    await pollScanJob();
  }

  async function resumeBackgroundScanIfAny () {
    const last = await chrome.runtime.sendMessage({ type: ordersWorkerType.SCAN_GET_LAST });
    if (!last?.ok || !last?.jobId) return;

    scanJobId = last.jobId;

    const state = await chrome.runtime.sendMessage({
      type: ordersWorkerType.SCAN_GET_STATE,
      jobId: scanJobId
    });

    if (!state?.ok || !state?.job) return;
    if (state.job.pageKey && app.pageKey && state.job.pageKey !== app.pageKey) return;

    if (state.job.status === 'running' || state.job.status === 'done') {
      await startScanPoll();
    }
  }

  // Realtime push from background when a new candidate is found
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== ordersWorkerType.SCAN_NEW_CANDIDATE) return;

    if (msg.pageKey && app.pageKey && msg.pageKey !== app.pageKey) return;

    if (!scanJobId && msg.jobId) scanJobId = msg.jobId;
    if (scanJobId && msg.jobId && msg.jobId !== scanJobId) return;

    const appended = upsertCandidate(msg.item, { render: true });
    if (appended) scheduleSaveUiSnapshot();
  });

  async function scanAndCompare () {
    const token = (app.token || '').trim();
    if (!token) {
      setMainStatus(
        els.mainStatus,
        t('status.api_key_required', {}, 'Please input Teeinblue API Key first.'),
        'error'
      );
      els.mainStatus.dataset.i18n = 'status.api_key_required';
      
      return;
    }

    if (scanJobId) {
      try {
        await chrome.runtime.sendMessage({ type: ordersWorkerType.SCAN_CANCEL, jobId: scanJobId });
      } catch (_) {}
    }

    els.scanBtn.disabled = true;
    els.syncAllBtn.disabled = true;

    setMainStatus(
      els.mainStatus,
      t(
        'status.scanning',
        {},
        'Scanning Etsy and comparing with Teeinblue...'
      ),
      'muted'
    );
    els.mainStatus.dataset.i18n = 'status.scanning';

    clearOrdersList(els.ordersList);
    app.orders = [];

    lastCandidateCount = 0;
    ordersById.clear();

    try {
      const extracted = await extractOrders();
      console.log('Orders extracted from Etsy:', extracted);

      const started = await chrome.runtime.sendMessage({
        type: ordersWorkerType.SCAN_START,
        token,
        extracted,
        pageKey: app.pageKey || ''
      });

      if (!started?.ok || !started?.jobId) {
        throw new Error(started?.error || 'Failed to start scan job');
      }

      scanJobId = started.jobId;
      await startScanPoll();
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
      els.mainStatus.dataset.i18n = 'status.scan_failed';
      els.mainStatus.dataset.i18nVars = JSON.stringify({ message: e?.message || String(e) });
    } finally {
      scheduleSaveUiSnapshot();
      els.scanBtn.disabled = false;
    }
  }

  function recomputeFromUpdateOrderResponse (data, item) {
    // data.customer.email + data.address to recompute need-sync
    return recomputeNeedSyncFromTB(data, {
      email: item.email,
      shipping_address: item.shipping_address
    });
  }

  async function syncSingle (platformOrderId) {
    const token = (app.token || '').trim();
    const item = app.orders.find(x => x.platform_order_id === platformOrderId);
    if (!token || !item) return;

    // save old state before syncing
    const beforeSyncedState = structuredClone(item);

    const payload = buildUpdatePayload(item);

    // Nothing to sync this order
    if (!Object.keys(payload).length) {
      setOrderLocalStatus(
        platformOrderId,
        t('status.order.nothing_to_sync', {}, 'Nothing to sync.'),
        'muted',
        { 'i18n': 'status.order.nothing_to_sync' }
      );
      syncLog(platformOrderId, 'skip', 'skip');
      await snapshot.saveUiSnapshot();
      return;
    }

    setOrderLocalStatus(
      platformOrderId,
      t('status.order.syncing', {}, 'Syncing...'),
      'muted',
      { 'i18n': 'status.order.syncing' }
    );

    const putRes = await updateEtsyOrderById(token, platformOrderId, payload);
    console.log('[PATCH]', platformOrderId, putRes.status, putRes.data);

    if (!putRes.ok) {
      syncLog(
        platformOrderId,
        payload.email ? 'failed' : 'skip',
        payload.shipping_address ? 'failed' : 'skip',
        { message: putRes.data.message }
      );
      setOrderLocalStatus(
        platformOrderId,
        t(
          'status.order.sync_failed_http',
          { status: putRes.status },
          `Sync failed ❌ (HTTP ${putRes.status})`
        ),
        'error',
        {
          'i18n': 'status.order.sync_failed_http',
          'i18nVars': JSON.stringify({ 'status': putRes.status })
        }
      );
      await snapshot.saveUiSnapshot();
      return;
    }

    // Verified update using response body
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
          'PATCH UPDATE ok ✅ (no response body to verify)'
        ),
        'ok',
        { 'i18n': 'status.order.put_ok_no_body' }
      );
      await snapshot.saveUiSnapshot();
      return;
    }

    const after = recomputeFromUpdateOrderResponse(putRes.data, item);

    // Update item state (from PATCH response)
    item.tbEmail = after.tbEmail;
    item.emailNeedsSync = after.emailNeedsSync;
    item.addrNeedsSync = after.addrNeedsSync;
    item.diffAddressKeys = after.diffAddressKeys;
    item.shipping_address_payload = after.shipping_address_payload;
    item.tbAddress = putRes.data.address || {};

    // keep map up-to-date (avoid stale ref after PATCH)
    ordersById.set(platformOrderId, item);

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

    // Patch card state + translate by applyDictionary only
    patchOrderCardI18n(item);

    if (!item.emailNeedsSync && !item.addrNeedsSync) {
      setOrderLocalStatus(
        platformOrderId,
        t('status.order.all_synced', {}, 'All field(s) synced ✅'),
        'ok',
        { 'i18n': 'status.order.all_synced' }
      );
    } else if (!item.emailNeedsSync && item.addrNeedsSync) {
      setOrderLocalStatus(
        platformOrderId,
        t(
          'status.order.email_synced_address_need',
          {},
          'Email synced ✅, Address needs sync ❌'
        ),
        'error',
        { 'i18n': 'status.order.email_synced_address_need' }
      );
    } else if (item.emailNeedsSync && !item.addrNeedsSync) {
      setOrderLocalStatus(
        platformOrderId,
        t(
          'status.order.email_need_address_synced',
          {},
          'Email needs sync ❌, Address synced ✅'
        ),
        'error',
        { 'i18n': 'status.order.email_need_address_synced' }
      );
    } else {
      setOrderLocalStatus(
        platformOrderId,
        t(
          'status.order.email_address_need',
          {},
          'Email and Address need sync ❌'
        ),
        'error',
        { 'i18n': 'status.order.email_address_need' }
      );
    }

    updateAddressCompareTable(
      platformOrderId,
      item.shipping_address,
      item.tbAddress,
      beforeSyncedState.diffAddressKeys
    );

    // Update Sync all button availability
    els.syncAllBtn.disabled = !app.orders.some(
      x => x.emailNeedsSync || x.addrNeedsSync
    );

    await snapshot.saveUiSnapshot();
  }

  async function syncAll () {
    els.syncAllBtn.disabled = true;
    setMainStatus(
      els.mainStatus,
      t('status.syncing_all', {}, 'Syncing all orders...'),
      'muted'
    );
    els.mainStatus.dataset.i18n = 'status.syncing_all';

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
    els.mainStatus.dataset.i18n = 'status.sync_all_completed';
    
    els.syncAllBtn.disabled = !app.orders.some(
      x => x.emailNeedsSync || x.addrNeedsSync
    );

    await snapshot.saveUiSnapshot();
  }

  function resetAllOrders () {
    clearOrdersList(els.ordersList);
    app.orders = [];
    ordersById.clear();
    lastCandidateCount = 0;
  }

  function handleOrdersListClick (e) {
    const btn = e.target.closest('[data-role="toggle-address"]');
    if (!btn) return;

    const card = btn.closest('.order');
    if (!card) return;

    const address = card.querySelector('.address-compare');
    if (!address) return;

    const open = !address.classList.contains('hidden');

    address.classList.toggle('hidden');

    btn.dataset.i18n = open
      ? 'orders.actions.show_full_address'
      : 'orders.actions.hide_full_address';

    applyDictionary(card);
  }

  els.ordersList.addEventListener('click', handleOrdersListClick);

  // IMPORTANT: when popup is re-opened, DOM snapshot may already contain cards
  primeDedupeStateFromUI();

  resumeBackgroundScanIfAny().catch(() => {});

  return { scanAndCompare, syncSingle, syncAll, resetAllOrders };
}
