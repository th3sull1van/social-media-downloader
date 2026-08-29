/**
 * Social Media Downloader — Reddit Naming Context
 */
import { FilenameService } from '../../core/services/FilenameService.js';
import { RedditNormalizer } from './RedditNormalizer.js';

export class RedditNaming {
  /**
   * Resolves original media filename.
   * @param {import('../../core/domain/MediaItem.js').MediaItem} item
   * @returns {string}
   */
  static getOriginalFilename(item) {
    const mediaId = /** @type {any} */ (item.metadata)?.mediaId || RedditNormalizer.extractMediaIdentifier(item);
    const ext = item.extension || (item.type === 'video' ? 'mp4' : 'jpg');
    return `${FilenameService.sanitize(mediaId, 60, 'media')}.${ext}`;
  }

  /**
   * Resolves relative path for a Reddit item within a local directory or ZIP archive.
   * @param {import('../../core/domain/MediaItem.js').MediaItem} item
   * @param {string} [pattern="r_{subreddit}_u_{author}_{id}_{orig_name}.{ext}"]
   * @param {boolean} [includeRoot=true]
   * @returns {string}
   */
  static resolveRelativePath(item, pattern = 'r_{subreddit}_u_{author}_{id}_{orig_name}.{ext}', includeRoot = true) {
    const sub = /** @type {any} */ (item.metadata)?.subreddit || item.collection?.id || 'reddit';
    const author = /** @type {any} */ (item.metadata)?.author || item.author?.username || 'user';
    const id = /** @type {any} */ (item.metadata)?.postId || item.id || 'post';
    const ext = item.extension || (item.type === 'video' ? 'mp4' : 'jpg');
    const origName = /** @type {any} */ (item.metadata)?.mediaId || RedditNormalizer.extractMediaIdentifier(item);
    const title = item.title || 'media';

    const safeSub = FilenameService.sanitize(sub, 40, 'reddit');
    const safeAuthor = FilenameService.sanitize(author, 40, 'user');
    const relDir = includeRoot ? `SMD/Reddit/r_${safeSub}/u_${safeAuthor}` : `r_${safeSub}/u_${safeAuthor}`;

    const context = {
      subreddit: safeSub,
      author: safeAuthor,
      id: FilenameService.sanitize(id, 40, 'id'),
      title: FilenameService.sanitize(title, 50, 'title'),
      orig_name: FilenameService.sanitize(origName, 40, 'orig'),
      ext
    };

    return FilenameService.render(pattern, context, relDir);
  }
}
