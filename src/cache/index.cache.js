const UI_BOOT_CACHE_KEY = 'ui_boot_cache_v1';

// IMPORTANT: use local to persist across popup open/close (even without service worker)
const STORE = chrome.storage.local;

export function tokenFingerprint (token = '') {
  const t = String(token || '');
  return `${t.slice(0, 8)}:${t.length}`;
}

/**
 * Normalize “same page” key:
 * - Non-target: ignore ALL query/hash (same pathname)
 * - Target (Etsy orders): ignore query EXCEPT page=
 *
 * @param {string} url
 * @param {(url: string) => boolean} isTargetPage
 */
export function buildPageKey (url = '', isTargetPage) {
  try {
    const u = new URL(url);
    const base = `${u.origin}${u.pathname}`;

    if (!isTargetPage || !isTargetPage(url)) return base;

    const page = u.searchParams.get('page') || '';
    return `${base}|page=${page}`;
  } catch (_) {
    return url || '';
  }
}

export async function readBootCache () {
  try {
    const res = await STORE.get([UI_BOOT_CACHE_KEY]);
    return res?.[UI_BOOT_CACHE_KEY] || null;
  } catch (_) {
    return null;
  }
}

export async function writeBootCache (patch) {
  try {
    const cur = (await readBootCache()) || {};
    await STORE.set({
      [UI_BOOT_CACHE_KEY]: { ...cur, ...patch, ts: Date.now() }
    });
  } catch (_) {}
}

// ===== UI snapshot (persist rendered orders list) =====
const UI_SNAPSHOT_KEY = 'ui_snapshot_v1';
const SNAP_STORE = chrome.storage.local;

function prune(map, max = 10) {
  const entries = Object.entries(map || {});
  if (entries.length <= max) return map || {};
  entries.sort((a, b) => (b[1]?.ts || 0) - (a[1]?.ts || 0));
  return Object.fromEntries(entries.slice(0, max));
}

export async function readUiSnapshot(pageKey) {
  try {
    const k = String(pageKey || '');
    if (!k) return null;

    const res = await SNAP_STORE.get([UI_SNAPSHOT_KEY]);
    const map = res?.[UI_SNAPSHOT_KEY] || {};
    return map[k] || null;
  } catch (_) {
    return null;
  }
}

export async function writeUiSnapshot(pageKey, snapshot) {
  try {
    const k = String(pageKey || '');
    if (!k) return;

    const res = await SNAP_STORE.get([UI_SNAPSHOT_KEY]);
    const map = res?.[UI_SNAPSHOT_KEY] || {};

    map[k] = { ...(snapshot || {}), ts: Date.now() };

    await SNAP_STORE.set({
      [UI_SNAPSHOT_KEY]: prune(map, 10)
    });
  } catch (_) {}
}

// ===== Clear all snapshots =====
export async function clearUiSnapshots () {
  try {
    await chrome.storage.local.remove([UI_BOOT_CACHE_KEY, UI_SNAPSHOT_KEY]);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}


export function saveAppStateToStorage (app, storageKey) {
  if (!storageKey) return Promise.reject(new Error('Storage key is required'));

  const data = {
    tokenFp: tokenFingerprint(app.token),
    connected: app.connected,
    pageKey: app.pageKey,
    orders: app.orders
  };

  return new Promise((resolve) => {
    try {
      chrome.storage.local.set({ [storageKey]: data }, () => resolve());
    } catch (_) {
      resolve();
    }
  });
}
