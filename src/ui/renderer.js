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
    ? t("orders.pills.email_override", {}, "Email Override")
    : t("orders.pills.email_ok", {}, "Email OK");

  const addrPillText = item.addrNeedsSync
    ? t(
      "orders.pills.address_override",
      { count: item.diffAddressKeys.length },
      `Address Override (${item.diffAddressKeys.length})`
    )
    : t("orders.pills.address_ok", {}, "Address OK");

  wrap.innerHTML = `
    <div class="row">
      <div class="label" data-i18n="orders.labels.order_id">Order ID</div>
      <div class="value mono">${item.platform_order_id}</div>
    </div>

    <div>
      <span class="pill ${item.emailNeedsSync ? "error" : "ok"}" data-role="pill-email">
        ${emailPillText}
      </span>

      <span class="pill ${item.addrNeedsSync ? "error" : "ok"}" data-role="pill-address">
        ${addrPillText}
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

  console.log(item);

  /** Update Pill status - START **/
  if (pillEmail) {
    pillEmail.className = `pill ${item.emailNeedsSync ? "error" : "ok"}`;
    pillEmail.textContent = item.emailNeedsSync
      ? t("orders.pills.email_override", {}, "Email Override")
      : t("orders.pills.email_ok", {}, "Email OK");
  }

  if (pillAddr) {
    pillAddr.className = `pill ${item.addrNeedsSync ? "error" : "ok"}`;
    pillAddr.textContent = item.addrNeedsSync
      ? t(
        "orders.pills.address_override",
        { count: item.diffAddressKeys.length },
        `Address Override (${item.diffAddressKeys.length})`
      )
      : t("orders.pills.address_ok", {}, "Address OK");
  }
  /** Update Pill status - END **/

  /** Update Sync status (card footer) - START **/

  /** Update Sync status (card footer) - END **/

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
