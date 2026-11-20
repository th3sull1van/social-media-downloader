/**
 * Social Media Downloader — SPA Navigation Tracker
 * Tracks URL pathname/search/hash changes across SPA history mutations, popstate,
 * and a lightweight safety-net interval that cleans itself up on context invalidation.
 */

/**
 * @param {{
 *   env?: any,
 *   platform: string,
 *   isContextValid: () => boolean,
 *   onNavigation: (info: { prevKey: string, nextKey: string }) => void,
 *   pollIntervalMs?: number
 * }} options
 */
export function createNavigationTracker({
  env = /** @type {any} */ (globalThis),
  platform,
  isContextValid,
  onNavigation,
  pollIntervalMs = 1000
}) {
  const win = env.window || globalThis;
  const hist = env.history || win.history;
  const setTimer = env.setTimeout || setTimeout;
  const setInt = env.setInterval || setInterval;
  const clearInt = env.clearInterval || clearInterval;

  function currentNavigationKey() {
    const loc = win.location || {};
    return `${platform}::${loc.pathname || ''}::${loc.search || ''}::${loc.hash || ''}`;
  }

  let lastNavigationKey = currentNavigationKey();

  function check() {
    const nextKey = currentNavigationKey();
    if (nextKey !== lastNavigationKey) {
      const prevKey = lastNavigationKey;
      lastNavigationKey = nextKey;
      onNavigation({ prevKey, nextKey });
      return true;
    }
    return false;
  }

  // Patch history.pushState / replaceState + listen to popstate
  try {
    if (hist && typeof hist.pushState === 'function') {
      const origPush = hist.pushState.bind(hist);
      hist.pushState = function (...args) {
        const res = origPush(...args);
        setTimer(check, 60);
        return res;
      };
    }
    if (hist && typeof hist.replaceState === 'function') {
      const origReplace = hist.replaceState.bind(hist);
      hist.replaceState = function (...args) {
        const res = origReplace(...args);
        setTimer(check, 60);
        return res;
      };
    }
    win.addEventListener?.('popstate', () => setTimer(check, 60));
  } catch (e) {}

  let pollTimer = setInt(() => {
    if (!isContextValid()) {
      clearInt(pollTimer);
      pollTimer = null;
      return;
    }
    check();
  }, pollIntervalMs);

  return {
    currentNavigationKey,
    check,
    getLastKey: () => lastNavigationKey,
    destroy() {
      if (pollTimer) {
        clearInt(pollTimer);
        pollTimer = null;
      }
    }
  };
}
