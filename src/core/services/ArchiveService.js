/**
 * Social Media Downloader — Archive Service
 * Platform-agnostic ZIP packaging interface communicating with the Offscreen document.
 */

export class ArchiveService {
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
   * @returns {Promise<boolean>}
   */
  static async begin() {
    const res = await ArchiveService.sendToOffscreen({ type: 'OFFSCREEN_BEGIN_ZIP' });
    return !!(res && res.ok);
  }

  /**
   * Appends a single file entry into the offscreen ZIP buffer.
   *
   * Transport note: chrome.runtime.sendMessage JSON-serializes messages (structured
   * clone is opt-in from Chrome 148). Raw ArrayBuffer/Uint8Array/Blob would arrive
   * as {} on the offscreen side, silently producing an empty 22-byte ZIP. Binary
   * data MUST be base64-encoded in the service worker before messaging.
   * @param {string} name - Relative path within the ZIP archive
   * @param {string | ArrayBuffer | Uint8Array | Blob} data - Base64 string or raw binary
   * @returns {Promise<{ ok: boolean, reason?: string, jobBytes?: number }>}
   */
  static async addFile(name, data) {
    let payload;
    if (typeof data === 'string') {
      payload = { type: 'OFFSCREEN_ADD_FILE', name, dataB64: data };
    } else {
      let bytes = null;
      if (typeof Blob !== 'undefined' && data instanceof Blob) {
        bytes = new Uint8Array(await data.arrayBuffer());
      } else if (data instanceof ArrayBuffer) {
        bytes = new Uint8Array(data);
      } else if (data && typeof data === 'object' && ArrayBuffer.isView(data)) {
        bytes = /** @type {Uint8Array} */ (data);
      }
      if (!bytes) {
        return { ok: false, reason: 'invalid_data' };
      }
      payload = { type: 'OFFSCREEN_ADD_FILE', name, dataB64: ArchiveService.bytesToBase64(bytes) };
    }
    const res = await ArchiveService.sendToOffscreen(payload);
    return res || { ok: false, reason: 'no_response' };
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
      bytes = /** @type {Uint8Array} */ (data);
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
