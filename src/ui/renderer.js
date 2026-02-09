import { normalizeAddress } from "../utils/value.js";
/**
 * UI rendering
 */

/**
 * Get nested value from dictionary by dot path.
 * @param {object} dict
 * @param {string} path
 * @returns {any}
 */
function getByPath(dict, path) {
  if (!dict || !path) return undefined;
  const parts = String(path).split(".");
  let cur = dict;
  for (const p of parts) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = cur[p];
  }
  return cur;
}

/**
 * Translate by key from window.dictionary (JSON)
 * Supports Shopify-like interpolation: "Found {{count}} orders"
 *
 * @param {string} key
 * @param {Record<string, any>} [vars]
 * @param {string} [fallback]
 * @returns {string}
 */
export function t(key, vars = {}, fallback = "") {
  const dict = window.dictionary || {};
  const raw = getByPath(dict, key);

  // If missing: keep existing UI text (fallback), do NOT show key
  if (raw === undefined || raw === null || raw === "") return fallback || "";

  return String(raw).replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => {
    const v = vars?.[k];
    return v === undefined || v === null ? "" : String(v);
  });
}

/**
 * Apply dictionary translations to a DOM subtree.
 * - data-i18n: textContent
 * - data-i18n-html: innerHTML
 * - data-i18n-attr: "placeholder:key;title:key;aria-label:key"
 *
 * @param {ParentNode} [root=document]
 * @param {object} [dict=window.dictionary]
 */
export function applyDictionary(root = document, dict = window.dictionary || {}) {
  // textContent
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    const translated = getByPath(dict, key);
    if (translated === undefined || translated === null || translated === "") return;
    el.textContent = String(translated);
  });

  // translate HTML -> ["data-i18n-html"]
  root.querySelectorAll("[data-i18n-html]").forEach((el) => {
    const key = el.getAttribute("data-i18n-html");
    const translated = getByPath(dict, key);
    if (translated === undefined || translated === null || translated === "") return;
    el.innerHTML = String(translated);
  });

  // translate text -> "data-i18n-html"]
  root.querySelectorAll("[data-i18n-attr]").forEach((el) => {
    const spec = el.getAttribute("data-i18n-attr") || "";
    spec
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((pair) => {
        const [attr, key] = pair.split(":").map((s) => s.trim());
        if (!attr || !key) return;

        const translated = getByPath(dict, key);
        if (translated === undefined || translated === null || translated === "") return;

        el.setAttribute(attr, String(translated));
      });
  });
}

export function setText(el, text) {
  el.textContent = text || "";
}

export function setClass(el, className) {
  el.className = className;
}

export function setTeeinblueStatus(elStatus, text, kind = "muted") {
  setClass(elStatus, `${kind} status`);
  setText(elStatus, text);
}

export function setMainStatus(elStatus, text, kind = "muted") {
  setClass(elStatus, `footer ${kind}`);
  setText(elStatus, text);
}

export function showTargetState(elNotOnTarget, elOnTarget, isOnTarget) {
  elNotOnTarget.classList.toggle("hidden", isOnTarget);
  elOnTarget.classList.toggle("hidden", !isOnTarget);
}

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
            <div class="addr-key">
              ${t(`address.${key}`, {}, key.replace(/_/g, " "))}
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

  const emailPillText = item.emailNeedsSync
    ? t("orders.pills.email_override", {}, "Need sync")
    : t("orders.pills.email_ok", {}, "OK");

  const addrPillText = item.addrNeedsSync
    ? t(
      "orders.pills.address_override",
      { count: item.diffAddressKeys.length },
      `Missing (${item.diffAddressKeys.length})`
    )
    : t("orders.pills.address_ok", {}, "OK");

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
        <span class="pill ${item.emailNeedsSync ? "error" : "ok"}" data-role="pill-email">
          ${emailPillText}
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

        <span class="pill ${item.addrNeedsSync ? "error" : "ok"}" data-role="pill-address">
          ${addrPillText}
        </span>
      </div>

      ${item.diffAddressKeys.length ? `
            <ul class="diff-list">
              ${item.diffAddressKeys.map(k => 
                `<li class="diff-item">${t(`address.${k}`, {}, k.replace(/_/g, " "))}</li>`).join("")}
            </ul>
          ` : `<div class="muted small">${t("status.order.no_difference", {}, "No differences found")}</div>`
      }

      <button class="btn-link toggle-address" data-i18n="orders.actions.show_full_address">
        Show full address
      </button>

      <div class="address-compare hidden">
        ${renderAddressCompareTable(item.shipping_address, item.tbAddress, item.diffAddressKeys)}
      </div>
    </div>
  `;

  wrap.querySelector('[data-role="btn-sync"]').addEventListener("click", () => {
    onSyncClick(item.platform_order_id);
  });

  const toggleBtn = wrap.querySelector(".toggle-address");
  const addressCompare = wrap.querySelector(".address-compare");

  toggleBtn.addEventListener("click", () => {
    const open = !addressCompare.classList.contains("hidden");
    addressCompare.classList.toggle("hidden");

    toggleBtn.textContent = open
      ? t("orders.actions.show_full_address", {}, "Show full address")
      : t("orders.actions.hide_full_address", {}, "Hide full address");
  });

  return wrap;
}

export function setOrderLocalStatus(platformOrderId, text, kind = "muted") {
  const el = document.getElementById(`status_${platformOrderId}`);
  if (!el) return;
  el.className = `footer ${kind}`;
  el.textContent = text || "";
}

/**
 * Update order card after state change.
 * @param {object} item
 */
export function updateOrderCardUI(item) {
  const card = document.querySelector(`.order[data-id="${item.platform_order_id}"]`);
  if (!card) return;

  const pillEmail = card.querySelector('[data-role="pill-email"]');
  const pillAddr = card.querySelector('[data-role="pill-address"]');
  const diffEl = card.querySelector('[data-role="diff-keys"]');
  const tbEmailEl = card.querySelector('[data-role="tb-email"]');
  const btn = card.querySelector('[data-role="btn-sync"]');

  if (pillEmail) {
    pillEmail.className = `pill ${item.emailNeedsSync ? "error" : "ok"}`;
    pillEmail.textContent = item.emailNeedsSync
      ? t("orders.pills.email_override", {}, "Need sync")
      : t("orders.pills.email_ok", {}, "OK");
  }

  if (pillAddr) {
    pillAddr.className = `pill ${item.addrNeedsSync ? "error" : "ok"}`;
    pillAddr.textContent = item.addrNeedsSync
      ? t(
        "orders.pills.address_override",
        { count: item.diffAddressKeys.length },
        `Missing (${item.diffAddressKeys.length})`
      )
      : t("orders.pills.address_ok", {}, "OK");
  }

  if (diffEl) {
    diffEl.textContent = item.diffAddressKeys?.length ? item.diffAddressKeys.join(", ") : "—";
  }

  if (tbEmailEl) {
    tbEmailEl.textContent = item.tbEmail || "—";
  }

  if (btn) {
    btn.disabled = !item.emailNeedsSync && !item.addrNeedsSync;
  }
}
