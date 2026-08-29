/**
 * Minimal ambient declarations for browser-extension globals that JSDoc mode
 * cannot otherwise resolve. Intentionally loose: chrome.* surfaces are stubbed
 * at runtime in tests and duck-typed in production code.
 */

/** @type {any} */
declare const chrome: any;

/**
 * Dedicated worker globals used to detect the service-worker context.
 * @type {any}
 */
declare const WorkerGlobalScope: any;

/**
 * JSZip vendored global (loaded via <script> in the offscreen document).
 * @type {any}
 */
declare const JSZip: any;

interface Window {
  /** @type {any} */
  [key: string]: any;
}
