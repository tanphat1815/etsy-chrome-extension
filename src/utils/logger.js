/**
 * Overlay logger:
 * log: "[time] order_id | email: ... | address: ..."
 */

function nowTS() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * Append log line to current active tab
 * @param {string} line
 */
export async function appendLogToPage(line) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      args: [line],
      func: (l) => {
        const ID = "__teeinblue_sync_log_overlay__";
        let root = document.getElementById(ID);

        if (!root) {
          root = document.createElement("div");
          root.id = ID;
          root.style.position = "fixed";
          root.style.right = "12px";
          root.style.bottom = "12px";
          root.style.width = "420px";
          root.style.maxWidth = "calc(100vw - 24px)";
          root.style.maxHeight = "32vh";
          root.style.zIndex = "2147483647";
          root.style.background = "rgba(15, 23, 42, 0.92)";
          root.style.color = "#e5e7eb";
          root.style.border = "1px solid rgba(148, 163, 184, 0.35)";
          root.style.borderRadius = "12px";
          root.style.boxShadow = "0 12px 30px rgba(0,0,0,0.35)";
          root.style.fontFamily =
            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
          root.style.overflow = "hidden";

          const header = document.createElement("div");
          header.style.display = "flex";
          header.style.alignItems = "center";
          header.style.justifyContent = "space-between";
          header.style.padding = "8px 10px";
          header.style.borderBottom = "1px solid rgba(148, 163, 184, 0.25)";
          header.style.background = "rgba(2, 6, 23, 0.35)";

          const title = document.createElement("div");
          title.textContent = "Logger";
          title.style.fontSize = "12px";
          title.style.fontWeight = "600";

          const actions = document.createElement("div");
          actions.style.display = "flex";
          actions.style.gap = "8px";

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

          const clearBtn = mkBtn("Clear");
          const closeBtn = mkBtn("Close");

          header.appendChild(title);
          actions.appendChild(clearBtn);
          actions.appendChild(closeBtn);
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

          clearBtn.addEventListener("click", () => (pre.textContent = ""));
          closeBtn.addEventListener("click", () => root.remove());

          root.appendChild(header);
          root.appendChild(pre);
          document.body.appendChild(root);
        }

        const pre = document.getElementById(ID + "__pre");
        if (!pre) return;

        const lines = pre.textContent ? pre.textContent.split("\n") : [];
        lines.push(l);
        pre.textContent = lines.slice(-250).join("\n");
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
