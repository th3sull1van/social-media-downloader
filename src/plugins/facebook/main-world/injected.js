/**
 * Social Media Downloader — Facebook Main World Injected Script
 * Queries Comet GraphQL endpoints directly within the page context.
 */

(function () {
  'use strict';

  if (typeof window !== 'undefined' && window.top && window !== window.top) return;
  if (window.__SMD_FB_INJECTED__) return;
  window.__SMD_FB_INJECTED__ = true;

  const DOC_IDS = {
    FB_ProfileCometAppCollectionPhotos: '27028962643386672',
    FB_ProfileCometTimelineFeedRefetch: '28388886477469027',
    FB_ProfileCometTilesFeedPagination: '28332792132988403',
    FB_CometPhotoRoot: '26613951978296785'
  };

  const session = {
    fb_dtsg: null,
    jazoest: null,
    userId: null,
    nonce: null
  };

  function calculateJazoest(dtsg) {
    if (!dtsg) return null;
    let sum = 0;
    for (let i = 0; i < dtsg.length; i++) sum += dtsg.charCodeAt(i);
    return '2' + sum;
  }

  function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop()?.split(';').shift() || null;
    return null;
  }

  function refreshSessionTokens() {
    session.userId = getCookie('c_user') || session.userId;

    if (typeof window.require === 'function') {
      try {
        const dtsgInitial = window.require('DTSGInitialData');
        if (dtsgInitial?.token) session.fb_dtsg = dtsgInitial.token;
      } catch (e) {}

      try {
        const dtsg = window.require('DTSG');
        if (dtsg && typeof dtsg.getToken === 'function') session.fb_dtsg = dtsg.getToken() || session.fb_dtsg;
      } catch (e) {}

      try {
        const currentUser = window.require('CurrentUserInitialData');
        if (currentUser?.USER_ID && currentUser.USER_ID !== '0') session.userId = currentUser.USER_ID;
      } catch (e) {}
    }

    if (!session.fb_dtsg) {
      const dtsgInput = document.querySelector('input[name="fb_dtsg"]');
      if (dtsgInput?.value) session.fb_dtsg = dtsgInput.value;
    }

    if (!session.fb_dtsg) {
      const scripts = document.querySelectorAll('script:not([src])');
      for (const s of scripts) {
        const text = s.textContent || '';
        const m = text.match(/\["DTSGInitialData",\[\],\{"token":"([^"]+)"\}/) ||
                  text.match(/"token":"(NAf[A-Za-z0-9_\-:]+)"/);
        if (m && m[1]) {
          session.fb_dtsg = m[1];
          break;
        }
      }
    }

    if (session.fb_dtsg) {
      session.jazoest = calculateJazoest(session.fb_dtsg);
    }
  }

  refreshSessionTokens();

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

  async function performGraphQLQuery(docId, friendlyName, variables) {
    refreshSessionTokens();
    const params = new URLSearchParams();
    params.append('doc_id', docId);
    params.append('variables', typeof variables === 'string' ? variables : JSON.stringify(variables));
    if (friendlyName) params.append('fb_api_req_friendly_name', friendlyName);
    if (session.fb_dtsg) params.append('fb_dtsg', session.fb_dtsg);
    if (session.jazoest) params.append('jazoest', session.jazoest);

    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest'
    };

    const response = await fetch('https://www.facebook.com/api/graphql/', {
      method: 'POST',
      headers,
      body: params.toString(),
      credentials: 'include'
    });

    if (!response.ok) {
      throw new Error(`Facebook GraphQL failed: HTTP ${response.status}`);
    }
    return await response.json();
  }

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
      case 'FETCH_FB_GRAPHQL': {
        try {
          const data = await performGraphQLQuery(payload.docId, payload.friendlyName, payload.variables);
          reply({ success: true, payload: { data } });
        } catch (err) {
          reply({ success: false, error: err.message });
        }
        break;
      }
      case 'RESOLVE_FB_PHOTO': {
        try {
          const photoId = payload && (payload.photoId || payload.id);
          if (!photoId) throw new Error('Missing photo ID');
          const data = await performGraphQLQuery(
            DOC_IDS.FB_CometPhotoRoot,
            'CometPhotoRootContentQuery',
            { photo_id: String(photoId), scale: 1 }
          );
          reply({ success: true, payload: { data } });
        } catch (err) {
          reply({ success: false, error: err.message });
        }
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
