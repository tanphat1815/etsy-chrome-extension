import { normalizeAddress } from "../utils/value.js";

/**
 * Render / update Orders UI
 */

export function clearOrdersList(elOrdersList) {
  elOrdersList.innerHTML = "";
}

function renderAddressCompareTable(etsyAddr = {}, tbAddr = {}, diffKeys = []) {
  const etsy = normalizeAddress(etsyAddr);
  const tb = normalizeAddress(tbAddr);

  return `
    <div class="addr-row addr-head">
      <div>&#32;</div>
      <div class="addr-src" data-i18n="orders.labels.extracted">Etsy</div>
      <div class="addr-src" data-i18n="orders.labels.teeinblue">Teeinblue</div>
    </div>
    <div class="address-table">
      ${Object.keys(etsy).map((key) => {
        const willOverwrite = diffKeys.includes(key);

        return `
          <div class="addr-row ${willOverwrite ? "overwrite" : ""}">
            <div class="addr-key" data-i18n="address.${key}">
              ${key.replace(/_/g, " ")}
            </div>
            <div class="addr-val mono">${etsy[key]}</div>
            <div class="addr-val mono">${tb[key]}</div>
          </div>
        `;
      }).join("")}
    </div>
  `;
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
    <div class="order-header">
      <div class="order-id">
        <span class="label" data-i18n="orders.labels.order_id">Order ID</span>
        <span class="value">#${item.platform_order_id}</span>
      </div>
      <div class="orderActions">
        <button
          class="btn btn-primary"
          type="button"
          data-role="btn-sync"
          data-i18n="orders.buttons.sync"
          ${(!item.emailNeedsSync && !item.addrNeedsSync) ? "disabled" : ""}
        >
          Sync
        </button>
      </div>
    </div>

    <!-- EMAIL -->
    <div class="section">
      <div class="section-header">
        <span class="section-title">
          📧 <span data-i18n="orders.fields.email">Email</span>
        </span>
        <span
          class="pill ${item.emailNeedsSync ? "error" : "ok"}"
          data-role="pill-email"
          data-i18n="${emailKey}"
        >
          ${item.emailNeedsSync ? "Need sync" : "OK"}
        </span>
      </div>

      <div class="row">
        <div class="label" data-i18n="orders.labels.extracted">Etsy</div>
        <div class="value mono">${item.email || "—"}</div>
      </div>

      <div class="row">
        <div class="label" data-i18n="orders.labels.teeinblue">Teeinblue</div>
        <div class="value mono" data-role="tb-email">${item.tbEmail || "—"}</div>
      </div>
    </div>

    <!-- ADDRESS -->
    <div class="section">
      <div class="section-header">
        <span class="section-title">
          📦 <span data-i18n="orders.fields.address">Shipping address</span>
        </span>

        <span
          class="pill ${item.addrNeedsSync ? "error" : "ok"}"
          data-role="pill-address"
          data-i18n="${addrKey}"
          ${addrVarsAttr}
        >
          ${item.addrNeedsSync ? `Missing (${addrCount})` : "OK"}
        </span>
      </div>

      ${item.diffAddressKeys?.length ? `
        <ul class="diff-list">
          ${item.diffAddressKeys.map(k => `
            <li class="diff-item" data-i18n="address.${k}">
              ${k.replace(/_/g, " ")}
            </li>`).join("")}
        </ul>

        <button class="btn-link toggle-address" data-role="toggle-address" data-i18n="orders.actions.show_full_address">
          ▸ Show full address
        </button>

        <div class="address-compare hidden">
          ${renderAddressCompareTable(item.shipping_address, item.tbAddress, item.diffAddressKeys)}
        </div>
      ` : `
        <div
          class="muted small"
          data-i18n="status.order.no_difference"
        >
          No differences found
        </div>
      `}
    </div>
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
    // console.log("Setting i18n data:", i18nData);
    for (const [k, v] of Object.entries(i18nData)) {
      el.dataset[k] = v;
    }
  }
}
