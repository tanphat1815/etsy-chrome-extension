import {
  clearOrdersList,
  renderOrderCard,
  setMainStatus,
  setOrderLocalStatus,
  applyDictionary,
  t
} from '../../src/ui/renderer.js';

import { extractOrdersMock } from '../../src/services/etsy.service.js';
import { getEtsyOrderById, updateEtsyOrderById } from '../../src/services/teeinblue.service.js';

import { recomputeNeedSyncFromTB, buildUpdatePayload } from '../../src/controllers/sync.controller.js';
import { syncLog } from '../../src/utils/logger.js';

export function createOrdersController ({ app, els, snapshot }) {
  let scanAbort = null;

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
          const newCandidate = {
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
          };
          candidates.push(newCandidate);
          els.ordersList.appendChild(
            renderOrderCard(newCandidate, async id => {
              await syncSingle(id);
            })
          );
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

      // Translate newly rendered nodes (labels/buttons/pills) based on current dictionary
      applyDictionary(els.ordersList);

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
      await snapshot.saveUiSnapshot();
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
        'error',
        {
          'i18n': 'status.order.sync_failed_http',
          'i18nVars': JSON.stringify({ 'status': putRes.status })
        }
      );
      await snapshot.saveUiSnapshot();
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
        'ok',
        { 'i18n': 'status.order.put_ok_no_body' }
      );
      await snapshot.saveUiSnapshot();
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

    await snapshot.saveUiSnapshot();
  }

  return { scanAndCompare, syncSingle, syncAll };
}
