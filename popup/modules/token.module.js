export async function loadTokenFromStorage ({ app, els, storageKey }) {
  const stored = await chrome.storage.local.get([storageKey]);
  const token = (stored?.[storageKey] || '').trim();
  app.token = token;
  if (els?.apiKeyInput) els.apiKeyInput.value = token;
  return token;
}

export async function saveTokenToStorage (token, storageKey) {
  await chrome.storage.local.set({ [storageKey]: token });
}
