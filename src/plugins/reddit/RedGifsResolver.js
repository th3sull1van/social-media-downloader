/**
 * Social Media Downloader — RedGifs Resolver
 * Handles RedGifs API v2 bearer token auth, caching, and stream resolution.
 */

export class RedGifsResolver {
  static _token = null;
  static _tokenExpiry = 0;
  static _tokenPromise = null;
  /** @type {AbortController | null} */
  static _tokenAbortController = null;
  static _tokenWaiters = 0;

  static async getToken(signal = undefined) {
    signal?.throwIfAborted();
    if (RedGifsResolver._token && Date.now() < RedGifsResolver._tokenExpiry) {
      return RedGifsResolver._token;
    }
    if (!RedGifsResolver._tokenPromise) {
      const controller = new AbortController();
      RedGifsResolver._tokenAbortController = controller;
      RedGifsResolver._tokenPromise = (async () => {
        try {
          const res = await fetch('https://api.redgifs.com/v2/auth/temporary', { signal: controller.signal });
          if (!res.ok) throw new Error(`HTTP ${res.status} when authenticating with RedGifs`);
          const data = await res.json();
          if (!data?.token) return null;
          RedGifsResolver._token = data.token;
          RedGifsResolver._tokenExpiry = Date.now() + (23 * 60 * 60 * 1000);
          return RedGifsResolver._token;
        } catch (err) {
          if (controller.signal.aborted) throw err;
          return null;
        } finally {
          if (RedGifsResolver._tokenAbortController === controller) {
            RedGifsResolver._tokenAbortController = null;
            RedGifsResolver._tokenPromise = null;
          }
        }
      })();
    }

    const sharedPromise = RedGifsResolver._tokenPromise;
    const sharedController = RedGifsResolver._tokenAbortController;
    RedGifsResolver._tokenWaiters++;
    let onAbort = null;
    try {
      if (!signal) return await sharedPromise;
      return await new Promise((resolve, reject) => {
        onAbort = () => {
          reject(signal.reason || new DOMException('Aborted', 'AbortError'));
        };
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
        sharedPromise.then(resolve, reject);
      });
    } finally {
      if (signal && onAbort) signal.removeEventListener('abort', onAbort);
      RedGifsResolver._tokenWaiters = Math.max(0, RedGifsResolver._tokenWaiters - 1);
      if (RedGifsResolver._tokenWaiters === 0 && sharedController && RedGifsResolver._tokenAbortController === sharedController) {
        sharedController.abort();
      }
    }
  }

  /**
   * Resolves RedGifs URL to direct high-res MP4 video stream.
   * @param {string} url
   * @param {AbortSignal} [signal]
   * @returns {Promise<Object>}
   */
  static async resolve(url, signal = undefined) {
    if (!url) throw new Error('Empty RedGifs URL');

    // 1. Service-worker context: resolve directly (the SW holds host permissions and a
    //    privileged network context). Messaging itself here would be a self-loop: the
    //    RESOLVE_REDGIFS handler lives in this same process, so sending a message to
    //    ourselves would be a self-loop.
    const isServiceWorker =
      typeof importScripts === 'function' ||
      (typeof WorkerGlobalScope !== 'undefined' && typeof self !== 'undefined' && self instanceof WorkerGlobalScope);

    // 2. Content/popup contexts: resolve via background worker to bypass CORS
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage && !isServiceWorker) {
      let runtimeResponse = null;
      let hadRuntimeError = false;
      try {
        runtimeResponse = await new Promise((resolve) => {
          chrome.runtime.sendMessage({ action: 'RESOLVE_REDGIFS', url }, (res) => {
            if (chrome.runtime.lastError) {
              hadRuntimeError = true;
              resolve({ success: false, error: chrome.runtime.lastError.message });
            } else {
              resolve(res || { success: false, error: 'No response from background worker' });
            }
          });
        });
      } catch (err) {
        hadRuntimeError = true;
      }
      if (runtimeResponse && runtimeResponse.success && runtimeResponse.data) {
        return runtimeResponse.data;
      }
      if (runtimeResponse && runtimeResponse.success === false && !hadRuntimeError) {
        throw new Error(runtimeResponse.error || 'RedGifs resolution failed');
      }
    }

    // 3. Direct API resolution (service worker / Node / test environments)
    const match = url.match(/redgifs\.com\/(?:watch|ifr|gifs)\/([a-zA-Z0-9_-]+)/i);
    let id = match ? match[1] : (url.split(/[?#]/)[0].split('/').filter(Boolean).pop() || '');
    id = id.toLowerCase().trim();

    if (!id || !/^[a-z0-9_-]+$/i.test(id)) {
      throw new Error(`RedGifs ID not found in URL: ${url}`);
    }

    let token = await RedGifsResolver.getToken(signal);
    const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
    const apiUrl = `https://api.redgifs.com/v2/gifs/${encodeURIComponent(id)}?views=yes&users=yes&niches=yes`;

    let res = await fetch(apiUrl, { headers, signal });
    if (res.status === 401) {
      if (RedGifsResolver._token === token) {
        RedGifsResolver._token = null;
        RedGifsResolver._tokenExpiry = 0;
      }
      token = await RedGifsResolver.getToken(signal);
      res = await fetch(apiUrl, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        signal
      });
    }

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} when querying RedGifs for ${id}`);
    }

    const data = await res.json();
    const gif = data?.gif;
    const urls = gif?.urls || {};
    const directMp4 = urls.hd || urls.sd || urls.silent || '';

    if (!directMp4 || !/^https?:\/\//i.test(directMp4)) {
      throw new Error('No MP4 video stream returned by RedGifs.');
    }

    return {
      type: 'video',
      url: directMp4,
      hdUrl: urls.hd,
      sdUrl: urls.sd,
      thumbUrl: urls.thumbnail || urls.poster || '',
      posterUrl: urls.poster || '',
      ext: 'mp4',
      name: gif?.id || id,
      duration: gif?.duration,
      width: gif?.width,
      height: gif?.height,
      hasAudio: gif?.hasAudio
    };
  }
}
