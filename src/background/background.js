/**
 * Social Media Downloader — Background Service Worker (Manifest V3)
 * Orchestrates plugin registry, download jobs, offscreen packager, and background helper requests.
 */
import { defaultRegistry } from '../core/application/PluginRegistry.js';
import { DownloadManager } from '../core/application/DownloadManager.js';
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

// 4. Register Chrome Download Listeners
// The onDeterminingFilename guard below re-asserts the filename we pass to
// chrome.downloads.download(). Competing download managers (e.g. IDM Integration
// Module) register their own listener and rename blob downloads to the blob URL's
// UUID basename (user report 2026-08-29: ZIPs landed as "<uuid>.zip"). Chrome
// honors the FIRST suggest() call, so the guard registers at SW startup — before
// any competing listener can act on our downloads. It suggests ONLY the filename
// we already chose (desiredFilenames map), so it never fights neutral listeners.
if (typeof chrome !== 'undefined') {
  downloadManager.registerFilenameGuards();
  if (chrome.downloads?.onChanged) {
    chrome.downloads.onChanged.addListener((delta) => {
      downloadManager.handleDownloadChanged(delta);
    });
  }
}

// 5. Message Dispatcher
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) return;
  const type = message.type || message.action;

  switch (type) {
    case 'START_DOWNLOAD': {
      const { platform, targetName, items, format, options } = message.payload || message;
      ensureOffscreenDocument().then(() => {
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
      if (downloadManager.activeJob && message.patch) {
        Object.assign(downloadManager.activeJob, message.patch);
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
