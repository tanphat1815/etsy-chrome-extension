import { ENV } from '../config/env.js';
import { URLS } from '../config/urls.js';

/**
 * Page detection, redirect, extraction placeholder.
 */

export function isOnSellerOrdersPage (url) {
  // if (!url) return false;
  // const u = String(url);

  // const inSellerArea = ENV.ETSY.SELLER_AREA_PREFIXES.some(p => u.startsWith(p));
  // const isOrders = u.includes('/orders');
  // return inSellerArea && isOrders;
  return true;
}

/**
 * Etsy Orders Extractor
 * - extractOrdersMock(htmlString): parse HTML from sample file cTrang gui
 * - extractOrders(doc, win): run on live Etsy orders page (window/document)
 *
 * Output format (per order):
 * {
 *   platform_order_id: string,
 *   shipping_address: {
 *     zip, city, name (not working), phone, company, country, address1, address2,
 *     latitude (not working), province, last_name, longitude (not working), first_name, country_code, province_code
 *   },
 *   email: string | null
 * }
 */

/** @param {string} fullName */
function splitName (fullName) {
  const raw = String(fullName || '').trim();
  if (!raw) return { first_name: null, last_name: null };
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return { first_name: parts[0], last_name: null };
  return { first_name: parts[0], last_name: parts.slice(1).join(' ') };
}

/**
 * Build Teeinblue shipping_address from Etsy "to_address" field
 * @param {any} toAddress Etsy to_address object (Common_Order_Fulfillment_Address)
 * @param {any} ctx Etsy.Context (optional, for country_code heuristic)
 */
function mapToShippingAddress (toAddress, ctx) {
  const a = toAddress || {};
  const fullName = a.name || '';
  const { first_name, last_name } = splitName(fullName);

  // country_code heuristic:
  // If destination country matches current region name in context, use region.code
  let country_code = null;
  try {
    const region = ctx?.data?.locale_settings?.region;
    if (
      region?.name &&
      a.country &&
      String(a.country).toLowerCase() === String(region.name).toLowerCase()
    ) {
      country_code = region.code || null;
    }
  } catch (_) {}

  return {
    zip: a.zip ?? null,
    city: a.city ?? null,
    name: fullName || null,
    phone: a.phone || null,
    company: null,
    country: a.country ?? null,
    address1: a.first_line ?? null,
    address2: a.second_line ?? null,
    latitude: null,
    province: a.state ?? null,
    last_name,
    longitude: null,
    first_name,
    country_code,
    province_code: null
  };
}

/**
 * Find and parse JSON object assigned to "Etsy.Context=" inside JS blob.
 * Uses brace matching (safe with strings/escapes) so it doesn't rely on regex-only.
 *
 * @param {string} text Full HTML or <script> text
 * @returns {any|null}
 */
function parseEtsyContextFromText (text) {
  if (!text) return null;

  // tolerate spaces: "Etsy.Context = {...}"
  const re = /Etsy\.Context\s*=\s*/g;
  const m = re.exec(text);
  if (!m) return null;

  const start = text.indexOf('{', re.lastIndex);
  if (start < 0) return null;

  // brace matching (safe with strings/escapes)
  let depth = 0;
  let inStr = false;
  let esc = false;
  let end = -1;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (inStr) {
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') { inStr = false; continue; }
      continue;
    }

    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) { end = i + 1; break; }
    }
  }

  if (end < 0) return null;

  const raw = text.slice(start, end);

  // IMPORTANT: Some saved/copy-pasted HTML introduces real \n/\r/\t inside JSON strings
  // => JSON.parse fails => escape control chars ONLY when inside double-quoted strings.
  let out = '';
  inStr = false;
  esc = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];

    if (inStr) {
      if (esc) { out += ch; esc = false; continue; }
      if (ch === '\\') { out += ch; esc = true; continue; }
      if (ch === '"') { out += ch; inStr = false; continue; }

      if (ch === '\n') { out += '\\n'; continue; }
      if (ch === '\r') { out += '\\r'; continue; }
      if (ch === '\t') { out += '\\t'; continue; }

      // other ASCII control chars
      if (ch < ' ') { out += ' '; continue; }

      out += ch;
      continue;
    }

    if (ch === '"') inStr = true;
    out += ch;
  }

  try {
    return JSON.parse(out);
  } catch (_) {
    return null;
  }
}

/**
 * Extract orders from an Etsy.Context object
 * @param {any} ctx Etsy.Context
 * @returns {Array<{platform_order_id: string, shipping_address: any, email: string|null}>}
 */
function extractOrdersFromContext (ctx) {
  const ordersSearch =
    ctx?.data?.initial_data?.orders?.orders_search ||
    ctx?.data?.initial_data?.orders?.ordersSearch ||
    ctx?.data?.initial_data?.orders?.orders ||
    null;

  if (!ordersSearch) return [];

  // buyers: [{ buyer_id, email, ... }]
  const buyers = Array.isArray(ordersSearch.buyers) ? ordersSearch.buyers : [];
  const buyerEmailById = new Map();
  for (const b of buyers) {
    const buyerId = b?.buyer_id ?? b?.buyerId;
    if (buyerId == null) continue;
    buyerEmailById.set(String(buyerId), b?.email ?? null);
  }

  // orders: [{ order_id, buyer_id, fulfillment: { to_address: {...}} , ... }]
  const orders = Array.isArray(ordersSearch.orders) ? ordersSearch.orders : [];

  return orders
    .map(o => {
      const orderId = o?.order_id ?? o?.orderId;
      if (orderId == null) return null;

      const buyerId = o?.buyer_id ?? o?.buyerId;
      const email =
        buyerId != null ? buyerEmailById.get(String(buyerId)) ?? null : null;

      const toAddress =
        o?.fulfillment?.to_address || o?.fulfillment?.toAddress || null;
      const shipping_address = mapToShippingAddress(toAddress, ctx);

      return {
        platform_order_id: String(orderId),
        shipping_address,
        email
      };
    })
    .filter(Boolean);
}

// used to get sample HTML content of Etsy orders page (for mock extraction during development/testing)
async function loadSampleEtsyOrdersHtml () {
  const url = chrome.runtime.getURL(ENV.ETSY.SAMPLE_ORDERS_HTML);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to load sample HTML: HTTP ${res.status}`);
  }
  return await res.text();
}

// used to get HTML content of active Etsy orders page (for live extraction)
async function loadEtsyOrdersHtmlFromActiveTab () {
  const getActiveTab = () =>
    new Promise((resolve, reject) => {
      chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        const err = chrome.runtime.lastError;
        if (err) return reject(new Error(err.message));
        resolve(tabs?.[0] || null);
      });
    });

  const execInTab = tabId =>
    new Promise((resolve, reject) => {
      // MV3
      if (chrome.scripting?.executeScript) {
        chrome.scripting.executeScript(
          {
            target: { tabId, allFrames: false },
            func: () => document.documentElement.outerHTML
          },
          results => {
            const err = chrome.runtime.lastError;
            if (err) return reject(new Error(err.message));
            resolve(String(results?.[0]?.result || ''));
          }
        );
        return;
      }

      // MV2 fallback
      chrome.tabs.executeScript(
        tabId,
        { code: 'document.documentElement.outerHTML' },
        results => {
          const err = chrome.runtime.lastError;
          if (err) return reject(new Error(err.message));
          resolve(String(results?.[0] || ''));
        }
      );
    });

  const patchUnresolved = htmlString => {
    const doc = new DOMParser().parseFromString(htmlString, 'text/html');

    // Remove unresolved attribute if present
    doc.documentElement?.removeAttribute('unresolved');
    doc.body?.removeAttribute('unresolved');

    // Remove/neutralize CSS that keeps page hidden while unresolved
    doc.querySelectorAll('style').forEach(styleEl => {
      const css = styleEl.textContent || '';
      if (!css.includes('[unresolved]')) return;

      const nextCss = css
        .replace(/body\s*\{\s*transition\s*:[^}]*\}\s*/gi, '')
        .replace(/body\s*\[\s*unresolved\s*\]\s*\{[^}]*\}\s*/gi, '')
        .replace(/html\s*\[\s*unresolved\s*\]\s*\{[^}]*\}\s*/gi, '');

      if (nextCss.trim()) styleEl.textContent = nextCss;
      else styleEl.remove();
    });

    // Final override to ensure visible (keep scripts intact)
    const override = doc.createElement('style');
    override.setAttribute('data-offline-fix', 'unresolved-visible');
    override.textContent = `
      html[unresolved], body[unresolved] { opacity: 1 !important; overflow: visible !important; }
      body { opacity: 1 !important; transition: none !important; }
    `;
    doc.head?.appendChild(override);

    const hasDoctype = /^\s*<!doctype/i.test(htmlString);
    return (
      (hasDoctype ? '' : '<!doctype html>\n') + doc.documentElement.outerHTML
    );
  };

  const tab = await getActiveTab();
  if (!tab?.id) throw new Error('No active tab found');

  const rawHtml = await execInTab(tab.id);
  if (!rawHtml) throw new Error('Failed to read HTML from active tab');

  return patchUnresolved(rawHtml);
}
async function loadEtsyContextFromActiveTab () {
  const tab = await new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      const err = chrome.runtime.lastError;
      if (err) return reject(new Error(err.message));
      resolve(tabs?.[0] || null);
    });
  });

  if (!tab?.id) throw new Error('No active tab found');

  const json = await new Promise((resolve, reject) => {
    if (!chrome.scripting?.executeScript) {
      return reject(new Error('chrome.scripting.executeScript is not available (need MV3)'));
    }

    chrome.scripting.executeScript(
      {
        target: { tabId: tab.id, allFrames: false },
        func: () => {
          try {
            const ctx = window.Etsy?.Context || null;
            return ctx ? JSON.stringify(ctx) : null;
          } catch (_) {
            return null;
          }
        }
      },
      results => {
        const err = chrome.runtime.lastError;
        if (err) return reject(new Error(err.message));
        resolve(results?.[0]?.result ?? null);
      }
    );
  });

  if (!json) return null;

  try { return JSON.parse(json); } catch (_) { return null; }
}

/**
 * Mock extractor: parse from the provided HTML string
 * @param {string} htmlString full HTML of Etsy orders page
 */
export async function extractOrdersMock () {
  // 1) LIVE: try read window.Etsy.Context first (reliable)
  if (!ENV.USE_MOCK) {
    try {
      const ctxLive = await loadEtsyContextFromActiveTab();
      if (ctxLive) return extractOrdersFromContext(ctxLive);
    } catch (_) {}
  }

  // 2) MOCK / fallback: parse from HTML string
  let htmlString = ENV.USE_MOCK
    ? await loadSampleEtsyOrdersHtml()
    : await loadEtsyOrdersHtmlFromActiveTab();

  htmlString = htmlString.replace(/\u0000/g, '');
  if (!/<!doctype/i.test(htmlString)) htmlString = '<!doctype html>\n' + htmlString;

  const ctx = parseEtsyContextFromText(htmlString);
  console.log('Parsed Etsy.Context from HTML:', ctx);
  if (ctx) return extractOrdersFromContext(ctx);

  // 3) Fallback: parse DOM then scan scripts
  try {
    const doc = new DOMParser().parseFromString(htmlString, 'text/html');
    const scripts = Array.from(doc.querySelectorAll('script'));
    for (const s of scripts) {
      const t = s.textContent || '';
      const ctx2 = parseEtsyContextFromText(t);
      if (ctx2) return extractOrdersFromContext(ctx2);
    }
  } catch (_) {}

  return [];
}
