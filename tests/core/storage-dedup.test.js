/**
 * Social Media Downloader — Storage & Exact/Historical Deduplication Unit Tests
 * Verifies:
 * 1. StorageService persistence, settings, and memory fallback.
 * 2. Exact Deduplication (real-time CRC-32 + size signature).
 * 3. Historical Deduplication across multiple batches.
 */
import assert from 'node:assert';
import { StorageService } from '../../src/core/services/StorageService.js';
import { ArchiveService } from '../../src/core/services/ArchiveService.js';
import { DownloadManager } from '../../src/core/application/DownloadManager.js';
import { PluginRegistry } from '../../src/core/application/PluginRegistry.js';
import { MediaItemModel } from '../../src/core/domain/MediaItem.js';

export async function runStorageDedupTests() {
  console.log('• Running: Storage & Exact/Historical Deduplication Tests...');

  // 1. StorageService basic get/set/remove
  {
    await StorageService.set('test.key', { foo: 'bar' });
    const val = await StorageService.get('test.key');
    assert.deepStrictEqual(val, { foo: 'bar' });

    await StorageService.remove('test.key');
    const removedVal = await StorageService.get('test.key', 'default');
    assert.strictEqual(removedVal, 'default');
  }

  // 2. StorageService settings persistence
  {
    await StorageService.saveSettings({ deduplicate: true, historicalDedup: true });
    let settings = await StorageService.getSettings();
    assert.strictEqual(settings.deduplicate, true);
    assert.strictEqual(settings.historicalDedup, true);

    await StorageService.saveSettings({ historicalDedup: false });
    settings = await StorageService.getSettings();
    assert.strictEqual(settings.deduplicate, true);
    assert.strictEqual(settings.historicalDedup, false);

    // Reset settings
    await StorageService.saveSettings({ deduplicate: false, historicalDedup: false });
  }

  // 3. Historical Deduplication Signature Registry
  {
    await StorageService.clearHistory();
    const sig1 = '12345678_1024';
    const sig2 = '87654321_2048';

    assert.strictEqual(await StorageService.isHistoricallyDownloaded(sig1), false);
    await StorageService.addHistoricalSignatures([sig1]);
    assert.strictEqual(await StorageService.isHistoricallyDownloaded(sig1), true);
    assert.strictEqual(await StorageService.isHistoricallyDownloaded(sig2), false);

    await StorageService.addHistoricalSignatures([sig2]);
    assert.strictEqual(await StorageService.isHistoricallyDownloaded(sig2), true);

    await StorageService.clearHistory();
    assert.strictEqual(await StorageService.isHistoricallyDownloaded(sig1), false);
  }

  // Snapshot invalidation and a late writer must not undo a user clear.
  {
    await StorageService.addHistoricalSignatures(['old']);
    const snapshot = await StorageService.getHistorySnapshot();
    assert.equal(snapshot.signatures.has('old'), true);
    await StorageService.clearHistory();
    await StorageService.addHistoricalSignatures(['late'], snapshot.revision);
    assert.notEqual(snapshot.revision, StorageService.historyRevision);
    assert.deepEqual(await StorageService.get('core.dedup_history'), []);
  }

  {
    const data = new Uint8Array([8, 9]);
    await StorageService.addHistoricalSignatures([ArchiveService.getSignature(data)]);
    const manager = new DownloadManager(/** @type {any} */ ({}));
    manager.scheduleBadgeClear = () => {};
    manager.broadcastProgress = () => {};
    manager.updateBadge = () => {};
    manager.downloadGeneratedBlob = async () => 1;
    await manager.processIndividualDownloads({ resolveMedia: async () => {
      await StorageService.clearHistory();
      return { kind: 'generated', data };
    } }, 'test', 'test', /** @type {any} */ ([{ id: 'cleared' }]), { deduplicate: true, historicalDedup: true });
    assert.equal(manager.activeJob.completed, 1, 'cleared historical entry must be downloadable');
    assert.equal(manager.activeJob.skippedDuplicates, 0);
    assert.deepEqual(await StorageService.get('core.dedup_history'), [], 'old job must not repopulate cleared history');
  }

  // 4. ArchiveService CRC-32 & signature generation
  {
    const dataA = new Uint8Array([1, 2, 3, 4, 5]);
    const dataB = new Uint8Array([1, 2, 3, 4, 5]);
    const dataC = new Uint8Array([5, 4, 3, 2, 1]);

    const crcA = ArchiveService.computeCrc32(dataA);
    const crcB = ArchiveService.computeCrc32(dataB);
    const crcC = ArchiveService.computeCrc32(dataC);

    assert.strictEqual(crcA, crcB, 'Identical bytes must produce identical CRC-32');
    assert.notStrictEqual(crcA, crcC, 'Different bytes should produce different CRC-32');

    const sigA = ArchiveService.getSignature(dataA);
    const sigB = ArchiveService.getSignature(dataB);
    assert.strictEqual(sigA, sigB);
    assert.strictEqual(sigA, `${crcA}_5`);
  }

  // 5. DownloadManager Exact Deduplication in ZIP mode
  {
    const recordedOffscreen = [];
    const recordedDownloads = [];

    // Install mock chrome global
    // @ts-ignore
    globalThis.chrome = {
      action: { setBadgeText: () => {}, setBadgeBackgroundColor: () => {} },
      runtime: {
        lastError: null,
        sendMessage: (msg, cb) => {
          recordedOffscreen.push(msg);
          if (msg.type === 'OFFSCREEN_BEGIN_ZIP') cb?.({ ok: true, sessionId: 'test-session' });
          else if (msg.type === 'OFFSCREEN_BEGIN_ENTRY') cb?.({ ok: true, entryId: `entry-${recordedOffscreen.length}` });
          else if (msg.type === 'OFFSCREEN_WRITE_CHUNK') cb?.({ ok: true });
          else if (msg.type === 'OFFSCREEN_END_ENTRY') cb?.({ ok: true });
          else if (msg.type === 'OFFSCREEN_FINISH_ZIP') cb?.({ ok: true, objectUrl: 'blob:test-zip' });
          else cb?.({ ok: true });
        }
      },
      downloads: {
        download: (opts, cb) => {
          recordedDownloads.push(opts);
          cb?.(101);
        },
        search: () => {},
        show: () => {}
      }
    };

    const registry = new PluginRegistry();
    const mockPlugin = {
      id: 'mock',
      version: '1.0.0',
      matches: () => true,
      getCapabilities: () => ({}),
      getArchivePath: (item) => `media_${item.id}.jpg`,
      resolveMedia: async (item) => {
        // item 1 and item 2 return identical data
        if (item.id === 'item_1' || item.id === 'item_2') {
          return { kind: 'generated', data: new Uint8Array([10, 20, 30, 40]) };
        }
        // item 3 returns different data
        return { kind: 'generated', data: new Uint8Array([50, 60, 70, 80, 90]) };
      }
    };
    registry.register(mockPlugin);

    const dm = new DownloadManager(registry);

    // Test with deduplicate: true
    const items = [
      MediaItemModel.create({ id: 'item_1', platform: 'mock', type: 'image', sourceType: 'post', url: 'https://example.com/1.jpg' }),
      MediaItemModel.create({ id: 'item_2', platform: 'mock', type: 'image', sourceType: 'post', url: 'https://example.com/2.jpg' }),
      MediaItemModel.create({ id: 'item_3', platform: 'mock', type: 'image', sourceType: 'post', url: 'https://example.com/3.jpg' })
    ];

    await dm.processZipDownload(mockPlugin, 'mock', 'TestTarget', items, { deduplicate: true });

    const addFileMsgs = recordedOffscreen.filter(m => m.type === 'OFFSCREEN_END_ENTRY');
    // item_2 is identical to item_1, so only 2 files should be added
    assert.strictEqual(addFileMsgs.length, 2, 'Duplicate file must not be added to ZIP');
    assert.strictEqual(dm.activeJob?.skippedDuplicates, 1, 'skippedDuplicates must equal 1');
    assert.strictEqual(dm.activeJob?.completed, 2, '2 unique items completed');

    // Clean up chrome stub
    // @ts-ignore
    delete globalThis.chrome;
  }

  // 6. DownloadManager Historical Deduplication
  {
    await StorageService.clearHistory();

    const data1 = new Uint8Array([11, 22, 33]);
    const sig1 = ArchiveService.getSignature(data1);
    // Pre-populate history with sig1
    await StorageService.addHistoricalSignatures([sig1]);

    const recordedOffscreen = [];
    const recordedDownloads = [];

    // @ts-ignore
    globalThis.chrome = {
      action: { setBadgeText: () => {}, setBadgeBackgroundColor: () => {} },
      runtime: {
        lastError: null,
        sendMessage: (msg, cb) => {
          recordedOffscreen.push(msg);
          if (msg.type === 'OFFSCREEN_BEGIN_ZIP') cb?.({ ok: true, sessionId: 'test-session' });
          else if (msg.type === 'OFFSCREEN_BEGIN_ENTRY') cb?.({ ok: true, entryId: `entry-${recordedOffscreen.length}` });
          else if (msg.type === 'OFFSCREEN_WRITE_CHUNK') cb?.({ ok: true });
          else if (msg.type === 'OFFSCREEN_END_ENTRY') cb?.({ ok: true });
          else if (msg.type === 'OFFSCREEN_FINISH_ZIP') cb?.({ ok: true, objectUrl: 'blob:test-zip' });
          else cb?.({ ok: true });
        }
      },
      downloads: {
        download: (opts, cb) => {
          recordedDownloads.push(opts);
          cb?.(102);
        },
        search: () => {},
        show: () => {}
      }
    };

    const registry = new PluginRegistry();
    const mockPlugin = {
      id: 'mock',
      version: '1.0.0',
      matches: () => true,
      getCapabilities: () => ({}),
      getArchivePath: (item) => `media_${item.id}.jpg`,
      resolveMedia: async (item) => {
        if (item.id === 'item_hist') {
          return { kind: 'generated', data: data1 }; // in history
        }
        return { kind: 'generated', data: new Uint8Array([99, 88, 77]) }; // new
      }
    };
    registry.register(mockPlugin);

    const dm = new DownloadManager(registry);
    const items = [
      MediaItemModel.create({ id: 'item_hist', platform: 'mock', type: 'image', sourceType: 'post', url: 'https://example.com/hist.jpg' }),
      MediaItemModel.create({ id: 'item_new', platform: 'mock', type: 'image', sourceType: 'post', url: 'https://example.com/new.jpg' })
    ];

    await dm.processZipDownload(mockPlugin, 'mock', 'TestTarget', items, { deduplicate: true, historicalDedup: true });

    const addFileMsgs = recordedOffscreen.filter(m => m.type === 'OFFSCREEN_END_ENTRY');
    assert.strictEqual(addFileMsgs.length, 1, 'Historically downloaded item must be skipped');
    assert.strictEqual(dm.activeJob?.skippedDuplicates, 1, 'skippedDuplicates must equal 1');

    // Verify item_new was saved into history
    const dataNew = new Uint8Array([99, 88, 77]);
    const sigNew = ArchiveService.getSignature(dataNew);
    assert.strictEqual(await StorageService.isHistoricallyDownloaded(sigNew), true, 'New item must be saved to history');

    // Clean up chrome stub
    // @ts-ignore
    delete globalThis.chrome;
    await StorageService.clearHistory();
  }
  // A large job performs one history read for lookups, not one per media item.
  {
    const originalGet = StorageService.get;
    const originalCreate = ArchiveService.createBlobUrl;
    const originalChrome = /** @type {any} */ (globalThis).chrome;
    let reads = 0;
    let resolveCount = 0;
    const payload = new Uint8Array([4, 3, 2, 1]);
    await StorageService.clearHistory();
    await StorageService.addHistoricalSignatures([ArchiveService.getSignature(payload)]);
    StorageService.get = async (key, fallback) => {
      if (key === 'core.dedup_history') reads++;
      return originalGet.call(StorageService, key, fallback);
    };
    const manager = new DownloadManager(/** @type {any} */ ({}));
    manager.scheduleBadgeClear = () => {};
    manager.broadcastProgress = () => {};
    manager.updateBadge = () => {};
    try {
      for (const count of [1000, 10000]) {
        reads = 0;
        const items = Array.from({ length: count }, (_, id) => ({ id: String(id) }));
        await manager.processIndividualDownloads({ resolveMedia: async () => {
          resolveCount++;
          return { kind: 'generated', data: payload };
        } }, 'test', 'test', /** @type {any} */ (items), { deduplicate: true, historicalDedup: true });
        assert.equal(reads, 1);
        assert.equal(manager.activeJob.skippedDuplicates, count);
        assert.equal(manager.activeJob.completed, 0);
        assert.equal(manager.activeJob.failed, 0);
      }
      assert.equal(resolveCount, 11000);
    } finally {
      StorageService.get = originalGet;
      ArchiveService.createBlobUrl = originalCreate;
      /** @type {any} */ (globalThis).chrome = originalChrome;
      await StorageService.clearHistory();
    }
  }

}
