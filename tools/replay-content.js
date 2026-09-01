/**
 * Content-script HAR replay harness.
 * Runs the REAL src/content/content.js inside a Node vm context with a minimal DOM +
 * chrome.* stub, then feeds captured HAR nodes through the real postMessage bridge
 * (with nonce) and compares the accumulated media state against the canonical
 * plugin pipeline (InstagramNormalizer). This is the behavioral-parity check for the
 * deliberate content-script duplication (content script is a classic script, so it cannot import the normalizer).
 *
 * Usage: bun tools/replay-content.js <capture.har> [...]
 */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { extractTimelineNodes, extractStoryItems } from './har-replay.js';
import { InstagramNormalizer } from '../src/plugins/instagram/InstagramNormalizer.js';

/**
 * Builds a minimal fake DOM element.
 */
function fakeElement(tag = 'div') {
  const el = {
    tagName: tag,
    style: {},
    dataset: {},
    children: [],
    attributes: {},
    classList: {
      add() {}, remove() {}, toggle() {}, contains() { return false; }
    },
    setAttribute(k, v) { this.attributes[k] = String(v); },
    getAttribute(k) { return this.attributes[k] ?? null; },
    appendChild(child) { this.children.push(child); return child; },
    attachShadow() {
      const shadow = fakeElement('shadow-root');
      shadow.getElementById = /** @type {any} */ ((id) => shadow.querySelector(`#${id}`));
      return shadow;
    },
    addEventListener() {},
    removeEventListener() {},
    querySelector(/** @type {string} */ _selector = '') { return fakeElement(); },
    querySelectorAll() { return []; },
    closest() { return null; },
    scrollIntoView() {},
    dispatchEvent() { return true; },
    click() {},
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

/**
 * Replays a HAR capture through the real content script.
 * @param {string} harPath
 * @returns {Promise<Object>} replay results
 */
export async function replayContentScript(harPath) {
  const { nodes } = extractTimelineNodes(harPath);
  const { storyItems } = extractStoryItems(harPath);

  const contentSource = fs.readFileSync(
    new URL('../src/content/content.js', import.meta.url),
    'utf8'
  );

  // --- captured chrome surface ---
  const sentRuntimeMessages = [];
  const onMessageListeners = [];
  const chromeStub = {
    runtime: {
      getURL: (p) => 'chrome-extension://smd/' + p,
      lastError: null,
      sendMessage: (msg, cb) => {
        sentRuntimeMessages.push(msg);
        if (typeof cb === 'function') cb({});
        return Promise.resolve({});
      },
      onMessage: {
        addListener: (fn) => onMessageListeners.push(fn)
      }
    },
    i18n: {
      getMessage: () => ''
    }
  };

  // --- window/message plumbing ---
  const messageListeners = [];
  const sandbox = {
    console,
    Math: { random: () => 0.5, floor: Math.floor, min: Math.min, max: Math.max, round: Math.round, abs: Math.abs },
    JSON, Promise, Object, Array, String, Number, Boolean, RegExp, Error,
    Map, Set, URL, URLSearchParams, Uint8Array, ArrayBuffer, Blob,
    // Timer stub: run callbacks on the next macrotask regardless of delay. This keeps
    // pagination waits fast and makes the 30s bridge timeout resolve harmlessly after
    // (never before) the microtask-based fake injected replies.
    setTimeout: (fn, ...rest) => setImmediate(() => fn()),
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    navigator: { userAgent: 'HAR-Replay/1.0' },
    chrome: chromeStub,
    location: {
      hostname: 'www.instagram.com',
      pathname: '/matiasvazquezok/',
      search: '',
      origin: 'https://www.instagram.com',
      href: 'https://www.instagram.com/matiasvazquezok/'
    },
    history: {
      pushState() {}, replaceState() {}, state: null, length: 1
    },
    Event: class Event { constructor(type) { this.type = type; } },
    MouseEvent: class MouseEvent { constructor() {} },
    PointerEvent: class PointerEvent { constructor() {} },
    PopStateEvent: class PopStateEvent { constructor() {} },
    document: {
      readyState: 'complete',
      head: fakeElement('head'),
      documentElement: fakeElement('html'),
      body: fakeElement('body'),
      title: '',
      createElement: (tag) => fakeElement(tag),
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener() {},
      removeEventListener() {}
    }
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.top = sandbox;
  sandbox.addEventListener = (type, fn) => {
    if (type === 'message') messageListeners.push(fn);
  };
  sandbox.removeEventListener = () => {};
  sandbox.dispatchEvent = () => true;

  // Deterministic nonce mirror: content.js computes 'smd_' + Math.random().toString(36).slice(2,12)
  // with Math.random()===0.5 on both sides, so the expected nonce is computable here.
  const expectedNonce = 'smd_' + (0.5).toString(36).slice(2, 12);

  /** Deliver a window message event to the content script. */
  function deliver(data) {
    const event = { source: realmGlobal, data, origin: 'https://www.instagram.com' };
    for (const fn of [...messageListeners]) fn(event);
  }

  // Fake injected world: answers SMD_CONTENT requests with the correct nonce.
  let profileReply = { success: true, payload: { profile: { id: 'u123', username: 'matiasvazquezok', hdProfilePicUrl: null } } };
  let storiesReply = { success: true, payload: { items: storyItems } };

  sandbox.postMessage = (msg) => {
    if (!msg || msg.source !== 'SMD_CONTENT') return;
    const reply = (payload) => {
      queueMicrotask(() => {
        deliver({
          source: 'SMD_IG_INJECTED_RESPONSE',
          nonce: expectedNonce,
          requestId: msg.requestId,
          ...payload
        });
      });
    };
    switch (msg.type) {
      case 'FETCH_IG_PROFILE': reply(profileReply); break;
      case 'FETCH_IG_POSTS': reply({ success: true, payload: { nodes: [] } }); break;
      case 'FETCH_IG_STORIES': reply(storiesReply); break;
      case 'FETCH_IG_HIGHLIGHTS': reply({ success: true, payload: { items: [] } }); break;
      default: reply({ success: true }); break;
    }
  };

  // --- run the real content script ---
  const context = vm.createContext(sandbox);
  // The real content script lazy-imports shared modules (MetaNode, MetaCdn)
  // via chrome.runtime.getURL(); resolve those to the real files on disk so
  // the replay exercises the actual production code path.
  vm.runInContext(contentSource, context, {
    filename: 'src/content/content.js',
    importModuleDynamically: (specifier) => {
      const file = String(specifier).replace('chrome-extension://smd/', '');
      return import(path.resolve(file));
    }
  });

  // The content script compares event.source against its in-context `window`.
  // From outside the realm, that is the contextified global proxy — NOT the raw
  // sandbox object. Delivering with the raw object would fail the very first
  // `event.source !== window` check and silently drop every message.
  const realmGlobal = /** @type {any} */ (vm.runInContext('globalThis', context));

  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));

  const getSendResponse = () => {
    let captured;
    const sendResponse = (res) => { captured = res; };
    return { sendResponse, get: () => captured };
  };

  function pageState() {
    for (const fn of onMessageListeners) {
      const sr = getSendResponse();
      fn({ type: 'GET_PAGE_STATE' }, {}, sr.sendResponse);
      if (sr.get()) return sr.get();
    }
    return null;
  }

  const sizeAfterInit = (pageState()?.media || []).length;

  // 1. Spoofed batch (no nonce) must be ignored.
  deliver({ source: 'SMD_IG_BATCH_POSTS', payload: { nodes } });
  const sizeAfterSpoof = (pageState()?.media || []).length;

  // 2. Genuine batch (with nonce) must be ingested.
  deliver({ source: 'SMD_IG_BATCH_POSTS', nonce: expectedNonce, payload: { nodes } });
  await new Promise((r) => setImmediate(r));
  const sizeAfterBatch = (pageState()?.media || []).length;

  // 3. Stories through the real request path (TRIGGER_SCAN_STORIES → bridge → reply).
  for (const fn of onMessageListeners) {
    const sr = getSendResponse();
    fn({ type: 'TRIGGER_SCAN_STORIES' }, {}, sr.sendResponse);
  }
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  const sizeAfterStories = (pageState()?.media || []).length;

  const contentItems = pageState()?.media || [];

  // --- canonical parity ---
  // Build the canonical set with the SAME dedup rule the content script uses
  // (keep the higher-resolution variant when the same id appears twice — e.g.
  // pagination overlap between captured pages). A last-wins map would produce
  // false URL mismatches on overlapping captures.
  const canonicalById = new Map();
  const bump = (item) => {
    const existing = canonicalById.get(item.id);
    if (!existing) {
      canonicalById.set(item.id, item);
      return;
    }
    const newPixels = (item.width || 0) * (item.height || 0);
    const oldPixels = (existing.width || 0) * (existing.height || 0);
    const newIsVideo = item.type === 'video' && existing.type !== 'video';
    if (newPixels > oldPixels || newIsVideo) canonicalById.set(item.id, item);
  };
  for (const n of nodes) {
    for (const item of InstagramNormalizer.normalizePost(n)) bump(item);
  }
  for (const it of storyItems) {
    const item = InstagramNormalizer.normalizeStory(
      it,
      it._highlightTitle ? 'highlights' : 'stories',
      it._highlightTitle
    );
    if (item) bump(item);
  }

  const contentById = new Map(contentItems.map((m) => [m.id, m]));

  const missingInContent = [...canonicalById.keys()].filter((id) => !contentById.has(id));
  const extraInContent = [...contentById.keys()].filter((id) => !canonicalById.has(id));

  /** @type {string[]} */
  const fieldMismatches = [];
  for (const [id, canon] of canonicalById) {
    const mine = contentById.get(id);
    if (!mine) continue;
    if (mine.type !== canon.type) fieldMismatches.push(`${id}: type ${mine.type} != ${canon.type}`);
    if ((mine.downloadUrl || '') !== (canon.downloadUrl || '')) {
      fieldMismatches.push(`${id}: downloadUrl differs`);
    }
    if ((mine.thumbnailUrl || '') !== (canon.thumbnailUrl || '')) {
      fieldMismatches.push(`${id}: thumbnailUrl differs`);
    }
    if ((mine.width || 0) !== (canon.width || 0) || (mine.height || 0) !== (canon.height || 0)) {
      fieldMismatches.push(`${id}: dimensions differ`);
    }
  }

  return {
    harPath,
    nodes: nodes.length,
    storyItems: storyItems.length,
    sizeAfterInit,
    spoofRejected: sizeAfterSpoof === sizeAfterInit,
    sizeAfterBatch,
    sizeAfterStories,
    contentItems,
    canonicalCount: canonicalById.size,
    missingInContent,
    extraInContent,
    fieldMismatches
  };
}

/**
 * Replays the target-avatar paths in the real classic content script. This is
 * intentionally separate from the Instagram media replay above: Facebook
 * receives avatar data through the main-world batch bridge, while Reddit gets
 * it through the plugin-owned lightweight message.
 *
 * @param {{ platform: 'facebook'|'reddit', location: { hostname: string, pathname: string, search?: string, origin: string, href: string }, facebookPayload?: any, facebookPayloads?: any[], facebookInitialPayloads?: any[], redditAvatarUrl?: string }} options
 * @returns {Promise<{ avatarUrl: string, targetName: string, media: any[], messages: any[] }>}
 */
export async function replayTargetAvatarContentScript(options) {
  const contentSource = fs.readFileSync(
    new URL('../src/content/content.js', import.meta.url),
    'utf8'
  );

  const onMessageListeners = [];
  const messageListeners = [];
  const messages = [];
  const redditAvatarUrl = options.redditAvatarUrl || '';
  const chromeStub = {
    runtime: {
      getURL: (p) => 'chrome-extension://smd/' + p,
      lastError: null,
      sendMessage: (msg, cb) => {
        messages.push(msg);
        if (typeof cb === 'function') {
          if (msg?.type === 'REDDIT_FETCH_AVATAR') {
            cb({ success: true, avatarUrl: redditAvatarUrl });
          } else {
            cb({});
          }
        }
        return Promise.resolve({});
      },
      onMessage: {
        addListener: (fn) => onMessageListeners.push(fn)
      }
    },
    i18n: { getMessage: () => '' }
  };

  const location = {
    search: '',
    ...options.location
  };
  const initialFacebookScripts = options.platform === 'facebook' && Array.isArray(options.facebookInitialPayloads)
    ? options.facebookInitialPayloads.map((payload) => ({ textContent: JSON.stringify(payload) }))
    : [];
  const sandbox = {
    console,
    Math: { random: () => 0.5, floor: Math.floor, min: Math.min, max: Math.max, round: Math.round, abs: Math.abs },
    JSON, Promise, Object, Array, String, Number, Boolean, RegExp, Error,
    Map, Set, URL, URLSearchParams, Uint8Array, ArrayBuffer, Blob,
    setTimeout: (fn) => setImmediate(() => fn()),
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    navigator: { userAgent: 'HAR-Replay/1.0' },
    chrome: chromeStub,
    location,
    history: { pushState() {}, replaceState() {}, state: null, length: 1 },
    document: {
      readyState: 'complete',
      head: fakeElement('head'),
      documentElement: fakeElement('html'),
      body: fakeElement('body'),
      title: '',
      createElement: (tag) => fakeElement(tag),
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: (selector = '') => selector === 'script[type="application/json"]'
        ? initialFacebookScripts
        : [],
      addEventListener() {},
      removeEventListener() {}
    }
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.top = sandbox;
  sandbox.addEventListener = (type, fn) => {
    if (type === 'message') messageListeners.push(fn);
  };
  sandbox.removeEventListener = () => {};
  sandbox.dispatchEvent = () => true;

  const expectedNonce = 'smd_' + (0.5).toString(36).slice(2, 12);
  const context = vm.createContext(sandbox);
  vm.runInContext(contentSource, context, {
    filename: 'src/content/content.js',
    importModuleDynamically: (specifier) => {
      const file = String(specifier).replace('chrome-extension://smd/', '');
      return import(path.resolve(file));
    }
  });
  const realmGlobal = /** @type {any} */ (vm.runInContext('globalThis', context));

  if (options.platform === 'facebook') {
    const payloads = Array.isArray(options.facebookPayloads)
      ? options.facebookPayloads
      : [options.facebookPayload || {}];
    for (const facebookPayload of payloads) {
      const event = {
        source: realmGlobal,
        data: {
          source: 'SMD_FB_BATCH_PHOTOS',
          nonce: expectedNonce,
          payload: { text: JSON.stringify(facebookPayload) }
        },
        origin: options.location.origin
      };
      for (const listener of [...messageListeners]) listener(event);
    }
  }

  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  let pageState = /** @type {any} */ (null);
  for (const listener of onMessageListeners) {
    listener({ type: 'GET_PAGE_STATE' }, {}, (response) => { pageState = response; });
  }
  return {
    avatarUrl: pageState?.avatarUrl || '',
    targetName: pageState?.targetName || '',
    media: pageState?.media || [],
    messages
  };
}

// CLI mode
if (process.argv[1] && process.argv[1].endsWith('replay-content.js')) {
  const harPath = process.argv[2];
  if (!harPath) {
    console.error('Usage: bun tools/replay-content.js <capture.har>');
    process.exit(1);
  }
  const result = await replayContentScript(harPath);
  console.log('HAR:', result.harPath);
  console.log('nodes:', result.nodes, '| story items:', result.storyItems);
  console.log('content items:', result.contentItems.length, '| canonical:', result.canonicalCount);
  console.log('spoof rejected:', result.spoofRejected);
  console.log('missing in content:', result.missingInContent.length, '| extra:', result.extraInContent.length, '| field mismatches:', result.fieldMismatches.length);
  for (const m of result.fieldMismatches.slice(0, 10)) console.log('  DIFF', m);
  if (result.extraInContent.length) console.log('  EXTRA ids:', result.extraInContent.slice(0, 5));
}
