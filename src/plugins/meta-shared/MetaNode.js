/**
 * Social Media Downloader — Meta Shared Node Classifiers
 * Helpers used by both the Facebook plugin (service worker) and the content
 * script's GraphQL walker, so a Reel/Video node can never be emitted as a photo
 * MediaItem from one path while the other filters it out.
 *
 * Keep this module tiny and dependency-free so it is safe to import from
 * `src/content/content.js` (which is also the content-script bundle's runtime).
 */

export class MetaNode {
  /**
   * True when the node is a video/Reel rather than a static photo.
   *
   * Recognises:
   *   - `__typename === 'Video'`           (Reel, post video, ad video, ...)
   *   - `__typename === 'ReelsTrayItem'`   (Reel carousel tray)
   *   - presence of `playable_url` / `playable_url_dash` (older schema)
   *   - presence of `video_versions[]`    (Instagram shape; harmless on FB)
   *
   * Always returns `false` for non-objects so callers can pipe arbitrary
   * JSON safely.
   *
   * @param {any} node
   * @returns {boolean}
   */
  static isVideoNode(node) {
    if (!node || typeof node !== 'object') return false;
    if (node.__typename === 'Video') return true;
    if (node.__typename === 'ReelsTrayItem') return true;
    if (node.playable_url) return true;
    if (node.playable_url_dash) return true;
    if (Array.isArray(node.video_versions) && node.video_versions.length > 0) return true;
    return false;
  }

  /**
   * True when the node is a Facebook `TimelineAppCollectionItem` (an album
   * cover tile that carries `image.uri` + a page URL but is NOT a photo to
   * download — grabbing its URL would save the page HTML as `.jpg`).
   *
   * @param {any} node
   * @returns {boolean}
   */
  static isCollectionTile(node) {
    if (!node || typeof node !== 'object') return false;
    if (node.__typename === 'TimelineAppCollectionItem') return true;
    return 'collection_item_type' in node;
  }

  /**
   * Convenience: should the walker refuse to emit this node as a photo?
   * Combines the two checks above.
   *
   * @param {any} node
   * @returns {boolean}
   */
  static shouldSkipAsPhoto(node) {
    return MetaNode.isVideoNode(node) || MetaNode.isCollectionTile(node);
  }
}
