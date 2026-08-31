/**
 * Offscreen ZIP integration tests.
 * Executes the real classic offscreen script in a VM with a small OPFS double.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import vm from 'node:vm';
import { ArchiveService } from '../../src/core/services/ArchiveService.js';

const OFFSCREEN_SOURCE = fs.readFileSync(new URL('../../src/offscreen/offscreen.js', import.meta.url), 'utf8');

function makeOpfs() {
  const files = new Map();
  const root = {
    async removeEntry(name) {
      if (name === 'smd_zip_temp') files.clear();
    },
    async getDirectoryHandle() {
      return {
        async getFileHandle(name) {
          if (!files.has(name)) files.set(name, { bytes: new Uint8Array(), cursor: 0, closed: false });
          const file = files.get(name);
          return {
            async createWritable() {
              file.cursor = 0;
              file.closed = false;
              return {
                async write(value) {
                  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
                  const end = file.cursor + bytes.byteLength;
                  if (end > file.bytes.byteLength) {
                    const expanded = new Uint8Array(end);
                    expanded.set(file.bytes);
                    file.bytes = expanded;
                  }
                  file.bytes.set(bytes, file.cursor);
                  file.cursor = end;
                },
                async seek(position) {
                  file.cursor = position;
                },
                async truncate(size) {
                  file.bytes = file.bytes.slice(0, size);
                  file.cursor = Math.min(file.cursor, size);
                },
                async close() {
                  file.closed = true;
                },
                async abort() {
                  file.bytes = new Uint8Array();
                  file.cursor = 0;
                  file.closed = false;
                }
              };
            },
            async getFile() {
              return new Blob([file.bytes], { type: 'application/zip' });
            }
          };
        }
      };
    }
  };
  return { root, files };
}

function makeContext({ storage }) {
  let listener;
  let lastObject;
  const opfs = storage ? makeOpfs() : null;
  const context = {
    ArrayBuffer,
    Blob,
    DataView,
    Promise,
    Set,
    TextDecoder,
    TextEncoder,
    Uint8Array,
    URL: {
      createObjectURL(blob) {
        lastObject = blob;
        return 'blob:zip-test';
      },
      revokeObjectURL() {}
    },
    atob,
    btoa,
    clearTimeout() {},
    console,
    navigator: storage ? { storage: { getDirectory: async () => opfs.root } } : {},
    setTimeout() { return 1; },
    chrome: {
      runtime: {
        onMessage: {
          addListener(fn) { listener = fn; }
        },
        sendMessage() { return Promise.resolve(); }
      }
    }
  };
  vm.runInNewContext(OFFSCREEN_SOURCE, context, { filename: 'src/offscreen/offscreen.js' });
  return {
    async send(message) {
      return new Promise((resolve) => listener(message, {}, resolve));
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
}
