import { ENV } from "./env.js";

function getBaseTeeinblueUrl() {
  return ENV.IS_PRODUCTION ? ENV.TEEINBLUE.PROD_BASE : ENV.TEEINBLUE.STAGING_BASE;
}
export const URLS = {
  ETSY: {
    SELLER_ORDERS_URL: `${ENV.ETSY.BASE_URL}${ENV.ETSY.SELLER_ORDERS_PATH}`
  },

  TEEINBLUE: {
    // Connect check  
    HEALTH_BY_LIST_ORDERS: `${getBaseTeeinblueUrl()}/openapi/v1/orders/etsy`,

    // GET order by id  
    GET_ORDER_BY_ID: (platformOrderId) =>
      `${getBaseTeeinblueUrl()}/openapi/v1/orders/etsy/${encodeURIComponent(platformOrderId)}`,
    // PATCH update  
    UPDATE_ORDER_BY_ID: (platformOrderId) =>
      `${getBaseTeeinblueUrl()}/openapi/v1/orders/etsy/${encodeURIComponent(platformOrderId)}`
  }
};
