/**
 * Social Media Downloader — Content Script Bootstrap Shell (Isolated World)
 * Classic entry script:
 *  1. Synchronously registers window & chrome.runtime message listeners with
 *     pre-boot FIFO queues so messages arriving immediately after injection never
 *     fail with "Receiving end does not exist".
 *  2. Lazily loads only the platform-agnostic runtime/UI ES modules and the
 *     single platform controller owned by the current host.
 */
(function () {
  'use strict';

  if (typeof window !== 'undefined' && window.top && window !== window.top) return;
  if (window.__SOCIAL_MEDIA_DOWNLOADER_CONTENT__) return;
  window.__SOCIAL_MEDIA_DOWNLOADER_CONTENT__ = true;

  // Resolve static icon once (old tabs retain timers after extension reloads).
  const fallbackIconUrl = chrome.runtime.getURL('assets/icons/icon32.png');

  const hostname = window.location.hostname.toLowerCase().replace(/\.+$/, '');
  const isHostOnDomain = (host, domain) => host === domain || host.endsWith('.' + domain);
  const platform = isHostOnDomain(hostname, 'instagram.com')
    ? 'instagram'
    : (isHostOnDomain(hostname, 'facebook.com')
      ? 'facebook'
      : ((isHostOnDomain(hostname, 'reddit.com') || isHostOnDomain(hostname, 'redd.it'))
        ? 'reddit'
        : 'unknown'));

  if (platform === 'unknown') return;

  // Host allowlists scoped per platform for any URL placed in <img src> or downloads.
  const PLATFORM_MEDIA_HOST_SUFFIXES = {
    instagram: ['instagram.com', 'cdninstagram.com', 'fbcdn.net'],
    facebook: ['fbcdn.net', 'facebook.com'],
    reddit: ['reddit.com', 'redd.it', 'redditmedia.com', 'redditstatic.com', 'redgifs.com', 'imgur.com']
  };

  const CONTROLLER_MODULES = {
    instagram: 'src/plugins/instagram/InstagramContentController.js',
    facebook: 'src/plugins/facebook/FacebookContentController.js',
    reddit: 'src/plugins/reddit/RedditContentController.js'
  };

  // One-time nonce for the content <-> main-world bridge (CSPRNG in browser,
  // deterministic fallback under restricted Node VM sandboxes).
  const BRIDGE_NONCE = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    ? 'smd_' + crypto.randomUUID().replace(/-/g, '')
    : 'smd_' + Math.random().toString(36).slice(2, 12);

  // Synchronous pre-boot listeners + FIFO queues.
  /** @type {any[]} */
  const preBootWindowMessages = [];
  /** @type {{ message: any, sender: any, sendResponse: Function }[]} */
  const preBootRuntimeMessages = [];
  /** @type {((data: any) => void) | null} */
  let bridgeDispatch = null;
  /** @type {((message: any, sender: any, sendResponse: Function) => boolean | void) | null} */
  let runtimeMessageHandler = null;

  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.data.nonce !== BRIDGE_NONCE) return;
    if (bridgeDispatch) {
      bridgeDispatch(event.data);
    } else {
      preBootWindowMessages.push(event.data);
    }
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message) return;
    if (runtimeMessageHandler) {
      return runtimeMessageHandler(message, sender, sendResponse);
    }
    preBootRuntimeMessages.push({ message, sender, sendResponse });
    return true;
  });

  const env = {
    window,
    document,
    chrome,
    location: window.location,
    history: window.history,
    JSON,
    Math,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Event: typeof Event === 'function' ? Event : undefined,
    MouseEvent: typeof MouseEvent === 'function' ? MouseEvent : undefined,
    PointerEvent: typeof PointerEvent === 'function' ? PointerEvent : undefined,
    PopStateEvent: typeof PopStateEvent === 'function' ? PopStateEvent : undefined,
    getComputedStyle: typeof getComputedStyle === 'function' ? getComputedStyle : undefined,
    fetch: typeof fetch === 'function' ? fetch.bind(globalThis) : undefined,
    requestAnimationFrame: typeof requestAnimationFrame === 'function' ? requestAnimationFrame : undefined,
    IntersectionObserver: typeof IntersectionObserver === 'function' ? IntersectionObserver : undefined,
    console
  };

  Promise.all([
    import(chrome.runtime.getURL('src/content/bridge/MainWorldBridge.js')),
    import(chrome.runtime.getURL('src/content/runtime/NavigationTracker.js')),
    import(chrome.runtime.getURL('src/content/runtime/ContentRuntime.js')),
    import(chrome.runtime.getURL('src/content/ui/OverlayModal.js')),
    import(chrome.runtime.getURL(CONTROLLER_MODULES[platform]))
  ]).then(([{ createMainWorldBridge }, { createNavigationTracker }, { createContentRuntime }, { createOverlayModal }, controllerMod]) => {
    boot({ createMainWorldBridge, createNavigationTracker, createContentRuntime, createOverlayModal, controllerMod });
  }).catch((err) => {
    console.error('[SMD Content] Failed to boot modular content runtime:', err);
  });

  function boot({ createMainWorldBridge, createNavigationTracker, createContentRuntime, createOverlayModal, controllerMod }) {
    /** @type {any} */
    let controller = null;
    /** @type {any} */
    let overlay = null;

    const runtime = createContentRuntime({
      env,
      platform,
      allowedHostSuffixesByPlatform: PLATFORM_MEDIA_HOST_SUFFIXES,
      isDownscaledUrl: (url) => (controller?.isDownscaledUrl ? controller.isDownscaledUrl(url) : false),
      onMediaChanged: () => {
        overlay?.updateFloatingWidgetBadge();
        overlay?.scheduleGridRender();
      },
      onStateReset: () => {
        overlay?.updateFloatingWidgetBadge();
        overlay?.renderGrid();
      }
    });
    const { state, isAllowedMediaUrl, isExtensionContextValid } = runtime;

    const bridge = createMainWorldBridge({
      env,
      nonce: BRIDGE_NONCE,
      idleTimeoutMs: 30000,
      onMessage: (data) => {
        controller?.onBridgeMessage?.(data);
      }
    });

    const navTracker = createNavigationTracker({
      env,
      platform,
      isContextValid: isExtensionContextValid,
      onNavigation: () => {
        controller?.onNavigation?.();
      }
    });

    overlay = createOverlayModal({
      env,
      runtime,
      fallbackIconUrl,
      uiConfig: controllerMod.uiConfig,
      callbacks: {
        onScanAll: () => controller?.scanAll?.(),
        onScanAction: (action) => controller?.runAction?.(action),
        onCancelScan: () => controller?.cancelScan?.(),
        onModalOpen: () => (controller?.onModalOpen ? controller.onModalOpen() : controller?.detectTarget?.()),
        resolveAvatarUrl: () => controller?.resolveAvatarUrl?.() || fallbackIconUrl
      }
    });

    controller = controllerMod.createController({
      env,
      runtime,
      bridge,
      navTracker,
      overlay,
      fallbackIconUrl
    });

    controller.detectTarget();

    function initContentScript() {
      overlay.mount();
      controller.init?.();
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initContentScript);
    } else {
      initContentScript();
    }

    function handleRuntimeMessage(message, sender, sendResponse) {
      if (!message || !isExtensionContextValid()) return;
      const type = message.type || message.action;

      switch (type) {
        case 'TOGGLE_MODAL': {
          overlay.toggleModal();
          sendResponse({ success: true });
          return true;
        }
        case 'GET_PAGE_STATE':
        case 'GET_PAGE_CONTEXT': {
          controller.detectTarget();
          sendResponse({
            platform: state.platform,
            targetName: state.targetName,
            targetType: state.targetType,
            username: state.username,
            avatarUrl: isAllowedMediaUrl(state.targetAvatarUrl) ? state.targetAvatarUrl : '',
            isScanning: state.isScanning,
            media: Array.from(state.media.values())
          });
          return true;
        }
        case 'TRIGGER_SCAN_ALL': {
          Promise.resolve(controller.scanAll?.()).then(() => {
            sendResponse({ success: true, count: state.media.size });
          });
          return true;
        }
        case 'DOWNLOAD_PROGRESS_UPDATE': {
          if (message.job) {
            if (message.job.platform && message.job.platform !== state.platform) break;
            overlay.updateDownloadProgressUI(message.job);
          }
          break;
        }
        default: {
          if (controller.handleMessage?.(type, sendResponse, message, sender)) {
            return true;
          }
          if (typeof type === 'string' && type.startsWith('TRIGGER_SCAN_')) {
            sendResponse({ success: false, status: 'unsupported' });
            return true;
          }
          break;
        }
      }
    }

    // Activate live dispatchers and flush FIFO queues captured during async boot.
    bridgeDispatch = bridge.dispatchData;
    runtimeMessageHandler = handleRuntimeMessage;

    for (const queuedData of preBootWindowMessages.splice(0)) {
      bridge.dispatchData(queuedData);
    }
    for (const queuedReq of preBootRuntimeMessages.splice(0)) {
      handleRuntimeMessage(queuedReq.message, queuedReq.sender, queuedReq.sendResponse);
    }
  }
})();
