import { ENV } from '../config/env.js';
import { URLS } from '../config/urls.js';

/**
 * Page detection, redirect, extraction placeholder.
 */

export function isOnSellerOrdersPage (url) {
  if (!url) return false;
  const u = String(url);

  const inSellerArea = ENV.ETSY.SELLER_AREA_PREFIXES.some(p => u.startsWith(p));
  const isOrders = u.includes('/orders');
  return inSellerArea && isOrders;
}
// export function isOnSellerOrdersPage (url = '') {
//   try {
//     const u = new URL(url);
//     if (u.hostname !== 'www.etsy.com') return false;

//     // Accept /your/shops/{shop}/orders and optional trailing slash
//     const path = u.pathname.replace(/\/$/, '');
//     return /^\/your\/shops\/[^/]+\/orders$/.test(path);
//   } catch (_) {
//     return false;
//   }
// }


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

  const marker = 'Etsy.Context=';
  const idx = text.indexOf(marker);
  if (idx < 0) return null;

  const start = text.indexOf('{', idx);
  if (start < 0) return null;

  let depth = 0;
  let inStr = false;
  let esc = false;
  let end = -1;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (inStr) {
      if (esc) {
        esc = false;
        continue;
      }
      if (ch === '\\') {
        esc = true;
        continue;
      }
      if (ch === '"') {
        inStr = false;
        continue;
      }
      continue;
    }

    // not in string
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) {
        end = i + 1; // slice end is exclusive
        break;
      }
    }
  }

  if (end < 0) return null;

  const jsonStr = text.slice(start, end);
  try {
    return JSON.parse(jsonStr);
  } catch (e) {
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

async function loadSampleEtsyOrdersHtml () {
  const url = chrome.runtime.getURL(ENV.ETSY.SAMPLE_ORDERS_HTML);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to load sample HTML: HTTP ${res.status}`);
  }
  return await res.text();
}

/**
 * Mock extractor: parse from the provided HTML string
 * @param {string} htmlString full HTML of Etsy orders page
 */
export async function extractOrdersMock () {
  const htmlString = await loadSampleEtsyOrdersHtml();
  const order_test = {
    platform_order_id: '6736176349299',
    shipping_address: {
      zip: '70000',
      city: 'Ho Chi Minh City',

      // name: "Customer One",
      first_name: 'datnt',
      last_name: 'hehehe',

      phone: '+84900000001',
      company: null,
      country: 'Vietnam',
      address1: '12 Nguyen Hue',
      address2: 'District 1',
      province: null,

      // latitude: "10.7758439",
      // longitude: "106.703626",

      country_code: 'VN',
      province_code: null
    },
    email: 'customer_1@gmail.com'
  };
  const ctx = parseEtsyContextFromText(htmlString);
  if (ctx) return [...extractOrdersFromContext(ctx), order_test];

  // Fallback: parse DOM then scan scripts
  try {
    const doc = new DOMParser().parseFromString(htmlString, 'text/html');
    const scripts = Array.from(doc.querySelectorAll('script'));
    for (const s of scripts) {
      const t = s.textContent || '';
      const ctx2 = parseEtsyContextFromText(t);
      if (ctx2) return [...extractOrdersFromContext(ctx2), order_test];
    }
  } catch (_) {}

  return [order_test];
}

/**
 * Live extractor: run on Etsy orders page when user open extension
 * @param {Document} doc window.document
 * @param {Window} win window
 */
export function extractOrders (doc = document, win = window) {
  // 1) If Etsy.Context already available on window
  const ctxWin = win?.Etsy?.Context;
  if (ctxWin?.data?.initial_data?.orders) {
    return extractOrdersFromContext(ctxWin);
  }

  // 2) Fallback => Parse from inline scripts
  const scripts = Array.from(doc.querySelectorAll('script'));
  for (const s of scripts) {
    const t = s.textContent || '';
    if (!t.includes('Etsy.Context=')) continue;
    const ctx = parseEtsyContextFromText(t);
    if (ctx) return extractOrdersFromContext(ctx);
  }

  // 3) Last resort (weak): find order ids from links (email/address likely not present)
  const orderIds = new Set();
  for (const a of Array.from(doc.querySelectorAll('a[href]'))) {
    const href = a.getAttribute('href') || '';
    const m1 = href.match(/\/your\/orders\/(\d+)/);
    const m2 = href.match(/[?&]order_id=(\d+)/);
    const id = (m1 && m1[1]) || (m2 && m2[1]);
    if (id) orderIds.add(String(id));
  }

  return Array.from(orderIds).map(id => ({
    platform_order_id: id,
    shipping_address: {
      zip: null,
      city: null,
      name: null,
      phone: null,
      company: null,
      country: null,
      address1: null,
      address2: null,
      latitude: null,
      province: null,
      last_name: null,
      longitude: null,
      first_name: null,
      country_code: null,
      province_code: null
    },
    email: null
  }));
}
