import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

export async function runBackgroundResourceTests() {
  const source = fs.readFileSync('src/background/background.js', 'utf8').replace(/^import .*;$/gm, '');
  function worker({ queryFails = false } = {}) {
    const messages = [];
    let onChanged;
    let onMessage;
    let exists = true;
    const prefix = 'blob:chrome-extension://test/';
    const active = { id: 7, url: prefix + 'active', state: 'in_progress' };
    const sandbox = {
      defaultRegistry: { register() {} },
      InstagramPlugin: {}, FacebookPlugin: {}, RedditPlugin: {}, StorageService: {},
      DownloadManager: class {
        downloadBlobUrls = new Map();
        activeJob = { archiveSessionId: 'session', completed: 2, failed: 1, total: 3, status: 'DOWNLOADING_BLOBS' };
        updateBadge() {}
        broadcastProgress() {}
        logger = { warn() {} };
        handleDownloadChanged() {}
        async startDownload() { messages.push({ type: 'STARTED' }); return { success: true }; }
      },
      ArchiveService: {
        async sendToOffscreen(message) { messages.push(message); return { ok: true }; },
        async revokeBlobUrls(urls) { messages.push({ type: 'REVOKED', urls }); }
      },
      chrome: {
        runtime: {
          getURL: (file) => `chrome-extension://test/${file}`,
          async getContexts() { return exists ? [{}] : []; },
          onMessage: { addListener(listener) { onMessage = listener; } }
        },
        offscreen: { async createDocument() { exists = true; } },
        downloads: {
          onChanged: { addListener(listener) { onChanged = listener; } },
          async search(query) {
            if (queryFails) throw new Error('unavailable');
            return query.id ? [{ ...active, state: 'complete' }] : [active, { url: 'https://example.com/file' }];
          }
        }
      }
    };
    vm.runInNewContext(source + '\nglobalThis.manager = downloadManager;', sandbox);
    return {
      messages,
      get job() { return /** @type {any} */ (sandbox).manager.activeJob; },
      progress(sessionId) { onMessage({ type: 'ZIP_OFFSCREEN_PROGRESS', sessionId, patch: { completed: 99, failed: 99, status: 'PACKAGING_ZIP' } }, {}, () => {}); },
      disappear() { exists = false; },
      terminal() { onChanged({ id: active.id, state: { current: 'complete' } }); },
      async start() { return new Promise((resolve) => onMessage({ type: 'START_DOWNLOAD' }, {}, resolve)); },
      offscreenMessage() {
        let answered = false;
        onMessage({ type: 'OFFSCREEN_BEGIN_ZIP' }, {}, () => { answered = true; });
        return answered;
      }
    };
  }
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  const first = worker();
  await flush();
  assert.equal(first.messages[0].type, 'OFFSCREEN_RECOVER_RESOURCES');
  assert.deepEqual([...first.messages[0].activeUrls], ['blob:chrome-extension://test/active']);
  await first.start();
  assert.equal(first.messages.filter((message) => message.type === 'OFFSCREEN_RECOVER_RESOURCES').length, 1);
  assert.equal(first.offscreenMessage(), false, 'worker must not race the offscreen reply');
  first.progress('stale');
  assert.equal(first.job.status, 'DOWNLOADING_BLOBS');
  first.progress('session');
  assert.equal(first.job.status, 'PACKAGING_ZIP');
  assert.equal(first.job.completed, 2);
  assert.equal(first.job.failed, 1);
  first.terminal();
  await flush();
  assert.deepEqual([...first.messages.find((message) => message.type === 'REVOKED').urls], ['blob:chrome-extension://test/active']);
  first.disappear();
  await first.start();
  assert.equal(first.messages.filter((message) => message.type === 'OFFSCREEN_RECOVER_RESOURCES').length, 2);

  const failed = worker({ queryFails: true });
  await flush();
  assert.equal(failed.messages.length, 0, 'unknown browser state must never trigger deletion');
  assert.equal((await failed.start()).success, false);
  assert.equal(failed.messages.length, 0);
}
