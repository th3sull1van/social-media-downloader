/**
 * Social Media Downloader — Download Artifact Model
 * Supports Direct URL downloads and Generated binary Blobs.
 */

/**
 * @typedef {"direct" | "generated"} ArtifactKind
 */

/**
 * @typedef {Object} DirectArtifact
 * @property {"direct"} kind
 * @property {{ url: string, headers?: Record<string, string> }} source
 * @property {{ filename: string, mimeType?: string }} output
 */

/**
 * @typedef {Object} GeneratedArtifact
 * @property {"generated"} kind
 * @property {Blob | ArrayBuffer | Uint8Array} data
 * @property {{ filename: string, mimeType?: string }} output
 */


/**
 * @typedef {DirectArtifact | GeneratedArtifact} DownloadArtifact
 */

export class DownloadArtifactModel {
  /**
   * Creates a direct URL download artifact.
   * @param {string} url
   * @param {string} filename
   * @param {Record<string, string>=} headers
   * @param {string=} mimeType
   * @returns {DirectArtifact}
   */
  static direct(url, filename, headers, mimeType) {
    if (!url) throw new TypeError('DirectArtifact requires a URL');
    return {
      kind: 'direct',
      source: {
        url,
        headers: headers ? { ...headers } : undefined
      },
      output: {
        filename,
        mimeType
      }
    };
  }

  /**
   * Creates a generated binary download artifact.
   * @param {Blob | ArrayBuffer | Uint8Array} data
   * @param {string} filename
   * @param {string=} mimeType
   * @returns {GeneratedArtifact}
   */
  static generated(data, filename, mimeType) {
    if (!data) throw new TypeError('GeneratedArtifact requires binary data');
    return {
      kind: 'generated',
      data,
      output: {
        filename,
        mimeType: mimeType || 'application/octet-stream'
      }
    };
  }

}
