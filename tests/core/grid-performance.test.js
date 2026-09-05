import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { InstagramNormalizer } from '../../src/plugins/instagram/InstagramNormalizer.js';

// Execute the production render/filter/observer functions, without a second
// implementation of their behavior. The DOM double counts real node creation.
export function createGridHarness(source = fs.readFileSync('src/content/content.js', 'utf8')) {
  let created = 0;
  const observed = new Set();
  function element(tag = 'div') {
    created++;
    const node = {
      tag, children: [], parentNode: null, style: {}, dataset: {}, attributes: {}, _textContent: '', listeners: {},
      get textContent() { return this._textContent; },
      set textContent(value) { this._textContent = value; for (const child of this.children) child.parentNode = null; this.children = []; },
      _next: null,
      classList: { toggle() {} },
      setAttribute(key, value) { this.attributes[key] = value; },
      addEventListener(type, listener) { this.listeners[type] = listener; },
      click() { this.listeners.click?.(); },
      get firstChild() { return this.children[0] || null; },
      get firstElementChild() { return this.firstChild; },
      get nextElementSibling() { return this._next; },
      appendChild(child) { return this.insertBefore(child, null); },
      insertBefore(child, before) {
        if (child.tag === 'fragment') { for (const entry of [...child.children]) this.insertBefore(entry, before); return child; }
        child.remove();
        const index = before ? this.children.indexOf(before) : this.children.length;
        assert.ok(index >= 0);
        child._next = before;
        if (index > 0) this.children[index - 1]._next = child;
        this.children.splice(index, 0, child);
        child.parentNode = this;
        return child;
      },
      remove() {
        if (this.parentNode) {
          const index = this.parentNode.children.indexOf(this);
          if (index > 0) this.parentNode.children[index - 1]._next = this._next;
          this.parentNode.children.splice(index, 1);
        }
        this._next = null;
        this.parentNode = null;
      }
    };
    return node;
  }
  const elements = new Map(['smd-grid', 'smd-empty'].map((id) => [id, element()]));
  const state = { media: new Map(), selectedIds: new Set(), activeFilter: 'all' };
  const sandbox = {
    state, floatingModal: { style: { display: 'flex' } },
    document: { createElement: element, createDocumentFragment: () => element('fragment') },
    uiGetById: (id) => elements.get(id),
    t: (key) => key,
    isAllowedMediaUrl: (url) => /^https:\/\//.test(url),
    updateSelectionSummary() {},
    IntersectionObserver: class {
      observe(image) { observed.add(image); }
      unobserve(image) { observed.delete(image); }
      disconnect() { observed.clear(); }
    }
  };
  const functions = source.slice(source.indexOf('  function matchesActiveFilter('), source.indexOf('  function updateSelectionSummary('));
  const context = vm.createContext(sandbox);
  vm.runInContext(functions + '\nglobalThis.render = renderModalGrid; globalThis.select = typeof updateGridSelection === "function" ? updateGridSelection : renderModalGrid;', context);
  return {
    state, grid: elements.get('smd-grid'), empty: elements.get('smd-empty'), observed,
    render: () => vm.runInContext('render()', context),
    select: () => vm.runInContext('select()', context),
    get created() { return created; }
  };
}

export async function runGridPerformanceTests() {
  const fixture = JSON.parse(fs.readFileSync('tests/fixtures/extracted/instagram/example-profile.json', 'utf8'));
  const items = fixture.nodes.flatMap((node) => InstagramNormalizer.normalizePost(node));
  assert.ok(items.length > 0);
  const ui = createGridHarness();
  for (const item of items) ui.state.media.set(item.id, item);
  ui.render();
  const card = ui.grid.firstChild;
  const image = card.children.find((child) => child.tag === 'img');
  const created = ui.created;
  ui.render();
  assert.equal(ui.created, created, 'unchanged render must allocate no DOM nodes');
  ui.state.selectedIds.add(items[0].id);
  ui.select();
  assert.equal(ui.grid.firstChild, card);
  assert.equal(ui.created, created, 'selection must reuse images and cards');
  assert.equal(card.attributes['aria-pressed'], 'true');
  card.listeners.keydown({ key: ' ', preventDefault() {} });
  assert.equal(ui.state.selectedIds.has(items[0].id), false);
  ui.state.media.set(items[0].id, { ...items[0], width: 9999 });
  ui.render();
  assert.equal(ui.grid.firstChild, card);
  assert.equal(card.children.find((child) => child.tag === 'img'), image);
  assert.ok(card.attributes['aria-label'].startsWith('9999x'));
  ui.state.media.clear();
  ui.render();
  assert.equal(ui.grid.children.length, 0);
  assert.equal(ui.observed.size, 0);
  assert.equal(ui.empty.style.display, 'flex');

  for (const count of [1000, 10000]) {
    const large = createGridHarness();
    for (let i = 0; i < count; i++) large.state.media.set(String(i), { ...items[0], id: String(i) });
    large.render();
    const nodes = large.created;
    large.state.selectedIds = new Set(large.state.media.keys());
    large.select();
    large.render();
    assert.equal(large.created, nodes, `${count} existing cards must be reused`);
  }
}
