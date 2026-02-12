/**
 * Overlay logger:
 * log: "[time] order_id | email: ... | address: ..."
 */

const MAX_LOG_LINES = 100;
const STORAGE_KEY = "__teeinblue_sync_log_lines__";

// Prefer session storage (MV3). Fallback to local.
const STORAGE =
  chrome?.storage?.session ? chrome.storage.session : chrome.storage.local;

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

function storageRemove(key) {
  return new Promise((resolve) => {
    try {
      STORAGE.remove([key], () => resolve());
    } catch (_) {
      resolve();
    }
  });
}

async function readLogs() {
  const v = await storageGet(STORAGE_KEY);
  return Array.isArray(v) ? v : [];
}

async function writeLogs(lines) {
  const trimmed = lines.slice(-MAX_LOG_LINES);
  await storageSet({ [STORAGE_KEY]: trimmed });
  return trimmed;
}

/**
 * Append log line to current active tab
 * @param {string} line
 */
export async function appendLogToPage(line) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    // Persist first (so closing overlay won't lose history)
    const oldLines = await readLogs();
    oldLines.push(line);
    const lines = await writeLogs(oldLines);
    const snapshotText = lines.join("\n");

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      args: [snapshotText, STORAGE_KEY],
      func: (text, storageKey) => {
        const ID = "__teeinblue_sync_log_overlay__";
        let root = document.getElementById(ID);

        const ensureStyles = (el) => {
          el.style.position = "fixed";
          el.style.right = "12px";
          el.style.bottom = "12px";
          el.style.width = "420px";
          el.style.maxWidth = "calc(100vw - 24px)";
          el.style.maxHeight = "32vh";
          el.style.zIndex = "2147483647";
          el.style.background = "rgba(15, 23, 42, 0.92)";
          el.style.color = "#e5e7eb";
          el.style.border = "1px solid rgba(148, 163, 184, 0.35)";
          el.style.borderRadius = "12px";
          el.style.boxShadow = "0 12px 30px rgba(0,0,0,0.35)";
          el.style.fontFamily =
            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
          el.style.overflow = "hidden";
        };

        const mkBtn = (text) => {
          const b = document.createElement("button");
          b.textContent = text;
          b.style.fontSize = "12px";
          b.style.padding = "4px 8px";
          b.style.borderRadius = "8px";
          b.style.border = "1px solid rgba(148, 163, 184, 0.35)";
          b.style.background = "rgba(2, 6, 23, 0.4)";
          b.style.color = "#e5e7eb";
          b.style.cursor = "pointer";
          return b;
        };

        const ensureModal = (root) => {
          const MID = ID + "__modal";
          let modal = document.getElementById(MID);
          if (modal) return modal;

          modal = document.createElement("div");
          modal.id = MID;
          modal.style.position = "absolute";
          modal.style.inset = "0";
          modal.style.display = "none";
          modal.style.alignItems = "center";
          modal.style.justifyContent = "center";
          modal.style.background = "rgba(0,0,0,0.45)";
          modal.style.backdropFilter = "blur(2px)";

          const card = document.createElement("div");
          card.style.width = "min(340px, calc(100% - 24px))";
          card.style.borderRadius = "12px";
          card.style.border = "1px solid rgba(148, 163, 184, 0.35)";
          card.style.background = "rgba(2, 6, 23, 0.92)";
          card.style.boxShadow = "0 12px 30px rgba(0,0,0,0.45)";
          card.style.padding = "12px";

          const title = document.createElement("div");
          title.textContent = "Clear log history?";
          title.style.fontSize = "12px";
          title.style.fontWeight = "700";
          title.style.marginBottom = "6px";

          const desc = document.createElement("div");
          desc.textContent = "This will remove the saved log lines.";
          desc.style.fontSize = "12px";
          desc.style.opacity = "0.85";
          desc.style.marginBottom = "12px";

          const row = document.createElement("div");
          row.style.display = "flex";
          row.style.gap = "8px";
          row.style.justifyContent = "flex-end";

          const cancel = mkBtn("Cancel");
          const confirm = mkBtn("Clear");
          confirm.style.background = "rgba(239, 68, 68, 0.25)";
          confirm.style.border = "1px solid rgba(239, 68, 68, 0.55)";

          cancel.addEventListener("click", () => (modal.style.display = "none"));
          modal.addEventListener("click", (e) => {
            if (e.target === modal) modal.style.display = "none";
          });

          card.appendChild(title);
          card.appendChild(desc);
          row.appendChild(cancel);
          row.appendChild(confirm);
          card.appendChild(row);
          modal.appendChild(card);
          root.appendChild(modal);

          // expose confirm button for wiring later
          modal.__confirmBtn = confirm;
          return modal;
        };

        if (!root) {
          root = document.createElement("div");
          root.id = ID;
          ensureStyles(root);

          const header = document.createElement("div");
          header.style.display = "flex";
          header.style.alignItems = "center";
          header.style.justifyContent = "space-between";
          header.style.padding = "8px 10px";
          header.style.borderBottom = "1px solid rgba(148, 163, 184, 0.25)";
          header.style.background = "rgba(2, 6, 23, 0.35)";

          const title = document.createElement("div");
          title.textContent = "History";
          title.style.fontSize = "12px";
          title.style.fontWeight = "600";

          const actions = document.createElement("div");
          actions.style.display = "flex";
          actions.style.gap = "8px";

          const clearBtn = mkBtn("Clear");
          const closeBtn = mkBtn("Close");

          actions.appendChild(clearBtn);
          actions.appendChild(closeBtn);

          header.appendChild(title);
          header.appendChild(actions);

          const pre = document.createElement("pre");
          pre.id = ID + "__pre";
          pre.style.margin = "0";
          pre.style.padding = "10px";
          pre.style.fontSize = "11px";
          pre.style.lineHeight = "1.35";
          pre.style.whiteSpace = "pre-wrap";
          pre.style.wordBreak = "break-word";
          pre.style.maxHeight = "calc(32vh - 42px)";
          pre.style.overflow = "auto";

          root.appendChild(header);
          root.appendChild(pre);

          const modal = ensureModal(root);

          clearBtn.addEventListener("click", () => {
            modal.style.display = "flex";
          });

          // Confirm clear: clear UI + tell extension to clear storage
          modal.__confirmBtn.addEventListener("click", () => {
            modal.style.display = "none";
            pre.textContent = "";

            try {
              chrome.runtime.sendMessage({
                type: "TEEINBLUE_LOG_CLEAR",
                key: storageKey
              });
            } catch (_) {}
          });

          closeBtn.addEventListener("click", () => root.remove());

          document.body.appendChild(root);
        }

        const pre = document.getElementById(ID + "__pre");
        if (!pre) return;

        pre.textContent = text || "";
        pre.scrollTop = pre.scrollHeight;
      }
    });
  } catch (_) {}
}

/**
 * Log line helper.
 * @param {string} orderId
 * @param {"ok"|"need-sync"|"failed"|"skip"} emailStatus
 * @param {"ok"|"need-sync"|"failed"|"skip"} addressStatus
 */
export function syncLog(orderId, emailStatus, addressStatus) {
  const line = `[${nowTS()}] ${orderId} | email: ${emailStatus} | address: ${addressStatus}`;
  console.log(line);
  appendLogToPage(line);
}
