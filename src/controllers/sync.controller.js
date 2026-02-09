import { isPlainObject, isEmptyValue, normalizeEmail, normalizeScalar } from "../utils/value.js";

/**
 * Logic that compares Etsy extracted data with Teeinblue data,
 * and prepares payload for sync + recomputes state from PUT response.
 *
 * Etsy extracted format:
 *  { platform_order_id, email, shipping_address }
 *
 * Teeinblue data format:
 *  data.customer.email
 *  data.address
 */

function shouldOverride(tbVal, exVal) {
  // Skip if extracted is empty/null
  if (isEmptyValue(exVal)) return false;
  const tbN = normalizeScalar(tbVal);
  const exN = normalizeScalar(exVal);
  return String(tbN ?? "") !== String(exN ?? "");
}

/**
 * Build merged shipping_address payload based on override rules:
 * - start from TB address
 * - for each extracted non-empty field: override if different
 *
 * @param {object} tbAddress Teeinblue data.address
 * @param {object} extractedAddress Etsy extracted shipping_address
 * @returns {{ merged: object, diffKeys: string[] }}
 */
export function buildAddressOverride(tbAddress, extractedAddress) {
  const tb = isPlainObject(tbAddress) ? tbAddress : {};
  const ex = isPlainObject(extractedAddress) ? extractedAddress : {};

  const merged = { ...tb };
  const diffKeys = [];

  for (const [k, exVal] of Object.entries(ex)) {
    if (isEmptyValue(exVal)) continue;
    if (shouldOverride(tb[k], exVal)) {
      merged[k] = exVal;
      diffKeys.push(k);
    }
  }

  return { merged, diffKeys };
}

/**
 * Compute "need sync" state based on TB response
 * and extracted Etsy fields.
 *
 * @param {any} tbData Teeinblue order payload
 * @param {{email: string, shipping_address: object}} extracted Etsy extracted order
 * @returns {{
 *   tbEmail: string,
 *   emailNeedsSync: boolean,
 *   addrNeedsSync: boolean,
 *   diffAddressKeys: string[],
 *   shipping_address_payload: object
 * }}
 */
export function recomputeNeedSyncFromTB(tbData, extracted) {
  const tbEmail = tbData?.customer?.email || "";
  const tbAddress = tbData?.address || {};

  const exEmailNorm = normalizeEmail(extracted.email);
  const tbEmailNorm = normalizeEmail(tbEmail);

  const emailNeedsSync = !!exEmailNorm && tbEmailNorm !== exEmailNorm;

  const { merged, diffKeys } = buildAddressOverride(tbAddress, extracted.shipping_address);
  const addrNeedsSync = diffKeys.length > 0;

  return {
    tbEmail,
    tbAddress,
    emailNeedsSync,
    addrNeedsSync,
    diffAddressKeys: diffKeys,
    shipping_address_payload: merged
  };
}

/**
 * Build update payload based on current item state.
 * Keeps exact keys required by API: { email, shipping_address }.
 *
 * @param {{
 *  emailNeedsSync: boolean,
 *  addrNeedsSync: boolean,
 *  email: string,
 *  shipping_address_payload: object
 * }} item
 * @returns {{email?: string, shipping_address?: object}}
 */
export function buildUpdatePayload(item) {
  const payload = {};

  if (item.emailNeedsSync && !isEmptyValue(item.email)) {
    payload.email = item.email;
  }
  if (item.addrNeedsSync && isPlainObject(item.shipping_address_payload)) {
    payload.shipping_address = item.shipping_address_payload;
  }

  return payload;
}
