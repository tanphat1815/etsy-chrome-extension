/**
 * Render / update Orders UI
 */

export function clearOrdersList(elOrdersList) {
  elOrdersList.innerHTML = "";
}

/**
 * Render one order card.
 * @param {object} item
 * @param {(id: string) => Promise<void>} onSyncClick
 * @returns {HTMLElement}
 */
export function renderOrderCard(item, onSyncClick) {
  const wrap = document.createElement("div");
  wrap.className = "order";
  wrap.dataset.id = item.platform_order_id;

  const emailKey = item.emailNeedsSync ? "orders.pills.email_override" : "orders.pills.email_ok";
  const addrKey = item.addrNeedsSync ? "orders.pills.address_override" : "orders.pills.address_ok";
  const addrCount = item.diffAddressKeys?.length || 0;
  const addrVarsAttr = item.addrNeedsSync ? `data-i18n-vars='${JSON.stringify({ count: addrCount })}'` : "";

  wrap.innerHTML = `
    <div class="row">
      <div class="label" data-i18n="orders.labels.order_id">Order ID</div>
      <div class="value mono">${item.platform_order_id}</div>
    </div>

    <div>
      <span
        class="pill ${item.emailNeedsSync ? "error" : "ok"}"
        data-role="pill-email"
        data-i18n="${emailKey}"
      >
        ${item.emailNeedsSync ? "Email Override" : "Email OK"}
      </span>

      <span
        class="pill ${item.addrNeedsSync ? "error" : "ok"}"
        data-role="pill-address"
        data-i18n="${addrKey}"
        ${addrVarsAttr}
      >
        ${item.addrNeedsSync ? `Address Override (${addrCount})` : "Address OK"}
      </span>
    </div>

    <div class="row" style="margin-top:8px;">
      <div class="label" data-i18n="orders.labels.extracted">Extracted</div>
      <div class="value">${item.email || "—"}</div>
    </div>

    <div class="row">
      <div class="label" data-i18n="orders.labels.teeinblue">Teeinblue</div>
      <div class="value" data-role="tb-email">${item.tbEmail || "—"}</div>
    </div>

    <div class="row">
      <div class="label" data-i18n="orders.labels.diff_keys">Diff Keys</div>
      <div class="value small" data-role="diff-keys">
        ${item.diffAddressKeys?.length ? item.diffAddressKeys.join(", ") : "—"}
      </div>
    </div>

    <div class="orderActions">
      <button
        class="btn btn-secondary"
        type="button"
        data-role="btn-sync"
        data-i18n="orders.buttons.sync"
        ${(!item.emailNeedsSync && !item.addrNeedsSync) ? "disabled" : ""}
      >
        Sync
      </button>
    </div>

    <div class="footer muted" id="status_${item.platform_order_id}"></div>
  `;

  wrap.querySelector('[data-role="btn-sync"]').addEventListener("click", () => {
    onSyncClick(item.platform_order_id);
  });

  return wrap;
}

export function setOrderLocalStatus(platformOrderId, text, kind = "muted", i18nData = {}) {
  const el = document.getElementById(`status_${platformOrderId}`);
  if (!el) return;
  el.className = `footer ${kind}`;
  el.textContent = text || "";

  if (typeof i18nData === "object" && i18nData !== null) {
    console.log("Setting i18n data:", i18nData);
    for (const [k, v] of Object.entries(i18nData)) {
      el.dataset[k] = v;
    }
  }
}
