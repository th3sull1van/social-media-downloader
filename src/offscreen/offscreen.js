/**
 * Social Media Downloader — Offscreen ZIP Packager (OPFS Disk Streaming Engine)
 * Manifest V3 Offscreen Document dedicated for streaming ZIP packaging in STORE mode.
 * Uses Origin Private File System (OPFS) for zero-RAM disk-cached streaming,
 * with graceful in-memory fallback when OPFS is unavailable.
 */

// CRC-32 Lookup Table
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[i] = c;
}

function computeCrc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) {
    crc = (CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function getDosDateTime(date = new Date()) {
  const year = date.getFullYear();
  const dosTime = ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)) & 0xFFFF;
  const dosDate = (((year < 1980 ? 0 : year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xFFFF;
  return { dosTime, dosDate };
}

function createLocalHeader(nameBytes, crc32, size, dosTime, dosDate) {
  const buf = new Uint8Array(30 + nameBytes.length);
  const view = new DataView(buf.buffer);
  view.setUint32(0, 0x04034b50, true); // Local file header signature (PK\x03\x04)
  view.setUint16(4, 20, true);         // Version needed to extract (2.0)
  view.setUint16(6, 0x0800, true);     // General purpose bit flag (UTF-8)
  view.setUint16(8, 0, true);          // Compression method (0 = STORE)
  view.setUint16(10, dosTime, true);   // Last mod time
  view.setUint16(12, dosDate, true);   // Last mod date
  view.setUint32(14, crc32, true);     // CRC-32
  view.setUint32(18, size, true);      // Compressed size
  view.setUint32(22, size, true);      // Uncompressed size
  view.setUint16(26, nameBytes.length, true); // Filename length
  view.setUint16(28, 0, true);         // Extra field length
  buf.set(nameBytes, 30);
  return buf;
}

function createCentralDirectoryHeader(entry) {
  const buf = new Uint8Array(46 + entry.nameBytes.length);
  const view = new DataView(buf.buffer);
  view.setUint32(0, 0x02014b50, true); // Central file header signature (PK\x01\x02)
  view.setUint16(4, 20, true);         // Version made by (2.0)
  view.setUint16(6, 20, true);         // Version needed to extract (2.0)
  view.setUint16(8, 0x0800, true);     // General purpose bit flag (UTF-8)
  view.setUint16(10, 0, true);         // Compression method (0 = STORE)
  view.setUint16(12, entry.dosTime, true); // Last mod time
  view.setUint16(14, entry.dosDate, true); // Last mod date
  view.setUint32(16, entry.crc32, true);   // CRC-32
  view.setUint32(20, entry.size, true);    // Compressed size
  view.setUint32(24, entry.size, true);    // Uncompressed size
  view.setUint16(28, entry.nameBytes.length, true); // Filename length
  view.setUint16(30, 0, true);         // Extra field length
  view.setUint16(32, 0, true);         // File comment length
  view.setUint16(34, 0, true);         // Disk number start
  view.setUint16(36, 0, true);         // Internal file attributes
  view.setUint32(38, 0, true);         // External file attributes
  view.setUint32(42, entry.offset, true); // Relative offset of local header
  buf.set(entry.nameBytes, 46);
  return buf;
}

function createEocdRecord(entryCount, cdSize, cdOffset) {
  const buf = new Uint8Array(22);
  const view = new DataView(buf.buffer);
  view.setUint32(0, 0x06054b50, true); // End of central dir signature (PK\x05\x06)
  view.setUint16(4, 0, true);          // Disk number
  view.setUint16(6, 0, true);          // Start disk
  view.setUint16(8, entryCount, true); // Entries on this disk
  view.setUint16(10, entryCount, true);// Total entries
  view.setUint32(12, cdSize, true);    // Size of central directory
  view.setUint32(16, cdOffset, true);  // Offset of central directory
  view.setUint16(20, 0, true);         // Comment length
  return buf;
}

const textEncoder = new TextEncoder();

const state = {
  active: false,
  useOpfs: false,
  tempDirHandle: null,
  zipFileHandle: null,
  writable: null,
  /** @type {Promise<any>} */
  writeQueue: Promise.resolve(),
  /** @type {Array<Uint8Array>} */
  memoryChunks: [],
  /** @type {Array<{ nameBytes: Uint8Array, crc32: number, size: number, offset: number, dosTime: number, dosDate: number }>} */
  entries: [],
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

async function resetState() {
  state.active = true;
  state.entries = [];
  state.memoryChunks = [];
  state.currentOffset = 0;
  state.completed = 0;
  state.cancelled = false;
  state.lastPct = -1;
  state.writeQueue = Promise.resolve();

  if (state.writable) {
    try { await state.writable.abort(); } catch (e) {}
    state.writable = null;
  }

  state.useOpfs = false;
  try {
    if (typeof navigator !== 'undefined' && navigator.storage && typeof navigator.storage.getDirectory === 'function') {
      await cleanupOpfs();
      const root = await navigator.storage.getDirectory();
      state.tempDirHandle = await root.getDirectoryHandle('smd_zip_temp', { create: true });
      state.zipFileHandle = await state.tempDirHandle.getFileHandle('archive.zip', { create: true });
      state.writable = await state.zipFileHandle.createWritable();
      state.useOpfs = true;
    }
  } catch (err) {
    state.useOpfs = false;
    state.writable = null;
  }
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function addFile(name, bufferOrB64) {
  if (!state.active) return { ok: false, reason: 'no_active_zip' };
  if (state.cancelled) return { ok: false, reason: 'cancelled' };

  let bytes;
  if (typeof Blob !== 'undefined' && bufferOrB64 instanceof Blob) {
    bytes = new Uint8Array(await bufferOrB64.arrayBuffer());
  } else if (bufferOrB64 instanceof ArrayBuffer) {
    bytes = new Uint8Array(bufferOrB64);
  } else if (bufferOrB64 && bufferOrB64.buffer instanceof ArrayBuffer) {
    bytes = bufferOrB64;
  } else if (typeof bufferOrB64 === 'string') {
    bytes = base64ToBytes(bufferOrB64);
  } else {
    return { ok: false, reason: 'invalid_data' };
  }

  const sanitizedName = String(name || 'file').replace(/\\/g, '/').replace(/^\/+/, '');
  const nameBytes = textEncoder.encode(sanitizedName);
  const crc32 = computeCrc32(bytes);
  const { dosTime, dosDate } = getDosDateTime();
  const localHeader = createLocalHeader(nameBytes, crc32, bytes.length, dosTime, dosDate);

  const writeOperation = async () => {
    if (!state.active || state.cancelled) return { ok: false, reason: 'cancelled' };

    const localHeaderOffset = state.currentOffset;

    if (state.useOpfs && state.writable) {
      await state.writable.write(localHeader);
      await state.writable.write(bytes);
    } else {
      state.memoryChunks.push(localHeader);
      state.memoryChunks.push(bytes);
    }

    state.entries.push({
      nameBytes,
      crc32,
      size: bytes.length,
      offset: localHeaderOffset,
      dosTime,
      dosDate
    });

    state.currentOffset += localHeader.byteLength + bytes.length;
    state.completed++;

    reportProgress({
      status: 'DOWNLOADING_BLOBS',
      completed: state.completed
    });

    return { ok: true, jobBytes: state.currentOffset };
  };

  // Mutex sequential write queue guarantees correct byte ordering & exact Central Directory offsets
  return (state.writeQueue = state.writeQueue.then(writeOperation, writeOperation));
}

async function finishZip(zipFilename, discard) {
  if (!state.active) return { ok: false, reason: 'no_active_zip' };
  state.active = false;

  // Drain any in-flight write operations first
  try {
    await state.writeQueue;
  } catch (e) {}

  if (discard || state.cancelled) {
    if (state.writable) {
      try { await state.writable.abort(); } catch (e) {}
      state.writable = null;
    }
    await cleanupOpfs();
    return { ok: false, reason: discard ? 'discarded' : 'cancelled', completed: state.completed };
  }

  reportProgress({ status: 'PACKAGING_ZIP', zipPercent: 0 });

  try {
    const cdStartOffset = state.currentOffset;
    let cdSize = 0;

    // Write Central Directory headers
    for (let i = 0; i < state.entries.length; i++) {
      const cdHeader = createCentralDirectoryHeader(state.entries[i]);
      if (state.useOpfs && state.writable) {
        await state.writable.write(cdHeader);
      } else {
        state.memoryChunks.push(cdHeader);
      }
      cdSize += cdHeader.byteLength;
      state.currentOffset += cdHeader.byteLength;

      const pct = Math.round(((i + 1) / state.entries.length) * 80);
      if (pct !== state.lastPct) {
        state.lastPct = pct;
        reportProgress({ status: 'PACKAGING_ZIP', zipPercent: pct });
      }
    }

    // Write End of Central Directory record
    const eocd = createEocdRecord(state.entries.length, cdSize, cdStartOffset);
    if (state.useOpfs && state.writable) {
      await state.writable.write(eocd);
      await state.writable.close();
      state.writable = null;
    } else {
      state.memoryChunks.push(eocd);
    }
    state.currentOffset += eocd.byteLength;

    reportProgress({ status: 'PACKAGING_ZIP', zipPercent: 100 });

    let zipBlob;
    if (state.useOpfs && state.zipFileHandle) {
      zipBlob = await state.zipFileHandle.getFile();
    } else {
      zipBlob = new Blob(state.memoryChunks, { type: 'application/zip' });
      state.memoryChunks = [];
    }

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

    return { ok: true, objectUrl, completed: state.completed };
  } catch (err) {
    if (state.writable) {
      try { await state.writable.abort(); } catch (e) {}
      state.writable = null;
    }
    await cleanupOpfs();
    return { ok: false, reason: err?.message || 'zip_failed', completed: state.completed };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) return;

  switch (message.type) {
    case 'OFFSCREEN_BEGIN_ZIP':
      resetState().then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
      return true;

    case 'OFFSCREEN_ADD_FILE':
      addFile(message.name, message.dataB64 || message.buffer).then(sendResponse);
      return true;

    case 'OFFSCREEN_FINISH_ZIP':
      finishZip(message.zipFilename, message.discard).then(sendResponse);
      return true;

    case 'OFFSCREEN_ABORT_ZIP':
      state.cancelled = true;
      if (state.writable) {
        state.writable.abort().catch(() => {});
        state.writable = null;
      }
      cleanupOpfs().catch(() => {});
      sendResponse({ ok: true });
      return;

    // Creates a blob URL for generated artifacts (muxed MP4, RedGifs transcodes).
    // The service worker cannot call URL.createObjectURL itself. Binary arrives
    // base64-encoded (runtime.sendMessage JSON-serializes messages).
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
      } catch (err) {
        sendResponse({ ok: false, reason: err?.message || 'blob_url_failed' });
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
