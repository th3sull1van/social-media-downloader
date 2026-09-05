/**
 * Offscreen ZIP integration tests.
 * Executes the real classic offscreen script in a VM with a small OPFS double.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import vm from 'node:vm';
import { DownloadManager } from '../../src/core/application/DownloadManager.js';
import { ArchiveService } from '../../src/core/services/ArchiveService.js';

const OFFSCREEN_SOURCE = fs.readFileSync(new URL('../../src/offscreen/offscreen.js', import.meta.url), 'utf8');

export function makeOpfs() {
  const files = new Map();
  const directories = new Map();
  const faults = { remove: false, write: false, close: false };
  function directory(path = '') {
    const handle = {
      kind: 'directory',
      async *entries() {
        for (const [name, entry] of directories) {
          if (name.startsWith(path) && !name.slice(path.length).includes('/')) yield [name.slice(path.length), entry];
        }
      },
      async removeEntry(name) {
        if (faults.remove) throw Object.assign(new Error('locked'), { name: 'NoModificationAllowedError' });
        const prefix = path + name;
        if (!directories.has(prefix) && !files.has(prefix)) throw Object.assign(new Error('missing'), { name: 'NotFoundError' });
        for (const key of files.keys()) if (key === prefix || key.startsWith(prefix + '/')) files.delete(key);
        for (const key of directories.keys()) if (key === prefix || key.startsWith(prefix + '/')) directories.delete(key);
      },
      async getDirectoryHandle(name, { create = false } = {}) {
        const key = path + name;
        if (!directories.has(key)) {
          if (!create) throw Object.assign(new Error('missing'), { name: 'NotFoundError' });
          directories.set(key, directory(key + '/'));
        }
        return directories.get(key);
      },
      async getFileHandle(name, { create = false } = {}) {
        const key = path + name;
        if (!files.has(key)) {
          if (!create) throw Object.assign(new Error('missing'), { name: 'NotFoundError' });
          files.set(key, { bytes: new Uint8Array(), cursor: 0, closed: false });
        }
        const file = files.get(key);
        return {
          async createWritable() {
            file.cursor = 0;
            file.closed = false;
            return {
              async write(value) {
                if (faults.write) throw new Error('write_failed');
                const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);
                const end = file.cursor + bytes.byteLength;
                if (end > file.bytes.byteLength) {
                  const expanded = new Uint8Array(end);
                  expanded.set(file.bytes);
                  file.bytes = expanded;
                }
                file.bytes.set(bytes, file.cursor);
                file.cursor = end;
              },
              async seek(position) { file.cursor = position; },
              async truncate(size) { file.bytes = file.bytes.slice(0, size); file.cursor = Math.min(file.cursor, size); },
              async close() { if (faults.close) throw new Error('close_failed'); file.closed = true; },
              async abort() { file.bytes = new Uint8Array(); file.cursor = 0; }
            };
          },
          async getFile() { return new Blob([file.bytes]); }
        };
      }
    };
    return handle;
  }
  return { root: directory(), files, directories, faults };
}

export function makeContext({ storage = true, opfs = storage ? makeOpfs() : null } = {}) {
  let listener;
  let lastObject;
  let sequence = 0;
  const revoked = [];
  const timers = [];
  const context = {
    ArrayBuffer, Blob, DataView, Promise, Set, Map, TextDecoder, TextEncoder, Uint8Array, crypto,
    URL: {
      createObjectURL(blob) { lastObject = blob; return `blob:zip-test-${++sequence}`; },
      revokeObjectURL(url) { revoked.push(url); }
    },
    atob, btoa, console,
    navigator: storage ? { storage: { getDirectory: async () => opfs.root } } : {},
    clearTimeout() {},
    setTimeout(fn) { timers.push(fn); return timers.length; },
    chrome: { runtime: {
      onMessage: { addListener(fn) { listener = fn; } },
      sendMessage() { return Promise.resolve(); }
    } }
  };
  vm.runInNewContext(OFFSCREEN_SOURCE, context, { filename: 'src/offscreen/offscreen.js' });
  let sessionId;
  return {
    opfs, revoked, timers,
    async send(message) {
      const result = await new Promise((resolve) => listener({ sessionId, ...message }, {}, resolve));
      if (message.type === 'OFFSCREEN_BEGIN_ZIP' && result.ok) sessionId = result.sessionId;
      return result;
    },
    getLastObject() { return lastObject; }
  };
}

async function readZipEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = bytes.length - 22;
  assert.strictEqual(view.getUint32(eocd, true), 0x06054b50);
  const count = view.getUint16(eocd + 10, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  const entries = [];
  let cursor = cdOffset;
  for (let i = 0; i < count; i++) {
    assert.strictEqual(view.getUint32(cursor, true), 0x02014b50);
    const flags = view.getUint16(cursor + 8, true);
    const crc = view.getUint32(cursor + 16, true);
    const size = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    const localOffset = view.getUint32(cursor + 42, true);
    const localNameLength = view.getUint16(localOffset + 26, true);
    const payloadStart = localOffset + 30 + localNameLength;
    const payload = bytes.slice(payloadStart, payloadStart + size);
    const descriptorOffset = payloadStart + size;
    assert.strictEqual(flags & 0x0008, 0x0008);
    assert.strictEqual(view.getUint32(descriptorOffset, true), 0x08074b50);
    assert.strictEqual(view.getUint32(descriptorOffset + 4, true), crc);
    assert.strictEqual(view.getUint32(descriptorOffset + 8, true), size);
    assert.strictEqual(ArchiveService.computeCrc32(payload), crc);
    entries.push({ name, payload });
    cursor += 46 + nameLength;
  }
  return entries;
}

export async function runOffscreenZipTests() {
  // Disk-only contract: no storage API means an explicit failure, never a Blob fallback.
  const unavailable = makeContext({ storage: false });
  const unavailableResult = await unavailable.send({ type: 'OFFSCREEN_BEGIN_ZIP' });
  assert.strictEqual(unavailableResult.ok, false);
  assert.strictEqual(unavailableResult.reason, 'opfs_unavailable');

  const offscreen = makeContext({ storage: true });
  assert.strictEqual((await offscreen.send({ type: 'OFFSCREEN_BEGIN_ZIP' })).ok, true);

  const first = await offscreen.send({ type: 'OFFSCREEN_BEGIN_ENTRY', name: 'photos/hello.txt' });
  assert.strictEqual(first.ok, true);
  const firstPayload = [new TextEncoder().encode('hello '), new TextEncoder().encode('world')];
  for (const bytes of firstPayload) {
    const result = await offscreen.send({
      type: 'OFFSCREEN_WRITE_CHUNK',
      entryId: first.entryId,
      dataB64: Buffer.from(bytes).toString('base64')
    });
    assert.strictEqual(result.ok, true);
  }
  assert.strictEqual((await offscreen.send({ type: 'OFFSCREEN_END_ENTRY', entryId: first.entryId })).ok, true);

  const second = await offscreen.send({ type: 'OFFSCREEN_BEGIN_ENTRY', name: '../../CON.txt' });
  assert.strictEqual(second.ok, true);
  const secondBytes = new Uint8Array([1, 2, 3, 4]);
  assert.strictEqual((await offscreen.send({
    type: 'OFFSCREEN_WRITE_CHUNK',
    entryId: second.entryId,
    dataB64: Buffer.from(secondBytes).toString('base64')
  })).ok, true);
  assert.strictEqual((await offscreen.send({ type: 'OFFSCREEN_END_ENTRY', entryId: second.entryId })).ok, true);

  const finish = await offscreen.send({ type: 'OFFSCREEN_FINISH_ZIP', zipFilename: 'test.zip' });
  assert.strictEqual(finish.ok, true);
  const zipBytes = new Uint8Array(await offscreen.getLastObject().arrayBuffer());
  const entries = await readZipEntries(zipBytes);
  assert.deepStrictEqual(entries.map((entry) => entry.name), ['photos/hello.txt', '_CON.txt']);
  assert.deepStrictEqual([...entries[0].payload], [...new TextEncoder().encode('hello world')]);
  assert.deepStrictEqual([...entries[1].payload], [...secondBytes]);
  // A second session must not delete the first download's backing file.
  const firstResource = finish.resourceId;
  assert.ok(offscreen.opfs.files.has(`smd_temp/${firstResource}/payload`));
  const next = await offscreen.send({ type: 'OFFSCREEN_BEGIN_ZIP' });
  assert.notEqual(next.sessionId, firstResource);
  assert.equal((await offscreen.send({ type: 'OFFSCREEN_ABORT_ZIP', sessionId: firstResource })).reason, 'stale_session');
  assert.equal((await offscreen.send({ type: 'OFFSCREEN_WRITE_CHUNK', sessionId: firstResource, entryId: first.entryId, dataB64: 'AQ==' })).reason, 'stale_session');
  // No ten-minute timer can delete a slow browser download.
  assert.equal(offscreen.timers.length, 0);
  assert.equal((await offscreen.send({ type: 'OFFSCREEN_REVOKE_BLOB_URLS', urls: [finish.objectUrl] })).ok, true);
  assert.ok(!offscreen.opfs.files.has(`smd_temp/${firstResource}/payload`));
  assert.ok(offscreen.opfs.files.has(`smd_temp/${next.sessionId}/payload`));
  assert.equal((await offscreen.send({ type: 'OFFSCREEN_ABORT_ZIP' })).ok, true);
  assert.equal(offscreen.opfs.files.size, 0);

  // Disk-backed generated payload, JSON transport, explicit bounds and failure cleanup.
  const blob = await offscreen.send({ type: 'OFFSCREEN_BEGIN_BLOB', mimeType: 'video/mp4' });
  assert.equal((await offscreen.send({ type: 'OFFSCREEN_WRITE_BLOB_CHUNK', resourceId: blob.resourceId, dataB64: 'AQIDBA==' })).ok, true);
  assert.equal((await offscreen.send({ type: 'OFFSCREEN_WRITE_BLOB_CHUNK', resourceId: blob.resourceId, dataB64: Buffer.alloc(512 * 1024 + 1).toString('base64') })).ok, false);
  const published = await offscreen.send({ type: 'OFFSCREEN_END_BLOB', resourceId: blob.resourceId });
  assert.equal(offscreen.getLastObject().type, 'video/mp4');
  assert.deepEqual([...new Uint8Array(await offscreen.getLastObject().arrayBuffer())], [1, 2, 3, 4]);

  // Recover with a fresh JS realm, retaining only browser-owned active URLs.
  const orphan = await offscreen.send({ type: 'OFFSCREEN_BEGIN_BLOB' });
  const restarted = makeContext({ opfs: offscreen.opfs });
  assert.equal((await restarted.send({ type: 'OFFSCREEN_RECOVER_RESOURCES', activeUrls: [published.objectUrl] })).ok, true);
  assert.ok(offscreen.opfs.files.has(`smd_temp/${published.resourceId}/payload`));
  assert.ok(!offscreen.opfs.files.has(`smd_temp/${orphan.resourceId}/payload`));
  offscreen.opfs.faults.remove = true;
  assert.equal((await restarted.send({ type: 'OFFSCREEN_REVOKE_BLOB_URLS', urls: [published.objectUrl] })).ok, false);
  offscreen.opfs.faults.remove = false;
  assert.equal((await restarted.send({ type: 'OFFSCREEN_REVOKE_BLOB_URLS', urls: [published.objectUrl] })).ok, true);
  assert.equal((await restarted.send({ type: 'OFFSCREEN_REVOKE_BLOB_URLS', urls: [published.objectUrl] })).ok, true);
  assert.equal(offscreen.opfs.files.size, 0);

  const failed = await restarted.send({ type: 'OFFSCREEN_BEGIN_BLOB' });
  offscreen.opfs.faults.write = true;
  assert.equal((await restarted.send({ type: 'OFFSCREEN_WRITE_BLOB_CHUNK', resourceId: failed.resourceId, dataB64: 'AQ==' })).ok, false);
  offscreen.opfs.faults.write = false;
  await restarted.send({ type: 'OFFSCREEN_ABORT_BLOB', resourceId: failed.resourceId });
  assert.equal(offscreen.opfs.files.size, 0);

  // Full manager -> JSON messaging -> real offscreen -> browser completion.
  const savedChrome = /** @type {any} */ (globalThis).chrome;
  const savedFetch = globalThis.fetch;
  const transport = makeContext();
  const messages = [];
  const downloads = new Map();
  let denied = false;
  const browser = {
    runtime: {
      lastError: null,
      sendMessage(message, callback) {
        if (!message.type.startsWith('OFFSCREEN_')) return Promise.resolve();
        messages.push(message);
        const pending = transport.send(JSON.parse(JSON.stringify(message)));
        pending.then(callback);
        return pending;
      }
    },
    downloads: {
      download(options, callback) {
        if (denied) { callback(undefined); return; }
        const id = downloads.size + 1;
        downloads.set(id, { ...options, id, state: 'in_progress' });
        callback(id);
      },
      search(query, callback) {
        const result = [...downloads.values()].filter((item) => item.id === query.id);
        callback?.(result);
        return Promise.resolve(result);
      },
      cancel(id, callback) { downloads.get(id).state = 'interrupted'; callback?.(); }
    }
  };
  const runtime = /** @type {any} */ (globalThis);
  runtime.chrome = browser;
  const manager = new DownloadManager(/** @type {any} */ ({ get() {} }));
  manager.scheduleBadgeClear = () => {};
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  try {
    const bytes = new Uint8Array(1024 * 1024 + 7).fill(0x5a);
    const id = await manager.downloadGeneratedBlob(bytes, 'SMD/test.bin');
    const chunks = messages.filter((message) => message.type === 'OFFSCREEN_WRITE_BLOB_CHUNK');
    assert.equal(chunks.length, 3);
    assert.ok(chunks.every((message) => Buffer.from(message.dataB64, 'base64').length <= 512 * 1024));
    assert.equal(transport.opfs.files.size, 2);
    manager.handleDownloadChanged({ id, state: { current: 'complete' } });
    await flush();
    assert.equal(transport.opfs.files.size, 0);

    denied = true;
    await assert.rejects(manager.downloadGeneratedBlob(bytes, 'SMD/denied.bin'));
    assert.equal(transport.opfs.files.size, 0, 'failed browser handoff must clean generated files');
    const items = /** @type {any} */ ([{ id: 'test', url: 'https://example.com/test.jpg' }]);
    const plugin = { resolveMedia: async () => ({ kind: 'generated', data: new Uint8Array([1, 2, 3]) }) };
    await manager.processZipDownload(plugin, 'test', 'test', items);
    assert.equal(manager.activeJob.status, 'FAILED');
    assert.equal(transport.opfs.files.size, 0, 'failed ZIP handoff must clean ZIP files');
    denied = false;
    await manager.processZipDownload(plugin, 'test', 'test', items);
    assert.equal(manager.activeJob.status, 'COMPLETED');
    const zipId = manager.activeJob.receiptDownloadId;
    assert.equal(transport.opfs.files.size, 2);
    manager.handleDownloadChanged({ id: zipId, state: { current: 'interrupted' } });
    await flush();
    assert.equal(transport.opfs.files.size, 0);

    const finishZip = ArchiveService.finish;
    ArchiveService.finish = async (...args) => {
      const result = await finishZip.apply(ArchiveService, args);
      await manager.cancelDownload();
      return result;
    };
    try {
      await manager.processZipDownload(plugin, 'test', 'cancel-finalizing', items);
      assert.equal(manager.activeJob.status, 'CANCELLED');
      assert.equal(transport.opfs.files.size, 0, 'cancellation while finalizing must revoke unpublished-to-browser URLs');
    } finally { ArchiveService.finish = finishZip; }

    // Cancellation during browser handoff must not delete an in-use file.
    const download = browser.downloads.download;
    /** @type {() => void} */
    let accept = () => { throw new Error('handoff not started'); };
    let started;
    const starting = new Promise((resolve) => { started = resolve; });
    browser.downloads.download = (options, callback) => { accept = () => download(options, callback); started(); };
    const handoff = manager.processZipDownload(plugin, 'test', 'handoff', items);
    await starting;
    await manager.cancelDownload();
    assert.equal(transport.opfs.files.size, 2, 'published file survives cancellation until browser acknowledges');
    accept();
    await handoff;
    await flush();
    assert.equal(manager.activeJob.status, 'CANCELLED');
    assert.equal(transport.opfs.files.size, 0, 'confirmed interruption releases the published file');
    browser.downloads.download = download;

    // Cancellation interrupts a pending read and frees its lock.
    let readCancelled = false;
    const body = new ReadableStream({ cancel() { readCancelled = true; } });
    const abort = new AbortController();
    const pending = ArchiveService.pipeSource(body, async () => ({ ok: true }), abort.signal);
    abort.abort();
    await assert.rejects(pending);
    assert.equal(body.locked, false);
    assert.equal(readCancelled, true);
    let errorCancelled = false;
    const failing = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1])); }, cancel() { errorCancelled = true; } });
    await assert.rejects(ArchiveService.pipeSource(failing, async () => ({ ok: false, reason: 'disk_full' })), /disk_full/);
    assert.equal(errorCancelled, true);
    assert.equal(failing.locked, false);

    let fetched;
    const fetching = new Promise((resolve) => { fetched = resolve; });
    runtime.fetch = async (_url, { signal }) => {
      fetched();
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
    };
    const old = manager.processZipDownload(null, 'test', 'old', items);
    await fetching;
    await manager.cancelDownload();
    await manager.processZipDownload(plugin, 'test', 'new', items);
    await old;
    assert.equal(manager.activeJob.targetName, 'new');
    assert.equal(manager.activeJob.status, 'COMPLETED');
    assert.equal(transport.opfs.files.size, 2, 'old cleanup cannot delete the new ZIP');
    manager.handleDownloadChanged({ id: manager.activeJob.receiptDownloadId, state: { current: 'complete' } });
    await flush();
    assert.equal(transport.opfs.files.size, 0);
  } finally {
    runtime.chrome = savedChrome;
    globalThis.fetch = savedFetch;
  }

}
