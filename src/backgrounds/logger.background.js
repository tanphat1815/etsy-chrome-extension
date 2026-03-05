import { loggerWorkerType } from "../constants/serviceWorkers.schema.js";
import { configs } from "../constants/configs.schema.js";

const STORAGE_KEY = configs.STORAGE_KEY.LOG_LINES;

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === loggerWorkerType.LOG_CLEAR) {
    const key = msg.key || STORAGE_KEY;
    const STORAGE = chrome.storage.session || chrome.storage.local;
    STORAGE.remove([key]);
  }
});
