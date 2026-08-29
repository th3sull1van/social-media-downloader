/**
 * Social Media Downloader — Platform Capabilities System
 * Declares supported scan modes, media types, resolution, download models, and runtime contexts.
 */

/**
 * @typedef {Object} PlatformCapabilities
 * @property {{ page?: boolean, post?: boolean, profile?: boolean, album?: boolean, collection?: boolean, subreddit?: boolean, stories?: boolean, highlights?: boolean, pagination?: boolean }} scan
 * @property {{ image?: boolean, gallery?: boolean, video?: boolean, audio?: boolean, avatar?: boolean }} media
 * @property {{ direct?: boolean, custom?: boolean, background?: boolean }} resolution
 * @property {{ direct?: boolean, streamed?: boolean, generated?: boolean, chunked?: boolean }} download
 * @property {{ muxing?: boolean, transcoding?: boolean, deduplication?: boolean }} processing
 * @property {{ mainWorld?: boolean, offscreen?: boolean, contentScript?: boolean }} runtime
 */

export class CapabilitiesModel {
  /**
   * Default template for empty capabilities.
   * @returns {PlatformCapabilities}
   */
  static defaultCapabilities() {
    return {
      scan: {
        page: false,
        post: false,
        profile: false,
        album: false,
        collection: false,
        subreddit: false,
        stories: false,
        highlights: false,
        pagination: false
      },
      media: {
        image: true,
        gallery: false,
        video: false,
        audio: false,
        avatar: false
      },
      resolution: {
        direct: true,
        custom: false,
        background: false
      },
      download: {
        direct: true,
        streamed: false,
        generated: false,
        chunked: false
      },
      processing: {
        muxing: false,
        transcoding: false,
        deduplication: false
      },
      runtime: {
        mainWorld: false,
        offscreen: false,
        contentScript: true
      }
    };
  }

  /**
   * Validates and merges partial capabilities with defaults.
   * @param {Partial<PlatformCapabilities>} custom
   * @returns {PlatformCapabilities}
   */
  static merge(custom = {}) {
    const defaults = CapabilitiesModel.defaultCapabilities();
    return {
      scan: { ...defaults.scan, ...(custom.scan || {}) },
      media: { ...defaults.media, ...(custom.media || {}) },
      resolution: { ...defaults.resolution, ...(custom.resolution || {}) },
      download: { ...defaults.download, ...(custom.download || {}) },
      processing: { ...defaults.processing, ...(custom.processing || {}) },
      runtime: { ...defaults.runtime, ...(custom.runtime || {}) }
    };
  }
}
