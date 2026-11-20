/**
 * Social Media Downloader — Facebook Plugin
 * Implements PlatformPlugin contract for Facebook.
 */
import { FacebookDetector } from './FacebookDetector.js';
import { FacebookNormalizer } from './FacebookNormalizer.js';
import { FacebookNaming } from './FacebookNaming.js';
import { CapabilitiesModel } from '../../core/domain/Capabilities.js';

export class FacebookPlugin {
  static id = 'facebook';
  static displayName = 'Facebook';
  static themeClass = 'fb-theme';
  static version = '1.2.2';
  static mainWorldScript = 'src/plugins/facebook/main-world/injected.js';
  static mediaHostSuffixes = ['fbcdn.net', 'facebook.com'];

  static matches(context) {
    return FacebookDetector.matches(context);
  }

  static getCapabilities() {
    return CapabilitiesModel.merge({
      scan: {
        page: true,
        profile: true,
        album: true,
        collection: true,
        pagination: true
      },
      media: {
        image: true,
        gallery: true,
        video: false
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

  static detectTarget(context) {
    return FacebookDetector.detectTarget(context);
  }

  static normalize(rawNode, context) {
    return FacebookNormalizer.normalizePhoto(rawNode);
  }

  static getFilename(item, context = {}) {
    const targetName = context.targetName || 'Facebook_Media';
    return FacebookNaming.resolveRelativePath(item, targetName, true);
  }

  static getArchivePath(item, context = {}) {
    const targetName = context.targetName || 'Facebook_Media';
    return FacebookNaming.resolveRelativePath(item, targetName, false);
  }

  static getFilters() {
    return [
      { id: 'all', labelKey: 'tabAll' },
      { id: 'image', labelKey: 'tabPhotos' }
    ];
  }

  // Contract note: getPlatformInfo / initialize / destroy / validateEnvironment /
  // selfTest / getPageContext are intentionally NOT implemented — the plugin is
  // stateless and nothing consumes them (SPEC §27 allows capability-scoped
  // implementations; AGENTS §32 "where practical").
}
