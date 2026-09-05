/**
 * Social Media Downloader — Archive Service
 * Platform-agnostic ZIP packaging interface communicating with the Offscreen document.
 */

export class ArchiveService {
  static CHUNK_BYTES = 512 * 1024;
  static sessionId = null;
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
   * @returns {Promise<{ ok: boolean, reason?: string, sessionId?: string, storage?: string, maxBytes?: number }>}
   */
  static async begin() {
    const res = await ArchiveService.sendToOffscreen({ type: 'OFFSCREEN_BEGIN_ZIP' });
    ArchiveService.sessionId = res?.sessionId || null;
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
  static async beginEntry(name, sessionId = ArchiveService.sessionId) {
    const res = await ArchiveService.sendToOffscreen({ type: 'OFFSCREEN_BEGIN_ENTRY', name, sessionId });
    return res || { ok: false, reason: 'no_response' };
  }

  /**
   * Writes one bounded binary chunk to an active entry.
   * @param {string} entryId
   * @param {Uint8Array} bytes
   * @returns {Promise<{ ok: boolean, reason?: string, jobBytes?: number }>}
   */
  static async writeChunk(entryId, bytes, sessionId = ArchiveService.sessionId) {
    if (!(bytes instanceof Uint8Array)) return { ok: false, reason: 'invalid_data' };
    const res = await ArchiveService.sendToOffscreen({
      type: 'OFFSCREEN_WRITE_CHUNK',
      sessionId,
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
  static async abortEntry(entryId, sessionId = ArchiveService.sessionId) {
    const res = await ArchiveService.sendToOffscreen({ type: 'OFFSCREEN_ABORT_ENTRY', entryId, sessionId });
    return res || { ok: false, reason: 'no_response' };
  }

  /**
   * Finishes an active entry transaction.
   * @param {string} entryId
   * @returns {Promise<{ ok: boolean, reason?: string, size?: number, crc32?: number }>}
   */
  static async endEntry(entryId, sessionId = ArchiveService.sessionId) {
    const res = await ArchiveService.sendToOffscreen({ type: 'OFFSCREEN_END_ENTRY', entryId, sessionId });
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
  static async addFileStream(name, source, signal = undefined, sessionId = ArchiveService.sessionId) {
    return ArchiveService.withEntryLock(async () => {
      let entryId;
      try {
        signal?.throwIfAborted();
        if (sessionId !== ArchiveService.sessionId) throw new Error('stale_session');
        const begin = await ArchiveService.beginEntry(name, sessionId);
        if (!begin?.ok || !begin.entryId) throw new Error(begin?.reason || 'no_response');
        entryId = begin.entryId;
        await ArchiveService.pipeSource(source,
          (bytes) => ArchiveService.writeChunk(entryId, bytes, sessionId), signal);
        const end = await ArchiveService.endEntry(entryId, sessionId);
        if (!end?.ok) throw new Error(end?.reason || 'no_response');
        return end;
      } catch (error) {
        if (entryId) await ArchiveService.abortEntry(entryId, sessionId);
        // A queued response may never have acquired a reader.
        const body = /** @type {any} */ (source)?.body || source;
        if (body?.cancel && !body.locked) await body.cancel().catch(() => {});
        return { ok: false, reason: signal?.aborted ? 'cancelled' : error?.message || 'stream_failed' };
      }
    });
  }

  /** Consume one source with bounded transport, acknowledgements and cancellation. */
  static async pipeSource(source, write, signal = undefined) {
    const reader = ArchiveService.getReader(source);
    const cancel = () => { if (reader) void reader.cancel().catch(() => {}); };
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      const send = async (bytes) => {
        if (!(bytes instanceof Uint8Array)) throw new Error('invalid_data');
        for (let offset = 0; offset < bytes.byteLength; offset += ArchiveService.CHUNK_BYTES) {
          signal?.throwIfAborted();
          const result = await write(bytes.subarray(offset, offset + ArchiveService.CHUNK_BYTES));
          if (!result?.ok) throw new Error(result?.reason || 'no_response');
        }
      };
      signal?.throwIfAborted();
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          signal?.throwIfAborted();
          if (done) break;
          await send(value);
        }
      } else {
        const bytes = await ArchiveService.toBytes(source);
        if (!bytes) throw new Error('invalid_data');
        await send(bytes);
      }
      signal?.throwIfAborted();
    } catch (error) {
      if (reader) await reader.cancel().catch(() => {});
      throw error;
    } finally {
      signal?.removeEventListener('abort', cancel);
      reader?.releaseLock();
    }
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
  static async finish(zipFilename, discard = false, sessionId = ArchiveService.sessionId) {
    const res = await ArchiveService.sendToOffscreen({
      type: 'OFFSCREEN_FINISH_ZIP',
      sessionId,
      zipFilename,
      discard
    });
    return res || { ok: false, reason: 'no_response' };
  }

  /**
   * Aborts an active ZIP job in the offscreen packager.
   * @returns {Promise<boolean>}
   */
  static async abort(sessionId = ArchiveService.sessionId) {
    const res = await ArchiveService.sendToOffscreen({ type: 'OFFSCREEN_ABORT_ZIP', sessionId });
    return !!(res && res.ok);
  }

  /**
   * Creates a Blob URL inside the offscreen document (the service worker has no
   * URL.createObjectURL). Used for generated artifacts such as muxed MP4 videos.
   * Each bounded chunk is base64-encoded because runtime.sendMessage JSON-serializes:
   * raw binary would arrive as {} in the offscreen document.
   * @param {Blob | ArrayBuffer | Uint8Array} data
   * @param {string} [mimeType='application/octet-stream']
   * @returns {Promise<{ ok: boolean, objectUrl?: string, reason?: string }>}
   */
  static async createBlobUrl(data, mimeType = 'application/octet-stream', signal = undefined) {
    let resourceId;
    try {
      signal?.throwIfAborted();
      const begin = await ArchiveService.sendToOffscreen({ type: 'OFFSCREEN_BEGIN_BLOB', mimeType });
      resourceId = begin?.resourceId;
      if (!begin?.ok || !resourceId) throw new Error(begin?.reason || 'no_response');
      await ArchiveService.pipeSource(data, (bytes) => ArchiveService.sendToOffscreen({
        type: 'OFFSCREEN_WRITE_BLOB_CHUNK', resourceId, dataB64: ArchiveService.bytesToBase64(bytes)
      }), signal);
      const result = await ArchiveService.sendToOffscreen({ type: 'OFFSCREEN_END_BLOB', resourceId });
      if (!result?.ok) throw new Error(result?.reason || 'no_response');
      signal?.throwIfAborted();
      return result;
    } catch (error) {
      if (resourceId) {
        const cleanup = await ArchiveService.sendToOffscreen({ type: 'OFFSCREEN_ABORT_BLOB', resourceId });
        if (!cleanup?.ok) return { ok: false, reason: 'opfs_cleanup_failed' };
      }
      return { ok: false, reason: signal?.aborted ? 'cancelled' : error?.message || 'blob_url_failed' };
    }
  }

  /**
   * Releases ZIP and generated-file URLs and their owned OPFS directories.
   * Called when the corresponding download reaches a terminal state.
   * @param {string[]} urls
   * @returns {Promise<void>}
   */
  static async revokeBlobUrls(urls) {
    if (!Array.isArray(urls) || urls.length === 0) return;
    const result = await ArchiveService.sendToOffscreen({ type: 'OFFSCREEN_REVOKE_BLOB_URLS', urls });
    if (!result?.ok) throw new Error(result?.reason || 'opfs_cleanup_failed');
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
