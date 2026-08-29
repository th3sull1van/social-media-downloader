/**
 * Social Media Downloader — DownloadManager Unit Tests (chrome.* stubbed)
 * Covers: per-item counters (F-08), failure counting, plugin filename contract,
 * filename passed via download() options, blob URL revocation on completion (F-04), badge updates (F-12).
 */
import assert from 'node:assert';
import { DownloadManager } from '../../src/core/application/DownloadManager.js';

/**
 * Installs a controllable chrome.* stub. Returns the stub and recorded calls.
 * @param {{ downloadImpl?: Function, offscreenReply?: Function }} [options]
 *   offscreenReply: (serializedMsg) => response object (default: {ok:true, objectUrl:'blob:stubbed'})
 */
function installChromeStub({ downloadImpl, offscreenReply } = {}) {
  const recorded = {
    badges: [],
    downloads: [],
    cancelled: [],
    offscreenMessages: []
  };

  // @ts-ignore test double installs the browser global
  globalThis.chrome = {
    action: {
      setBadgeText: (opts) => { recorded.badges.push({ text: opts.text }); },
      setBadgeBackgroundColor: (opts) => { recorded.badges.push({ color: opts.color }); }
    },
    runtime: {
      lastError: null,
      sendMessage: (msg, cb) => {
        // Faithful transport: chrome.runtime.sendMessage JSON-serializes messages
        // (structured clone is opt-in from Chrome 148). Recording and replying with
        // the JSON round-trip catches non-serializable payloads (e.g. ArrayBuffer
        // arriving as {}) exactly like production does.
        let serialized;
        try {
          serialized = JSON.parse(JSON.stringify(msg));
        } catch (err) {
          serialized = { __serializationError: err.message };
        }
        recorded.offscreenMessages.push(serialized);
        if (typeof cb === 'function') {
          const response = offscreenReply
            ? offscreenReply(serialized)
            : { ok: true, objectUrl: 'blob:stubbed' };
          cb(response);
        }
        return Promise.resolve(offscreenReply ? offscreenReply(serialized) : { ok: true, objectUrl: 'blob:stubbed' });
      }
    },
    tabs: {
      query: (opts, cb) => cb([]),
      sendMessage: () => Promise.resolve()
    },
    downloads: {
      download: downloadImpl || ((options, cb) => {
        recorded.downloads.push(options);
        cb(recorded.downloads.length);
      }),
      cancel: (id) => { recorded.cancelled.push(id); }
    }
  };

  return recorded;
}

function uninstallChromeStub() {
  delete (/** @type {any} */ (globalThis)).chrome;
}

const chromeRef = /** @type {any} */ (globalThis);
const anyFetch = /** @type {any} */ (globalThis);

function makeItem(id, url) {
  return {
    id,
    platform: 'testplatform',
    type: 'image',
    sourceType: 'test',
    url,
    downloadUrl: url,
    thumbnailUrl: url,
    extension: 'jpg',
    metadata: {}
  };
}

export async function runDownloadManagerTests() {
  const fakePlugin = {
    id: 'testplatform',
    getFilename: (item, ctx) => `SMD/Test/@user/${item.id}_${ctx.index}.jpg`,
    getArchivePath: (item, ctx) => `@user/${item.id}_${ctx.index}.jpg`
  };

  // Small registry double — avoids importing the real one's global singleton side effects.
  const registry = /** @type {any} */ ({ get: () => fakePlugin });

  // 1. Badge updates (F-12): real text is set, not silently cleared.
  {
    const recorded = installChromeStub();
    const dm = new DownloadManager(registry);
    dm.updateBadge('3/10');
    const setText = recorded.badges.some((b) => b.text === '3/10');
    assert.ok(setText, 'badge text should be set with real progress');
    dm.updateBadge('');
    const cleared = recorded.badges.some((b) => b.text === '');
    assert.ok(cleared, 'empty text should clear the badge');
    uninstallChromeStub();
  }

  // 2. Individual downloads: per-item counters, plugin filenames, completion.
  {
    const recorded = installChromeStub();
    const dm = new DownloadManager(registry);
    const items = /** @type {any} */ (Array.from({ length: 5 }, (_, i) => makeItem(`item_${i}`, `https://cdn.test/${i}.jpg`)));

    const res = await dm.startDownload({ platform: 'testplatform', targetName: 'My_Target', items, format: 'individual' });
    assert.strictEqual(res.success, true);

    await new Promise((resolve) => {
      const check = () => {
        if (dm.activeJob && dm.activeJob.status === 'COMPLETED') resolve();
        else setTimeout(check, 10);
      };
      check();
    });

    assert.strictEqual(dm.activeJob.completed, 5);
    assert.strictEqual(dm.activeJob.failed, 0);
    assert.strictEqual(dm.activeJob.total, 5);
    assert.strictEqual(recorded.downloads.length, 5);
    assert.ok(recorded.downloads[0].filename.startsWith('SMD/Test/@user/item_0_'));
    assert.ok(recorded.downloads[0].filename.endsWith('_1.jpg'));
    assert.strictEqual(recorded.downloads[0].conflictAction, 'uniquify');
    uninstallChromeStub();
  }

  // 3. Failure counting: one download rejects, job still completes with failed=1.
  {
    let attempt = 0;
    const recorded = installChromeStub({
      downloadImpl: (options, cb) => {
        attempt++;
        if (attempt === 2) {
          chromeRef.chrome.runtime.lastError = { message: 'network denied' };
          cb(undefined);
          chromeRef.chrome.runtime.lastError = null;
          return;
        }
        recorded.downloads.push(options);
        cb(attempt);
      }
    });
    const dm = new DownloadManager(registry);
    const items = /** @type {any} */ (Array.from({ length: 3 }, (_, i) => makeItem(`f_${i}`, `https://cdn.test/${i}.jpg`)));

    await dm.startDownload({ platform: 'testplatform', targetName: 'T', items, format: 'individual' });
    await new Promise((resolve) => {
      const check = () => {
        if (dm.activeJob && dm.activeJob.status === 'COMPLETED') resolve();
        else setTimeout(check, 10);
      };
      check();
    });

    assert.strictEqual(dm.activeJob.completed, 2);
    assert.strictEqual(dm.activeJob.failed, 1);
    uninstallChromeStub();
  }

  // 4. Generic fallback naming when no plugin is registered.
  {
    installChromeStub();
    const dm = new DownloadManager(/** @type {any} */ ({ get: () => undefined }));
    const items = /** @type {any} */ ([makeItem('x1', 'https://cdn.test/a.jpg')]);
    await dm.startDownload({ platform: 'unknownplat', targetName: 'Gen', items, format: 'individual' });
    await new Promise((resolve) => {
      const check = () => {
        if (dm.activeJob && dm.activeJob.status === 'COMPLETED') resolve();
        else setTimeout(check, 10);
      };
      check();
    });
    assert.ok(dm.activeJob.status === 'COMPLETED');
    uninstallChromeStub();
  }

  // 5. startDownload guards.
  {
    installChromeStub();
    const dm = new DownloadManager(registry);
    const noItems = await dm.startDownload({ platform: 'testplatform', targetName: 'T', items: [] });
    assert.strictEqual(noItems.success, false);
    uninstallChromeStub();
  }

  // 6. Cancellation marks the job CANCELLED and cancels active downloads.
  {
    const recorded = installChromeStub();
    const dm = new DownloadManager(registry);
    const items = /** @type {any} */ (Array.from({ length: 20 }, (_, i) => makeItem(`c_${i}`, `https://cdn.test/${i}.jpg`)));
    await dm.startDownload({ platform: 'testplatform', targetName: 'T', items, format: 'individual' });
    await dm.cancelDownload();
    assert.strictEqual(dm.activeJob.status, 'CANCELLED');
    assert.ok(recorded.cancelled.length > 0, 'in-flight downloads should be cancelled');
    uninstallChromeStub();
  }


  // 7. Downloads are named via the `filename` option of chrome.downloads.download()
  //    (no onDeterminingFilename suggest — that fought other download managers like
  //    IDM Integration Module; see user report 2026-08-29).
  {
    const recorded = installChromeStub();
    const dm = new DownloadManager(registry);
    await dm.downloadUrl('https://cdn.test/a.jpg', 'SMD/Test/photo.jpg');
    assert.strictEqual(recorded.downloads.length, 1);
    assert.strictEqual(recorded.downloads[0].filename, 'SMD/Test/photo.jpg', 'filename must be passed to download()');
    uninstallChromeStub();
  }

  // 8. ZIP blob transfer also carries its final name in the download() options.
  {
    const recorded = installChromeStub();
    const dm = new DownloadManager(registry);
    dm.activeJob = /** @type {any} */ ({
      format: 'zip',
      status: 'PACKAGING_ZIP',
      targetName: 'Album',
      targetFilename: 'SMD/testplatform_Album_2026.zip'
    });
    await dm.downloadUrl('blob:https://extension/xyz', dm.activeJob.targetFilename);
    assert.strictEqual(recorded.downloads[0].filename, 'SMD/testplatform_Album_2026.zip');
    uninstallChromeStub();
  }

  // 9. Blob URL lifecycle (F-04): generated blob download maps url->id; completion revokes via offscreen.
  {
    const recorded = installChromeStub();
    const dm = new DownloadManager(registry);

    await dm.downloadGeneratedBlob(new Uint8Array([1, 2, 3]), 'SMD/Test/video.mp4');
    assert.strictEqual(recorded.downloads.length, 1);
    const blobUrl = recorded.downloads[0].url;
    assert.ok(blobUrl.startsWith('blob:'), 'download should use the offscreen blob URL');
    assert.ok(dm.blobUrlDownloadIds.has(blobUrl), 'blob URL should be tracked');

    dm.handleDownloadChanged({ id: recorded.downloads.length, state: { current: 'complete' } });
    const revokeMsg = recorded.offscreenMessages.find((m) => m.type === 'OFFSCREEN_REVOKE_BLOB_URLS');
    assert.ok(revokeMsg, 'offscreen revoke message should be sent on completion');
    assert.deepStrictEqual(revokeMsg.urls, [blobUrl]);
    assert.ok(!dm.blobUrlDownloadIds.has(blobUrl));
    uninstallChromeStub();
  }

  // 11. ZIP transport fidelity (22-byte empty ZIP regression): every OFFSCREEN_ADD_FILE
  //     must carry a base64 STRING. JSON round-trip in the stub guarantees a raw
  //     ArrayBuffer/Blob would have arrived as {} on the offscreen side.
  {
    const recorded = installChromeStub({
      offscreenReply: (msg) => {
        if (msg.type === 'OFFSCREEN_ADD_FILE') {
          return { ok: true, jobBytes: 100 };
        }
        if (msg.type === 'OFFSCREEN_FINISH_ZIP') {
          return { ok: true, objectUrl: 'blob:stubbed-zip', completed: 3 };
        }
        return { ok: true };
      }
    });
    const dm = new DownloadManager(registry);
    const items = /** @type {any} */ (Array.from({ length: 3 }, (_, i) =>
      makeItem(`z_${i}`, `https://cdn.test/payload_${i}.jpg`)));
    const originalFetch = anyFetch.fetch;
    anyFetch.fetch = async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new Uint8Array(12).fill(0x41).buffer
    });
    await dm.startDownload({ platform: 'testplatform', targetName: 'T', items, format: 'zip' });
    await new Promise((resolve) => {
      const check = () => {
        if (dm.activeJob && dm.activeJob.status === 'COMPLETED') resolve();
        else setTimeout(check, 10);
      };
      check();
    });

    const addMsgs = recorded.offscreenMessages.filter((m) => m.type === 'OFFSCREEN_ADD_FILE');
    assert.strictEqual(addMsgs.length, 3, 'all 3 items must reach the offscreen document');
    for (const msg of addMsgs) {
      assert.strictEqual(typeof msg.dataB64, 'string', 'ZIP payload must be a base64 string, not a binary object');
      assert.ok(msg.dataB64.length > 0, 'ZIP payload must not be empty');
      assert.ok(!('buffer' in msg) && !('data' in msg), 'no raw binary fields may be sent');
    }
    // Verify round-trip fidelity of the base64 payload for the first item.
    const decoded = Buffer.from(addMsgs[0].dataB64, 'base64');
    assert.strictEqual(decoded.length, 12, 'payload length must survive the round-trip');
    assert.ok(decoded.every((b) => b === 0x41), 'payload bytes must survive the round-trip');
    anyFetch.fetch = originalFetch;
    uninstallChromeStub();
  }

  // 12. Empty-ZIP guard: when every addFile fails, the job must FAIL — never emit
  //     a 22-byte empty archive.
  {
    installChromeStub({
      offscreenReply: (msg) => {
        if (msg.type === 'OFFSCREEN_ADD_FILE') {
          return { ok: false, reason: 'invalid_data' };
        }
        return { ok: true };
      }
    });
    const dm = new DownloadManager(registry);
    const items = /** @type {any} */ (Array.from({ length: 2 }, (_, i) => makeItem(`e_${i}`, `https://cdn.test/${i}.jpg`)));
    const originalFetch = anyFetch.fetch;
    anyFetch.fetch = async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new Uint8Array(8).fill(0x42).buffer
    });
    await dm.startDownload({ platform: 'testplatform', targetName: 'T', items, format: 'zip' });
    await new Promise((resolve) => {
      const check = () => {
        if (dm.activeJob && (dm.activeJob.status === 'FAILED' || dm.activeJob.status === 'COMPLETED')) resolve();
        else setTimeout(check, 10);
      };
      check();
    });
    assert.strictEqual(dm.activeJob.status, 'FAILED', 'all-adds-failed must fail the job, not package an empty ZIP');
    anyFetch.fetch = originalFetch;
    uninstallChromeStub();
  }

  // 13. Generated-blob transport fidelity: createBlobUrl must send base64, not a Blob.
  {
    const recorded = installChromeStub();
    const dm = new DownloadManager(registry);
    await dm.downloadGeneratedBlob(new Uint8Array([1, 2, 3, 4]), 'SMD/Test/v.mp4');
    const createMsg = recorded.offscreenMessages.find((m) => m.type === 'OFFSCREEN_CREATE_BLOB_URL');
    assert.ok(createMsg, 'CREATE_BLOB_URL message must be sent');
    assert.strictEqual(typeof createMsg.dataB64, 'string', 'blob payload must be base64 string');
    const decoded = Buffer.from(createMsg.dataB64, 'base64');
    assert.deepStrictEqual([...decoded], [1, 2, 3, 4], 'blob bytes must survive the round-trip');
    uninstallChromeStub();
  }

  // 14. ZIP path uniquify: identical archive paths get deterministic _2/_3 suffixes
  //     (two distinct Facebook photos can share one CDN basename).
  {
    const used = new Set();
    assert.strictEqual(DownloadManager.uniquifyArchivePath('Album/a_n.jpg', used), 'Album/a_n.jpg');
    assert.strictEqual(DownloadManager.uniquifyArchivePath('Album/a_n.jpg', used), 'Album/a_n_2.jpg');
    assert.strictEqual(DownloadManager.uniquifyArchivePath('Album/a_n.jpg', used), 'Album/a_n_3.jpg');
    // An explicit _2 after its own generated _2 also stays unique.
    assert.strictEqual(DownloadManager.uniquifyArchivePath('Album/a_n_2.jpg', used), 'Album/a_n_2_2.jpg');
    assert.strictEqual(DownloadManager.uniquifyArchivePath('Album/other.png', used), 'Album/other.png');
  }
};
