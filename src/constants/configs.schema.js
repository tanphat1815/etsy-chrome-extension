/**
 * @description Global configs and constants
 *
 * @typedef {Object} Configs
 * @property {Object} LOGS
 * @property {number} LOGS.MAX_LINES - maximum number of log lines to retain
 * @property {Object} STORAGE_KEY
 * @property {string} STORAGE_KEY.LOG_LINES - key used for storing log entries / session storage
 * @property {string} STORAGE_KEY.UI_BOOT_CACHE - key used for caching UI boot state / local storage
 * @property {string} STORAGE_KEY.UI_SNAPSHOT - key used for storing UI snapshot / local storage
 * @property {string} STORAGE_KEY.TB_API_KEY - key used for storing the Teeinblue API key / local storage
 * @property {string} STORAGE_KEY.APP_KEY - key used for storing app-related data (e.g. cached connection status) / local storage
 *
 * @returns {Configs} the configuration constants used throughout the app
 */

export const configs = {
  LOGS: {
    MAX_LINES: 100,
  },

  STORAGE_KEY: {
    LOG_LINES: '__teeinblue_sync_log_lines__',
    UI_BOOT_CACHE: 'ui_boot_cache_v1',
    UI_SNAPSHOT: 'ui_snapshot_v1',
    TB_API_KEY: 'teeinblueApiKey',
    APP_KEY: 'app'
  }
};
