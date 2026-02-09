import { URLS } from '../config/urls.js';
import { readResponseBody } from '../utils/http.js';

/**
 * Teeinblue API Service.
 */

/**
 * Check token by fetching "list orders" (staging).
 * @param {string} token Bearer token (raw)
 * @returns {Promise<{ok: boolean, status: number, data: any}>}
 */
export async function checkConnectionByListOrders (token) {
  const res = await fetch(URLS.TEEINBLUE.HEALTH_BY_LIST_ORDERS, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: '*/*'
    }
  });

  const data = await readResponseBody(res);
  return { ok: res.ok, status: res.status, data };
}

/**
 * Get order by Etsy platform_order_id (staging).
 * @param {string} token Bearer token (raw)
 * @param {string} platformOrderId Etsy order id
 * @returns {Promise<{ok: boolean, status: number, data: any}>}
 */
export async function getEtsyOrderById (token, platformOrderId) {
  const res = await fetch(URLS.TEEINBLUE.GET_ORDER_BY_ID(platformOrderId), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: '*/*'
    }
  });

  const data = await readResponseBody(res);
  return { ok: res.ok, status: res.status, data };
}

/**
 * Update Etsy order by platform_order_id (staging).
 *
 * @param {string} token Bearer token (raw)
 * @param {string} platformOrderId Etsy order id
 * @param {{email?: string, shipping_address?: object}} payload Update payload
 * @returns {Promise<{ok: boolean, status: number, data: any}>}
 */
export async function updateEtsyOrderById (token, platformOrderId, payload) {
  const res = await fetch(URLS.TEEINBLUE.UPDATE_ORDER_BY_ID(platformOrderId), {
    method: 'PATCH',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });

  const data = await readResponseBody(res);
  return { ok: res.ok, status: res.status, data };
}
