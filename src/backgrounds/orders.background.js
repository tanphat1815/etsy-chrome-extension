import { getEtsyOrderById } from '../services/teeinblue.service.js';
import { recomputeNeedSyncFromTB } from '../controllers/sync.controller.js';
import { ordersWorkerType } from '../constants/serviceWorkers.schema.js';

// latest jobId to resume popup when openning
const JOB_LAST_KEY = 'tb_scan_last_job_v1';

// namespace for job snapshot in `chrome.storage.local`
const JOB_PREFIX = 'tb_scan_job_v1:';

function jobKey(jobId) {
  // `tb_scan_job_v1:<jobId>`
  return `${JOB_PREFIX}${jobId}`;
}

function now() {
  return Date.now();
}

function newJobId() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

async function saveJob(job) {
  await chrome.storage.local.set({
    [jobKey(job.jobId)]: job,
    [JOB_LAST_KEY]: job.jobId
  });
}

async function loadJob(jobId) {
  const obj = await chrome.storage.local.get([jobKey(jobId)]);
  return obj?.[jobKey(jobId)] || null;
}

async function loadLastJobId() {
  const obj = await chrome.storage.local.get([JOB_LAST_KEY]);
  return obj?.[JOB_LAST_KEY] || '';
}

function safeSend (payload) {
  try {
    chrome.runtime.sendMessage(payload, () => void chrome.runtime.lastError);
  } catch (_) {}
}

const running = new Set();

async function runScanJob(jobId) {
  if (running.has(jobId)) return;
  running.add(jobId);

  try {
    let job = await loadJob(jobId);
    if (!job || job.status !== 'running') return;

    const extracted = Array.isArray(job.extracted) ? job.extracted : [];
    const total = extracted.length;

    for (let i = job.cursor || 0; i < total; i++) {
      job = await loadJob(jobId);
      if (!job || job.status !== 'running') break;

      if (job.cancelled) {
        job.status = 'cancelled';
        job.updatedAt = now();
        await saveJob(job);
        safeSend({ type: ordersWorkerType.SCAN_DONE, jobId, status: 'cancelled', pageKey: job.pageKey || '' });
        return;
      }

      const ex = extracted[i] || {};
      const platformId = ex.platform_order_id;

      job.cursor = i;
      job.progress = {
        total,
        processed: job.processed || 0,
        currentId: platformId
      };
      job.updatedAt = now();
      await saveJob(job);

      const tb = await getEtsyOrderById(job.token, platformId);

      if (tb?.ok && tb?.data && typeof tb.data === 'object') {
        const computed = recomputeNeedSyncFromTB(tb.data, {
          email: ex.email,
          shipping_address: ex.shipping_address
        });

        if (computed.emailNeedsSync || computed.addrNeedsSync) {
          job.candidateIds = job.candidateIds || {};
          if (!job.candidateIds[platformId]) {
            job.candidateIds[platformId] = true;

            const candidate = {
              platform_order_id: platformId,

              // extracted (etsy)
              email: ex.email,
              shipping_address: ex.shipping_address,

              // tb view
              tbEmail: computed.tbEmail,
              tbAddress: computed.tbAddress,

              // state
              emailNeedsSync: computed.emailNeedsSync,
              addrNeedsSync: computed.addrNeedsSync,
              diffAddressKeys: computed.diffAddressKeys,

              // payload helper
              shipping_address_payload: computed.shipping_address_payload
            };

            job.candidates = job.candidates || [];
            job.candidates.push(candidate);
            job.updatedAt = now();
            await saveJob(job);

            safeSend({
              type: ordersWorkerType.SCAN_NEW_CANDIDATE,
              jobId: job.jobId,
              pageKey: job.pageKey || '',
              item: candidate
            });
          }
        }
      }

      job.processed = (job.processed || 0) + 1;
      job.progress = { total, processed: job.processed, currentId: platformId };
      job.updatedAt = now();
      await saveJob(job);
    }

    job = await loadJob(jobId);
    if (job && job.status === 'running') {
      job.status = 'done';
      job.updatedAt = now();
      await saveJob(job);

      safeSend({ type: ordersWorkerType.SCAN_DONE, jobId, status: 'done', pageKey: job.pageKey || '' });
    }
  } finally {
    running.delete(jobId);
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const type = msg?.type;

  if (type === ordersWorkerType.SCAN_START) {
    (async () => {
      const token = (msg?.token || '').trim();
      const extracted = Array.isArray(msg?.extracted) ? msg.extracted : [];
      const pageKey = msg?.pageKey || '';

      const jobId = newJobId();
      const job = {
        jobId,
        pageKey,
        token,
        extracted,

        status: 'running',
        createdAt: now(),
        updatedAt: now(),

        cursor: 0,
        processed: 0,
        progress: { total: extracted.length, processed: 0, currentId: '' },

        candidates: [],
        candidateIds: {},

        cancelled: false
      };

      await saveJob(job);
      runScanJob(jobId);

      sendResponse({ ok: true, jobId });
    })().catch((e) => {
      sendResponse({ ok: false, error: e?.message || String(e) });
    });

    return true;
  }

  if (type === ordersWorkerType.SCAN_GET_STATE) {
    (async () => {
      const jobId = msg?.jobId || '';
      const job = await loadJob(jobId);

      if (!job) {
        sendResponse({ ok: false, error: 'JOB_NOT_FOUND' });
        return;
      }

      if (job.status === 'running' && !running.has(job.jobId)) {
        runScanJob(job.jobId);
      }

      sendResponse({
        ok: true,
        job: {
          jobId: job.jobId,
          pageKey: job.pageKey,
          status: job.status,
          progress: job.progress,
          candidates: job.candidates || []
        }
      });
    })().catch((e) => {
      sendResponse({ ok: false, error: e?.message || String(e) });
    });

    return true;
  }

  if (type === ordersWorkerType.SCAN_GET_LAST) {
    (async () => {
      const jobId = await loadLastJobId();
      sendResponse({ ok: true, jobId });
    })().catch((e) => {
      sendResponse({ ok: false, error: e?.message || String(e) });
    });

    return true;
  }

  if (type === ordersWorkerType.SCAN_CANCEL) {
    (async () => {
      const jobId = msg?.jobId || '';
      const job = await loadJob(jobId);

      if (!job) {
        sendResponse({ ok: false, error: 'JOB_NOT_FOUND' });
        return;
      }

      job.cancelled = true;
      job.updatedAt = now();
      await saveJob(job);

      sendResponse({ ok: true });
    })().catch((e) => {
      sendResponse({ ok: false, error: e?.message || String(e) });
    });

    return true;
  }
});
