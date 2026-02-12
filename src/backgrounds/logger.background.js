const STORAGE_KEY = '__teeinblue_sync_log_lines__';

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'TEEINBLUE_LOG_CLEAR') {
    const key = msg.key || STORAGE_KEY;
    const STORAGE = chrome.storage.session || chrome.storage.local;
    STORAGE.remove([key]);
  }
});
