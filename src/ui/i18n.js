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
    const key = el.dataset.i18n;
    let translated = getByPath(dict, key);
    if (translated === undefined || translated === null || translated === "") return;

    if (String(translated).includes('{{') && String(translated).includes('}}')) {
      const i18nVars = el.dataset.i18nVars;
      console.log("i18nVars:", i18nVars);
      if (i18nVars) {
        try {
          const vars = JSON.parse(i18nVars);
          translated = t(key, vars, '');
          console.log("Translated with vars:", translated);
        } catch (_) {}
      }
    }

    el.textContent = String(translated);
  });

  // translate HTML -> ["data-i18n-html"]
  root.querySelectorAll("[data-i18n-html]").forEach((el) => {
    const key = el.dataset.i18nHtml;
    let translated = getByPath(dict, key);
    if (translated === undefined || translated === null || translated === "") return;

    if (String(translated).includes('{{') && String(translated).includes('}}')) {
      const i18nVars = el.dataset.i18nVars;
      if (i18nVars) {
        try {
          const vars = JSON.parse(i18nVars);
          translated = t(key, vars, '');
        } catch (_) {}
      }
    }

    el.innerHTML = String(translated);
  });

  // translate attr -> "data-i18n-attr"
  root.querySelectorAll("[data-i18n-attr]").forEach((el) => {
    const spec = el.dataset.i18nAttr || "";
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
