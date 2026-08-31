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

  function broadcastMediaBatch(text) {
    if (!text || !session.nonce) return;
    if (text.includes('viewer_image') || text.includes('"Photo"') || text.includes('TimelineAppCollectionItem')) {
      window.postMessage({
        source: 'SMD_FB_BATCH_PHOTOS',
        nonce: session.nonce,
        payload: { text }
      }, '*');
    }
  }

  // Intercept fetch & XHR to capture all Comet GraphQL responses as user navigates/scrolls
  try {
    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
      const response = await originalFetch.apply(this, args);
      try {
        const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url ? args[0].url : '');
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
      this._smd_fb_url = url;
      return originalXHROpen.call(this, method, url, ...rest);
    };
    XMLHttpRequest.prototype.send = function (...args) {
      this.addEventListener('load', () => {
        try {
          const url = String(this._smd_fb_url || '');
          if ((url.includes('/api/graphql') || url.includes('/graphql/')) && this.responseText) {
            broadcastMediaBatch(this.responseText);
          }
        } catch (e) {}
      });
      return originalXHRSend.apply(this, args);
    };
  } catch (e) {}

  window.addEventListener('message', async (event) => {
    if (event.source !== window || !event.data || event.data.source !== 'SMD_CONTENT') return;
    const { type, requestId, payload } = event.data;
    // Echo the session nonce back: the content script drops responses without it (F-14).
    const nonce = event.data.nonce;
    if (nonce) session.nonce = nonce;

    const reply = (res) => {
      window.postMessage({
        source: 'SMD_FB_INJECTED_RESPONSE',
        nonce,
        requestId,
        ...res
      }, '*');
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
})();