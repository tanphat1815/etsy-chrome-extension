/**
 * UI rendering
 */

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

  wrap.innerHTML = `
    <div class="row">
      <div class="label">Order ID</div>
      <div class="value mono">${item.platform_order_id}</div>
    </div>

    <div>
      <span class="pill ${item.emailNeedsSync ? "error" : "ok"}" data-role="pill-email">
        ${item.emailNeedsSync ? "Email Override" : "Email OK"}
      </span>

      <span class="pill ${item.addrNeedsSync ? "error" : "ok"}" data-role="pill-address">
        ${item.addrNeedsSync ? `Address Override (${item.diffAddressKeys.length})` : "Address OK"}
      </span>
    </div>

    <div class="row" style="margin-top:8px;">
      <div class="label">Extracted</div>
      <div class="value">${item.email || "—"}</div>
    </div>

    <div class="row">
      <div class="label">Teeinblue</div>
      <div class="value" data-role="tb-email">${item.tbEmail || "—"}</div>
    </div>

    <div class="row">
      <div class="label">Diff Keys</div>
      <div class="value small" data-role="diff-keys">
        ${item.diffAddressKeys?.length ? item.diffAddressKeys.join(", ") : "—"}
      </div>
    </div>

    <div class="orderActions">
      <button type="button" data-role="btn-sync" ${(!item.emailNeedsSync && !item.addrNeedsSync) ? "disabled" : ""}>
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

  if (pillEmail) {
    pillEmail.className = `pill ${item.emailNeedsSync ? "error" : "ok"}`;
    pillEmail.textContent = item.emailNeedsSync ? "Email Override" : "Email OK";
  }

  if (pillAddr) {
    pillAddr.className = `pill ${item.addrNeedsSync ? "error" : "ok"}`;
    pillAddr.textContent = item.addrNeedsSync
      ? `Address Override (${item.diffAddressKeys.length})`
      : "Address OK";
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
