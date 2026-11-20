/**
 * Social Media Downloader — Main-World PostMessage Bridge
 * Nonce-verified, origin-locked request/response & streaming bridge between
 * the isolated content script and main-world platform injectors.
 */

/**
 * @typedef {Object} BridgeEnv
 * @property {Window & typeof globalThis | any} window
 * @property {typeof setTimeout} setTimeout
 * @property {typeof clearTimeout} clearTimeout
 * @property {Math | any} [Math]
 * @property {Console | any} [console]
 */

/**
 * @param {{
 *   env?: BridgeEnv,
 *   nonce: string,
 *   idleTimeoutMs?: number,
 *   responseSources?: string[],
 *   onMessage?: (data: any) => void
 * }} options
 */
export function createMainWorldBridge({
  env = /** @type {any} */ (globalThis),
  nonce,
  idleTimeoutMs = 30000,
  responseSources = ['SMD_IG_INJECTED_RESPONSE', 'SMD_FB_INJECTED_RESPONSE'],
  onMessage = () => {}
}) {
  const win = env.window || globalThis;
  const setTimer = env.setTimeout || setTimeout;
  const clearTimer = env.clearTimeout || clearTimeout;
  const mathObj = env.Math || Math;
  const log = env.console || console;
  const responseSourceSet = new Set(responseSources);

  /** @type {Map<string, { resolve: Function, context: any, timer: any, resetTimer: () => void }>} */
  const pendingRequests = new Map();

  function getTargetOrigin() {
    const origin = win?.location?.origin;
    return origin && origin !== 'null' ? origin : '*';
  }

  /**
   * Sends a nonce-authenticated message to the main-world script and waits for its response.
   * Resets its inactivity timer whenever `touchRequest(requestId)` is invoked.
   * @param {string} type
   * @param {Record<string, any>} [payload]
   * @param {{ generation: number, requestIds: Set<string>, cancelled?: boolean } | null} [context]
   * @returns {Promise<any>}
   */
  function send(type, payload = {}, context = null) {
    return new Promise((resolve) => {
      const requestId = 'req_' + mathObj.random().toString(36).slice(2, 9);
      if (context) context.requestIds.add(requestId);

      const entry = {
        resolve,
        context,
        timer: /** @type {any} */ (null),
        resetTimer() {
          if (entry.timer) clearTimer(entry.timer);
          entry.timer = setTimer(() => {
            if (!pendingRequests.has(requestId)) return;
            pendingRequests.delete(requestId);
            if (context) context.requestIds.delete(requestId);
            log?.warn?.(`[SMD Bridge] ${type} timed out after ${idleTimeoutMs / 1000}s of inactivity.`);
            if (type !== 'CANCEL_SCAN' && type !== 'PING') {
              try {
                win.postMessage({
                  source: 'SMD_CONTENT',
                  nonce,
                  type: 'CANCEL_SCAN',
                  requestId: 'req_cancel_' + requestId,
                  payload: {}
                }, getTargetOrigin());
              } catch (e) {}
            }
            resolve({ success: false, status: 'network_failure', error: 'Timeout' });
          }, idleTimeoutMs);
        }
      };

      pendingRequests.set(requestId, entry);
      entry.resetTimer();

      win.postMessage({
        source: 'SMD_CONTENT',
        nonce,
        type,
        requestId,
        payload: context ? { ...payload, generation: context.generation } : payload
      }, getTargetOrigin());
    });
  }

  /**
   * Resets the idle timeout for an active streaming request.
   * @param {string} requestId
   */
  function touchRequest(requestId) {
    const pending = pendingRequests.get(requestId);
    if (pending && typeof pending.resetTimer === 'function') {
      pending.resetTimer();
    }
  }

  /**
   * Processes a verified (same-window, valid-nonce) message payload.
   * @param {any} data
   */
  function dispatchData(data) {
    if (!data || data.nonce !== nonce) return;
    const { source, requestId, success, status, payload, error } = data;

    if (responseSourceSet.has(source) && pendingRequests.has(requestId)) {
      const entry = pendingRequests.get(requestId);
      pendingRequests.delete(requestId);
      if (entry?.timer) clearTimer(entry.timer);
      entry?.resolve?.({ success, status, payload, error, requestId });
    }

    onMessage(data);
  }

  return {
    nonce,
    pendingRequests,
    send,
    touchRequest,
    dispatchData
  };
}
