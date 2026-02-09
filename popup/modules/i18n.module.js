export function registerDictionaryUpdatedListener ({ applyDictionary }) {
  window.addEventListener('dictionary:updated', e => {
    const dict = e?.detail?.dictionary;
    if (dict) window.dictionary = dict;

    // static + dynamic UI (all via data-i18n)
    applyDictionary(document);
  });
}

export function setLanguage (els) {
  if (!els?.langSel) return;

  const cache = new Map(); // cache JSON by lang code

  // ../locales/example.json
  function getLocalePath (code) {
    // Use lower-case file name: locales/en.json
    return `../locales/${String(code).toLowerCase()}.json`;
  }

  async function loadDictionary (code) {
    if (cache.has(code)) return cache.get(code);

    const res = await fetch(getLocalePath(code), { cache: 'no-store' });
    if (!res.ok) {
      throw new Error(
        `Failed to load locale file: ${getLocalePath(code)} (${res.status})`
      );
    }

    const json = await res.json();
    cache.set(code, json);
    return json;
  }

  async function applyLanguage (code) {
    try {
      const dict = await loadDictionary(code);

      // window.dictionary MUST be the JSON object of the selected language
      window.dictionary = dict;

      try {
        localStorage.setItem('lang', code);
      } catch (_) {}

      window.dispatchEvent(
        new CustomEvent('dictionary:updated', {
          detail: { lang: code, dictionary: dict }
        })
      );
    } catch (err) {
      console.error(err);

      // Fallback: if error -> use old dict or empty
      window.dictionary = window.dictionary || {};
      window.dispatchEvent(
        new CustomEvent('dictionary:error', {
          detail: { lang: code, error: String(err) }
        })
      );
    }
  }

  // Init: localStorage (higher priority) -> fallback to selected value
  const saved = (() => {
    try {
      return localStorage.getItem('lang');
    } catch (_) {
      return null;
    }
  })();

  const initialLang = saved || els.langSel.value || 'EN';
  els.langSel.value = initialLang;
  applyLanguage(initialLang);

  // On change
  els.langSel.addEventListener('change', e => {
    const code = e.target.value;
    console.log('Language changed to', code);
    applyLanguage(code);
  });
}
