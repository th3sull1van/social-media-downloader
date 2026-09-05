/**
 * Social Media Downloader — Offscreen ZIP Packager
 *
 * ZIP entries are written in STORE mode to an OPFS-backed file. OPFS is a hard
 * requirement for production packaging: there is intentionally no in-memory
 * fallback. Media content is received in bounded base64 chunks and entries use
 * ZIP data descriptors, so CRC and size do not need to be known up front.
 */

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[i] = c;
}

function updateCrc32(crc, bytes) {
  for (let i = 0; i < bytes.length; i++) {
    crc = (CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8)) >>> 0;
  }
  return crc >>> 0;
}

function finalizeCrc32(crc) {
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function getDosDateTime(date = new Date()) {
  const year = date.getFullYear();
  const dosTime = ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)) & 0xFFFF;
  const dosDate = (((year < 1980 ? 0 : year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xFFFF;
  return { dosTime, dosDate };
}

function createLocalHeader(nameBytes, dosTime, dosDate) {
  const buf = new Uint8Array(30 + nameBytes.length);
  const view = new DataView(buf.buffer);
  view.setUint32(0, 0x04034b50, true); // PK\x03\x04
  view.setUint16(4, 20, true);         // Version needed to extract (2.0)
  view.setUint16(6, 0x0808, true);     // UTF-8 + data descriptor follows
  view.setUint16(8, 0, true);           // Compression method: STORE
  view.setUint16(10, dosTime, true);
  view.setUint16(12, dosDate, true);
  view.setUint32(14, 0, true);          // CRC is in the data descriptor
  view.setUint32(18, 0, true);           // Compressed size is in the descriptor
  view.setUint32(22, 0, true);           // Uncompressed size is in the descriptor
  view.setUint16(26, nameBytes.length, true);
  view.setUint16(28, 0, true);
  buf.set(nameBytes, 30);
  return buf;
}

function createDataDescriptor(crc32, size) {
  const buf = new Uint8Array(16);
  const view = new DataView(buf.buffer);
  view.setUint32(0, 0x08074b50, true); // PK\x07\x08
  view.setUint32(4, crc32, true);
  view.setUint32(8, size, true);
  view.setUint32(12, size, true);
  return buf;
}

function createCentralDirectoryHeader(entry) {
  const buf = new Uint8Array(46 + entry.nameBytes.length);
  const view = new DataView(buf.buffer);
  view.setUint32(0, 0x02014b50, true); // PK\x01\x02
  view.setUint16(4, 20, true);          // Version made by (2.0)
  view.setUint16(6, 20, true);          // Version needed (2.0)
  view.setUint16(8, 0x0808, true);      // UTF-8 + data descriptor follows
  view.setUint16(10, 0, true);          // Compression method: STORE
  view.setUint16(12, entry.dosTime, true);
  view.setUint16(14, entry.dosDate, true);
  view.setUint32(16, entry.crc32, true);
  view.setUint32(20, entry.size, true);
  view.setUint32(24, entry.size, true);
  view.setUint16(28, entry.nameBytes.length, true);
  view.setUint16(30, 0, true);           // Extra field length
  view.setUint16(32, 0, true);           // Comment length
  view.setUint16(34, 0, true);           // Disk number start
  view.setUint16(36, 0, true);           // Internal attributes
  view.setUint32(38, 0, true);           // External attributes
  view.setUint32(42, entry.offset, true);
  buf.set(entry.nameBytes, 46);
  return buf;
}

function createEocdRecord(entryCount, cdSize, cdOffset) {
  const buf = new Uint8Array(22);
  const view = new DataView(buf.buffer);
  view.setUint32(0, 0x06054b50, true); // PK\x05\x06
  view.setUint16(4, 0, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, entryCount, true);
  view.setUint16(10, entryCount, true);
  view.setUint32(12, cdSize, true);
  view.setUint32(16, cdOffset, true);
  view.setUint16(20, 0, true);
  return buf;
}

const textEncoder = new TextEncoder();
const MAX_ZIP_BYTES = 1024 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 0xFFFF;
const ZIP_DATA_DESCRIPTOR_BYTES = 16;
const DOS_RESERVED_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
]);

function sanitizeArchivePath(rawName) {
  const rawPath = String(rawName || 'file').replace(/\\/g, '/').slice(0, 1024);
  const safeSegments = [];

  for (const rawSegment of rawPath.split('/')) {
    if (!rawSegment || rawSegment === '.' || rawSegment === '..') continue;

    let segment = rawSegment
      .replace(/[\x00-\x1F\x7F<>:"|?*]/g, '_')
      .replace(/^[\s.]+|[\s.]+$/g, '')
      .trim();
    if (!segment) continue;

    const baseName = segment.split('.')[0].toUpperCase();
    if (DOS_RESERVED_NAMES.has(baseName)) segment = `_${segment}`;
    safeSegments.push(segment);
  }

  return safeSegments.join('/') || 'file';
}

function dataErrorReason(error, fallback = 'opfs_write_failed') {
  if (error?.name === 'QuotaExceededError') return 'opfs_quota_exceeded';
  if (error?.name === 'NotFoundError') return 'opfs_unavailable';
  return error?.code || fallback;
}

const state = {
  active: false,
  tempDirHandle: null,
  zipFileHandle: null,
  writable: null,
  /** @type {Array<{ nameBytes: Uint8Array, crc32: number, size: number, offset: number, dosTime: number, dosDate: number }>} */
  entries: [],
  /** @type {{ id: string, nameBytes: Uint8Array, offset: number, crcState: number, size: number, dosTime: number, dosDate: number } | null} */
  currentEntry: null,
  entrySequence: 0,
  currentOffset: 0,
  completed: 0,
  cancelled: false,
  lastPct: -1,
  sessionId: null
};

function reportProgress(patch) {
  try {
    chrome.runtime.sendMessage({ type: 'ZIP_OFFSCREEN_PROGRESS', sessionId: state.sessionId, patch }).catch(() => {});
  } catch (e) {}
}

// All mutations run on one message queue. A resource owns its directory until the
// browser confirms a terminal download state; there is no time-based deletion.
const resources = new Map();
const resourceUrls = new Map();
const MAX_CHUNK_BYTES = 512 * 1024;

async function tempRoot() {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle('smd_temp', { create: true });
}

async function removeResource(id) {
  const resource = resources.get(id);
  if (resource?.writable) {
    await resource.writable.abort();
    resource.writable = null;
  }
  if (resource?.objectUrl) URL.revokeObjectURL(resource.objectUrl);
  try {
    await (await tempRoot()).removeEntry(id, { recursive: true });
  } catch (error) {
    if (error?.name !== 'NotFoundError') throw error;
  }
  if (resource?.objectUrl) resourceUrls.delete(resource.objectUrl);
  resources.delete(id);
}

async function createResource(mimeType) {
  const id = crypto.randomUUID();
  const dir = await (await tempRoot()).getDirectoryHandle(id, { create: true });
  const resource = { id, dir, mimeType, writable: null, file: null, objectUrl: null };
  resources.set(id, resource);
  try {
    resource.file = await dir.getFileHandle('payload', { create: true });
    resource.writable = await resource.file.createWritable();
    return resource;
  } catch (error) {
    await removeResource(id);
    throw error;
  }
}

async function publishResource(resource) {
  await resource.writable.close();
  resource.writable = null;
  const file = await resource.file.getFile();
  resource.objectUrl = URL.createObjectURL(file.slice(0, file.size, resource.mimeType));
  resourceUrls.set(resource.objectUrl, resource.id);
  // Persist ownership before returning the URL, including the gap before a
  // download ID is known. Recovery matches the browser's in-progress URLs.
  const metadata = await resource.dir.getFileHandle('resource.json', { create: true });
  const writer = await metadata.createWritable();
  try {
    await writer.write(JSON.stringify({ objectUrl: resource.objectUrl }));
    await writer.close();
  } catch (error) {
    await writer.abort();
    throw error;
  }
  return { ok: true, objectUrl: resource.objectUrl, resourceId: resource.id };
}

async function recoverResources(activeUrls) {
  if (!Array.isArray(activeUrls)) return { ok: false, reason: 'invalid_data' };
  const active = new Set(activeUrls);
  const root = await tempRoot();
  for await (const [id, dir] of root.entries()) {
    if (dir.kind !== 'directory' || !/^[a-f0-9-]{36}$/.test(id)) continue;
    let objectUrl;
    try {
      const metadata = await (await dir.getFileHandle('resource.json')).getFile();
      objectUrl = JSON.parse(await metadata.text()).objectUrl;
    } catch (error) {
      if (error?.name !== 'NotFoundError' && !(error instanceof SyntaxError)) throw error;
    }
    if (objectUrl && active.has(objectUrl)) {
      if (!resources.has(id)) resources.set(id, { id, dir, objectUrl, writable: null });
      resourceUrls.set(objectUrl, id);
    } else {
      await removeResource(id);
      if (state.sessionId === id) {
        state.active = false;
        state.writable = null;
        state.sessionId = null;
        state.entries = [];
        state.currentEntry = null;
      }
    }
  }
  // Legacy versions used a single directory without ownership metadata. Do not
  // remove it while any extension blob download could still be using it.
  if (active.size === 0) {
    try {
      await (await navigator.storage.getDirectory()).removeEntry('smd_zip_temp', { recursive: true });
    } catch (error) {
      if (error?.name !== 'NotFoundError') throw error;
    }
  }
  return { ok: true };
}

async function closeAndCleanupZip() {
  const id = state.sessionId;
  state.active = false;
  if (id) await removeResource(id);
  state.writable = null;
  state.currentEntry = null;
  state.entries = [];
  state.tempDirHandle = null;
  state.zipFileHandle = null;
  state.sessionId = null;
}

async function resetState() {
  // Finished resources belong to their browser downloads, not the next ZIP.
  if (state.active || state.writable) await closeAndCleanupZip();
  state.active = false;
  state.entries = [];
  state.currentEntry = null;
  state.currentOffset = 0;
  state.completed = 0;
  state.cancelled = false;
  state.lastPct = -1;
  state.entrySequence = 0;
  state.sessionId = null;
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
      return { ok: false, reason: 'opfs_unavailable' };
    }
    const resource = await createResource('application/zip');
    state.sessionId = resource.id;
    state.tempDirHandle = resource.dir;
    state.zipFileHandle = resource.file;
    state.writable = resource.writable;
    state.active = true;
    return { ok: true, sessionId: resource.id, storage: 'opfs', maxBytes: MAX_ZIP_BYTES };
  } catch (error) {
    await closeAndCleanupZip();
    return { ok: false, reason: dataErrorReason(error, 'opfs_unavailable') };
  }
}

function base64ToBytes(b64) {
  if (typeof b64 !== 'string') throw new Error('invalid_data');
  if (typeof b64 !== 'string' || b64.length > Math.ceil(MAX_CHUNK_BYTES / 3) * 4) throw new Error('invalid_data');
  const bin = atob(b64);
  if (bin.length > MAX_CHUNK_BYTES) throw new Error('invalid_data');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function writeBytes(bytes) {
  if (!state.writable) throw Object.assign(new Error('opfs_unavailable'), { code: 'opfs_unavailable' });
  await state.writable.write(bytes);
  state.currentOffset += bytes.byteLength;
}

async function beginEntry(name) {
  if (!state.active) return { ok: false, reason: 'no_active_zip' };
  if (state.cancelled) return { ok: false, reason: 'cancelled' };
  if (state.currentEntry) return { ok: false, reason: 'entry_in_progress' };
  if (state.entries.length >= MAX_ZIP_ENTRIES) return { ok: false, reason: 'entry_limit' };

  const sanitizedName = sanitizeArchivePath(name);
  const nameBytes = textEncoder.encode(sanitizedName);
  const { dosTime, dosDate } = getDosDateTime();
  const localHeader = createLocalHeader(nameBytes, dosTime, dosDate);
  const minimumFinalSize = state.currentOffset + localHeader.byteLength + ZIP_DATA_DESCRIPTOR_BYTES + 46 + nameBytes.length + 22;
  if (minimumFinalSize > MAX_ZIP_BYTES) return { ok: false, reason: 'size_limit', jobBytes: state.currentOffset };

  const entryId = `${state.sessionId}_${++state.entrySequence}`;
  const offset = state.currentOffset;
  try {
    await writeBytes(localHeader);
    state.currentEntry = {
      id: entryId,
      nameBytes,
      offset,
      crcState: 0xFFFFFFFF,
      size: 0,
      dosTime,
      dosDate
    };
    return { ok: true, entryId, path: sanitizedName, jobBytes: state.currentOffset };
  } catch (error) {
    await closeAndCleanupZip();
    return { ok: false, reason: dataErrorReason(error) };
  }
}

async function writeChunk(entryId, dataB64) {
  if (!state.active) return { ok: false, reason: 'no_active_zip' };
  if (state.cancelled) return { ok: false, reason: 'cancelled' };
  const entry = state.currentEntry;
  if (!entry || entry.id !== entryId) return { ok: false, reason: 'entry_not_active' };

  let bytes;
  try {
    bytes = base64ToBytes(dataB64);
  } catch (error) {
    return { ok: false, reason: 'invalid_data' };
  }

  const projected = state.currentOffset + bytes.byteLength + ZIP_DATA_DESCRIPTOR_BYTES + 46 + entry.nameBytes.length + 22;
  if (projected > MAX_ZIP_BYTES || entry.size + bytes.byteLength > 0xFFFFFFFF) {
    return { ok: false, reason: 'size_limit', jobBytes: state.currentOffset };
  }

  try {
    if (bytes.byteLength > 0) {
      await writeBytes(bytes);
      entry.crcState = updateCrc32(entry.crcState, bytes);
      entry.size += bytes.byteLength;
    }
    return { ok: true, chunkBytes: bytes.byteLength, jobBytes: state.currentOffset };
  } catch (error) {
    return { ok: false, reason: dataErrorReason(error), jobBytes: state.currentOffset };
  }
}

async function abortEntry(entryId) {
  const entry = state.currentEntry;
  if (!entry || entry.id !== entryId) return { ok: false, reason: 'entry_not_active' };

  try {
    // FileSystemWritableFileStream supports rollback through truncate/seek. This
    // keeps a failed media response from corrupting the rest of the archive.
    await state.writable.truncate(entry.offset);
    await state.writable.seek(entry.offset);
    state.currentOffset = entry.offset;
    state.currentEntry = null;
    return { ok: true, jobBytes: state.currentOffset };
  } catch (error) {
    await closeAndCleanupZip();
    return { ok: false, reason: dataErrorReason(error) };
  }
}

async function endEntry(entryId) {
  if (!state.active) return { ok: false, reason: 'no_active_zip' };
  if (state.cancelled) return { ok: false, reason: 'cancelled' };
  const entry = state.currentEntry;
  if (!entry || entry.id !== entryId) return { ok: false, reason: 'entry_not_active' };

  const crc32 = finalizeCrc32(entry.crcState);
  const descriptor = createDataDescriptor(crc32, entry.size);
  const projected = state.currentOffset + descriptor.byteLength + 46 + entry.nameBytes.length + 22;
  if (projected > MAX_ZIP_BYTES) {
    await abortEntry(entryId);
    return { ok: false, reason: 'size_limit', jobBytes: state.currentOffset };
  }

  try {
    await writeBytes(descriptor);
    state.entries.push({
      nameBytes: entry.nameBytes,
      crc32,
      size: entry.size,
      offset: entry.offset,
      dosTime: entry.dosTime,
      dosDate: entry.dosDate
    });
    state.currentEntry = null;
    state.completed++;
    reportProgress({
      status: 'DOWNLOADING_BLOBS',
      completed: state.completed,
      jobBytes: state.currentOffset
    });
    return { ok: true, size: entry.size, crc32, jobBytes: state.currentOffset };
  } catch (error) {
    await abortEntry(entryId);
    return { ok: false, reason: dataErrorReason(error), jobBytes: state.currentOffset };
  }
}

async function finishZip(zipFilename, discard) {
  void zipFilename;
  if (!state.active) return { ok: false, reason: 'no_active_zip' };
  if (state.currentEntry) return { ok: false, reason: 'entry_in_progress' };
  state.active = false;

  if (discard || state.cancelled) {
    await closeAndCleanupZip();
    return { ok: false, reason: discard ? 'discarded' : 'cancelled', completed: state.completed };
  }

  reportProgress({ status: 'PACKAGING_ZIP', zipPercent: 0 });

  try {
    const cdStartOffset = state.currentOffset;
    const cdSize = state.entries.reduce((total, entry) => total + 46 + entry.nameBytes.length, 0);
    const finalSize = cdStartOffset + cdSize + 22;
    if (finalSize > MAX_ZIP_BYTES) {
      await closeAndCleanupZip();
      return { ok: false, reason: 'size_limit', completed: state.completed };
    }

    for (let i = 0; i < state.entries.length; i++) {
      const cdHeader = createCentralDirectoryHeader(state.entries[i]);
      await writeBytes(cdHeader);
      const pct = state.entries.length === 0 ? 80 : Math.round(((i + 1) / state.entries.length) * 80);
      if (pct !== state.lastPct) {
        state.lastPct = pct;
        reportProgress({ status: 'PACKAGING_ZIP', zipPercent: pct });
      }
    }

    await writeBytes(createEocdRecord(state.entries.length, cdSize, cdStartOffset));
    const published = await publishResource(resources.get(state.sessionId));
    state.writable = null;
    state.entries = [];
    state.zipFileHandle = null;
    state.tempDirHandle = null;
    reportProgress({ status: 'PACKAGING_ZIP', zipPercent: 100 });
    return { ...published, completed: state.completed, size: finalSize };
  } catch (error) {
    await closeAndCleanupZip();
    return { ok: false, reason: dataErrorReason(error, 'zip_failed'), completed: state.completed };
  }
}

async function handleMessage(message) {
  const { type, sessionId, resourceId } = message;
  if (type === 'OFFSCREEN_ABORT_ZIP' && sessionId && !resources.has(sessionId)) return { ok: true };
  if (['OFFSCREEN_BEGIN_ENTRY', 'OFFSCREEN_WRITE_CHUNK', 'OFFSCREEN_END_ENTRY',
       'OFFSCREEN_ABORT_ENTRY', 'OFFSCREEN_FINISH_ZIP', 'OFFSCREEN_ABORT_ZIP'].includes(type) &&
      (!sessionId || sessionId !== state.sessionId)) {
    return { ok: false, reason: 'stale_session' };
  }
  switch (type) {
    case 'OFFSCREEN_BEGIN_ZIP': return resetState();
    case 'OFFSCREEN_BEGIN_ENTRY': return beginEntry(message.name);
    case 'OFFSCREEN_WRITE_CHUNK': return writeChunk(message.entryId, message.dataB64);
    case 'OFFSCREEN_END_ENTRY': return endEntry(message.entryId);
    case 'OFFSCREEN_ABORT_ENTRY': return abortEntry(message.entryId);
    case 'OFFSCREEN_FINISH_ZIP': return finishZip(message.zipFilename, message.discard);
    case 'OFFSCREEN_ABORT_ZIP':
      // A published file may already be read by the browser, even before the
      // download() callback supplies an ID. Its URL owns terminal cleanup.
      if (resources.get(sessionId)?.objectUrl) return { ok: true };
      state.cancelled = true;
      await closeAndCleanupZip();
      return { ok: true };
    case 'OFFSCREEN_RECOVER_RESOURCES': return recoverResources(message.activeUrls);
    case 'OFFSCREEN_BEGIN_BLOB': {
      const resource = await createResource(message.mimeType || 'application/octet-stream');
      return { ok: true, resourceId: resource.id };
    }
    case 'OFFSCREEN_WRITE_BLOB_CHUNK': {
      const resource = resources.get(resourceId);
      if (!resource?.writable || resourceId === state.sessionId) return { ok: false, reason: 'resource_not_active' };
      await resource.writable.write(base64ToBytes(message.dataB64));
      return { ok: true };
    }
    case 'OFFSCREEN_END_BLOB': {
      const resource = resources.get(resourceId);
      if (!resource?.writable || resourceId === state.sessionId) return { ok: false, reason: 'resource_not_active' };
      try { return await publishResource(resource); }
      catch (error) { await removeResource(resourceId); throw error; }
    }
    case 'OFFSCREEN_ABORT_BLOB':
      if (resources.has(resourceId) && resourceId !== state.sessionId) await removeResource(resourceId);
      return { ok: true };
    case 'OFFSCREEN_REVOKE_BLOB_URLS':
      if (!Array.isArray(message.urls)) return { ok: false, reason: 'invalid_data' };
      for (const url of message.urls) {
        const id = resourceUrls.get(url);
        if (id) await removeResource(id);
      }
      return { ok: true };
    default: return { ok: false, reason: 'unsupported_message' };
  }
}

let messageQueue = Promise.resolve();
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message?.type?.startsWith('OFFSCREEN_')) return;
  // Content scripts cannot create/delete extension-owned files.
  if (sender.tab || (sender.id && sender.id !== chrome.runtime.id)) return;
  const operation = messageQueue.then(() => handleMessage(message));
  messageQueue = operation.catch(() => {});
  operation.then(sendResponse, (error) => sendResponse({ ok: false, reason: dataErrorReason(error, 'opfs_operation_failed') }));
  return true;
});
