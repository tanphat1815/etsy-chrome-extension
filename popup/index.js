import { getDomRefs } from "../src/ui/dom.js";
import {
  setText,
  setTeeinblueStatus,
  setMainStatus,
  showTargetState,
  clearOrdersList,
  renderOrderCard,
  setOrderLocalStatus,
  updateOrderCardUI
} from "../src/ui/renderer.js";

import { isOnSellerOrdersPage, openSellerOrdersInNewTab, extractOrdersMock } from "../src/services/etsy.service.js";
import { checkConnectionByListOrders, getEtsyOrderById, updateEtsyOrderById } from "../src/services/teeinblue.service.js";

import { recomputeNeedSyncFromTB, buildUpdatePayload } from "../src/controllers/sync.controller.js";
import { syncLog } from "../src/utils/logger.js";

const STORAGE_KEY = "teeinblueApiKey";

const els = getDomRefs();

const app = {
  token: "",
  connected: false,
  orders: [] // items currently rendered + their sync state
};

let connectTimer = null;
let scanAbort = null;

async function refreshTargetView() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url || "";
  setText(els.currentUrl, url ? `Current tab: ${url}` : "No active tab");

  const onTarget = isOnSellerOrdersPage(url);
  showTargetState(els.stateNotOnTarget, els.stateOnTarget, onTarget);
}

async function loadTokenFromStorage() {
  const stored = await chrome.storage.local.get([STORAGE_KEY]);
  const token = (stored?.[STORAGE_KEY] || "").trim();
  app.token = token;
  els.apiKeyInput.value = token;
  return token;
}

async function saveTokenToStorage(token) {
  await chrome.storage.local.set({ [STORAGE_KEY]: token });
}

async function checkConnect(token) {
  app.token = (token || "").trim();

  if (!app.token) {
    app.connected = false;
    setTeeinblueStatus(els.teeinblueStatus, "", "muted");
    return;
  }

  setTeeinblueStatus(els.teeinblueStatus, "Checking connection (staging orders)...", "muted");

  try {
    const res = await checkConnectionByListOrders(app.token);
    console.log("[ConnectCheck]", res.status, res.data);

    app.connected = !!res.ok;

    if (res.ok) setTeeinblueStatus(els.teeinblueStatus, "Connected ✅", "ok");
    else setTeeinblueStatus(els.teeinblueStatus, `Not connected ❌ (HTTP ${res.status})`, "error");
  } catch (e) {
    console.log("[ConnectCheck] error", e);
    app.connected = false;
    setTeeinblueStatus(els.teeinblueStatus, `Request failed ❌ (${e?.message || String(e)})`, "error");
  }
}

function debounceConnectCheck() {
  const token = (els.apiKeyInput.value || "").trim();
  if (connectTimer) clearTimeout(connectTimer);
  connectTimer = setTimeout(async () => {
    await saveTokenToStorage(token);
    await checkConnect(token);
  }, 450);
}

async function scanAndCompare() {
  const token = (app.token || "").trim();
  if (!token) {
    setMainStatus(els.mainStatus, "Please input Teeinblue API Key first.", "error");
    return;
  }

  if (scanAbort) {
    try { scanAbort.abort(); } catch (_) {}
  }
  scanAbort = new AbortController();

  els.scanBtn.disabled = true;
  els.syncAllBtn.disabled = true;

  setMainStatus(els.mainStatus, "Scanning Etsy (mock) and comparing with Teeinblue...", "muted");
  clearOrdersList(els.ordersList);
  app.orders = [];

  try {
    const extracted = await extractOrdersMock();
    console.log("Orders extracted from Etsy (mock):", extracted);
    const candidates = [];

    for (const ex of extracted) {
      if (scanAbort.signal.aborted) break;

      const platformId = ex.platform_order_id;

      const tb = await getEtsyOrderById(token, platformId);
      console.log("[GET]", platformId, tb.status, tb.data);

      if (!tb.ok || !tb.data || typeof tb.data !== "object") continue;

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
      setMainStatus(els.mainStatus, "No orders need syncing (based on current extract).", "ok");
      return;
    }

    setMainStatus(els.mainStatus, `Found ${candidates.length} order(s) needing sync.`, "ok");

    for (const item of candidates) {
      els.ordersList.appendChild(
        renderOrderCard(item, async (id) => {
          await syncSingle(id);
        })
      );
    }

    els.syncAllBtn.disabled = false;
  } catch (e) {
    setMainStatus(els.mainStatus, `Scan failed: ${e?.message || String(e)}`, "error");
  } finally {
    els.scanBtn.disabled = false;
  }
}

function recomputeFromPutResponse(putData, item) {
  // Use PUT response: data.customer.email + data.address
  // to recompute need-sync
  return recomputeNeedSyncFromTB(putData, {
    email: item.email,
    shipping_address: item.shipping_address
  });
}

async function syncSingle(platformOrderId) {
  const token = (app.token || "").trim();
  const item = app.orders.find((x) => x.platform_order_id === platformOrderId);
  if (!token || !item) return;

  const payload = buildUpdatePayload(item);
  if (!Object.keys(payload).length) {
    setOrderLocalStatus(platformOrderId, "Nothing to sync.", "muted");
    syncLog(platformOrderId, "skip", "skip");
    return;
  }

  setOrderLocalStatus(platformOrderId, "Syncing...", "muted");

  const putRes = await updateEtsyOrderById(token, platformOrderId, payload);
  console.log("[PUT]", platformOrderId, putRes.status, putRes.data);

  if (!putRes.ok) {
    syncLog(
      platformOrderId,
      payload.email ? "failed" : "skip",
      payload.shipping_address ? "failed" : "skip"
    );
    setOrderLocalStatus(platformOrderId, `Sync failed ❌ (HTTP ${putRes.status})`, "error");
    return;
  }

  // Verified update using PUT response body
  if (!putRes.data || typeof putRes.data !== "object") {
    syncLog(
      platformOrderId,
      payload.email ? "ok" : "skip",
      payload.shipping_address ? "ok" : "skip"
    );
    setOrderLocalStatus(platformOrderId, "PUT ok ✅ (no response body to verify)", "ok");
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
  const emailStatus = payload.email ? (item.emailNeedsSync ? "need-sync" : "ok") : "skip";
  const addrStatus = payload.shipping_address ? (item.addrNeedsSync ? "need-sync" : "ok") : "skip";
  syncLog(platformOrderId, emailStatus, addrStatus);

  updateOrderCardUI(item);

  if (!item.emailNeedsSync && !item.addrNeedsSync) {
    setOrderLocalStatus(platformOrderId, "All field(s) synced ✅", "ok");
  } else if(!item.emailNeedsSync && item.addrNeedsSync) {
    setOrderLocalStatus(platformOrderId, "Email synced ✅, Address needs sync ❌", "error");
  } else if(item.emailNeedsSync && !item.addrNeedsSync) {
    setOrderLocalStatus(platformOrderId, "Email needs sync ❌, Address synced ✅", "error");
  } else {
    setOrderLocalStatus(platformOrderId, "Email and Address need sync ❌", "error");
  }

  // Update Sync all button availability
  els.syncAllBtn.disabled = !app.orders.some((x) => x.emailNeedsSync || x.addrNeedsSync);
}

async function syncAll() {
  els.syncAllBtn.disabled = true;
  setMainStatus(els.mainStatus, "Syncing all orders...", "muted");

  for (const item of app.orders) {
    if (item.emailNeedsSync || item.addrNeedsSync) {
      await syncSingle(item.platform_order_id);
    }
  }

  setMainStatus(els.mainStatus, "Sync all completed.", "ok");
  els.syncAllBtn.disabled = !app.orders.some((x) => x.emailNeedsSync || x.addrNeedsSync);
}

function bindEvents() {
  els.redirectLink.addEventListener("click", async (e) => {
    e.preventDefault();
    await openSellerOrdersInNewTab();
    window.close();
  });

  els.apiKeyInput.addEventListener("input", debounceConnectCheck);

  els.apiKeyInput.addEventListener("keydown", async (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const token = (els.apiKeyInput.value || "").trim();
      await saveTokenToStorage(token);
      await checkConnect(token);
    }
  });

  // token "Sync" button: just re-check connect (as before)
  els.submitBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    const token = (els.apiKeyInput.value || "").trim();
    await saveTokenToStorage(token);
    await checkConnect(token);
  });

  els.scanBtn.addEventListener("click", scanAndCompare);
  els.syncAllBtn.addEventListener("click", syncAll);
}

(async function main() {
  bindEvents();
  await refreshTargetView();

  const token = await loadTokenFromStorage();
  if (token) await checkConnect(token);
})();
