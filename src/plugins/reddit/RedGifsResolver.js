/**
 * Social Media Downloader — RedGifs Resolver
 * Handles RedGifs API v2 bearer token auth, caching, and stream resolution.
 */

export class RedGifsResolver {
  static _token = null;
  static _tokenExpiry = 0;

  static async getToken() {
    if (RedGifsResolver._token && Date.now() < RedGifsResolver._tokenExpiry) {
      return RedGifsResolver._token;
    }
    try {
      const res = await fetch('https://api.redgifs.com/v2/auth/temporary');
      if (!res.ok) throw new Error(`HTTP ${res.status} when authenticating with RedGifs`);
      const data = await res.json();
      RedGifsResolver._token = data.token;
      RedGifsResolver._tokenExpiry = Date.now() + (23 * 60 * 60 * 1000);
      return RedGifsResolver._token;
    } catch (err) {
      return null;
    }
  }

  /**
   * Resolves RedGifs URL to direct high-res MP4 video stream.
   * @param {string} url
   * @returns {Promise<Object>}
   */
  static async resolve(url) {
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
      try {
        const response = await new Promise((resolve) => {
          chrome.runtime.sendMessage({ action: 'RESOLVE_REDGIFS', url }, (res) => {
            if (chrome.runtime.lastError) {
              resolve({ success: false, error: chrome.runtime.lastError.message });
            } else {
              resolve(res || { success: false, error: 'No response from background worker' });
            }
          });
        });
        if (response && response.success && response.data) {
          return response.data;
        }
      } catch (err) {}
    }

    // 3. Direct API resolution (service worker / Node / test environments)
    const match = url.match(/redgifs\.com\/(?:watch|ifr|gifs)\/([a-zA-Z0-9_-]+)/i);
    let id = match ? match[1] : url.split('/').pop()?.split('?')[0] || '';
    id = id.toLowerCase().trim();

    if (!id) throw new Error(`RedGifs ID not found in URL: ${url}`);

    let token = await RedGifsResolver.getToken();
    const headers = token ? { 'Authorization': `Bearer ${token}` } : {};

    let res = await fetch(`https://api.redgifs.com/v2/gifs/${id}?views=yes&users=yes&niches=yes`, { headers });
    if (res.status === 401) {
      RedGifsResolver._token = null;
      token = await RedGifsResolver.getToken();
      res = await fetch(`https://api.redgifs.com/v2/gifs/${id}?views=yes&users=yes&niches=yes`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
    }

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} when querying RedGifs for ${id}`);
    }

    const data = await res.json();
    const gif = data?.gif;
    const urls = gif?.urls || {};
    const directMp4 = urls.hd || urls.sd || urls.silent || '';

    if (!directMp4) {
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
