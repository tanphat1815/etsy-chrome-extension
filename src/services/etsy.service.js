import { ENV } from '../config/env.js';
import { URLS } from '../config/urls.js';

/**
 * Page detection, redirect, extraction placeholder.
 */

export function isOnSellerOrdersPage (url, check = false) {
  if(!check) return true; // skip checking

  if (!url) return false;
  const u = String(url);

  const inSellerArea = ENV.ETSY.SELLER_AREA_PREFIXES.some(p => u.startsWith(p));
  const isOrders = u.includes('/orders');
  return inSellerArea && isOrders;
}

/**
 * Etsy Orders Extractor
 * - extractOrders(htmlString): parse HTML from sample file cTrang gui
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

// used to get "View Page Source" HTML of active Etsy orders page (for live extraction)
// SPA pages may remove/alter Etsy.Context at runtime, but the server HTML still contains it.
async function loadEtsyOrdersPageSourceHtmlFromActiveTab () {
  const getActiveTab = () =>
    new Promise((resolve, reject) => {
      chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        const err = chrome.runtime.lastError;
        if (err) return reject(new Error(err.message));
        resolve(tabs?.[0] || null);
      });
    });

  const fetchInTab = tabId =>
    new Promise((resolve, reject) => {
      if (!chrome.scripting?.executeScript) {
        return reject(new Error('chrome.scripting.executeScript is not available (need MV3)'));
      }

      chrome.scripting.executeScript(
        {
          target: { tabId, allFrames: false },
          func: async () => {
            const url = location.href;

            // Fetching from the page origin keeps the same cookies/session as "View page source"
            const res = await fetch(url, {
              method: 'GET',
              credentials: 'include',
              cache: 'no-store',
              headers: { Accept: 'text/html,*/*' }
            });

            const text = await res.text();
            return { ok: res.ok, status: res.status, url, text };
          }
        },
        results => {
          const err = chrome.runtime.lastError;
          if (err) return reject(new Error(err.message));
          resolve(results?.[0]?.result || null);
        }
      );
    });

  const tab = await getActiveTab();
  if (!tab?.id) throw new Error('No active tab found');

  const r = await fetchInTab(tab.id);
  if (!r?.ok) {
    throw new Error(`Failed to fetch page source: HTTP ${r?.status ?? 'unknown'}`);
  }

  return String(r.text || '');
}

/**
 * DOM fallback:
 * Runtime HTML (outerHTML) may not keep orders in Etsy.Context, but order rows still contain:
 * - links with order_id=...
 * - "Ship to" section containing name/city/country
 * - buyer email can be missing; if it shows "Inactive email" we keep that value.
 */
function normalizeDomText (value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function extractOrderIdFromRoot (root) {
  if (!root?.querySelector) return null;

  const link = root.querySelector('a[href*="order_id="]');
  if (link) {
    const href = link.getAttribute('href') || '';
    const m = href.match(/[?&]order_id=(\d+)/);
    if (m) return m[1];
  }

  const orderBtn = root.querySelector('button[orderid]');
  const btnOrderId = orderBtn?.getAttribute('orderid') || '';
  if (/^\d+$/.test(btnOrderId)) return btnOrderId;

  const checkbox = root.querySelector('input[type="checkbox"][name]');
  const checkboxOrderId = checkbox?.getAttribute('name') || '';
  if (/^\d+$/.test(checkboxOrderId)) return checkboxOrderId;

  const text = normalizeDomText(root.textContent || '');
  const m = text.match(/#(\d{6,})/);
  return m ? m[1] : null;
}

function findOrderRootFromAnchor (a) {
  let el = a;
  for (let i = 0; i < 40 && el; i++) {
    if (el.matches?.('.panel-body-row.has-hover-state')) return el;

    if (el.querySelector) {
      const hasShipTo = /(?:^|\s)ship\s*to(?:\s|$)/i.test(normalizeDomText(el.textContent || ''));
      const hasShipBlock =
        !!el.querySelector('button[data-content-toggle]') ||
        !!el.querySelector('.fs-mask .break-word');

      if (hasShipTo && hasShipBlock) return el;
    }

    el = el.parentElement;
  }

  return (
    a.closest('.panel-body-row.has-hover-state') ||
    a.closest('.panel') ||
    a.closest('section') ||
    a.closest('div') ||
    a.parentElement ||
    null
  );
}

function findOrderRoots (doc) {
  const rowRoots = Array.from(doc.querySelectorAll('.panel-body-row.has-hover-state'));
  const rowsWithOrderId = rowRoots.filter(root => !!extractOrderIdFromRoot(root));
  if (rowsWithOrderId.length) return rowsWithOrderId;

  const anchors = Array.from(doc.querySelectorAll('a[href*="order_id="]'));
  const seen = new Set();
  const roots = [];

  for (const a of anchors) {
    const root = findOrderRootFromAnchor(a);
    if (!root) continue;

    const orderId = extractOrderIdFromRoot(root) || `node:${roots.length}`;
    if (seen.has(orderId)) continue;
    seen.add(orderId);
    roots.push(root);
  }

  return roots;
}

function extractShipToFromRoot (root) {
  if (!root?.querySelector) return { name: null, city: null, country: null };

  const btns = Array.from(root.querySelectorAll('button[data-content-toggle]'));
  const shipBtn = btns.find(b => /ship\s*to/i.test(normalizeDomText(b.textContent || ''))) || null;

  let fsMask = shipBtn?.closest('.fs-mask') || null;
  if (!fsMask) {
    fsMask =
      Array.from(root.querySelectorAll('.fs-mask')).find(el =>
        /ship\s*to/i.test(normalizeDomText(el.textContent || ''))
      ) || null;
  }

  const bw = fsMask?.querySelector('.break-word') || null;
  if (!bw) return { name: null, city: null, country: null };

  const uns = Array.from(bw.querySelectorAll('[data-test-id="unsanitize"]'))
    .map(n => normalizeDomText(n.textContent || ''))
    .filter(Boolean);

  // pattern from inspected Etsy DOM copy: [name, city, country]
  if (uns.length >= 3) {
    return {
      name: uns[0] || null,
      city: uns[uns.length - 2] || null,
      country: uns[uns.length - 1] || null
    };
  }

  if (uns.length === 2) {
    return {
      name: uns[0] || null,
      city: null,
      country: uns[1] || null
    };
  }

  const text = normalizeDomText(bw.textContent || '');
  if (!text) return { name: null, city: null, country: null };

  const parts = text.split(/\s*,\s*/).map(normalizeDomText).filter(Boolean);
  if (parts.length >= 3) {
    return {
      name: parts[0] || null,
      city: parts[parts.length - 2] || null,
      country: parts[parts.length - 1] || null
    };
  }

  if (parts.length === 2) {
    return {
      name: parts[0] || null,
      city: null,
      country: parts[1] || null
    };
  }

  return {
    name: text || null,
    city: null,
    country: null
  };
}

function extractEmailFromRoot (root) {
  if (!root?.querySelector) return null;

  const mailto = root.querySelector('a[href^="mailto:"]');
  if (mailto) {
    const email = (mailto.getAttribute('href') || '').replace(/^mailto:/i, '').trim();
    if (email) return email;
  }

  const text = normalizeDomText(root.textContent || '');

  // priority: real email
  const m = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (m) return m[0];

  // keep "Inactive email" as a meaningful value
  const mi = text.match(/\binactive\s+email\b/i);
  if (mi) return 'Inactive email';

  return null;
}

function extractOrdersFromDom (doc, ctx) {
  const roots = findOrderRoots(doc);
  const out = [];
  const seen = new Set();

  for (const root of roots) {
    const orderId = extractOrderIdFromRoot(root);
    if (!orderId || seen.has(orderId)) continue;
    seen.add(orderId);

    const ship = extractShipToFromRoot(root);
    const email = extractEmailFromRoot(root);

    const shipping_address = mapToShippingAddress(
      { name: ship.name, city: ship.city, country: ship.country },
      ctx
    );

    out.push({
      platform_order_id: String(orderId),
      shipping_address,
      email
    });
  }

  return out;
}

/**
 * Mock extractor: parse from the provided HTML string
 * @param {string} htmlString full HTML of Etsy orders page
 */
export async function extractOrders () {
  // 1) LIVE: try read window.Etsy.Context first (fast path)
  if (!ENV.USE_MOCK) {
    try {
      const ctxLive = await loadEtsyContextFromActiveTab();
      console.log('[EtsyExtract] ctxLive:', !!ctxLive);
      if (ctxLive) {
        const out = extractOrdersFromContext(ctxLive);
        console.log('[EtsyExtract] from ctxLive:', out.length);
        if (out.length) return out;
      }
    } catch (e) {
      console.log('[EtsyExtract] ctxLive error:', e?.message || String(e));
    }
  }

  // 2) LIVE: fetch "page source" HTML from the active tab and parse Etsy.Context from it
  // Runtime DOM can be pruned/overwritten by SPA, but server HTML usually keeps the initial_data.orders.
  if (!ENV.USE_MOCK) {
    try {
      let htmlSource = await loadEtsyOrdersPageSourceHtmlFromActiveTab();

      htmlSource = htmlSource.replace(/\u0000/g, '');
      if (!/<!doctype/i.test(htmlSource)) htmlSource = '<!doctype html>\n' + htmlSource;

      console.log('[EtsyExtract] pageSource length:', htmlSource.length);

      const ctx = parseEtsyContextFromText(htmlSource);
      console.log('[EtsyExtract] Parsed Etsy.Context from PAGE SOURCE:', !!ctx);

      if (ctx) {
        const out = extractOrdersFromContext(ctx);
        console.log('[EtsyExtract] from PAGE SOURCE ctx:', out.length);
        if (out.length) return out;
      }
    } catch (e) {
      console.log('[EtsyExtract] PAGE SOURCE error:', e?.message || String(e));
    }
  }

  // 3) MOCK / fallback: parse from HTML snapshot
  // - USE_MOCK=true: load sample file
  // - USE_MOCK=false: read document.documentElement.outerHTML from active tab
  let htmlString = ENV.USE_MOCK
    ? await loadSampleEtsyOrdersHtml()
    : await loadEtsyOrdersHtmlFromActiveTab();

  htmlString = htmlString.replace(/\u0000/g, '');
  if (!/<!doctype/i.test(htmlString)) htmlString = '<!doctype html>\n' + htmlString;

  console.log('[EtsyExtract] htmlSnapshot length:', htmlString.length);

  const ctx = parseEtsyContextFromText(htmlString);
  console.log('[EtsyExtract] Parsed Etsy.Context from HTML snapshot:', !!ctx);

  if (ctx) {
    const out = extractOrdersFromContext(ctx);
    console.log('[EtsyExtract] from HTML snapshot ctx:', out.length);
    if (out.length) return out;
  }

  // 4) Fallback: parse DOM then scan scripts
  // (kept as-is, but we do not return early if ctx2 exists but has no orders)
  let doc = null;
  try {
    doc = new DOMParser().parseFromString(htmlString, 'text/html');
    const scripts = Array.from(doc.querySelectorAll('script'));

    let foundCtxInScripts = 0;

    for (const s of scripts) {
      const t = s.textContent || '';
      const ctx2 = parseEtsyContextFromText(t);
      if (!ctx2) continue;

      foundCtxInScripts++;

      const out = extractOrdersFromContext(ctx2);
      if (out.length) {
        console.log('[EtsyExtract] from <script> ctx:', out.length);
        return out;
      }
    }

    console.log('[EtsyExtract] script ctx found:', foundCtxInScripts);
  } catch (_) {}

  // 5) DOM extraction (works for Inspect-copied HTML where Etsy.Context has no orders)
  try {
    if (!doc) doc = new DOMParser().parseFromString(htmlString, 'text/html');
    const outDom = extractOrdersFromDom(doc, ctx);
    console.log('[EtsyExtract] from DOM:', outDom.length);
    if (outDom.length) return outDom;
  } catch (e) {
    console.log('[EtsyExtract] DOM fallback error:', e?.message || String(e));
  }

  return [];
}
