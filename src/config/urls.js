import { ENV } from "./env.js";

export const URLS = {
  ETSY: {
    SELLER_ORDERS_URL: `${ENV.ETSY.BASE_URL}${ENV.ETSY.SELLER_ORDERS_PATH}`
  },

  TEEINBLUE: {
    // Connect check (staging)
    HEALTH_BY_LIST_ORDERS: `${ENV.TEEINBLUE.STAGING_BASE}/openapi/v1/orders`,

    // GET order by id (staging)
    GET_ORDER_BY_ID: (platformOrderId) =>
      `${ENV.TEEINBLUE.STAGING_BASE}/openapi/v1/orders/etsy/${encodeURIComponent(platformOrderId)}`,

    // PUT update (staging)
    UPDATE_ORDER_BY_ID: (platformOrderId) =>
      `${ENV.TEEINBLUE.STAGING_BASE}/openapi/v1/orders/etsy/${encodeURIComponent(platformOrderId)}`
  }
};
