import { setTeeinblueStatus, t } from '../../src/ui/renderer.js';
import { tokenFingerprint, writeBootCache } from '../../src/cache/index.cache.js';
import { checkConnectionByListOrders } from '../../src/services/teeinblue.service.js';

export function createConnectController ({ app, els, saveTokenToStorage, saveUiSnapshot }) {
  let connectTimer = null;

  async function checkConnect (token) {
    app.token = (token || '').trim();

    if (!app.token) {
      app.connected = false;
      setTeeinblueStatus(els.teeinblueStatus, '', 'muted');

      // cache status (avoid re-checking on reopen)
      await writeBootCache({
        key: app.pageKey,
        tokenFp: tokenFingerprint(app.token),
        teeinblueStatus: { text: '', kind: 'muted' }
      });

      await saveUiSnapshot();
      return;
    }

    setTeeinblueStatus(
      els.teeinblueStatus,
      t('status.checking_connection', {}, 'Checking connection ...'),
      'muted'
    );
    els.teeinblueStatus.dataset.i18n = 'status.checking_connection';

    try {
      const res = await checkConnectionByListOrders(app.token);
      console.log('[ConnectCheck]', res.status, res.data);

      app.connected = !!res.ok;

      if (res.ok) {
        const text = t('status.connected', {}, 'Connected ✅');
        setTeeinblueStatus(els.teeinblueStatus, text, 'ok');
        els.teeinblueStatus.dataset.i18n = 'status.connected';

        // cache status (avoid re-checking on reopen)
        await writeBootCache({
          key: app.pageKey,
          tokenFp: tokenFingerprint(app.token),
          teeinblueStatus: { text, kind: 'ok' }
        });

        await saveUiSnapshot();
      } else {
        const text = t(
          'status.not_connected_http',
          { status: res.status },
          `Not connected ❌ (HTTP ${res.status})`
        );
        setTeeinblueStatus(els.teeinblueStatus, text, 'error');
        els.teeinblueStatus.dataset.i18n = 'status.not_connected_http';
        els.teeinblueStatus.dataset.i18nVars = JSON.stringify({ status: res.status });

        // cache status (avoid re-checking on reopen)
        await writeBootCache({
          key: app.pageKey,
          tokenFp: tokenFingerprint(app.token),
          teeinblueStatus: { text, kind: 'error' }
        });

        await saveUiSnapshot();
      }
    } catch (e) {
      console.log('[ConnectCheck] error', e);
      app.connected = false;

      const text = t(
        'status.request_failed',
        { message: e?.message || String(e) },
        `Request failed ❌ (${e?.message || String(e)})`
      );
      setTeeinblueStatus(els.teeinblueStatus, text, 'error');
      els.teeinblueStatus.dataset.i18n = 'status.request_failed';
      els.teeinblueStatus.dataset.i18nVars = JSON.stringify({ message: e?.message || String(e) });

      // cache status (avoid re-checking on reopen)
      await writeBootCache({
        key: app.pageKey,
        tokenFp: tokenFingerprint(app.token),
        teeinblueStatus: { text, kind: 'error' }
      });

      await saveUiSnapshot();
    }
  }

  function debounceConnectCheck () {
    const token = (els.apiKeyInput.value || '').trim();
    if (connectTimer) clearTimeout(connectTimer);
    connectTimer = setTimeout(async () => {
      await saveTokenToStorage(token);
      await checkConnect(token);
    }, 450);
  }

  return { checkConnect, debounceConnectCheck };
}
