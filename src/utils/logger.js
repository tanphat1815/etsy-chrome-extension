/**
 * Overlay logger:
 * log: "[time] order_id | email: ... | address: ..."
 *
 * Exports:
 * - syncLog(orderId, emailStatus, addressStatus): append a formatted line + show overlay
 * - appendLogToPage(line): append custom line + show overlay
 * - openLog(): show overlay with current saved logs (no append)
 */

import { loggerWorkerType } from "../constants/serviceWorkers.schema.js";
import { configs } from "../constants/configs.schema.js";

const MAX_LOG_LINES = configs.LOGS.MAX_LINES || 100;
const LOGS_KEY = configs.STORAGE_KEY.LOG_LINES;

// Prefer session storage (MV3). Fallback to local.
const STORAGE =
  chrome?.storage?.session ? chrome.storage.session : chrome.storage.local;

// Injected stylesheet file inside extension package
const CSS_FILE = "assets/styles/logger.css";

function nowTS() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function storageGet(key) {
  return new Promise((resolve) => {
    try {
      STORAGE.get([key], (res) => resolve(res?.[key]));
    } catch (_) {
      resolve(undefined);
    }
  });
}

function storageSet(obj) {
  return new Promise((resolve) => {
    try {
      STORAGE.set(obj, () => resolve());
    } catch (_) {
      resolve();
    }
  });
}

async function storageRemove(keys) {
  return new Promise((resolve) => {
    try {
      STORAGE.remove(keys, () => resolve());
    } catch (_) {
      resolve();
    }
  });
}

async function readLogs() {
  const v = await storageGet(LOGS_KEY);
  return Array.isArray(v) ? v : [];
}

async function writeLogs(lines) {
  const trimmed = lines.slice(-MAX_LOG_LINES);
  await storageSet({ [LOGS_KEY]: trimmed });
  return trimmed;
}

/**
 * Render (or update) overlay on the active tab.
 * @param {string} snapshotText newline-separated text
 */
async function renderOverlayOnActiveTab(snapshotText) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  // Inject CSS
  try {
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: [CSS_FILE]
    });
  } catch (_) {}

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    args: [snapshotText, LOGS_KEY, loggerWorkerType.LOG_CLEAR],
    func: (text, storageKey, clearType) => {
      const ID = "__teeinblue_sync_log_overlay__";
      const BODY_ID = ID + "__body";
      const MID = ID + "__modal";

      const mk = (tag, cls, txt) => {
        const el = document.createElement(tag);
        if (cls) el.className = cls;
        if (txt != null) el.textContent = txt;
        return el;
      };

      const escapeHtml = (s) =>
        String(s ?? "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#39;");

      const normStatus = (s) => {
        const v = String(s || "").trim();
        if (v === "ok" || v === "need-sync" || v === "failed" || v === "skip") return v;
        return "unknown";
      };

      const lineKind = (emailStatus, addrStatus) => {
        if (emailStatus === "failed" || addrStatus === "failed") return "failed";
        if (emailStatus === "need-sync" || addrStatus === "need-sync") return "need-sync";
        if (emailStatus === "ok" && addrStatus === "ok") return "ok";
        if (emailStatus === "skip" && addrStatus === "skip") return "skip";
        return "unknown";
      };

      const formatLineHtml = (line) => {
        // Expected format:
        // [HH:mm:ss] orderId | email: <status> | address: <status>
        // Optional message at the end: | message: <text>
        const m = String(line || "").match(
          /^\[(\d{2}:\d{2}:\d{2})\]\s+(.+?)\s+\|\s+email:\s+(\S+)\s+\|\s+address:\s+(\S+)(?:\s+\|\s+message:\s+([\s\S]*))?\s*$/
        );

        if (!m) {
          return `<div class="tb-log-line tb-log-line--unknown">${escapeHtml(line)}</div>`;
        }

        const ts = m[1];
        const orderId = m[2];
        const emailStatus = normStatus(m[3]);
        const addrStatus = normStatus(m[4]);
        const message = (m[5] || "").trim();
        const kind = lineKind(emailStatus, addrStatus);

        return `
          <div class="tb-log-line tb-log-line--${kind}">
            <span class="tb-log-ts">[${escapeHtml(ts)}]</span>
            <span class="tb-log-order">${escapeHtml(orderId)}</span>
            <span class="tb-log-sep">|</span>
            <span class="tb-log-kv">
              <span class="tb-log-k">email:</span>
              <span class="tb-log-status tb-log-status--${emailStatus}">${escapeHtml(emailStatus)}</span>
            </span>
            <span class="tb-log-sep">|</span>
            <span class="tb-log-kv">
              <span class="tb-log-k">address:</span>
              <span class="tb-log-status tb-log-status--${addrStatus}">${escapeHtml(addrStatus)}</span>
            </span>
            ${message ? `
              <div class="tb-log-message">
                <span class="tb-log-message-text">${escapeHtml(message)}</span>
              </div>
            ` : ''}
          </div>
        `;
      };

      const formatSnapshotHtml = (snapshotText) => {
        const lines = String(snapshotText || "")
          .split("\n")
          .filter(Boolean);

        if (!lines.length) {
          return `<div class="tb-log-empty">No logs yet.</div>`;
        }

        return lines.map(formatLineHtml).join("");
      };

      const ensureModal = (root, onClear) => {
        let modal = document.getElementById(MID);
        if (modal) return modal;

        modal = mk("div", "tb-log-modal");
        modal.id = MID;

        const card = mk("div", "tb-log-modal-card");

        const title = mk("div", "tb-log-modal-title", "Clear log history?");
        const desc = mk(
          "div",
          "tb-log-modal-desc",
          "This will remove the saved log lines."
        );

        const row = mk("div", "tb-log-modal-actions");

        const cancel = mk("button", "tb-log-btn", "Cancel");
        const confirm = mk("button", "tb-log-btn tb-log-btn--danger", "Clear");

        cancel.addEventListener("click", () => (modal.style.display = "none"));
        modal.addEventListener("click", (e) => {
          if (e.target === modal) modal.style.display = "none";
        });

        confirm.addEventListener("click", () => {
          modal.style.display = "none";
          // await storageRemove(storageKey);
          onClear();
        });

        row.appendChild(cancel);
        row.appendChild(confirm);

        card.appendChild(title);
        card.appendChild(desc);
        card.appendChild(row);

        modal.appendChild(card);
        root.appendChild(modal);

        return modal;
      };

      let root = document.getElementById(ID);

      if (!root) {
        root = mk("div", "tb-log-root");
        root.id = ID;

        const header = mk("div", "tb-log-header");
        const title = mk("div", "tb-log-title", "History");
        const actions = mk("div", "tb-log-actions");

        const clearBtn = mk("button", "tb-log-btn tb-log-clear", "Clear");
        const closeBtn = mk("button", "tb-log-btn tb-log-close", "Close");

        actions.appendChild(clearBtn);
        actions.appendChild(closeBtn);
        header.appendChild(title);
        header.appendChild(actions);

        const body = mk("div", "tb-log-body");
        body.id = BODY_ID;

        root.appendChild(header);
        root.appendChild(body);

        const modal = ensureModal(root, () => {
          body.innerHTML = `<div class="tb-log-empty">No logs yet.</div>`;

          try {
            chrome.runtime.sendMessage({
              type: clearType,
              key: storageKey
            });
          } catch (_) {}
        });

        clearBtn.addEventListener("click", () => {
          modal.style.display = "flex";
        });

        closeBtn.addEventListener("click", () => root.remove());

        document.body.appendChild(root);
      }

      const body = document.getElementById(BODY_ID);
      if (!body) return;

      body.innerHTML = formatSnapshotHtml(text);
      body.scrollTop = body.scrollHeight;
    }
  });
}

/**
 * Open overlay without appending a new line.
 */
export async function openLog() {
  try {
    const lines = await readLogs();
    const snapshotText = lines.join("\n");
    await renderOverlayOnActiveTab(snapshotText);
  } catch (_) {}
}

/**
 * Append log line to current active tab
 * @param {string} line
 */
export async function appendLogToPage(line) {
  try {
    // Persist first (so closing overlay won't lose history)
    const oldLines = await readLogs();
    oldLines.push(line);
    const lines = await writeLogs(oldLines);
    const snapshotText = lines.join("\n");

    await renderOverlayOnActiveTab(snapshotText);
  } catch (_) {}
}

/**
 * Log line helper.
 * @param {string} orderId
 * @param {"ok"|"need-sync"|"failed"|"skip"} emailStatus
 * @param {"ok"|"need-sync"|"failed"|"skip"} addressStatus
 * @param {{"message": string}} error
 */
export function syncLog(orderId, emailStatus, addressStatus, error = '') {
  let line = `[${nowTS()}] ${orderId} | email: ${emailStatus} | address: ${addressStatus}`;

  const message = error?.message || error;
  if (message) {
    line += ` | message: ${String(message).trim()}`;
  }

  console.log(line);
  appendLogToPage(line);
}
