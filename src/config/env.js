export const ENV = {
  IS_PRODUCTION: false,
  USE_MOCK: false, 
  /** Set USE_MOCK to true to use sample data instead of live Etsy orders */
  
  ETSY: {
    BASE_URL: "https://www.etsy.com",
    SELLER_ORDERS_PATH: "/your/shops/me/orders",
    SELLER_AREA_PREFIXES: ["https://www.etsy.com/your/shops/"],
    SAMPLE_ORDERS_HTML: "samples/sample_etsy_orders.html"
  },

  TEEINBLUE: {
    STAGING_BASE: "https://staging-api.teeinblue.com",
    PROD_BASE: "https://api.teeinblue.com"
  }
};
