/**
 * Social Media Downloader — Canonical MediaItem Domain Model
 * Platform-agnostic media representation bridging platform discovery and Core services.
 */

/**
 * @typedef {"image" | "video" | "audio" | "file"} MediaType
 */

/**
 * @typedef {Object} AuthorInfo
 * @property {string=} id
 * @property {string=} username
 * @property {string=} name
 * @property {string=} url
 * @property {string=} avatarUrl
 */

/**
 * @typedef {Object} CollectionInfo
 * @property {string=} id
 * @property {string=} name
 * @property {string=} type
 * @property {string=} url
 */

/**
 * @typedef {Object} MediaCapabilities
 * @property {boolean=} directDownload
 * @property {boolean=} requiresMuxing
 * @property {boolean=} requiresAuth
 * @property {boolean=} supportsThumbnail
 */

/**
 * @typedef {Object} MediaItem
 * @property {string} id
 * @property {string} platform
 * @property {MediaType} type
 * @property {string} sourceType
 * @property {string=} url
 * @property {string=} downloadUrl
 * @property {string=} thumbnailUrl
 * @property {string=} filename
 * @property {string=} extension
 * @property {string=} mimeType
 * @property {number=} width
 * @property {number=} height
 * @property {number=} duration
 * @property {string=} title
 * @property {string=} caption
 * @property {AuthorInfo=} author
 * @property {CollectionInfo=} collection
 * @property {Object=} location
 * @property {Record<string, unknown>} metadata
 * @property {MediaCapabilities} capabilities
 */

export class MediaItemModel {
  /**
   * Creates and validates a canonical MediaItem.
   * @param {Partial<MediaItem> & { id: string, platform: string, type: MediaType, sourceType: string }} data
   * @returns {MediaItem}
   */
  static create(data) {
    if (!data || typeof data !== 'object') {
      throw new TypeError('MediaItem data must be an object');
    }
    if (!data.id || typeof data.id !== 'string') {
      throw new TypeError('MediaItem requires a non-empty string id');
    }
    if (!data.platform || typeof data.platform !== 'string') {
      throw new TypeError('MediaItem requires a non-empty string platform');
    }
    if (!data.type || !['image', 'video', 'audio', 'file'].includes(data.type)) {
      throw new TypeError(`Invalid MediaItem type: ${data.type}`);
    }
    if (!data.sourceType || typeof data.sourceType !== 'string') {
      throw new TypeError('MediaItem requires a non-empty string sourceType');
    }

    const ext = data.extension || (data.type === 'video' ? 'mp4' : (data.type === 'audio' ? 'mp3' : 'jpg'));

    return {
      id: String(data.id),
      platform: String(data.platform).toLowerCase(),
      type: data.type,
      sourceType: String(data.sourceType),
      url: data.url || data.downloadUrl || '',
      downloadUrl: data.downloadUrl || data.url || '',
      thumbnailUrl: data.thumbnailUrl || data.url || '',
      filename: data.filename || '',
      extension: ext.toLowerCase().replace(/^\./, ''),
      mimeType: data.mimeType || (data.type === 'video' ? 'video/mp4' : (data.type === 'audio' ? 'audio/mpeg' : 'image/jpeg')),
      width: typeof data.width === 'number' ? data.width : undefined,
      height: typeof data.height === 'number' ? data.height : undefined,
      duration: typeof data.duration === 'number' ? data.duration : undefined,
      title: data.title ? String(data.title) : undefined,
      caption: data.caption ? String(data.caption) : undefined,
      author: data.author && typeof data.author === 'object' ? { ...data.author } : undefined,
      collection: data.collection && typeof data.collection === 'object' ? { ...data.collection } : undefined,
      location: data.location && typeof data.location === 'object' ? { ...data.location } : undefined,
      metadata: data.metadata && typeof data.metadata === 'object' ? { ...data.metadata } : {},
      capabilities: {
        directDownload: data.capabilities?.directDownload ?? true,
        requiresMuxing: data.capabilities?.requiresMuxing ?? false,
        requiresAuth: data.capabilities?.requiresAuth ?? false,
        supportsThumbnail: data.capabilities?.supportsThumbnail ?? true,
        ...data.capabilities
      }
    };
  }

  /**
   * Validates whether an object is a valid MediaItem.
   * @param {unknown} item
   * @returns {boolean}
   */
  static isValid(item) {
    if (!item || typeof item !== 'object') return false;
    const m = /** @type {MediaItem} */ (item);
    return (
      typeof m.id === 'string' &&
      m.id.length > 0 &&
      typeof m.platform === 'string' &&
      ['image', 'video', 'audio', 'file'].includes(m.type) &&
      typeof m.sourceType === 'string' &&
      typeof m.metadata === 'object' &&
      typeof m.capabilities === 'object'
    );
  }
}
