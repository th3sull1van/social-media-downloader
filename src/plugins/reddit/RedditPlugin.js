/**
 * Social Media Downloader — Reddit Plugin
 * Implements PlatformPlugin contract for Reddit.
 */
import { RedditDetector } from './RedditDetector.js';
import { RedditNormalizer } from './RedditNormalizer.js';
import { RedditNaming } from './RedditNaming.js';
import { RedditScanner } from './RedditScanner.js';
import { RedditVideoMuxer } from './RedditVideoMuxer.js';
import { RedGifsResolver } from './RedGifsResolver.js';
import { RedditMessages } from './RedditMessages.js';
import { CapabilitiesModel } from '../../core/domain/Capabilities.js';
import { DownloadArtifactModel } from '../../core/domain/DownloadArtifact.js';

export class RedditPlugin {
  static id = 'reddit';
  static version = '1.1.0';

  static matches(context) {
    return RedditDetector.matches(context);
  }

  static getCapabilities() {
    return CapabilitiesModel.merge({
      scan: {
        page: true,
        post: true,
        profile: true,
        subreddit: true,
        pagination: true
      },
      media: {
        image: true,
        gallery: true,
        video: true,
        audio: true
      },
      resolution: {
        direct: true,
        custom: true,
        background: true
      },
      download: {
        direct: true,
        generated: true,
        chunked: true
      },
      processing: {
        muxing: true,
        deduplication: true
      },
      runtime: {
        contentScript: true
      }
    });
  }

  static detectTarget(context) {
    return RedditDetector.detectTarget(context);
  }

  static normalize(rawNode, context) {
    return RedditNormalizer.normalizeItem(rawNode, context);
  }

  static async resolveMedia(item, context = {}) {
    if (item.metadata?.baseUrl) {
      const streams = await RedditVideoMuxer.resolveStreams(item.metadata.baseUrl, item.metadata.fallbackUrl);
      const muxedBlob = await RedditVideoMuxer.downloadMuxedVideo(streams.videoUrl, streams.audioUrl);
      const filename = RedditNaming.resolveRelativePath(item, undefined, true);
      return DownloadArtifactModel.generated(muxedBlob, filename, 'video/mp4');
    }

    if (item.metadata?.isRedGifs || item.sourceType === 'redgifs') {
      const rgData = await RedGifsResolver.resolve(item.url);
      const filename = RedditNaming.resolveRelativePath(item, undefined, true);
      return DownloadArtifactModel.direct(rgData.url, filename);
    }

    const filename = RedditNaming.resolveRelativePath(item, undefined, true);
    return DownloadArtifactModel.direct(item.downloadUrl || item.url, filename);
  }

  static getFilename(item, context = {}) {
    return RedditNaming.resolveRelativePath(item, context.pattern, true);
  }

  static getArchivePath(item, context = {}) {
    return RedditNaming.resolveRelativePath(item, context.pattern, false);
  }

  static getFilters() {
    return [
      { id: 'all', labelKey: 'tabAll' },
      { id: 'image', labelKey: 'tabPhotos' },
      { id: 'gallery', labelKey: 'tabGalleries' },
      { id: 'video', labelKey: 'tabVideos' },
      { id: 'redgifs', labelKey: 'tabRedgifs' }
    ];
  }

  // Contract note: getPlatformInfo / initialize / destroy / validateEnvironment /
  // selfTest / getPageContext are intentionally NOT implemented — the plugin is
  // stateless and nothing consumes them (SPEC §27 allows capability-scoped
  // implementations; AGENTS §32 "where practical").

  /**
   * Handles Reddit-specific message types so the service worker can delegate
   * platform work to the owning plugin instead of routing on it (SPEC §54,
   * AGENTS §27 / §22). Returns `{ handled: true, response }` when the type is a
   * Reddit message, otherwise `undefined` so the registry can try other plugins.
   * @param {string} type
   * @param {any} message
   * @returns {Promise<{ handled: boolean, response: any } | undefined>}
   */
  static async handleMessage(type, message = {}) {
    if (type === RedditMessages.REDDIT_FETCH_AVATAR) {
      const { kind, id } = message?.payload || message || {};
      if (!id || !['user', 'subreddit'].includes(kind)) {
        return { handled: true, response: { success: false, error: 'Unsupported Reddit avatar target' } };
      }
      try {
        const avatarUrl = await RedditScanner.fetchTargetAvatar(kind, id);
        return { handled: true, response: { success: true, avatarUrl } };
      } catch (err) {
        return { handled: true, response: { success: false, error: err.message } };
      }
    }

    if (type === RedditMessages.REDDIT_SCAN) {
      const { kind, id } = message?.payload || message || {};
      try {
        if (!id || !['post', 'user', 'subreddit'].includes(kind)) {
          throw new Error('Unsupported Reddit scan target');
        }
        /** @type {{ items: import('../../core/domain/MediaItem.js').MediaItem[], totalPosts?: number, status?: string, errorCode?: string }} */
        let result;
        if (kind === 'post') {
          result = await RedditScanner.fetchPostById(id);
        } else if (kind === 'user') {
          const r = await RedditScanner.fetchUserSubmissions(id, { limit: 200 });
          result = { items: r.mediaItems, totalPosts: r.totalPosts, status: r.status, errorCode: r.errorCode };
        } else {
          result = await RedditScanner.fetchSubredditPosts(id, { limit: 300 });
        }
        let avatarUrl = '';
        if (kind === 'user' || kind === 'subreddit') {
          try {
            avatarUrl = await RedditScanner.fetchTargetAvatar(kind, id);
          } catch {
            // Avatar lookup is auxiliary: a profile can still be scanned when
            // its about endpoint is unavailable or rate-limited.
          }
        }
        const status = result?.status || ((result?.items || []).length > 0 ? 'success' : 'empty');
        const success = status !== 'network_failure';
        return {
          handled: true,
          response: {
            success,
            status,
            items: (result && result.items) || [],
            ...(avatarUrl ? { avatarUrl } : {}),
            ...(result?.errorCode ? { errorCode: result.errorCode } : {}),
            ...(success ? {} : { error: 'Reddit API request failed' })
          }
        };
      } catch (err) {
        return { handled: true, response: { success: false, error: err.message } };
      }
    }

    if (type === RedditMessages.RESOLVE_REDGIFS) {
      try {
        const data = await RedGifsResolver.resolve(message.url);
        return { handled: true, response: { success: true, data } };
      } catch (err) {
        return { handled: true, response: { success: false, error: err.message } };
      }
    }

    return undefined;
  }
}
