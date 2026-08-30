/**
 * Social Media Downloader — Download Manager (Core Application Layer)
 * Coordinates download queue, concurrency, ZIP packaging delegation, cancellation, and progress updates.
 * ZERO platform conditionals: relies entirely on plugin contracts and capabilities.
 */
import { DownloadJobModel } from '../domain/DownloadJob.js';
import { FilenameService } from '../services/FilenameService.js';
import { ArchiveService } from '../services/ArchiveService.js';
import { Logger } from '../services/LoggingService.js';

export class DownloadManager {
  /**
   * @param {import('./PluginRegistry.js').PluginRegistry} pluginRegistry
   */
  constructor(pluginRegistry) {
    this.registry = pluginRegistry;
    this.logger = new Logger('core:download');

    /** @type {import('../domain/DownloadJob.js').DownloadJob | null} */
    this.activeJob = null;

    /** @type {Set<number>} */
    this.activeDownloadIds = new Set();

    /** @type {Map<string, number>} Blob URL -> chrome download id (blob URLs produced by the offscreen document) */
    this.blobUrlDownloadIds = new Map();

    /** @type {Set<string>} */
    this.pendingBlobUrls = new Set();

    /** @type {Map<number, string>} Download ID -> filename we want Chrome to use */
    this.desiredFilenames = new Map();

    /** @type {boolean} */
    this.filenameGuardsRegistered = false;
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

  // onDeterminingFilename guard: downloads we start register their filename in
  // desiredFilenames (downloadUrl), and this listener re-asserts it. Required
  // because competing download managers (e.g. IDM Integration Module) register
  // their own onDeterminingFilename and rename blob downloads to the blob URL's
  // UUID basename (user report 2026-08-29: ZIPs landing as "<uuid>.zip").
  // Chrome honors the FIRST suggest() call, so background.js registers this
  // guard at SW startup — racing every competing listener for our downloads.
  // It only suggests filenames we explicitly set, so downloads from other
  // extensions/sources pass through untouched (suggest not called).
  registerFilenameGuards() {
    if (typeof chrome === 'undefined' || !chrome.downloads?.onDeterminingFilename || this.filenameGuardsRegistered) {
      return;
    }
    this.filenameGuardsRegistered = true;
    chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
      const desired = this.desiredFilenames.get(downloadItem.id);
      if (desired) {
        suggest({ filename: desired, conflictAction: 'uniquify' });
        return true;
      }
      return false;
    });
  }

  /**
   * Keeps active download IDs synchronized and releases blob URLs when their
   * download reaches a terminal state (revoke on completion, not eagerly).
   * @param {any} delta
   */
  handleDownloadChanged(delta) {
    if (delta && delta.state && (delta.state.current === 'complete' || delta.state.current === 'interrupted')) {
      this.desiredFilenames.delete(delta.id);
      this.activeDownloadIds.delete(delta.id);
      const blobUrl = [...this.blobUrlDownloadIds.entries()].find(([, id]) => id === delta.id)?.[0];
      if (blobUrl) {
        this.blobUrlDownloadIds.delete(blobUrl);
        this.pendingBlobUrls.delete(blobUrl);
        ArchiveService.revokeBlobUrls([blobUrl]);
      }
    }
  }

  /**
   * Initiates a download batch.
   * @param {Object} params
   * @param {string} params.platform
   * @param {string} params.targetName
   * @param {import('../domain/MediaItem.js').MediaItem[]} params.items
   * @param {import('../domain/DownloadJob.js').DownloadFormat} [params.format='individual']
   * @returns {Promise<{ success: boolean, message?: string, error?: string }>}
   */
  async startDownload({ platform, targetName, items, format = 'individual' }) {
    if (!items || !items.length) {
      return { success: false, error: 'No items provided' };
    }

    if (this.activeJob && DownloadJobModel.isActive(this.activeJob)) {
      return { success: false, error: 'A download job is already in progress' };
    }

    const plugin = this.registry.get(platform);
    const safeTargetName = FilenameService.sanitize(targetName || 'Media_Collection', 80, 'Media_Collection');

    if (format === 'zip') {
      this.processZipDownload(plugin, platform, safeTargetName, items).catch((err) => {
        this.logger.error('ZIP download error:', err);
      });
    } else {
      this.processIndividualDownloads(plugin, platform, safeTargetName, items).catch((err) => {
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
    if (plugin && typeof plugin.getFilename === 'function') {
      return plugin.getFilename(item, { targetName, index: index + 1 });
    }
    const baseName = item.filename || item.id || `media_${index + 1}`;
    const ext = item.extension || (item.type === 'video' ? 'mp4' : 'jpg');
    return `SMD/${targetName}/${FilenameService.sanitize(baseName)}.${ext}`;
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
    const lastDot = path.lastIndexOf('.');
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
    if (plugin && typeof plugin.getArchivePath === 'function') {
      return plugin.getArchivePath(item, { targetName, index: index + 1 });
    }
    const baseName = item.filename || item.id || `media_${index + 1}`;
    const ext = item.extension || (item.type === 'video' ? 'mp4' : 'jpg');
    return `${targetName}/${FilenameService.sanitize(baseName)}.${ext}`;
  }

  /**
   * Downloads one item through the plugin resolver (generated artifacts)
   * or via a direct URL. The decision of how to resolve an item is owned by the
   * plugin; Core only executes the resulting DownloadArtifact.
   * @param {any} plugin
   * @param {string} targetFilename
   * @returns {Promise<number>} chrome download id
   */
  async downloadItem(plugin, item, targetFilename) {
    // 1. Plugin resolver path — if the plugin provides resolveMedia(), call it and
    //    execute the returned DownloadArtifact (direct / generated).
    if (plugin && typeof plugin.resolveMedia === 'function') {
      const artifact = await plugin.resolveMedia(item, {});
      if (artifact && artifact.kind === 'direct' && artifact.source?.url) {
        return this.downloadUrl(artifact.source.url, targetFilename);
      }
      if (artifact && (artifact.kind === 'generated' || artifact.data)) {
        return this.downloadGeneratedBlob(artifact.data, targetFilename);
      }
      throw new Error(`Unsupported artifact kind: ${artifact?.kind || 'unknown'}`);
    }

    // 2. Direct URL download
    const downloadUrl = item.downloadUrl || item.url;
    if (!downloadUrl) {
      throw new Error('Item has no download URL');
    }
    return this.downloadUrl(downloadUrl, targetFilename);
  }
  /**
   * Downloads a URL via chrome.downloads and tracks the pending filename.
   * @param {string} url
   * @param {string} targetFilename
   * @returns {Promise<number>}
   */
  downloadUrl(url, targetFilename) {
    this.registerFilenameGuards();
    return new Promise((resolve, reject) => {
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
          // Re-asserted by our onDeterminingFilename guard in case a competing
          // download manager (IDM) renames blob downloads to their UUID basename.
          this.desiredFilenames.set(downloadId, targetFilename);
          this.activeDownloadIds.add(downloadId);
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
  async downloadGeneratedBlob(data, targetFilename) {
    const createRes = await ArchiveService.createBlobUrl(data);
    if (!createRes || !createRes.ok || !createRes.objectUrl) {
      throw new Error(createRes?.reason || 'Offscreen blob URL creation failed');
    }
    const objectUrl = createRes.objectUrl;
    this.pendingBlobUrls.add(objectUrl);
    const downloadId = await this.downloadUrl(objectUrl, targetFilename);
    this.blobUrlDownloadIds.set(objectUrl, downloadId);
    return downloadId;
  }

  /**
   * Processes individual file downloads.
   * @param {any} plugin
   * @param {string} platform
   * @param {string} targetName
   * @param {import('../domain/MediaItem.js').MediaItem[]} items
   */
  async processIndividualDownloads(plugin, platform, targetName, items) {
    const total = items.length;
    /** @type {Map<number, { ok: boolean }>} */
    const results = new Map();

    this.activeJob = DownloadJobModel.create({
      platform,
      targetName,
      format: 'individual',
      total
    });
    this.activeJob.status = 'DOWNLOADING';

    this.updateBadge(`0/${total}`);
    this.broadcastProgress();

    const concurrency = 6;
    let index = 0;

    const worker = async () => {
      while (index < items.length) {
        if (!this.activeJob || this.currentJobStatus() === 'CANCELLED') break;
        const currentIndex = index++;
        const item = items[currentIndex];
        const targetFilename = this.resolveFilename(plugin, item, targetName, currentIndex);

        let ok = false;
        let downloadId = null;
        try {
          downloadId = await this.downloadItem(plugin, item, targetFilename);
          ok = true;
        } catch (err) {
          this.logger.warn(`Failed to download item ${item.id || currentIndex}:`, err);
        }

        results.set(currentIndex, { ok });

        // Per-item counters written from the owning worker only (no shared counter race).
        if (this.activeJob) {
          let completed = 0;
          let failed = 0;
          for (const r of results.values()) {
            if (r.ok) completed++; else failed++;
          }
          this.activeJob.completed = completed;
          this.activeJob.failed = failed;
          if (ok && downloadId != null) {
            this.activeJob.receiptDownloadId = downloadId;
          }
          this.activeJob.updatedAt = Date.now();
          this.updateBadge(`${completed}/${total}`);
          this.broadcastProgress();
        }

        await new Promise((r) => setTimeout(r, 40));
      }
    };

    const workers = [];
    for (let i = 0; i < Math.min(concurrency, items.length); i++) {
      workers.push(worker());
    }

    await Promise.all(workers);

    const individualStatus = this.currentJobStatus();
    if (this.activeJob && individualStatus !== 'CANCELLED') {
      this.activeJob.status = 'COMPLETED';
    }

    this.updateBadge('✓', '#4BB543');
    setTimeout(() => this.updateBadge(''), 5000);
    this.broadcastProgress();
  }

  /**
   * Processes ZIP archive downloads via offscreen document.
   * Buffers are base64-encoded in the service worker before messaging (see ArchiveService):
   * chrome.runtime.sendMessage JSON-serializes, so a raw ArrayBuffer would arrive as {}
   * on the offscreen side and produce a 22-byte empty ZIP. This is the reverted F-07 fix.
   * @param {any} plugin
   * @param {string} platform
   * @param {string} targetName
   * @param {import('../domain/MediaItem.js').MediaItem[]} items
   */
  async processZipDownload(plugin, platform, targetName, items) {
    const timestamp = FilenameService.getTimestamp();
    const zipFilename = `SMD/${platform}-${targetName}-${timestamp}.zip`;

    this.activeJob = DownloadJobModel.create({
      platform,
      targetName,
      format: 'zip',
      total: items.length,
      targetFilename: zipFilename
    });
    this.activeJob.status = 'DOWNLOADING_BLOBS';

    this.updateBadge(`0/${items.length}`);
    this.broadcastProgress();

    try {
      await ArchiveService.begin();

      const concurrency = 6;
      let index = 0;
      let sizeLimitHit = false;
      /** @type {Map<number, boolean>} */
      const results = new Map();
      /** @type {Set<string>} */
      const usedArchivePaths = new Set();

      const worker = async () => {
        while (index < items.length) {
          if (sizeLimitHit) break;
          if (!this.activeJob || this.currentJobStatus() === 'CANCELLED') return;

          const currentIndex = index++;
          const item = items[currentIndex];
          const zipPath = DownloadManager.uniquifyArchivePath(
            this.resolveArchivePath(plugin, item, targetName, currentIndex),
            usedArchivePaths
          );

          let ok = false;
          try {
            // Media that needs processing (generated blobs) is resolved through
            // the plugin resolver, same as the individual path; the plugin owns
            // how its media is resolved. Everything else is fetched here.
            if (plugin && typeof plugin.resolveMedia === 'function') {
              const artifact = await plugin.resolveMedia(item, {});
              if (artifact && (artifact.kind === 'generated' || artifact.data)) {
                const addRes = await ArchiveService.addFile(zipPath, artifact.data);
                if (!addRes || !addRes.ok) {
                  if (addRes && addRes.reason === 'size_limit') {
                    sizeLimitHit = true;
                    break;
                  }
                  if (addRes && addRes.reason === 'cancelled') return;
                  throw new Error(addRes?.reason || 'Offscreen rejected resolved file');
                }
                ok = true;
              } else if (artifact && artifact.kind === 'direct' && artifact.source?.url) {
                const response = await fetch(artifact.source.url, { mode: 'cors' });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const arrayBuffer = await response.arrayBuffer();
                const addRes = await ArchiveService.addFile(zipPath, arrayBuffer);
                if (!addRes || !addRes.ok) {
                  if (addRes && addRes.reason === 'size_limit') {
                    sizeLimitHit = true;
                    break;
                  }
                  if (addRes && addRes.reason === 'cancelled') return;
                  throw new Error(addRes?.reason || 'Offscreen rejected resolved file');
                }
                ok = true;
              } else {
                throw new Error(`Unsupported artifact kind: ${artifact?.kind || 'unknown'}`);
              }
            } else {
              let response = await fetch(item.downloadUrl || item.url, { mode: 'cors' });
              if (!response.ok) throw new Error(`HTTP ${response.status}`);
              const arrayBuffer = await response.arrayBuffer();

              const addRes = await ArchiveService.addFile(zipPath, arrayBuffer);

              if (!addRes || !addRes.ok) {
                if (addRes && addRes.reason === 'size_limit') {
                  sizeLimitHit = true;
                  break;
                }
                if (addRes && addRes.reason === 'cancelled') return;
                throw new Error(addRes?.reason || 'Offscreen rejected file');
              }
              ok = true;
            }
          } catch (err) {
            this.logger.warn(`Failed to fetch media blob ${item.id || currentIndex}:`, err);
          }

          results.set(currentIndex, ok);

          if (this.activeJob) {
            let completed = 0;
            let failed = 0;
            for (const r of results.values()) {
              if (r) completed++; else failed++;
            }
            this.activeJob.completed = completed;
            this.activeJob.failed = failed;
            this.activeJob.updatedAt = Date.now();
            this.updateBadge(`${completed}/${items.length}`);
            this.broadcastProgress();
          }

          await new Promise((r) => setTimeout(r, 40));
        }
      };

      const workers = [];
      for (let i = 0; i < Math.min(concurrency, items.length); i++) {
        workers.push(worker());
      }
      await Promise.all(workers);

      const cancelled = !this.activeJob || this.currentJobStatus() === 'CANCELLED';
      if (cancelled) return;

      // Never emit an empty ZIP: if every addFile failed (e.g. a transport bug producing
      // 22-byte archives), fail the job visibly instead of packaging nothing.
      if (!sizeLimitHit && this.activeJob.completed === 0) {
        throw new Error('No media could be added to the ZIP archive (all items failed)');
      }

      const finish = await ArchiveService.finish(zipFilename, cancelled || sizeLimitHit);

      if (cancelled) return;

      if (sizeLimitHit) {
        this.activeJob.status = 'FAILED_SIZE';
        this.updateBadge('ERR', '#FF0000');
        this.broadcastProgress();
        return;
      }

      if (!finish || !finish.ok || !finish.objectUrl) {
        throw new Error(finish?.reason || 'ZIP packaging failed');
      }

      // The download id is used by handleDownloadChanged to revoke the blob
      // URL only after the download completes.
      const zipDownloadId = await this.downloadUrl(finish.objectUrl, zipFilename);
      if (this.activeJob) {
        this.activeJob.receiptDownloadId = zipDownloadId;
      }
      this.blobUrlDownloadIds.set(finish.objectUrl, zipDownloadId);

      // Verify the final on-disk name. A competing download manager (IDM) can win
      // the onDeterminingFilename race and rename the ZIP to the blob UUID. The
      // download itself succeeds, so surface the interference instead of failing.
      setTimeout(() => {
        if (typeof chrome === 'undefined' || !chrome.downloads?.search) return;
        chrome.downloads.search({ id: zipDownloadId }, (items) => {
          const item = items?.[0];
          if (item && !item.filename.endsWith(zipFilename.split('/').pop())) {
            this.logger.warn(`ZIP filename overridden by another download manager: "${item.filename}" (wanted "${zipFilename}")`);
            if (this.activeJob) {
              this.activeJob.filenameOverridden = true;
              this.broadcastProgress();
            }
          }
        });
      }, 1000);

      if (this.activeJob) {
        this.activeJob.status = 'COMPLETED';
      }
    } catch (err) {
      this.logger.error('ZIP job failed:', err);
      const status = this.currentJobStatus();
      if (this.activeJob && (status === 'DOWNLOADING_BLOBS' || status === 'PACKAGING_ZIP')) {
        this.activeJob.status = 'FAILED';
      }
      this.updateBadge('ERR', '#FF0000');
      this.broadcastProgress();
    }
  }

  /**
   * Cancels the active download job and in-flight downloads.
   */
  async cancelDownload() {
    if (this.activeJob) {
      this.activeJob.status = 'CANCELLED';
      this.activeJob.updatedAt = Date.now();

      await ArchiveService.abort();

      if (typeof chrome !== 'undefined' && chrome.downloads) {
        for (const downloadId of this.activeDownloadIds) {
          try {
            chrome.downloads.cancel(downloadId, () => void chrome.runtime.lastError);
          } catch (e) {}
        }
      }
      this.activeDownloadIds.clear();
      this.updateBadge('');
      this.broadcastProgress();
    }
  }
}
