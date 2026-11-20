/**
 * Social Media Downloader — Facebook Main World Injected Script
 * Queries Comet GraphQL endpoints directly within the page context.
 */

(function () {
  'use strict';

  if (typeof window !== 'undefined' && window.top && window !== window.top) return;
  if (window.__SMD_FB_INJECTED__) return;
  window.__SMD_FB_INJECTED__ = true;

  const session = {
    nonce: null
  };

  // Buffer GraphQL payloads intercepted between document_start and content.js PING
  // handshake so initial hydration photos/profile headers are never lost.
  const PRE_HANDSHAKE_MAX_ITEMS = 30;
  const PRE_HANDSHAKE_MAX_CHARS = 10 * 1024 * 1024;
  /** @type {string[]} */
  const preHandshakeQueue = [];
  let preHandshakeChars = 0;

  function targetOrigin() {
    return (typeof window !== 'undefined' && window.location?.origin && window.location.origin !== 'null')
      ? window.location.origin
      : '*';
  }

  function isRelevantGraphqlPayload(text) {
    return Boolean(text && (
      text.includes('viewer_image') ||
      text.includes('"Photo"') ||
      text.includes('TimelineAppCollectionItem') ||
      text.includes('profile_picture') ||
      text.includes('profilePicLarge') ||
      text.includes('cover_photo')
    ));
  }

  function flushPreHandshakeQueue() {
    if (!session.nonce || preHandshakeQueue.length === 0) return;
    const queued = preHandshakeQueue.splice(0, preHandshakeQueue.length);
    preHandshakeChars = 0;
    const origin = targetOrigin();
    for (const text of queued) {
      window.postMessage({
        source: 'SMD_FB_BATCH_PHOTOS',
        nonce: session.nonce,
        payload: { text }
      }, origin);
    }
  }

  function broadcastMediaBatch(text) {
    if (!isRelevantGraphqlPayload(text)) return;
    if (!session.nonce) {
      if (text.length <= PRE_HANDSHAKE_MAX_CHARS) {
        while (preHandshakeQueue.length >= PRE_HANDSHAKE_MAX_ITEMS ||
               (preHandshakeQueue.length > 0 && preHandshakeChars + text.length > PRE_HANDSHAKE_MAX_CHARS)) {
          const evicted = preHandshakeQueue.shift();
          preHandshakeChars -= evicted ? evicted.length : 0;
        }
        preHandshakeQueue.push(text);
        preHandshakeChars += text.length;
      }
      return;
    }
    window.postMessage({
      source: 'SMD_FB_BATCH_PHOTOS',
      nonce: session.nonce,
      payload: { text }
    }, targetOrigin());
  }

  // Intercept fetch & XHR to capture all Comet GraphQL responses as user navigates/scrolls
  try {
    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
      const response = await originalFetch.apply(this, args);
      try {
        const firstArg = args[0];
        const url = typeof firstArg === 'string'
          ? firstArg
          : (firstArg instanceof URL
            ? firstArg.href
            : (firstArg && typeof firstArg === 'object' && 'url' in firstArg ? String(firstArg.url || '') : ''));
        if (url.includes('/api/graphql') || url.includes('/graphql/')) {
          const clone = response.clone();
          clone.text().then(text => broadcastMediaBatch(text)).catch(() => {});
        }
      } catch (e) {}
      return response;
    };
  } catch (e) {}

  try {
    const originalXHROpen = XMLHttpRequest.prototype.open;
    const originalXHRSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      /** @type {any} */ (this)._smd_fb_url = url;
      return originalXHROpen.call(this, method, url, ...rest);
    };
    XMLHttpRequest.prototype.send = function (...args) {
      this.addEventListener('load', () => {
        try {
          const url = String(/** @type {any} */ (this)._smd_fb_url || '');
          const isText = !this.responseType || this.responseType === 'text';
          if (isText && (url.includes('/api/graphql') || url.includes('/graphql/')) && this.responseText) {
            broadcastMediaBatch(this.responseText);
          }
        } catch (e) {}
      });
      return originalXHRSend.apply(this, args);
    };
  } catch (e) {}

  window.addEventListener('message', async (event) => {
    if (event.isTrusted === false || event.source !== window || !event.data || event.data.source !== 'SMD_CONTENT') return;
    const { type, requestId, payload } = event.data;
    // Lock and echo the session nonce: the content script drops responses without it (F-14).
    const nonce = event.data.nonce;
    if (!nonce) return;
    if (!session.nonce) {
      session.nonce = nonce;
      flushPreHandshakeQueue();
    } else if (nonce !== session.nonce) {
      return;
    }

    const reply = (res) => {
      window.postMessage({
        source: 'SMD_FB_INJECTED_RESPONSE',
        nonce,
        requestId,
        ...res
      }, targetOrigin());
    };

    switch (type) {
      case 'PING': {
        reply({ success: true });
        break;
      }
      case 'NAVIGATE_FB_TAB': {
        try {
          const href = payload && payload.href;
          let navigated = false;

          if (href && typeof window.require === 'function') {
            let pathAndQuery = href;
            try {
              const u = new URL(href, window.location.origin);
              pathAndQuery = u.pathname + u.search;
            } catch (e) {}

            try {
              const routerModule = window.require('currentCometRouterInstance');
              if (routerModule && typeof routerModule.get_THIS_IS_NOT_WHAT_YOU_WANT === 'function') {
                const router = routerModule.get_THIS_IS_NOT_WHAT_YOU_WANT();
                if (router) {
                  const dispatcher = router.dispatcher || (typeof router.getRouterDispatcher === 'function' ? router.getRouterDispatcher() : null) || router;
                  if (dispatcher && typeof dispatcher.go === 'function') {
                    dispatcher.go(pathAndQuery);
                    navigated = true;
                  } else if (dispatcher && typeof dispatcher.goTo === 'function') {
                    dispatcher.goTo(pathAndQuery);
                    navigated = true;
                  }
                }
              }
            } catch (e) {}

            if (!navigated) {
              try {
                const cometRouter = window.require('CometRouter');
                if (cometRouter && typeof cometRouter.navigate === 'function') {
                  cometRouter.navigate(pathAndQuery);
                  navigated = true;
                }
              } catch (e) {}
            }
          }

          reply({ success: true, payload: { navigated } });
        } catch (err) {
          reply({ success: false, error: err.message });
        }
        break;
      }
      default:
        break;
    }
  });

  // Notify isolated world on SPA navigation (pushState / replaceState / popstate)
  // so target changes clear media immediately rather than waiting for polling.
  const notifyNavigation = () => {
    if (!session.nonce) return;
    try {
      window.postMessage({
        source: 'SMD_FB_NAVIGATION_CHANGED',
        nonce: session.nonce,
        payload: { href: window.location.href }
      }, targetOrigin());
    } catch (e) {}
  };
  try {
    if (typeof history !== 'undefined' && typeof history.pushState === 'function') {
      const origPush = history.pushState;
      history.pushState = function (...args) {
        const res = origPush.apply(this, args);
        notifyNavigation();
        return res;
      };
    }
    if (typeof history !== 'undefined' && typeof history.replaceState === 'function') {
      const origReplace = history.replaceState;
      history.replaceState = function (...args) {
        const res = origReplace.apply(this, args);
        notifyNavigation();
        return res;
      };
    }
    window.addEventListener('popstate', notifyNavigation);
  } catch (e) {}
})();
