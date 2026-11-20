/**
 * Social Media Downloader — Popup Controller Unit & Integration Tests (AUDIT-25)
 * Executes the REAL src/popup/popup.js against a lightweight DOM + chrome.* harness.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import { MediaItemModel } from '../../src/core/domain/MediaItem.js';

function createPopupHarness({
  tabUrl = 'https://www.reddit.com/user/demo/',
  pluginInfo = {
    id: 'reddit',
    displayName: 'Reddit',
    themeClass: 'reddit-theme',
    mainWorldScript: null,
    mediaHostSuffixes: ['reddit.com', 'redd.it', 'redditmedia.com', 'redditstatic.com', 'redgifs.com', 'imgur.com'],
    capabilities: {
      scan: { page: true, post: true, profile: true, subreddit: true },
      media: { image: true, gallery: true, video: true },
      processing: { deduplication: true },
      runtime: { contentScript: true }
    },
    filters: [
      { id: 'all', labelKey: 'tabAll' },
      { id: 'image', labelKey: 'tabPhotos' },
      { id: 'video', labelKey: 'tabVideos' },
      { id: 'gallery', labelKey: 'tabGalleries' },
      { id: 'redgifs', labelKey: 'tabRedgifs' }
    ]
  },
  settings = { deduplicate: true, historicalDedup: false, defaultFormat: 'zip' },
  activeJob = null,
  pageState = null,
  startDownloadResponse = /** @type {any} */ ({ success: true }),
  scriptingFails = false
} = {}) {
  const popupSrc = fs.readFileSync(new URL('../../src/popup/popup.js', import.meta.url), 'utf8')
    .replace(/import\s*\{\s*MediaItemModel\s*\}\s*from\s*['"][^'"]+['"];?/, '');

  const byId = new Map();
  const allElements = [];

  class FakeHTMLElement {
    constructor(tag = 'div', id = '') {
      this.tagName = tag.toUpperCase();
      this.id = id;
      this.className = '';
      this.style = { display: '' };
      this.attributes = {};
      this.children = [];
      this.parentNode = null;
      this.disabled = false;
      this.checked = false;
      this.selected = false;
      this.type = '';
      this.name = '';
      this.value = '';
      this.src = '';
      this.alt = '';
      this.title = '';
      this.loading = '';
      this.tabIndex = 0;
      this._textContent = '';
      this._listeners = new Map();
      this.classList = {
        _set: new Set(),
        add: (...c) => c.forEach((x) => this.classList._set.add(x)),
        remove: (...c) => c.forEach((x) => this.classList._set.delete(x)),
        toggle: (c, f) => {
          if (f === undefined) {
            if (this.classList._set.has(c)) this.classList._set.delete(c);
            else this.classList._set.add(c);
          } else if (f) this.classList._set.add(c);
          else this.classList._set.delete(c);
        },
        contains: (c) => this.classList._set.has(c)
      };
      allElements.push(this);
      if (id) byId.set(id, this);
    }
    get textContent() { return this._textContent; }
    set textContent(v) {
      this._textContent = String(v ?? '');
      if (this._textContent === '') {
        for (const c of this.children) c.parentNode = null;
        this.children = [];
      }
    }
    get firstElementChild() { return this.children[0] || null; }
    get nextElementSibling() {
      if (!this.parentNode) return null;
      const idx = this.parentNode.children.indexOf(this);
      return idx >= 0 ? (this.parentNode.children[idx + 1] || null) : null;
    }
    setAttribute(k, v) { this.attributes[k] = String(v); }
    getAttribute(k) { return this.attributes[k] ?? null; }
    appendChild(child) { return this.insertBefore(child, null); }
    insertBefore(child, before) {
      child.remove();
      const idx = before ? this.children.indexOf(before) : this.children.length;
      this.children.splice(idx >= 0 ? idx : this.children.length, 0, child);
      child.parentNode = this;
      return child;
    }
    remove() {
      if (this.parentNode) {
        const idx = this.parentNode.children.indexOf(this);
        if (idx >= 0) this.parentNode.children.splice(idx, 1);
      }
      this.parentNode = null;
    }
    addEventListener(ev, fn) {
      if (!this._listeners.has(ev)) this._listeners.set(ev, []);
      this._listeners.get(ev).push(fn);
    }
    dispatch(ev, eventObj = {}) {
      for (const fn of this._listeners.get(ev) || []) {
        fn({ target: this, currentTarget: this, preventDefault() {}, ...eventObj });
      }
    }
    click() { this.dispatch('click'); }
  }
  class FakeHTMLInputElement extends FakeHTMLElement {
    constructor(id = '', type = 'checkbox', name = '', value = '') {
      super('input', id);
      this.type = type;
      this.name = name;
      this.value = value;
    }
  }

  // Create key elements matching popup.html
  const make = (tag, id, cls = '') => {
    const el = new FakeHTMLElement(tag, id);
    el.className = cls;
    cls.split(/\s+/).filter(Boolean).forEach((c) => el.classList.add(c));
    return el;
  };
  for (const id of [
    'inactive-notice', 'active-section', 'platform-badge', 'target-type-label',
    'target-title', 'media-counter', 'subreddit-filter-container', 'filter-subreddit',
    'btn-scan-all', 'scan-all-label', 'btn-scan-posts', 'btn-scan-stories',
    'btn-scan-highlights', 'btn-scan-avatar', 'btn-scan-fb-page', 'btn-scan-fb-tabs',
    'btn-scan-galleries', 'btn-scan-videos', 'btn-scan-redgifs',
    'ig-specific-buttons', 'fb-specific-buttons', 'reddit-specific-buttons',
    'btn-select-all', 'btn-deselect-all', 'btn-dedup', 'selected-summary',
    'media-grid', 'empty-state', 'btn-download', 'download-btn-text',
    'download-progress-container', 'progress-status-text', 'progress-percentage',
    'progress-bar-fill', 'btn-cancel-download', 'popup-historical-dedup-container',
    'popup-clear-history-btn',
    'p-tab-all', 'p-tab-image', 'p-tab-video', 'p-tab-stories',
    'p-tab-highlights', 'p-tab-gallery', 'p-tab-redgifs'
  ]) make('div', id);

  const dedupToggle = new FakeHTMLInputElement('popup-dedup-toggle', 'checkbox');
  const histToggle = new FakeHTMLInputElement('popup-historical-dedup-toggle', 'checkbox');
  const formatInd = new FakeHTMLInputElement('fmt-ind', 'radio', 'download-format', 'individual');
  formatInd.checked = true;
  const formatZip = new FakeHTMLInputElement('fmt-zip', 'radio', 'download-format', 'zip');
  const formatInputs = [formatInd, formatZip];

  const tabs = [
    ['all', 'tab active'],
    ['image', 'tab'],
    ['video', 'tab'],
    ['stories', 'tab ig-only'],
    ['highlights', 'tab ig-only'],
    ['gallery', 'tab reddit-only'],
    ['redgifs', 'tab reddit-only']
  ].map(([filter, cls]) => {
    const t = make('button', '', cls);
    t.setAttribute('data-filter', filter);
    return t;
  });

  const body = make('body', '');
  const docEl = make('html', '');
  let domReadyFn = null;

  const doc = {
    body,
    documentElement: docEl,
    getElementById: (id) => byId.get(id) || null,
    createElement: (tag) => new FakeHTMLElement(tag),
    addEventListener: (ev, fn) => { if (ev === 'DOMContentLoaded') domReadyFn = fn; },
    querySelector: (sel) => {
      if (sel === 'input[name="download-format"]:checked') return formatInputs.find((i) => i.checked) || null;
      const fmtMatch = sel.match(/^input\[name="download-format"\]\[value="([^"]+)"\]$/);
      if (fmtMatch) return formatInputs.find((i) => i.value === fmtMatch[1]) || null;
      return null;
    },
    querySelectorAll: (sel) => {
      if (sel === 'input[name="download-format"]') return formatInputs;
      if (sel === '.filter-tabs .tab') return tabs;
      if (sel === '.filter-tabs .tab[data-filter="video"]') return tabs.filter((t) => t.getAttribute('data-filter') === 'video');
      if (sel === '.ig-only.tab') return tabs.filter((t) => t.classList.contains('ig-only'));
      if (sel === '.reddit-only.tab') return tabs.filter((t) => t.classList.contains('reddit-only'));
      if (sel === '.scan-actions button') return [byId.get('btn-scan-all')];
      return [];
    }
  };

  const sentRuntime = [];
  const runtimeListeners = [];
  const win = { _smdAutoScanned: false };
  const chromeStub = {
    i18n: {
      getMessage: (k, subs) => (subs?.length ? `${k}:${subs.join(',')}` : k),
      getUILanguage: () => 'en'
    },
    tabs: {
      async query() { return [{ id: 7, url: tabUrl }]; },
      sendMessage(_tabId, msg, cb) {
        if (msg.type === 'GET_PAGE_STATE') {
          if (pageState === null) {
            chromeStub.runtime.lastError = { message: 'Could not establish connection' };
            cb(undefined);
            chromeStub.runtime.lastError = null;
            return;
          }
          cb(pageState);
          return;
        }
        cb({ success: true });
      }
    },
    scripting: {
      async executeScript() {
        if (scriptingFails) throw new Error('cannot inject');
        return [];
      }
    },
    runtime: {
      lastError: null,
      onMessage: { addListener: (fn) => runtimeListeners.push(fn) },
      sendMessage(msg, cb) {
        sentRuntime.push(msg);
        /** @type {any} */
        let res = { success: true };
        if (msg.type === 'GET_PLUGIN_INFO') res = { success: true, info: pluginInfo };
        else if (msg.type === 'GET_SETTINGS') res = { success: true, settings };
        else if (msg.type === 'GET_DOWNLOAD_STATUS') res = { activeJob };
        else if (msg.type === 'START_DOWNLOAD') res = startDownloadResponse;
        else if (msg.type === 'CLEAR_DEDUP_HISTORY') res = { success: true };
        if (typeof cb === 'function') queueMicrotask(() => cb(res));
        return Promise.resolve(res);
      }
    }
  };

  const sandbox = {
    window: win,
    document: doc,
    chrome: chromeStub,
    MediaItemModel,
    HTMLInputElement: FakeHTMLInputElement,
    URL, Set, Map, Array, Object, String, Number, Boolean, Promise, Math, RegExp, Error,
    setTimeout: (fn) => { queueMicrotask(fn); return 1; },
    clearTimeout() {},
    console: { log() {}, warn() {}, error() {}, info() {} }
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(popupSrc, ctx, { filename: 'src/popup/popup.js' });

  return {
    async boot() {
      assert.ok(domReadyFn, 'DOMContentLoaded listener must be registered');
      await domReadyFn();
      await new Promise((r) => setTimeout(r, 15));
    },
    byId,
    body,
    formatInputs,
    dedupToggle,
    histToggle,
    sentRuntime,
    deliverRuntime(msg) {
      for (const fn of runtimeListeners) fn(msg);
    }
  };
}

export async function runPopupTests() {
  // 1. Metadata-driven theme/hosts, persisted format, subreddit/dedup tab counts, video placeholder, clear history
  {
    const h = createPopupHarness({
      activeJob: { platform: 'instagram', status: 'DOWNLOADING', completed: 1, total: 5 },
      pageState: {
        platform: 'reddit',
        targetName: 'u_demo',
        targetType: 'profile',
        username: 'demo',
        isScanning: false,
        media: [
          {
            id: 'img1', platform: 'reddit', type: 'image', sourceType: 'reddit_image',
            url: 'https://i.redd.it/a1.jpg', downloadUrl: 'https://i.redd.it/a1.jpg',
            deduplicationKey: 'dup_key', metadata: { subreddit: 'pics', score: 100 }
          },
          {
            id: 'img1_dup', platform: 'reddit', type: 'image', sourceType: 'reddit_image',
            url: 'https://i.redd.it/a1.jpg', downloadUrl: 'https://i.redd.it/a1.jpg',
            deduplicationKey: 'dup_key', metadata: { subreddit: 'pics', score: 50 }
          },
          {
            id: 'vid1', platform: 'reddit', type: 'video', sourceType: 'reddit_video',
            url: 'https://v.redd.it/clip1/DASH_720.mp4', downloadUrl: 'https://v.redd.it/clip1/DASH_720.mp4',
            thumbnailUrl: 'https://v.redd.it/clip1/DASH_720.mp4',
            metadata: { subreddit: 'videos', score: 90 }
          }
        ]
      }
    });
    await h.boot();

    assert.equal(h.byId.get('platform-badge').textContent, 'Reddit', 'badge uses plugin displayName');
    assert.ok(h.body.classList.contains('reddit-theme'), 'body applies plugin themeClass');
    // Foreign platform activeJob (instagram) must NOT display progress bar in Reddit popup
    assert.notEqual(h.byId.get('download-progress-container').style.display, 'flex',
      'foreign-platform active job must be filtered out on popup init');
    // Persisted defaultFormat === 'zip' applied
    assert.equal(h.formatInputs.find((i) => i.value === 'zip').checked, true, 'persisted defaultFormat must sync to radio');

    // Tab counts reflect deduplication (2 unique items: 1 image + 1 video, not 3)
    assert.equal(h.byId.get('p-tab-all').textContent, '(2)', 'tab all count must match deduplicated visible set');
    assert.equal(h.byId.get('p-tab-image').textContent, '(1)', 'tab image count must match deduplicated images');
    assert.equal(h.byId.get('p-tab-video').textContent, '(1)', 'tab video count must match deduplicated videos');

    // Video card with .mp4 thumbnailUrl must render placeholder, NOT <img src="...mp4">
    const cards = h.byId.get('media-grid').children;
    assert.equal(cards.length, 2);
    const vidCard = cards.find((c) => c.children.some((ch) => ch.className === 'tag-video'));
    assert.ok(vidCard, 'video card must exist');
    assert.equal(vidCard.children.some((ch) => ch.tagName === 'IMG'), false, 'video .mp4 URL must not render in <img>');
    assert.ok(vidCard.children.some((ch) => ch.className === 'video-placeholder'), 'video card renders placeholder');

    // Clear history button dispatches CLEAR_DEDUP_HISTORY
    h.byId.get('popup-clear-history-btn').click();
    await new Promise((r) => setTimeout(r, 10));
    assert.ok(h.sentRuntime.some((m) => m.type === 'CLEAR_DEDUP_HISTORY'), 'clear button must send CLEAR_DEDUP_HISTORY');

    // Progress updates: QUEUED is running + flex layout + skippedDuplicates counts toward 100%
    h.deliverRuntime({
      type: 'DOWNLOAD_PROGRESS_UPDATE',
      job: { platform: 'reddit', status: 'QUEUED', completed: 0, skippedDuplicates: 0, total: 2 }
    });
    assert.equal(h.byId.get('download-progress-container').style.display, 'flex', 'progress card must use flex');
    assert.equal(h.byId.get('btn-cancel-download').style.display, 'inline-block', 'QUEUED must show cancel button');

    h.deliverRuntime({
      type: 'DOWNLOAD_PROGRESS_UPDATE',
      job: { platform: 'reddit', status: 'COMPLETED', completed: 1, skippedDuplicates: 1, total: 2 }
    });
    assert.equal(h.byId.get('progress-bar-fill').style.width, '100%', 'completed + skippedDuplicates must reach 100%');
  }

  // 2. Failed START_DOWNLOAD shows visible error; failed post-injection refresh falls back to inactive notice
  {
    const hFail = createPopupHarness({
      pageState: {
        platform: 'reddit',
        targetName: 'u_demo',
        targetType: 'profile',
        media: [{ id: 'a', platform: 'reddit', type: 'image', url: 'https://i.redd.it/x.jpg', downloadUrl: 'https://i.redd.it/x.jpg' }]
      },
      startDownloadResponse: { success: false, error: 'download_busy' }
    });
    await hFail.boot();
    hFail.byId.get('btn-download').click();
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(hFail.byId.get('progress-status-text').textContent, 'download_busy',
      'failed START_DOWNLOAD must surface visible error to user');

    const hInactive = createPopupHarness({ pageState: null, scriptingFails: false });
    await hInactive.boot();
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(hInactive.byId.get('inactive-notice').style.display, 'flex',
      'failed post-injection refreshState must fall back to inactive notice');
  }
}

if (process.argv[1] === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))) {
  runPopupTests()
    .then(() => console.log('✔ popup tests passed.'))
    .catch((err) => { console.error(err); process.exit(1); });
}
