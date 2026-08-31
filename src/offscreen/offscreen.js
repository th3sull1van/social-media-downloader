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
  lastObjectUrl: null,
  revokeTimer: null,
  /** @type {Set<string>} */
  generatedBlobUrls: new Set()
};

function reportProgress(patch) {
  try {
    chrome.runtime.sendMessage({ type: 'ZIP_OFFSCREEN_PROGRESS', patch }).catch(() => {});
  } catch (e) {}
}

async function cleanupOpfs() {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage && typeof navigator.storage.getDirectory === 'function') {
      const root = await navigator.storage.getDirectory();
      await root.removeEntry('smd_zip_temp', { recursive: true });
    }
  } catch (e) {}
}

async function closeAndCleanupZip() {
  if (state.writable) {
    try { await state.writable.abort(); } catch (e) {}
    state.writable = null;
  }
  state.currentEntry = null;
  state.active = false;
  await cleanupOpfs();
}

async function resetState() {
  state.active = false;
  state.entries = [];
  state.currentEntry = null;
  state.currentOffset = 0;
  state.completed = 0;
  state.cancelled = false;
  state.lastPct = -1;
  state.entrySequence = 0;

  if (state.writable) {
    try { await state.writable.abort(); } catch (e) {}
    state.writable = null;
  }

  await cleanupOpfs();

  try {
    if (typeof navigator === 'undefined' || !navigator.storage || typeof navigator.storage.getDirectory !== 'function') {
      return { ok: false, reason: 'opfs_unavailable' };
    }

    const root = await navigator.storage.getDirectory();
    state.tempDirHandle = await root.getDirectoryHandle('smd_zip_temp', { create: true });
    state.zipFileHandle = await state.tempDirHandle.getFileHandle('archive.zip', { create: true });
    state.writable = await state.zipFileHandle.createWritable();
    state.active = true;
    return { ok: true, storage: 'opfs', maxBytes: MAX_ZIP_BYTES };
  } catch (error) {
    state.tempDirHandle = null;
    state.zipFileHandle = null;
    state.writable = null;
    await cleanupOpfs();
    return { ok: false, reason: dataErrorReason(error, 'opfs_unavailable') };
  }
}

function base64ToBytes(b64) {
  if (typeof b64 !== 'string') throw new Error('invalid_data');
  const bin = atob(b64);
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

  const entryId = `entry_${++state.entrySequence}`;
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
    await state.writable.close();
    state.writable = null;
    reportProgress({ status: 'PACKAGING_ZIP', zipPercent: 100 });

    const zipBlob = await state.zipFileHandle.getFile();
    const objectUrl = URL.createObjectURL(zipBlob);
    state.lastObjectUrl = objectUrl;
    clearTimeout(state.revokeTimer);
    state.revokeTimer = setTimeout(() => {
      if (state.lastObjectUrl) {
        URL.revokeObjectURL(state.lastObjectUrl);
        state.lastObjectUrl = null;
      }
      cleanupOpfs().catch(() => {});
    }, 600_000);

    return { ok: true, objectUrl, completed: state.completed, size: finalSize };
  } catch (error) {
    await closeAndCleanupZip();
    return { ok: false, reason: dataErrorReason(error, 'zip_failed'), completed: state.completed };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) return;

  switch (message.type) {
    case 'OFFSCREEN_BEGIN_ZIP':
      resetState().then(sendResponse).catch((error) => sendResponse({ ok: false, reason: dataErrorReason(error, 'opfs_unavailable') }));
      return true;

    case 'OFFSCREEN_BEGIN_ENTRY':
      beginEntry(message.name).then(sendResponse).catch((error) => sendResponse({ ok: false, reason: dataErrorReason(error) }));
      return true;

    case 'OFFSCREEN_WRITE_CHUNK':
      writeChunk(message.entryId, message.dataB64).then(sendResponse).catch((error) => sendResponse({ ok: false, reason: dataErrorReason(error) }));
      return true;

    case 'OFFSCREEN_END_ENTRY':
      endEntry(message.entryId).then(sendResponse).catch((error) => sendResponse({ ok: false, reason: dataErrorReason(error) }));
      return true;

    case 'OFFSCREEN_ABORT_ENTRY':
      abortEntry(message.entryId).then(sendResponse).catch((error) => sendResponse({ ok: false, reason: dataErrorReason(error) }));
      return true;

    case 'OFFSCREEN_FINISH_ZIP':
      finishZip(message.zipFilename, message.discard).then(sendResponse).catch((error) => sendResponse({ ok: false, reason: dataErrorReason(error) }));
      return true;

    case 'OFFSCREEN_ABORT_ZIP':
      state.cancelled = true;
      closeAndCleanupZip().then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false, reason: 'opfs_cleanup_failed' }));
      return true;

    // Creates a blob URL for generated artifacts (muxed MP4, RedGifs transcodes).
    // The service worker cannot call URL.createObjectURL itself. Binary arrives
    // base64-encoded because chrome.runtime.sendMessage JSON-serializes messages.
    case 'OFFSCREEN_CREATE_BLOB_URL': {
      try {
        if (typeof message.dataB64 !== 'string' || message.dataB64.length === 0) {
          sendResponse({ ok: false, reason: 'invalid_data' });
          return;
        }
        const bytes = base64ToBytes(message.dataB64);
        const blob = new Blob([bytes], { type: message.mimeType || 'application/octet-stream' });
        const objectUrl = URL.createObjectURL(blob);
        state.generatedBlobUrls.add(objectUrl);
        sendResponse({ ok: true, objectUrl });
      } catch (error) {
        sendResponse({ ok: false, reason: error?.message || 'blob_url_failed' });
      }
      return;
    }

    case 'OFFSCREEN_REVOKE_BLOB_URLS': {
      const urls = Array.isArray(message.urls) ? message.urls : [];
      for (const url of urls) {
        if (state.generatedBlobUrls.has(url)) {
          URL.revokeObjectURL(url);
          state.generatedBlobUrls.delete(url);
        }
      }
      sendResponse({ ok: true });
      return;
    }
  }
});
