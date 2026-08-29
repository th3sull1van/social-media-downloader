/**
 * Social Media Downloader — Instagram Plugin
 * Implements PlatformPlugin contract for Instagram.
 */
import { InstagramDetector } from './InstagramDetector.js';
import { InstagramNormalizer } from './InstagramNormalizer.js';
import { InstagramNaming } from './InstagramNaming.js';
import { CapabilitiesModel } from '../../core/domain/Capabilities.js';
import { ScanResultModel } from '../../core/domain/ScanResult.js';

export class InstagramPlugin {
  static id = 'instagram';
  static version = '1.0.0';

  /**
   * Matches whether context belongs to Instagram.
   */
  static matches(context) {
    return InstagramDetector.matches(context);
  }

  /**
   * Returns capabilities declared by Instagram.
   */
  static getCapabilities() {
    return CapabilitiesModel.merge({
      scan: {
        page: true,
        post: true,
        profile: true,
        stories: true,
        highlights: true,
        pagination: true
      },
      media: {
        image: true,
        gallery: true,
        video: true,
        avatar: true
      },
      resolution: {
        direct: true,
        custom: true
      },
      download: {
        direct: true
      },
      runtime: {
        mainWorld: true,
        contentScript: true
      }
    });
  }

  /**
   * Detects the platform target from current URL and document.
   */
  static detectTarget(context) {
    return InstagramDetector.detectTarget(context);
  }

  /**
   * Normalizes raw nodes into canonical MediaItems.
   */
  static normalize(rawNode, context) {
    return InstagramNormalizer.normalizePost(rawNode, context);
  }

  /**
   * Generates local destination filename.
   */
  static getFilename(item, context = {}) {
    const username = context.targetName || item.metadata?.username || 'Instagram_Profile';
    return InstagramNaming.resolveRelativePath(item, username, true);
  }

  /**
   * Generates archive relative path.
   */
  static getArchivePath(item, context = {}) {
    const username = context.targetName || item.metadata?.username || 'Instagram_Profile';
    return InstagramNaming.resolveRelativePath(item, username, false);
  }

  /**
   * Returns available filter definitions for Instagram.
   */
  static getFilters() {
    return [
      { id: 'all', labelKey: 'tabAll' },
      { id: 'image', labelKey: 'tabPhotos' },
      { id: 'video', labelKey: 'tabVideos' },
      { id: 'stories', labelKey: 'tabStories' },
      { id: 'highlights', labelKey: 'tabHighlights' }
    ];
  }

  // Contract note: getPlatformInfo / initialize / destroy / validateEnvironment /
  // selfTest / getPageContext are intentionally NOT implemented — the plugin is
  // stateless and nothing consumes them (SPEC §27 allows capability-scoped
  // implementations; AGENTS §32 "where practical").
}
