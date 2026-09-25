/**
 * Social Media Downloader — Download Manager (Core Application Layer)
 * Coordinates download queue, concurrency, ZIP packaging delegation, cancellation, and progress updates.
 * ZERO platform conditionals: relies entirely on plugin contracts and capabilities.
 */
import { DownloadJobModel } from '../domain/DownloadJob.js';
import { FilenameService } from '../services/FilenameService.js';
import { ArchiveService } from '../services/ArchiveService.js';
import { StorageService } from '../services/StorageService.js';
import { Logger } from '../services/LoggingService.js';

export class DownloadManager {
  /**
   * @param {import('./PluginRegistry.js').PluginRegistry} pluginRegistry
   */
  constructor(pluginRegistry) {
    this.abortController = new AbortController();
    this.registry = pluginRegistry;
    this.logger = new Logger('core:download');

    /** @type {import('../domain/DownloadJob.js').DownloadJob | null} */
    this.activeJob = null;

    /** @type {Set<number>} */
    this.activeDownloadIds = new Set();

    /** @type {Map<number, { state: string, accounted: boolean }>} */
    this.downloadLedger = new Map();

    /** @type {Map<number, string>} Chrome download id -> Blob URL (blob URLs produced by the offscreen document) */
    this.downloadBlobUrls = new Map();

    /** @type {Set<string>} */
    this.pendingBlobUrls = new Set();

    /** @type {ReturnType<typeof setTimeout> | null} */
    this.badgeClearTimer = null;
    this._restorePromise = null;
    this._reconcilePromise = null;
    this._stateWrites = Promise.resolve();
    this.stateWasRestored = false;
  }

  async restoreState() {
    if (!this._restorePromise) {
      this._restorePromise = (async () => {
        const saved = await StorageService.get('core.active_job', null);
        if (!saved?.job || !DownloadJobModel.isActive(saved.job)) return;
        this.stateWasRestored = true;
        this.activeJob = saved.job;
        this.activeDownloadIds = new Set(
          Array.isArray(saved.downloadIds) ? saved.downloadIds.filter((id) => Number.isInteger(id)) : []
        );
        for (const entry of Array.isArray(saved.downloadLedger) ? saved.downloadLedger : []) {
          if (Number.isInteger(entry?.id) && typeof entry.state === 'string') {
            const accounted = entry.accounted === true;
            this.downloadLedger.set(entry.id, { state: entry.state, accounted });
            if (accounted) this.activeDownloadIds.delete(entry.id);
            else if (entry.state === 'in_progress') this.activeDownloadIds.add(entry.id);
          }
        }
      })().catch((error) => this.logger.warn('Download state recovery failed:', error));
    }
    return this._restorePromise;
  }

  persistState() {
    const job = this.activeJob;
    const snapshot = job && DownloadJobModel.isActive(job)
      ? {
          job: { ...job },
          downloadIds: [...this.activeDownloadIds],
          downloadLedger: [...this.downloadLedger].map(([id, entry]) => ({ id, ...entry }))
        }
      : null;
    this._stateWrites = this._stateWrites.then(() => snapshot
      ? StorageService.set('core.active_job', snapshot)
      : StorageService.remove('core.active_job')
    ).then((ok) => {
      if (ok === false) throw new Error('storage_write_failed');
    }).catch((error) => {
      this.logger.warn('Download state persistence failed:', error);
    });
    return this._stateWrites;
  }

  accountDownload(downloadId, state) {
    if (downloadId == null) return;
    this.downloadLedger.set(downloadId, { state, accounted: true });
    this.activeDownloadIds.delete(downloadId);
  }

  async reconcileState() {
    if (this._reconcilePromise) return this._reconcilePromise;
    this._reconcilePromise = this._reconcileState().finally(() => { this._reconcilePromise = null; });
    return this._reconcilePromise;
  }

  async _reconcileState() {
    await this.restoreState();
    const job = this.activeJob;
    // The normal worker has live completion listeners. Reconciliation is only
    // for state loaded after a service-worker restart; otherwise a status poll
    // must not turn a currently resolving ZIP/individual job into a failure.
    if (!this.stateWasRestored || !job || !DownloadJobModel.isActive(job)) return job;
    const ids = [...new Set([
      ...this.activeDownloadIds,
      ...[...this.downloadLedger].filter(([, entry]) => !entry.accounted).map(([id]) => id)
    ])];
    const states = new Map();
    const searchFailures = new Set();
    if (typeof chrome !== 'undefined' && chrome.downloads?.search) {
      await Promise.all(ids.map(async (id) => {
        try {
          const items = await chrome.downloads.search({ id });
          if (items?.[0]?.state) states.set(id, items[0].state);
        } catch (error) {
          searchFailures.add(id);
          this.logger.warn(`Unable to reconcile download ${id}:`, error);
        }
      }));
    }
    if (this.activeJob !== job) return this.activeJob;

    if (job.format === 'zip') {
      job.status = 'FAILED';
      job.error = 'restart_unrecoverable_zip';
      for (const id of ids) {
        if (!states.has(id) || states.get(id) === 'in_progress') {
          try { chrome.downloads.cancel(id, () => {}); } catch (error) { this.logger.warn('Restart download cancellation failed:', error); }
        }
      }
      this.activeDownloadIds.clear();
      await this.persistState();
      return job;
    }

    for (const id of ids) {
      if (!states.has(id) && !searchFailures.has(id)) this.activeDownloadIds.delete(id);
    }
    let interrupted = false;
    for (const id of ids) {
      const state = states.get(id);
      if (state !== 'complete' && state !== 'interrupted') continue;
      const entry = this.downloadLedger.get(id);
      if (entry?.accounted) continue;
      this.downloadLedger.set(id, { state, accounted: true });
      this.activeDownloadIds.delete(id);
      if (state === 'complete') {
        job.completed++;
        job.receiptDownloadId = id;
      } else {
        job.failed++;
        interrupted = true;
      }
    }
    if (this.activeJob !== job) return this.activeJob;
    const reconciledItems = job.completed + job.failed + (job.skippedDuplicates || 0);
    if (this.activeDownloadIds.size === 0 && reconciledItems < job.total) {
      job.status = 'FAILED';
      job.error = 'restart_missing_downloads';
    } else if (this.activeDownloadIds.size === 0 && reconciledItems >= job.total) {
      job.status = interrupted || (job.completed === 0 && job.failed > 0) ? 'FAILED' : 'COMPLETED';
      if (interrupted) job.error = 'download_interrupted';
    }
    await this.persistState();
    return job;
  }

  /**
   * Updates browser action badge with real progress (previously a no-op).
   */
  updateBadge(text, color = '#E1306C') {
    try {
      if (typeof chrome !== 'undefined' && chrome.action) {
        if (text) {
          chrome.action.setBadgeText({ text: String(text) });
          chrome.action.setBadgeBackgroundColor({ color: String(color) });
        } else {
          chrome.action.setBadgeText({ text: '' });
        }
      }
    } catch (e) {}
  }

  /**
   * Broadcasts current job progress to runtime and active tabs.
   */
  broadcastProgress() {
    if (!this.activeJob) return;
    const payload = {
      type: 'DOWNLOAD_PROGRESS_UPDATE',
      job: { ...this.activeJob }
    };

    try {
      if (typeof chrome !== 'undefined' && chrome.runtime) {
        chrome.runtime.sendMessage(payload).catch(() => {});
      }
    } catch (e) {}

    try {
      if (typeof chrome !== 'undefined' && chrome.tabs) {
        chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
          if (!tabs) return;
          tabs.forEach((tab) => {
            if (tab.id) {
              chrome.tabs.sendMessage(tab.id, payload).catch(() => {});
            }
          });
        });
      }
    } catch (e) {}
  }

  /**
   * Reads the active job status as a plain string. TS narrowing is unsound here:
   * cancelDownload() mutates the status concurrently from another message turn.
   * @returns {string | null}
   */
  currentJobStatus() {
    return this.activeJob ? /** @type {string} */ (this.activeJob.status) : null;
  }

  /**
   * Keeps active download IDs synchronized and releases blob URLs when their
   * download reaches a terminal state (revoke on completion, not eagerly).
   * @param {any} delta
   */
  handleDownloadChanged(delta) {
    const state = delta?.state?.current;
    if (!delta || !['complete', 'interrupted'].includes(state)) return;

    const previous = this.downloadLedger.get(delta.id);
    const wasTracked = this.activeDownloadIds.has(delta.id) || !!previous;
    if (wasTracked) {
      const wasAccounted = previous?.accounted === true;
      this.downloadLedger.set(delta.id, { state, accounted: wasAccounted });
      this.activeDownloadIds.delete(delta.id);

      // A restarted worker has no item promise left to account for a terminal
      // browser event. Account that one pending ID here; the live worker keeps
      // this false and its item loop performs the accounting after await.
      if (this.stateWasRestored && !wasAccounted && this.activeJob && DownloadJobModel.isActive(this.activeJob)) {
        this.downloadLedger.set(delta.id, { state, accounted: true });
        if (this.activeJob.format === 'zip') {
          this.activeJob.status = state === 'complete' ? 'COMPLETED' : 'FAILED';
          if (state === 'interrupted') this.activeJob.error = 'download_interrupted';
        } else if (state === 'complete') {
          this.activeJob.completed++;
          this.activeJob.receiptDownloadId = delta.id;
        } else {
          this.activeJob.failed++;
          this.activeJob.error = 'download_interrupted';
        }
        const accountedItems = this.activeJob.completed + this.activeJob.failed + (this.activeJob.skippedDuplicates || 0);
        if (this.activeJob.format === 'individual' && this.activeDownloadIds.size === 0) {
          this.activeJob.status = accountedItems >= this.activeJob.total && this.activeJob.failed === 0
            ? 'COMPLETED'
            : 'FAILED';
          if (this.activeJob.status === 'FAILED' && !this.activeJob.error) {
            this.activeJob.error = 'restart_missing_downloads';
          }
        }
      }
      this.persistState();
    }

    const blobUrl = this.downloadBlobUrls.get(delta.id);
    if (blobUrl) {
      void ArchiveService.revokeBlobUrls([blobUrl]).then(() => {
        this.downloadBlobUrls.delete(delta.id);
        this.pendingBlobUrls.delete(blobUrl);
      }).catch((err) => {
        this.logger.warn('Failed to revoke completed download blob URL:', err);
      });
    }
  }

  /**
   * Initiates a download batch.
   * @param {Object} params
   * @param {string} params.platform
   * @param {string} params.targetName
   * @param {import('../domain/MediaItem.js').MediaItem[]} params.items
   * @param {import('../domain/DownloadJob.js').DownloadFormat} [params.format='individual']
   * @param {Object} [params.options]
   * @param {boolean} [params.options.deduplicate]
   * @param {boolean} [params.options.historicalDedup]
   * @returns {Promise<{ success: boolean, message?: string, error?: string }>}
   */
  async startDownload({ platform, targetName, items, format = 'individual', options }) {
    await this.reconcileState();
    if (!items || !items.length) {
      return { success: false, error: 'No items provided' };
    }

    if (this.activeJob && DownloadJobModel.isActive(this.activeJob)) {
      return { success: false, error: 'A download job is already in progress' };
    }

    const plugin = this.registry.get(platform);
    const safeTargetName = FilenameService.sanitize(targetName || 'Media_Collection', 80, 'Media_Collection');

    if (this.badgeClearTimer) {
      clearTimeout(this.badgeClearTimer);
      this.badgeClearTimer = null;
    }

    const settings = await StorageService.getSettings();
    if (this.activeJob && DownloadJobModel.isActive(this.activeJob)) {
      return { success: false, error: 'A download job is already in progress' };
    }
    const deduplicate = options && typeof options.deduplicate === 'boolean' ? options.deduplicate : settings.deduplicate;
    const historicalDedup = deduplicate && (options && typeof options.historicalDedup === 'boolean' ? options.historicalDedup : settings.historicalDedup);

    if (format === 'zip') {
      this.processZipDownload(plugin, platform, safeTargetName, items, { deduplicate, historicalDedup }).catch((err) => {
        this.logger.error('ZIP download error:', err);
      });
    } else {
      this.processIndividualDownloads(plugin, platform, safeTargetName, items, { deduplicate, historicalDedup }).catch((err) => {
        this.logger.error('Individual download error:', err);
      });
    }

    return { success: true, message: 'Download initiated' };
  }

  /**
   * Builds the per-item destination filename via the plugin contract, with a generic fallback.
   * @param {any} plugin
   * @param {any} item
   * @param {string} targetName
   * @param {number} index
   * @returns {string}
   */
  resolveFilename(plugin, item, targetName, index) {
    let filename;
    if (plugin && typeof plugin.getFilename === 'function') {
      filename = plugin.getFilename(item, { targetName, index: index + 1 });
    } else {
      const baseName = item.filename || item.id || `media_${index + 1}`;
      const ext = item.extension || (item.type === 'video' ? 'mp4' : 'jpg');
      filename = `SMD/${targetName}/${FilenameService.sanitize(baseName)}.${ext}`;
    }
    return FilenameService.sanitizePath(filename, `SMD/${targetName}/media_${index + 1}.bin`);
  }

  /**
   * Keeps ZIP entry paths unique within one job. Genuine collisions exist: two
   * distinct media items can share a CDN basename (observed in real captures),
   * so identical entry paths would extract ambiguously from the archive. Chrome
   * uniquifies individual downloads via conflictAction, but a ZIP has no such
   * mechanism, so we deduplicate the entry paths here.
   * @param {string} path
   * @param {Set<string>} usedPaths
   * @returns {string}
   */
  static uniquifyArchivePath(path, usedPaths) {
    if (!usedPaths.has(path)) {
      usedPaths.add(path);
      return path;
    }
    const lastDot = path.lastIndexOf('.') > path.lastIndexOf('/') + 1 ? path.lastIndexOf('.') : -1;
    const stem = lastDot > 0 ? path.slice(0, lastDot) : path;
    const ext = lastDot > 0 ? path.slice(lastDot) : '';
    let n = 2;
    let candidate = `${stem}_${n}${ext}`;
    while (usedPaths.has(candidate)) {
      n++;
      candidate = `${stem}_${n}${ext}`;
    }
    usedPaths.add(candidate);
    return candidate;
  }

  /**
   * Builds the per-item archive path via the plugin contract, with a generic fallback.
   * @param {any} plugin
   * @param {any} item
   * @param {string} targetName
   * @param {number} index
   * @returns {string}
   */
  resolveArchivePath(plugin, item, targetName, index) {
    let archivePath;
    if (plugin && typeof plugin.getArchivePath === 'function') {
      archivePath = plugin.getArchivePath(item, { targetName, index: index + 1 });
    } else {
      const baseName = item.filename || item.id || `media_${index + 1}`;
      const ext = item.extension || (item.type === 'video' ? 'mp4' : 'jpg');
      archivePath = `${targetName}/${FilenameService.sanitize(baseName)}.${ext}`;
    }
    return FilenameService.sanitizePath(archivePath, `${targetName}/media_${index + 1}.bin`);
  }

  /**
   * Normalizes binary resolver output before deduplication. Resolvers may
   * return any supported binary view, not only Uint8Array.
   * @param {unknown} data
   * @returns {Promise<Uint8Array | null>}
   */
  static async toUint8Array(data) {
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (data && typeof data === 'object' && ArrayBuffer.isView(data)) {
      return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }
    if (typeof Blob !== 'undefined' && data instanceof Blob) {
      return new Uint8Array(await data.arrayBuffer());
    }
    return null;
  }

  scheduleBadgeClear(job) {
    if (this.badgeClearTimer) clearTimeout(this.badgeClearTimer);
    this.badgeClearTimer = setTimeout(() => {
      this.badgeClearTimer = null;
      if (this.activeJob === job) this.updateBadge('');
    }, 5000);
  }

  /**
   * Downloads one item through the plugin resolver (generated artifacts)
   * or via a direct URL. The decision of how to resolve an item is owned by the
   * plugin; Core only executes the resulting DownloadArtifact.
   * @param {any} plugin
   * @param {string} targetFilename
   * @returns {Promise<number>} chrome download id
   */
  async downloadItem(plugin, item, targetFilename, signal = undefined) {
    // 1. Plugin resolver path — if the plugin provides resolveMedia(), call it and
    //    execute the returned DownloadArtifact (direct / generated).
    if (plugin && typeof plugin.resolveMedia === 'function') {
      const artifact = await plugin.resolveMedia(item, { signal });
      if (artifact && artifact.kind === 'direct' && artifact.source?.url) {
        return this.downloadUrl(artifact.source.url, targetFilename, signal);
      }
      if (artifact && (artifact.kind === 'generated' || artifact.data)) {
        return this.downloadGeneratedBlob(artifact.data, targetFilename, signal);
      }
      throw new Error(`Unsupported artifact kind: ${artifact?.kind || 'unknown'}`);
    }

    // 2. Direct URL download
    const downloadUrl = item.downloadUrl || item.url;
    if (!downloadUrl) {
      throw new Error('Item has no download URL');
    }
    return this.downloadUrl(downloadUrl, targetFilename, signal);
  }
  /**
   * Downloads a URL via chrome.downloads using the requested filename.
   * @param {string} url
   * @param {string} targetFilename
   * @returns {Promise<number>}
   */
  downloadUrl(url, targetFilename, signal = undefined) {
    return new Promise((resolve, reject) => {
      signal?.throwIfAborted();
      if (typeof chrome === 'undefined' || !chrome.downloads) {
        reject(new Error('chrome.downloads unavailable'));
        return;
      }
      chrome.downloads.download({
        url,
        filename: targetFilename,
        saveAs: false,
        conflictAction: 'uniquify'
      }, (downloadId) => {
        if (chrome.runtime.lastError || !downloadId) {
          reject(new Error(chrome.runtime.lastError?.message || 'Download failed'));
        } else {
          this.activeDownloadIds.add(downloadId);
          this.downloadLedger.set(downloadId, { state: 'in_progress', accounted: false });
          this.persistState();
          if (signal?.aborted) {
            // The browser already owns the URL. Keep its backing resource until
            // cancellation is confirmed by a terminal event or reconciliation.
            chrome.downloads.cancel(downloadId, () => {
              if (chrome.runtime.lastError) this.logger.warn('Browser download cancellation failed');
            });
          }
          resolve(downloadId);
        }
      });
    });
  }

  /**
   * Materializes a generated blob (plugin-produced binary, e.g. a muxed video)
   * as an offscreen blob URL and downloads it.
   * The service worker has no URL.createObjectURL; the offscreen document creates it for us.
   * @param {Blob | ArrayBuffer | Uint8Array} data
   * @param {string} targetFilename
   * @returns {Promise<number>} chrome download id
   */
  async downloadGeneratedBlob(data, targetFilename, signal = undefined) {
    const createRes = await ArchiveService.createBlobUrl(data, (data instanceof Blob && data.type) || 'application/octet-stream', signal);
    if (!createRes || !createRes.ok || !createRes.objectUrl) {
      throw new Error(createRes?.reason || 'Offscreen blob URL creation failed');
    }
    return this.downloadBlobUrl(createRes.objectUrl, targetFilename, signal);
  }

  async downloadBlobUrl(objectUrl, targetFilename, signal = undefined) {
    this.pendingBlobUrls.add(objectUrl);
    try {
      const downloadId = await this.downloadUrl(objectUrl, targetFilename, signal);
      this.downloadBlobUrls.set(downloadId, objectUrl);
      // Terminal events can precede the download() callback. Reconcile once the
      // URL is registered; startup recovery covers worker termination here.
      if (chrome.downloads.search) chrome.downloads.search({ id: downloadId }, (items) => {
        if (!chrome.runtime.lastError && items?.[0]?.state !== 'in_progress' && items?.[0]?.state) {
          this.handleDownloadChanged({ id: downloadId, state: { current: items[0].state } });
        }
      });
      return downloadId;
    } catch (err) {
      this.pendingBlobUrls.delete(objectUrl);
      try {
        await ArchiveService.revokeBlobUrls([objectUrl]);
      } catch (revokeErr) {
        this.logger.warn('Failed to revoke generated blob URL after download failure:', revokeErr);
      }
      throw err;
    }
  }

  /** Wait for disk completion, including an event that preceded registration.
   * @param {number} downloadId
   * @param {AbortSignal} signal
   * @returns {Promise<void>}
   */
  waitForDownloadCompletion(downloadId, signal) {
    return new Promise((resolve, reject) => {
      signal.throwIfAborted();
      if (typeof chrome === 'undefined' || !chrome.downloads?.onChanged || !chrome.downloads.search) {
        reject(new Error('Download completion tracking unavailable'));
        return;
      }
      const finish = (error = null) => {
        chrome.downloads.onChanged.removeListener(onChanged);
        signal.removeEventListener('abort', onAbort);
        if (error) reject(error); else resolve();
      };
      const onAbort = () => finish(signal.reason || new Error('Download cancelled'));
      const onChanged = (delta) => {
        if (delta.id !== downloadId) return;
        if (delta.state?.current === 'complete') {
          this.handleDownloadChanged(delta);
          finish();
        }
        if (delta.state?.current === 'interrupted') {
          this.handleDownloadChanged(delta);
          finish(new Error('Browser download interrupted'));
        }
      };
      chrome.downloads.onChanged.addListener(onChanged);
      signal.addEventListener('abort', onAbort, { once: true });
      try {
        chrome.downloads.search({ id: downloadId }, (items) => {
          if (chrome.runtime.lastError || !items?.length) {
            finish(new Error('Cannot verify browser download'));
          } else onChanged({ id: downloadId, state: { current: items[0].state } });
        });
      } catch (error) { finish(error); }
    });
  }

  /**
   * Processes individual file downloads.
   * @param {any} plugin
   * @param {string} platform
   * @param {string} targetName
   * @param {import('../domain/MediaItem.js').MediaItem[]} items
   * @param {Object} [options]
   * @param {boolean} [options.deduplicate]
   * @param {boolean} [options.historicalDedup]
   */
  async processIndividualDownloads(plugin, platform, targetName, items, { deduplicate = false, historicalDedup = false } = {}) {
    const total = items.length;
    const sessionSignatures = new Set();
    let skippedDuplicates = 0;
    let interrupted = false;
    this.stateWasRestored = false;
    this.activeDownloadIds.clear();
    this.downloadLedger.clear();

    this.activeJob = DownloadJobModel.create({
      platform,
      targetName,
      format: 'individual',
      total
    });
    const job = this.activeJob;
    this.abortController = new AbortController();
    const signal = this.abortController.signal;
    const historyRevision = StorageService.historyRevision;
    const history = historicalDedup ? await StorageService.getHistorySnapshot() : null;
    if (signal.aborted) return;
    job.status = 'DOWNLOADING';
    this.persistState();

    this.updateBadge(`0/${total}`);
    this.broadcastProgress();

    // ponytail: one full payload at a time with dedup; incremental OPFS hashing if one file exceeds memory.
    const concurrency = deduplicate ? 1 : 6;
    let index = 0;

    const worker = async () => {
      while (index < items.length) {
        if (!job || signal.aborted) break;
        const currentIndex = index++;
        const item = items[currentIndex];

        let ok = false;
        let downloadId = null;
        let itemInterrupted = false;
        try {
          const targetFilename = this.resolveFilename(plugin, item, targetName, currentIndex);
          if (deduplicate) {
            let bytes = null;
            if (plugin && typeof plugin.resolveMedia === 'function') {
              const artifact = await plugin.resolveMedia(item, { signal });
              if (artifact && (artifact.kind === 'generated' || artifact.data)) {
                bytes = await DownloadManager.toUint8Array(artifact.data);
              } else if (artifact && artifact.kind === 'direct' && artifact.source?.url) {
                const response = await fetch(artifact.source.url, { mode: 'cors', signal });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                bytes = new Uint8Array(await response.arrayBuffer());
              }
            } else {
              const response = await fetch(item.downloadUrl || item.url, { mode: 'cors', signal });
              if (!response.ok) throw new Error(`HTTP ${response.status}`);
              bytes = new Uint8Array(await response.arrayBuffer());
            }

            signal.throwIfAborted();
            if (bytes) {
              const sig = await ArchiveService.getSignature(bytes);
              if (sessionSignatures.has(sig) || (history && history.revision === StorageService.historyRevision && history.signatures.has(sig))) {
                skippedDuplicates++;
                if (job) {
                  job.skippedDuplicates = skippedDuplicates;
                }
                this.updateBadge(`${job.completed + skippedDuplicates}/${items.length}`);
                this.broadcastProgress();
                continue;
              }
              downloadId = await this.downloadGeneratedBlob(bytes, targetFilename, signal);
              await this.waitForDownloadCompletion(downloadId, signal);
              sessionSignatures.add(sig);
              if (historicalDedup) await StorageService.addHistoricalSignatures([sig], historyRevision);
              ok = true;
            } else {
              downloadId = await this.downloadItem(plugin, item, targetFilename, signal);
              await this.waitForDownloadCompletion(downloadId, signal);
              ok = true;
            }
          } else {
            downloadId = await this.downloadItem(plugin, item, targetFilename, signal);
            await this.waitForDownloadCompletion(downloadId, signal);
            ok = true;
          }
        } catch (err) {
          if (signal.aborted) return;
          if (/interrupted/i.test(String(err?.message || err))) {
            itemInterrupted = true;
            interrupted = true;
          }
          this.logger.warn(`Failed to download item ${item.id || currentIndex}:`, err);
        }


        if (signal.aborted) return;
        // Each worker accounts for its item once, with no await between updates.
        if (job) {
          if (ok) job.completed++; else job.failed++;
          const completed = job.completed;
          if (ok && downloadId != null) {
            job.receiptDownloadId = downloadId;
          }
          job.updatedAt = Date.now();
          this.updateBadge(`${completed + skippedDuplicates}/${total}`);
          this.broadcastProgress();
          if (downloadId != null && (ok || itemInterrupted)) this.accountDownload(downloadId, ok ? 'complete' : 'interrupted');
          this.persistState();
        }

        await new Promise((r) => setTimeout(r, 40));
      }
    };

    const workers = [];
    for (let i = 0; i < Math.min(concurrency, items.length); i++) {
      workers.push(worker());
    }

    await Promise.all(workers);

    if (signal.aborted) {
      if (this.activeJob !== job) return;
      this.updateBadge('');
      this.broadcastProgress();
      return;
    }

    if (signal.aborted || this.activeJob !== job) return;
    if (interrupted || (job.completed === 0 && skippedDuplicates === 0 && job.failed > 0)) {
      job.status = 'FAILED';
      if (interrupted) job.error = 'download_interrupted';
      await this.persistState();
      this.updateBadge('ERR', '#FF0000');
      this.broadcastProgress();
      return;
    }
    job.status = 'COMPLETED';
    await this.persistState();
    this.updateBadge('✓', '#4BB543');
    this.scheduleBadgeClear(job);
    this.broadcastProgress();
  }

  /**
   * Processes ZIP archive downloads via the offscreen OPFS writer.
   * Direct responses are consumed as streams and sent in bounded chunks. Generated
   * artifacts that already exist as binary values are also chunked at the transport
   * boundary; deduplication may still materialize them because it needs a signature
   * before deciding whether to add the entry.
   * @param {any} plugin
   * @param {string} platform
   * @param {string} targetName
   * @param {import('../domain/MediaItem.js').MediaItem[]} items
   * @param {Object} [options]
   * @param {boolean} [options.deduplicate]
   * @param {boolean} [options.historicalDedup]
   */
  async processZipDownload(plugin, platform, targetName, items, { deduplicate = false, historicalDedup = false } = {}) {
    const timestamp = FilenameService.getTimestamp();
    const zipFilename = `SMD/${platform}-${targetName}-${timestamp}.zip`;
    const sessionSignatures = new Set();
    const newHistoricalSignatures = [];
    let skippedDuplicates = 0;
    this.stateWasRestored = false;
    this.activeDownloadIds.clear();
    this.downloadLedger.clear();

    this.activeJob = DownloadJobModel.create({
      platform,
      targetName,
      format: 'zip',
      total: items.length,
      targetFilename: zipFilename
    });
    const job = this.activeJob;
    this.abortController = new AbortController();
    const signal = this.abortController.signal;
    const historyRevision = StorageService.historyRevision;
    const history = historicalDedup ? await StorageService.getHistorySnapshot() : null;
    if (signal.aborted) return;
    job.status = 'DOWNLOADING_BLOBS';
    this.persistState();

    this.updateBadge(`0/${items.length}`);
    this.broadcastProgress();

    let sessionId;
    let handedOff = false;
    try {
      const begin = await ArchiveService.begin();
      if (!begin?.ok) {
        throw Object.assign(new Error(`Offscreen ZIP packaging unavailable: ${begin?.reason || 'unknown'}`), {
          code: begin?.reason || 'opfs_unavailable'
        });
      }

      sessionId = begin.sessionId;
      job.archiveSessionId = sessionId;
      this.persistState();
      signal.throwIfAborted();
      // ponytail: one full payload at a time with dedup; incremental OPFS hashing if one file exceeds memory.
      const concurrency = deduplicate ? 1 : 6;
      let index = 0;
      let sizeLimitHit = false;
      /** @type {Set<string>} */
      const usedArchivePaths = new Set();

      const worker = async () => {
        while (index < items.length) {
          if (sizeLimitHit) break;
          if (!job || signal.aborted) return;

          const currentIndex = index++;
          const item = items[currentIndex];

          let ok = false;
          try {
            const zipPath = DownloadManager.uniquifyArchivePath(
              this.resolveArchivePath(plugin, item, targetName, currentIndex),
              usedArchivePaths
            );
            let dataPayload = null;
            let streamSource = null;
            let bytesForSignature = null;
            let signature = null;

            if (plugin && typeof plugin.resolveMedia === 'function') {
              const artifact = await plugin.resolveMedia(item, { signal });
              if (artifact && (artifact.kind === 'generated' || artifact.data)) {
                dataPayload = artifact.data;
                if (deduplicate) {
                  bytesForSignature = await DownloadManager.toUint8Array(artifact.data);
                }
              } else if (artifact && artifact.kind === 'direct' && artifact.source?.url) {
                const response = await fetch(artifact.source.url, { mode: 'cors', signal });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                if (deduplicate) {
                  dataPayload = await response.arrayBuffer();
                  bytesForSignature = new Uint8Array(dataPayload);
                } else {
                  streamSource = response;
                }
              } else {
                throw new Error(`Unsupported artifact kind: ${artifact?.kind || 'unknown'}`);
              }
            } else {
              const response = await fetch(item.downloadUrl || item.url, { mode: 'cors', signal });
              if (!response.ok) throw new Error(`HTTP ${response.status}`);
              if (deduplicate) {
                dataPayload = await response.arrayBuffer();
                bytesForSignature = new Uint8Array(dataPayload);
              } else {
                streamSource = response;
              }
            }

            signal.throwIfAborted();
            if (deduplicate && bytesForSignature) {
              const sig = await ArchiveService.getSignature(bytesForSignature);
              if (sessionSignatures.has(sig) || (history && history.revision === StorageService.historyRevision && history.signatures.has(sig))) {
                skippedDuplicates++;
                if (job) {
                  job.skippedDuplicates = skippedDuplicates;
                }
                this.updateBadge(`${job.completed + skippedDuplicates}/${items.length}`);
                this.broadcastProgress();
                continue;
              }
              signature = sig;
            }

            if (streamSource || dataPayload) {
              const addRes = await ArchiveService.addFileStream(zipPath, streamSource || dataPayload, signal, sessionId);
              if (!addRes || !addRes.ok) {
                if (addRes && addRes.reason === 'size_limit') {
                  sizeLimitHit = true;
                  break;
                }
                if (addRes && addRes.reason === 'cancelled') return;
                throw new Error(addRes?.reason || 'Offscreen rejected file');
              }
              if (signature) {
                sessionSignatures.add(signature);
                newHistoricalSignatures.push(signature);
              }
              ok = true;
            }
          } catch (err) {
            if (signal.aborted) return;
            this.logger.warn(`Failed to fetch media blob ${item.id || currentIndex}:`, err);
          }


          if (job) {
            if (ok) job.completed++; else job.failed++;
            const completed = job.completed;
            job.updatedAt = Date.now();
            this.updateBadge(`${completed + skippedDuplicates}/${items.length}`);
            this.broadcastProgress();
          }

        }
      };

      const workers = [];
      for (let i = 0; i < Math.min(concurrency, items.length); i++) {
        workers.push(worker());
      }
      await Promise.all(workers);

      const cancelled = !job || signal.aborted;
      if (cancelled) return;

      if (!sizeLimitHit && job.completed === 0 && skippedDuplicates === 0) {
        throw new Error('No media could be added to the ZIP archive (all items failed)');
      }

      if (!sizeLimitHit && job.completed === 0 && skippedDuplicates > 0 && job.failed === 0) {
        job.status = 'COMPLETED';
        await this.persistState();
        this.updateBadge('✓', '#4BB543');
        this.scheduleBadgeClear(job);
        this.broadcastProgress();
        return;
      }
      const finish = await ArchiveService.finish(zipFilename, sizeLimitHit, sessionId);

      if (signal.aborted) {
        if (finish?.objectUrl) {
          await ArchiveService.revokeBlobUrls([finish.objectUrl]).catch((error) => this.logger.warn('Temporary ZIP cleanup failed:', error));
        }
        return;
      }

      if (sizeLimitHit) {
        job.status = 'FAILED_SIZE';
        await this.persistState();
        this.updateBadge('ERR', '#FF0000');
        this.broadcastProgress();
        return;
      }

      if (finish?.reason === 'size_limit') {
        job.status = 'FAILED_SIZE';
        job.error = 'zip_size_limit';
        await this.persistState();
        this.updateBadge('ERR', '#FF0000');
        this.broadcastProgress();
        return;
      }

      if (!finish || !finish.ok || !finish.objectUrl) {
        throw new Error(finish?.reason || 'ZIP packaging failed');
      }

      const zipDownloadId = await this.downloadBlobUrl(finish.objectUrl, zipFilename, signal);
      if (job) {
        job.receiptDownloadId = zipDownloadId;
      }
      handedOff = true;
      await this.waitForDownloadCompletion(zipDownloadId, signal);

      if (historicalDedup && newHistoricalSignatures.length > 0) {
        await StorageService.addHistoricalSignatures(newHistoricalSignatures, historyRevision);
      }

      // Verify the final on-disk name. A competing download manager (IDM) can win
      // the onDeterminingFilename race and rename the ZIP to the blob UUID. The
      // download itself succeeds, so surface the interference instead of failing.
      setTimeout(() => {
        if (typeof chrome === 'undefined' || !chrome.downloads?.search) return;
        chrome.downloads.search({ id: zipDownloadId }, (items) => {
          const item = items?.[0];
          if (item && !item.filename.endsWith(zipFilename.split('/').pop())) {
            this.logger.warn(`ZIP filename overridden by another download manager: "${item.filename}" (wanted "${zipFilename}")`);
            if (job) {
              job.filenameOverridden = true;
              this.broadcastProgress();
            }
          }
        });
      }, 1000);

      if (!signal.aborted && this.activeJob === job) {
        job.status = 'COMPLETED';
        await this.persistState();
        this.updateBadge('✓', '#4BB543');
        this.scheduleBadgeClear(job);
        this.broadcastProgress();
      }
    } catch (err) {
      if (signal.aborted) return;
      this.logger.error('ZIP job failed:', err);
      const status = /** @type {string} */ (job.status);
      if (job && (status === 'DOWNLOADING_BLOBS' || status === 'PACKAGING_ZIP')) {
        job.status = 'FAILED';
        job.error = err?.code || 'zip_failed';
        await this.persistState();
      }
      this.updateBadge('ERR', '#FF0000');
      this.broadcastProgress();
    } finally {
      if (sessionId && !handedOff) {
        if (!await ArchiveService.abort(sessionId)) this.logger.warn('Temporary ZIP cleanup failed');
      }
    }
  }

  /**
   * Cancels the active download job and in-flight downloads.
   */
  async cancelDownload() {
    await this.reconcileState();
    const job = this.activeJob;
    if (!job) return;
    const wasProducing = DownloadJobModel.isActive(job);
    this.abortController.abort();
    job.status = 'CANCELLED';
    job.updatedAt = Date.now();
    const ids = [...this.activeDownloadIds];
    for (const id of ids) this.activeDownloadIds.delete(id);
    if (typeof chrome !== 'undefined' && chrome.downloads) {
      for (const id of ids) {
        chrome.downloads.cancel(id, () => {
          if (chrome.runtime.lastError) this.logger.warn('Browser download cancellation failed');
        });
      }
    }
    if (wasProducing && job.archiveSessionId && !await ArchiveService.abort(job.archiveSessionId)) {
      this.logger.warn('Temporary ZIP cleanup failed');
    }
    await this.persistState();
    if (this.activeJob === job) {
      this.updateBadge('');
      this.broadcastProgress();
    }
  }
}
