/**
 * Regression tests for Stage 1 audit blockers in src/content/content.js:
 *  - AUDIT-01: TRIGGER_SCAN_ALL executes full scans on Reddit & Facebook (not blocked by isScanning).
 *  - AUDIT-04: Shadow DOM uses closed mode, batches without requestId are rejected, untrusted clicks blocked.
 *  - AUDIT-08: Failed START_DOWNLOAD leaves scan action buttons enabled.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

function makeElement(tag = 'div', id = '') {
  const listeners = new Map();
  const el = {
    tagName: tag.toUpperCase(),
    id,
    className: '',
    disabled: false,
    checked: false,
    value: 'zip',
    style: {},
    dataset: {},
    children: [],
    attributes: {},
    shadowInit: null,
    classList: {
      _s: new Set(),
      add(...c) { c.forEach((x) => this._s.add(x)); },
      remove(...c) { c.forEach((x) => this._s.delete(x)); },
      toggle(c, f) {
        if (f === undefined) {
          if (this._s.has(c)) this._s.delete(c); else this._s.add(c);
        } else if (f) this._s.add(c); else this._s.delete(c);
      },
      contains(c) { return this._s.has(c); }
    },
    setAttribute(k, v) { this.attributes[k] = String(v); },
    getAttribute(k) { return this.attributes[k] ?? null; },
    appendChild(child) { child.parentElement = this; child.parentNode = this; this.children.push(child); return child; },
    insertBefore(child) { return this.appendChild(child); },
    attachShadow(init) {
      this.shadowInit = init;
      const shadow = makeElement('shadow-root');
      shadow._byId = new Map();
      shadow.querySelector = (sel) => {
        if (sel.startsWith('#')) {
          const k = sel.slice(1);
          if (!shadow._byId.has(k)) shadow._byId.set(k, makeElement('button', k));
          return shadow._byId.get(k);
        }
        return makeElement();
      };
      shadow.querySelectorAll = (sel) => {
        if (sel === '.smd-btn-action') {
          return ['smd-scan-all', 'smd-scan-posts'].map((k) => shadow.querySelector('#' + k));
        }
        return [];
      };
      return shadow;
    },
    addEventListener(ev, fn) {
      if (!listeners.has(ev)) listeners.set(ev, []);
      listeners.get(ev).push(fn);
    },
    removeEventListener() {},
    trigger(ev, eventObj = { isTrusted: true }) {
      for (const fn of listeners.get(ev) || []) fn(eventObj);
    },
    click(eventObj = { isTrusted: true }) { this.trigger('click', eventObj); },
    querySelector(/** @type {string} */ _sel = '') { return makeElement(); },
    querySelectorAll() { return []; },
    closest() { return null; },
    scrollIntoView() {},
    dispatchEvent() { return true; },
    focus() {},
    remove() {},
    innerText: '',
    textContent: '',
    innerHTML: '',
    src: '',
    alt: ''
  };
  return el;
}

function bootContent(urlStr, { onRuntimeMessage = (/** @type {any} */ _msg) => ({ success: true }), onBridgeMessage = (/** @type {any} */ _msg) => ({ success: true }) } = {}) {
  const source = fs.readFileSync(new URL('../../src/content/content.js', import.meta.url), 'utf8');
  const parsed = new URL(urlStr);
  const runtimeListeners = [];
  const winMessageListeners = [];
  const sentBridge = [];
  const sentRuntime = [];
  let shadowRef = null;
  let shadowMode = null;

  const doc = {
    readyState: 'complete',
    title: 'Test Page',
    body: makeElement('body'),
    head: makeElement('head'),
    documentElement: makeElement('html'),
    createElement(tag) {
      const el = makeElement(tag);
      const origAttach = el.attachShadow.bind(el);
      el.attachShadow = (init) => {
        shadowMode = init?.mode || null;
        shadowRef = origAttach(init);
        return shadowRef;
      };
      return el;
    },
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {}
  };

  let realmGlobal;
  const win = {
    location: {
      href: parsed.href,
      hostname: parsed.hostname,
      pathname: parsed.pathname,
      search: parsed.search,
      hash: parsed.hash,
      origin: parsed.origin
    },
    history: { pushState() {}, replaceState() {} },
    innerHeight: 900,
    scrollY: 0,
    scrollTo() {},
    scrollBy() {},
    addEventListener(ev, fn) { if (ev === 'message') winMessageListeners.push(fn); },
    removeEventListener() {},
    dispatchEvent() { return true; },
    postMessage(data, targetOrigin) {
      sentBridge.push({ data, targetOrigin });
      if (data?.source === 'SMD_CONTENT') {
        const res = onBridgeMessage(data);
        if (res) {
          const respSource = parsed.hostname.includes('instagram') ? 'SMD_IG_INJECTED_RESPONSE' : 'SMD_FB_INJECTED_RESPONSE';
          queueMicrotask(() => {
            for (const fn of winMessageListeners) {
              fn({ source: realmGlobal, data: { source: respSource, nonce: data.nonce, requestId: data.requestId, ...res } });
            }
          });
        }
      }
    }
  };
  win.top = win;

  const chromeStub = {
    runtime: {
      id: 'ext_test',
      getURL: (p) => p.endsWith('.js') ? pathToFileURL(path.resolve(p)).href : `chrome-extension://ext_test/${p}`,
      lastError: null,
      sendMessage(msg, cb) {
        sentRuntime.push(msg);
        const res = onRuntimeMessage(msg);
        if (typeof cb === 'function') queueMicrotask(() => cb(res));
        return Promise.resolve(res);
      },
      onMessage: { addListener: (fn) => runtimeListeners.push(fn) }
    },
    i18n: { getMessage: (k) => k }
  };

  const sandbox = {
    window: win,
    document: doc,
    history: win.history,
    chrome: chromeStub,
    URL, URLSearchParams, Map, Set, Promise, Math, Date, Object, Array, Number, String, Boolean, RegExp, Error, TypeError, JSON,
    crypto: globalThis.crypto,
    console: { log() {}, warn() {}, error() {}, info() {} },
    setTimeout: (fn) => { queueMicrotask(fn); return 1; },
    clearTimeout() {},
    setInterval: () => 1,
    clearInterval() {},
    Event: class Event {},
    PopStateEvent: class PopStateEvent {},
    MouseEvent: class MouseEvent {},
    PointerEvent: class PointerEvent {},
    IntersectionObserver: class { observe() {} unobserve() {} }
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(source, ctx, {
    filename: 'src/content/content.js',
    importModuleDynamically: /** @type {any} */ (vm.constants?.USE_MAIN_CONTEXT_DEFAULT_LOADER) || ((specifier) => {
      const file = String(specifier).replace('chrome-extension://ext_test/', '');
      return import(pathToFileURL(path.resolve(file)).href);
    })
  });
  realmGlobal = vm.runInContext('globalThis', ctx);

  return {
    sentBridge,
    sentRuntime,
    getShadow: () => shadowRef,
    getShadowMode: () => shadowMode,
    deliverWindowMessage(data) {
      for (const fn of winMessageListeners) fn({ source: realmGlobal, data });
    },
    sendToContent(msg) {
      return new Promise((resolve) => {
        for (const fn of runtimeListeners) fn(msg, {}, resolve);
      });
    },
    notifyContent(msg) {
      for (const fn of runtimeListeners) fn(msg, {}, () => {});
    }
  };
}

export async function runContentScanRegressionTests() {
  // 1. AUDIT-01: Reddit TRIGGER_SCAN_ALL must execute REDDIT_SCAN and ingest items.
  {
    let redditScanCalls = 0;
    const vmRun = bootContent('https://www.reddit.com/r/pics/', {
      onRuntimeMessage: (msg) => {
        if (msg.type === 'REDDIT_SCAN') {
          redditScanCalls++;
          return {
            success: true,
            status: 'success',
            items: [{
              id: 'rd1',
              platform: 'reddit',
              type: 'image',
              sourceType: 'reddit_image',
              url: 'https://i.redd.it/sample123.jpg',
              downloadUrl: 'https://i.redd.it/sample123.jpg'
            }]
          };
        }
        return { success: true, settings: {} };
      }
    });
    const res = await vmRun.sendToContent({ type: 'TRIGGER_SCAN_ALL' });
    assert.equal(redditScanCalls, 1, 'Reddit TRIGGER_SCAN_ALL must dispatch REDDIT_SCAN');
    assert.equal(res.count, 1, 'Reddit TRIGGER_SCAN_ALL must ingest returned media');
  }

  // 2. AUDIT-01: Facebook TRIGGER_SCAN_ALL must navigate photo tabs instead of returning early.
  {
    let fbNavCalls = 0;
    const vmRun = bootContent('https://www.facebook.com/exampleuser', {
      onBridgeMessage: (msg) => {
        if (msg.type === 'NAVIGATE_FB_TAB') fbNavCalls++;
        return { success: true, payload: { navigated: true } };
      }
    });
    await vmRun.sendToContent({ type: 'TRIGGER_SCAN_ALL' });
    assert.ok(fbNavCalls >= 3, `Facebook TRIGGER_SCAN_ALL must navigate photo tabs (got ${fbNavCalls})`);
    assert.ok(vmRun.sentBridge.every((m) => m.targetOrigin === 'https://www.facebook.com'),
      'Facebook bridge postMessage must target window.location.origin, not *');
  }

  // 3. AUDIT-04: Closed Shadow DOM, strict requestId on IG batches, and isTrusted guards on privileged buttons.
  {
    let capturedNonce = null;
    const vmRun = bootContent('https://www.instagram.com/exampleuser/', {
      onBridgeMessage: (msg) => {
        capturedNonce = msg.nonce;
        return {
          success: true,
          payload: {
            profile: {
              id: '123',
              username: 'exampleuser',
              hdProfilePicUrl: 'https://scontent.cdninstagram.com/v/1_2_3_n.jpg'
            }
          }
        };
      },
      onRuntimeMessage: (msg) => {
        if (msg.type === 'START_DOWNLOAD') return { success: false, error: 'busy' };
        return { success: true, settings: {} };
      }
    });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(vmRun.getShadowMode(), 'closed', 'In-page overlay Shadow DOM must use mode: closed');
    // AUDIT-09: Visiting a profile page must NOT fire unsolicited FETCH_IG_PROFILE API calls.
    assert.equal(vmRun.sentBridge.filter((m) => m.data?.type === 'FETCH_IG_PROFILE').length, 0,
      'profile page load must not trigger unsolicited FETCH_IG_PROFILE calls');

    // Trigger on-demand avatar scan so nonce is exchanged and 1 item enters state.media
    await vmRun.sendToContent({ type: 'TRIGGER_SCAN_AVATAR' });
    assert.ok(capturedNonce, 'on-demand avatar scan must establish bridge nonce');
    assert.ok(vmRun.sentBridge.every((m) => m.targetOrigin === 'https://www.instagram.com'),
      'Instagram bridge postMessage must target window.location.origin, not *');

    // Forged batch with valid nonce but omitted requestId must be rejected
    vmRun.deliverWindowMessage({
      source: 'SMD_IG_BATCH_POSTS',
      nonce: capturedNonce,
      payload: {
        nodes: [{
          id: 'forged_999',
          media_type: 1,
          image_versions2: { candidates: [{ url: 'https://scontent.cdninstagram.com/v/9_9_9_n.jpg', width: 1080, height: 1080 }] }
        }]
      }
    });
    const stateAfterForged = await vmRun.sendToContent({ type: 'GET_PAGE_STATE' });
    assert.equal(stateAfterForged.media.some((m) => m.id === 'forged_999'), false,
      'IG batch without active requestId must be rejected');

    // Untrusted synthetic clicks on privileged controls must be ignored
    const runtimeBefore = vmRun.sentRuntime.length;
    vmRun.getShadow().querySelector('#smd-btn-cancel-download').click({ isTrusted: false });
    vmRun.getShadow().querySelector('#smd-dedup-toggle').trigger('change', { isTrusted: false, target: { checked: true } });
    assert.equal(vmRun.sentRuntime.length, runtimeBefore, 'untrusted events must not dispatch privileged runtime messages');

    // 4. AUDIT-08: Failed START_DOWNLOAD must NOT leave scan buttons disabled.
    vmRun.getShadow().querySelector('#smd-btn-start-download').click({ isTrusted: true });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(vmRun.getShadow().querySelector('#smd-scan-all').disabled, false,
      'scan buttons must stay enabled after a failed START_DOWNLOAD');
  }

  // 5. AUDIT-05: Facebook main-world injected.js buffers pre-handshake GraphQL and flushes on PING.
  {
    const fbInjSrc = fs.readFileSync(new URL('../../src/plugins/facebook/main-world/injected.js', import.meta.url), 'utf8');
    const fbPosted = [];
    /** @type {any} */
    let msgListener = null;
    const fbWin = {
      location: { origin: 'https://www.facebook.com', href: 'https://www.facebook.com/example' },
      fetch: async (/** @type {string} */ _url) => ({
        clone: () => ({ text: async () => '{"viewer_image":{"uri":"https://scontent.fbcdn.net/1_2_3_n.jpg"}}' })
      }),
      postMessage: (m, origin) => fbPosted.push({ m, origin }),
      addEventListener: (ev, fn) => { if (ev === 'message') msgListener = fn; }
    };
    fbWin.top = fbWin;
    const fbCtx = vm.createContext({ window: fbWin, XMLHttpRequest: function () {}, URL, Promise, String });
    fbCtx.XMLHttpRequest.prototype = { open() {}, send() {} };
    vm.runInContext(fbInjSrc, fbCtx);

    await fbWin.fetch('https://www.facebook.com/api/graphql/');
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(fbPosted.length, 0, 'must buffer before handshake');

    assert.ok(msgListener, 'facebook injected listener should be registered');
    await msgListener({
      isTrusted: true,
      source: fbWin,
      data: { source: 'SMD_CONTENT', nonce: 'fb_nonce_1', requestId: 'req_1', type: 'PING' }
    });
    const batches = fbPosted.filter((x) => x.m?.source === 'SMD_FB_BATCH_PHOTOS');
    assert.equal(batches.length, 1, 'PING handshake must flush buffered pre-handshake GraphQL batches');
    assert.equal(batches[0].origin, 'https://www.facebook.com', 'must post to window.location.origin');
  }

  // 6. AUDIT-09: Instagram injected.js short-circuits HTTP 429 without hammering fallback doc_ids.
  {
    const igInjSrc = fs.readFileSync(new URL('../../src/plugins/instagram/main-world/injected.js', import.meta.url), 'utf8');
    let graphqlFetchCount = 0;
    /** @type {any} */
    let msgListener = null;
    const posted = [];
    const igCtx = vm.createContext({
      URLSearchParams,
      console: { log() {}, info() {}, warn() {}, error() {} },
      document: { cookie: '', querySelector: () => null, querySelectorAll: () => [] },
      location: { href: 'https://www.instagram.com/example/', origin: 'https://www.instagram.com' },
      history: { pushState() {}, replaceState() {} },
      setTimeout: (fn) => { queueMicrotask(fn); return 0; },
      addEventListener: (ev, fn) => { if (ev === 'message') msgListener = fn; },
      postMessage: (m) => posted.push(m),
      fetch: async () => {
        graphqlFetchCount++;
        return { ok: false, status: 429, headers: { get: () => 'application/json' } };
      }
    });
    vm.runInContext('window = globalThis; window.top = window;', igCtx);
    vm.runInContext(igInjSrc, igCtx);
    const igRealm = vm.runInContext('globalThis', igCtx);
    assert.ok(msgListener, 'instagram injected listener should be registered');
    await msgListener({
      isTrusted: true,
      source: igRealm,
      data: { source: 'SMD_CONTENT', nonce: 'n1', requestId: 'r429', type: 'FETCH_IG_POSTS', payload: { username: 'example' } }
    });
    // Page 1 primary + Page 1 connection fallback = at most 2 calls (instead of 24 calls across 8 doc_ids * 3 retries!)
    assert.ok(graphqlFetchCount <= 2, `HTTP 429 must short-circuit immediately (got ${graphqlFetchCount} requests)`);
  }

  // 7. AUDIT-14, AUDIT-15, AUDIT-19, AUDIT-20: Shadow DOM :host, progress flex/skipped/QUEUED,
  //    FB SPA pushState event, and no web_accessible exposure of main-world injected scripts.
  {
    const overlayCss = fs.readFileSync(new URL('../../src/content/inpage_overlay.css', import.meta.url), 'utf8');
    assert.ok(overlayCss.includes(':host {'), 'inpage_overlay.css must style Shadow DOM host via :host');
    assert.ok(!overlayCss.includes('#smd-ui-root'), 'inpage_overlay.css must not rely on dead #smd-ui-root selector inside Shadow DOM');

    const manifest = JSON.parse(fs.readFileSync(new URL('../../manifest.json', import.meta.url), 'utf8'));
    const allWar = (manifest.web_accessible_resources || []).flatMap((g) => g.resources || []);
    assert.ok(!allWar.some((r) => r.includes('main-world/injected.js')),
      'main-world injected.js must not be exposed in web_accessible_resources (AUDIT-20)');

    // Progress card flex display + skippedDuplicates percentage + QUEUED status
    const vmRun = bootContent('https://www.instagram.com/exampleuser/');
    await new Promise((r) => setTimeout(r, 15));
    vmRun.notifyContent({
      type: 'DOWNLOAD_PROGRESS_UPDATE',
      job: { platform: 'instagram', status: 'QUEUED', completed: 0, skippedDuplicates: 0, total: 4 }
    });
    const progressBox = vmRun.getShadow().querySelector('#smd-download-progress-box');
    const cancelBtn = vmRun.getShadow().querySelector('#smd-btn-cancel-download');
    assert.equal(progressBox.style.display, 'flex', 'progress card must use flex layout (AUDIT-14)');
    assert.equal(cancelBtn.style.display, 'inline-block', 'QUEUED job must be treated as running (AUDIT-15)');

    vmRun.notifyContent({
      type: 'DOWNLOAD_PROGRESS_UPDATE',
      job: { platform: 'instagram', status: 'COMPLETED', completed: 0, skippedDuplicates: 4, total: 4 }
    });
    assert.equal(vmRun.getShadow().querySelector('#smd-progress-bar-fill').style.width, '100%',
      'all-duplicate completed download must reach 100% progress (AUDIT-15)');

    // AUDIT-19: Facebook injected.js emits SMD_FB_NAVIGATION_CHANGED on history.pushState
    const fbInjSrc = fs.readFileSync(new URL('../../src/plugins/facebook/main-world/injected.js', import.meta.url), 'utf8');
    const fbPosted = [];
    /** @type {any} */
    let fbListener = null;
    const fbHistory = { pushState(/** @type {any[]} */ ..._a) {}, replaceState(/** @type {any[]} */ ..._a) {} };
    const fbWin = {
      location: { origin: 'https://www.facebook.com', href: 'https://www.facebook.com/userA' },
      fetch: async () => ({ clone: () => ({ text: async () => '' }) }),
      postMessage: (m, origin) => fbPosted.push({ m, origin }),
      addEventListener: (ev, fn) => { if (ev === 'message') fbListener = fn; }
    };
    fbWin.top = fbWin;
    const fbCtx = vm.createContext({ window: fbWin, history: fbHistory, XMLHttpRequest: function () {}, URL, Promise, String });
    fbCtx.XMLHttpRequest.prototype = { open() {}, send() {} };
    vm.runInContext(fbInjSrc, fbCtx);
    assert.ok(fbListener);
    await fbListener({
      isTrusted: true,
      source: fbWin,
      data: { source: 'SMD_CONTENT', nonce: 'nav_nonce', requestId: 'r_nav', type: 'PING' }
    });
    fbWin.location.href = 'https://www.facebook.com/userB';
    fbHistory.pushState({}, '', '/userB');
    assert.ok(fbPosted.some((p) => p.m?.source === 'SMD_FB_NAVIGATION_CHANGED' && p.m?.nonce === 'nav_nonce'),
      'Facebook main-world pushState hook must notify content script via SMD_FB_NAVIGATION_CHANGED');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runContentScanRegressionTests()
    .then(() => console.log('✔ content scan regression tests passed.'))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
