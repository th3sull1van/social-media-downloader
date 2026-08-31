/**
 * Social Media Downloader — Archive Service
 * Platform-agnostic ZIP packaging interface communicating with the Offscreen document.
 */

export class ArchiveService {
  static CHUNK_BYTES = 512 * 1024;
  static entryQueue = Promise.resolve();

  /**
   * Sends a structured message to the active offscreen document.
   * @param {Object} message
   * @returns {Promise<any>}
   */
  static async sendToOffscreen(message) {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
      return null;
    }
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          void chrome.runtime.lastError;
          resolve(response || null);
        });
      } catch (e) {
        resolve(null);
      }
    });
  }

  /**
   * Initializes a new ZIP packaging session in the offscreen document.
   * @returns {Promise<{ ok: boolean, reason?: string, storage?: string, maxBytes?: number }>}
   */
  static async begin() {
    const res = await ArchiveService.sendToOffscreen({ type: 'OFFSCREEN_BEGIN_ZIP' });
    ArchiveService.entryQueue = Promise.resolve();
    return res || { ok: false, reason: 'no_response' };
  }

  /**
   * Serializes complete entry transactions while allowing the DownloadManager
   * to fetch several media responses concurrently. ZIP bytes cannot interleave
   * entries, so only one begin/chunk/end sequence may be active at a time.
   * @param {() => Promise<any>} operation
   * @returns {Promise<any>}
   */
  static async withEntryLock(operation) {
    const previous = ArchiveService.entryQueue;
    let release = () => {};
    ArchiveService.entryQueue = new Promise((resolve) => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  /**
   * Starts one ZIP entry using a data descriptor. The payload is then delivered
   * through bounded OFFSCREEN_WRITE_CHUNK messages.
   * @param {string} name
   * @returns {Promise<{ ok: boolean, entryId?: string, reason?: string }>}
   */
  static async beginEntry(name) {
    const res = await ArchiveService.sendToOffscreen({ type: 'OFFSCREEN_BEGIN_ENTRY', name });
    return res || { ok: false, reason: 'no_response' };
  }

  /**
   * Writes one bounded binary chunk to an active entry.
   * @param {string} entryId
   * @param {Uint8Array} bytes
   * @returns {Promise<{ ok: boolean, reason?: string, jobBytes?: number }>}
   */
  static async writeChunk(entryId, bytes) {
    if (!(bytes instanceof Uint8Array)) return { ok: false, reason: 'invalid_data' };
    const res = await ArchiveService.sendToOffscreen({
      type: 'OFFSCREEN_WRITE_CHUNK',
      entryId,
      dataB64: ArchiveService.bytesToBase64(bytes)
    });
    return res || { ok: false, reason: 'no_response' };
  }

  /**
   * Rolls back the current entry after a failed network/read operation.
   * @param {string} entryId
   * @returns {Promise<{ ok: boolean, reason?: string }>}
   */
  static async abortEntry(entryId) {
    const res = await ArchiveService.sendToOffscreen({ type: 'OFFSCREEN_ABORT_ENTRY', entryId });
    return res || { ok: false, reason: 'no_response' };
  }

  /**
   * Finishes an active entry transaction.
   * @param {string} entryId
   * @returns {Promise<{ ok: boolean, reason?: string, size?: number, crc32?: number }>}
   */
  static async endEntry(entryId) {
    const res = await ArchiveService.sendToOffscreen({ type: 'OFFSCREEN_END_ENTRY', entryId });
    return res || { ok: false, reason: 'no_response' };
  }

  /**
   * Streams a binary source into one ZIP entry. Response/ReadableStream/Blob
   * sources are consumed incrementally; ArrayBuffer-like values are chunked
   * before transport. The lock keeps ZIP entry bytes ordered and the ack after
   * every chunk provides backpressure.
   *
   * @param {string} name
   * @param {Response | ReadableStream | Blob | ArrayBuffer | ArrayBufferView | string} source
   * @returns {Promise<{ ok: boolean, reason?: string, jobBytes?: number, size?: number }>}
   */
  static async addFileStream(name, source) {
    return ArchiveService.withEntryLock(async () => {
      const begin = await ArchiveService.beginEntry(name);
      if (!begin?.ok || !begin.entryId) return begin || { ok: false, reason: 'no_response' };

      const entryId = begin.entryId;
      try {
        const reader = ArchiveService.getReader(source);
        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value instanceof Uint8Array && value.byteLength > 0) {
              const result = await ArchiveService.writeChunked(entryId, value);
              if (!result.ok) throw Object.assign(new Error(result.reason || 'chunk_write_failed'), { reason: result.reason });
            }
          }
        } else {
          const bytes = await ArchiveService.toBytes(source);
          if (!bytes) throw new Error('invalid_data');
          const result = await ArchiveService.writeChunked(entryId, bytes);
          if (!result.ok) throw Object.assign(new Error(result.reason || 'chunk_write_failed'), { reason: result.reason });
        }

        const end = await ArchiveService.endEntry(entryId);
        if (!end?.ok) {
          await ArchiveService.abortEntry(entryId);
        }
        return end || { ok: false, reason: 'no_response' };
      } catch (error) {
        await ArchiveService.abortEntry(entryId);
        return { ok: false, reason: error?.reason || error?.message || 'stream_failed' };
      }
    });
  }

  /**
   * Compatibility wrapper for callers that already hold a complete payload.
   * New ZIP code should use addFileStream with a Response or Blob stream.
   * @param {string} name - Relative path within the ZIP archive
   * @param {string | ArrayBuffer | Uint8Array | Blob} data - Base64 string or raw binary
   * @returns {Promise<{ ok: boolean, reason?: string, jobBytes?: number }>}
   */
  static async addFile(name, data) {
    if (typeof data === 'string') {
      try {
        data = ArchiveService.base64ToBytes(data);
      } catch (error) {
        return { ok: false, reason: 'invalid_data' };
      }
    }
    return ArchiveService.addFileStream(name, data);
  }

  static getReader(source) {
    if (source && source.body && typeof source.body.getReader === 'function') return source.body.getReader();
    if (source && typeof source.getReader === 'function') return source.getReader();
    if (typeof Blob !== 'undefined' && source instanceof Blob && typeof source.stream === 'function') {
      return source.stream().getReader();
    }
    return null;
  }

  static async toBytes(data) {
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (data && typeof data === 'object' && ArrayBuffer.isView(data)) {
      return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }
    if (typeof Blob !== 'undefined' && data instanceof Blob) {
      return new Uint8Array(await data.arrayBuffer());
    }
    if (data && typeof data.arrayBuffer === 'function') {
      return new Uint8Array(await data.arrayBuffer());
    }
    return null;
  }

  static async writeChunked(entryId, bytes) {
    for (let offset = 0; offset < bytes.byteLength; offset += ArchiveService.CHUNK_BYTES) {
      const chunk = bytes.subarray(offset, Math.min(offset + ArchiveService.CHUNK_BYTES, bytes.byteLength));
      const result = await ArchiveService.writeChunk(entryId, chunk);
      if (!result?.ok) return result || { ok: false, reason: 'no_response' };
    }
    return { ok: true };
  }

  static base64ToBytes(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  /**
   * Finalizes the ZIP archive and generates a Blob URL.
   * @param {string} zipFilename
   * @param {boolean} [discard=false]
   * @returns {Promise<{ ok: boolean, objectUrl?: string, reason?: string, completed?: number }>}
   */
  static async finish(zipFilename, discard = false) {
    const res = await ArchiveService.sendToOffscreen({
      type: 'OFFSCREEN_FINISH_ZIP',
      zipFilename,
      discard
    });
    return res || { ok: false, reason: 'no_response' };
  }

  /**
   * Aborts an active ZIP job in the offscreen packager.
   * @returns {Promise<boolean>}
   */
  static async abort() {
    const res = await ArchiveService.sendToOffscreen({ type: 'OFFSCREEN_ABORT_ZIP' });
    return !!(res && res.ok);
  }

  /**
   * Creates a Blob URL inside the offscreen document (the service worker has no
   * URL.createObjectURL). Used for generated artifacts such as muxed MP4 videos.
   * Data is base64-encoded here because runtime.sendMessage JSON-serializes:
   * raw binary would arrive as {} in the offscreen document.
   * @param {Blob | ArrayBuffer | Uint8Array} data
   * @param {string} [mimeType='application/octet-stream']
   * @returns {Promise<{ ok: boolean, objectUrl?: string, reason?: string }>}
   */
  static async createBlobUrl(data, mimeType = 'application/octet-stream') {
    let bytes = null;
    if (typeof Blob !== 'undefined' && data instanceof Blob) {
      bytes = new Uint8Array(await data.arrayBuffer());
    } else if (data instanceof ArrayBuffer) {
      bytes = new Uint8Array(data);
    } else if (data && typeof data === 'object' && ArrayBuffer.isView(data)) {
      bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }
    if (!bytes) {
      return { ok: false, reason: 'invalid_data' };
    }
    const res = await ArchiveService.sendToOffscreen({
      type: 'OFFSCREEN_CREATE_BLOB_URL',
      dataB64: ArchiveService.bytesToBase64(bytes),
      mimeType
    });
    return res || { ok: false, reason: 'no_response' };
  }

  /**
   * Revokes specific Blob URLs created by OFFSCREEN_CREATE_BLOB_URL.
   * Called when the corresponding download reaches a terminal state.
   * @param {string[]} urls
   * @returns {Promise<void>}
   */
  static async revokeBlobUrls(urls) {
    if (!Array.isArray(urls) || urls.length === 0) return;
    await ArchiveService.sendToOffscreen({ type: 'OFFSCREEN_REVOKE_BLOB_URLS', urls });
  }

  /**
   * Converts a Uint8Array or ArrayBuffer to base64 in 32KB chunks without call-stack overflow.
   * @param {Uint8Array} bytes
   * @returns {string}
   */
  static bytesToBase64(bytes) {
    const CHUNK = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
  }

  static CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[i] = c;
    }
    return table;
  })();

  /**
   * Computes the 32-bit unsigned CRC-32 checksum of a byte array.
   * @param {Uint8Array} bytes
   * @returns {number}
   */
  static computeCrc32(bytes) {
    let crc = 0xFFFFFFFF;
    const table = ArchiveService.CRC_TABLE;
    for (let i = 0; i < bytes.length; i++) {
      crc = (table[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8)) >>> 0;
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  /**
   * Generates a unique content signature for exact deduplication.
   * @param {Uint8Array} bytes
   * @returns {string}
   */
  static getSignature(bytes) {
    return `${ArchiveService.computeCrc32(bytes)}_${bytes.length}`;
  }
}
