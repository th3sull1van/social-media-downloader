/**
 * Social Media Downloader — Background Service Worker (Manifest V3)
 * Orchestrates plugin registry, download jobs, offscreen packager, and background helper requests.
 */
import { defaultRegistry } from '../core/application/PluginRegistry.js';
import { DownloadManager } from '../core/application/DownloadManager.js';
import { ArchiveService } from '../core/services/ArchiveService.js';
import { StorageService } from '../core/services/StorageService.js';
import { InstagramPlugin } from '../plugins/instagram/InstagramPlugin.js';
import { FacebookPlugin } from '../plugins/facebook/FacebookPlugin.js';
import { RedditPlugin } from '../plugins/reddit/RedditPlugin.js';

// 1. Register Built-In First-Class Plugins
function safeHostname(url) {
  try {
    return new URL(url).hostname;
  } catch (e) {
    return undefined;
  }
}

defaultRegistry.register(InstagramPlugin);
defaultRegistry.register(FacebookPlugin);
defaultRegistry.register(RedditPlugin);

// 2. Initialize Core Download Manager
const downloadManager = new DownloadManager(defaultRegistry);

// 3. Ensure Offscreen Document for Packaging
let offscreenCreating = null;
async function hasOffscreenDocument() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL('src/offscreen/offscreen.html')]
  });
  return contexts.length > 0;
}

async function ensureOffscreenDocument() {
  if (await hasOffscreenDocument()) return;
  if (offscreenCreating) {
    await offscreenCreating;
    return;
  }
  offscreenCreating = chrome.offscreen.createDocument({
    url: 'src/offscreen/offscreen.html',
    reasons: ['BLOBS'],
    justification: 'Packaging ZIP archives and creating blob URLs without memory leaks or UI freezing.'
  });
  try {
    await offscreenCreating;
  } catch (err) {
    // Reset the gate so a later download can retry creating the document.
    // Without this reset, a single failed creation would poison every future job.
    offscreenCreating = null;
    // A "already exists" race is benign; anything else is a real failure.
    if (!await hasOffscreenDocument()) {
      throw err;
    }
  }
  offscreenCreating = null;
}

// Reconcile once per worker lifetime, before accepting any new resource producer.
// A failed browser query fails closed: never delete files on an unknown snapshot.
let resourceRecovery = null;
function recoverTemporaryResources() {
  if (!resourceRecovery) {
    resourceRecovery = (async () => {
      await ensureOffscreenDocument();
      const downloads = await chrome.downloads.search({ state: 'in_progress' });
      const prefix = `blob:${chrome.runtime.getURL('')}`;
      const activeUrls = downloads.flatMap((item) => [item.url, item.finalUrl]).filter((url) => url?.startsWith(prefix));
      const result = await ArchiveService.sendToOffscreen({ type: 'OFFSCREEN_RECOVER_RESOURCES', activeUrls });
      if (!result?.ok) throw new Error(result?.reason || 'opfs_cleanup_failed');
    })().catch((error) => { resourceRecovery = null; throw error; });
  }
  return resourceRecovery;
}
let preparingResources = null;
function prepareTemporaryResources() {
  if (!preparingResources) preparingResources = (async () => {
    if (!await hasOffscreenDocument()) resourceRecovery = null;
    await recoverTemporaryResources();
  })().finally(() => { preparingResources = null; });
  return preparingResources;
}
void prepareTemporaryResources().catch((error) => downloadManager.logger.warn('Temporary resource recovery failed:', error));

// 4. Register Chrome Download Listeners
// Keep filename selection inside chrome.downloads.download({ filename }). Do not
// register onDeterminingFilename: competing download managers such as IDM may
// register the same event, and multiple filename suggestions produce a conflict.
if (typeof chrome !== 'undefined') {
  if (chrome.downloads?.onChanged) {
    chrome.downloads.onChanged.addListener((delta) => {
      const tracked = downloadManager.downloadBlobUrls.has(delta.id);
      downloadManager.handleDownloadChanged(delta);
      if (!tracked && ['complete', 'interrupted'].includes(delta.state?.current)) {
        // The URL->ID map is volatile; query the browser after a worker restart.
        void prepareTemporaryResources().then(async () => {
          const [item] = await chrome.downloads.search({ id: delta.id });
          const prefix = `blob:${chrome.runtime.getURL('')}`;
          const urls = [item?.url, item?.finalUrl].filter((url) => url?.startsWith(prefix));
          await ArchiveService.revokeBlobUrls(urls);
        }).catch((error) => downloadManager.logger.warn('Temporary download cleanup failed:', error));
      }
    });
  }
}

// 5. Message Dispatcher
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) return;
  const type = message.type || message.action;
  if (type?.startsWith('OFFSCREEN_')) return;

  switch (type) {
    case 'START_DOWNLOAD': {
      const { platform, targetName, items, format, options } = message.payload || message;
      prepareTemporaryResources().then(() => {
        return downloadManager.startDownload({ platform, targetName, items, format, options });
      }).then(sendResponse).catch((err) => {
        sendResponse({ success: false, error: err.message });
      });
      return true;
    }

    case 'GET_SETTINGS': {
      StorageService.getSettings().then((settings) => {
        sendResponse({ success: true, settings });
      }).catch((err) => {
        sendResponse({ success: false, error: err.message });
      });
      return true;
    }

    case 'SAVE_SETTINGS': {
      const settings = message.payload || message.settings || {};
      StorageService.saveSettings(settings).then((ok) => {
        sendResponse({ success: ok });
      }).catch((err) => {
        sendResponse({ success: false, error: err.message });
      });
      return true;
    }

    case 'CLEAR_DEDUP_HISTORY': {
      StorageService.clearHistory().then((ok) => {
        sendResponse({ success: ok });
      }).catch((err) => {
        sendResponse({ success: false, error: err.message });
      });
      return true;
    }

    case 'GET_DOWNLOAD_STATUS':
    case 'GET_DOWNLOAD_STATE': {
      sendResponse({ activeJob: downloadManager.activeJob });
      return true;
    }

    case 'GET_PLUGIN_INFO': {
      const url = message.url || message.payload?.url;
      const hostname = message.hostname || (url ? safeHostname(url) : undefined);
      const plugin = defaultRegistry.detect({ url, hostname });
      if (!plugin) {
        sendResponse({ success: false, error: 'No plugin matches the given context' });
        return true;
      }
      sendResponse({
        success: true,
        info: {
          id: plugin.id,
          version: plugin.version,
          capabilities: typeof plugin.getCapabilities === 'function' ? plugin.getCapabilities() : {},
          filters: typeof plugin.getFilters === 'function' ? plugin.getFilters() : []
        }
      });
      return true;
    }

    case 'CANCEL_DOWNLOAD': {
      downloadManager.cancelDownload().then(() => {
        sendResponse({ success: true });
      });
      return true;
    }

    case 'ZIP_OFFSCREEN_PROGRESS': {
      // The offscreen finishes with { status: 'PACKAGING_ZIP', zipPercent: 100 }
      // before the FINISH response is processed. That message can arrive AFTER
      // the job reached a terminal state (COMPLETED/FAILED/CANCELLED), so a blind
      // Object.assign would regress the status back to PACKAGING_ZIP and leave the
      // progress UI stuck on "Compactando... 100% Cancelar". Only apply progress
      // patches while the job is still running.
      if (downloadManager.activeJob && message.patch &&
          message.sessionId === downloadManager.activeJob.archiveSessionId &&
          ['QUEUED', 'DOWNLOADING', 'DOWNLOADING_BLOBS', 'PACKAGING_ZIP'].includes(downloadManager.activeJob.status)) {
        // The manager owns per-item counters. Offscreen entry acknowledgements
        // can arrive before/after worker increments and must not overwrite them.
        const { completed, failed, ...patch } = message.patch;
        Object.assign(downloadManager.activeJob, patch);
        downloadManager.updateBadge(`${downloadManager.activeJob.completed}/${downloadManager.activeJob.total}`);
        downloadManager.broadcastProgress();
      }
      return;
    }

    default: {
      // Delegate platform-specific message types to the owning plugin so the
      // service worker orchestrates instead of routing on platform internals
      // (SPEC §54, AGENTS §27 / §22). A plugin returns { handled: true, response }
      // when it owns the type; otherwise the registry tries the next plugin.
      (async () => {
        for (const plugin of defaultRegistry.list()) {
          if (typeof plugin.handleMessage === 'function') {
            const handled = await plugin.handleMessage(type, message);
            if (handled && handled.handled) {
              sendResponse(handled.response);
              return;
            }
          }
        }
        sendResponse({ success: false, error: `No handler for message: ${type}` });
      })();
      return true;
    }
  }
});
