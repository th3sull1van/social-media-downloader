/**
 * Social Media Downloader — Instagram Media Normalizer
 * Normalizes raw Instagram GraphQL/REST nodes into canonical MediaItems.
 */
import { MediaItemModel } from '../../core/domain/MediaItem.js';
import { MetaCdn } from '../meta-shared/MetaCdn.js';

export class InstagramNormalizer {
  /**
   * Sorts IG candidates: largest area (width * height) and width first; among equal sizes prefer the
   * UNCROPPED render (crop-spec inside `stp` like c0.108.864.864a_* means the
   * square/grid crop — in 2026-08-28 captures the same 864-width asset shipped
   * both a full and a square-crop render).
   * @param {Array<{url?: string, width?: number, height?: number}>} candidates
   * @returns {Array<{url?: string, width?: number, height?: number}>}
   */
  static sortCandidates(candidates) {
    if (!Array.isArray(candidates)) return [];
    const cropRank = (c) => (/[?&]stp=[^&]*c\d+\.\d+\.\d+\.\d+[a-z]?/i.test(String(c?.url || '')) ? 1 : 0);
    return [...candidates].sort((a, b) => {
      const areaA = (a.width || 0) * (a.height || 0);
      const areaB = (b.width || 0) * (b.height || 0);
      return (areaB - areaA) || ((b.width || 0) - (a.width || 0)) || (cropRank(a) - cropRank(b));
    });
  }

  /**
   * Normalizes an Instagram post / edge node into an array of MediaItems.
   * Handles single images, single videos/reels, and multi-slide carousels.
   * @param {any} node
   * @param {Object} [context]
   * @returns {import('../../core/domain/MediaItem.js').MediaItem[]}
   */
  static normalizePost(node, context = {}) {
    if (!node) return [];
    const results = [];

    const postId = String(node.id || node.pk || '');
    const postCode = node.code || postId;
    const caption = typeof node.caption === 'object' && node.caption !== null
      ? (node.caption.text || '')
      : (typeof node.caption === 'string' ? node.caption : '');
    const takenAt = node.taken_at || Math.floor(Date.now() / 1000);
    const mediaType = node.media_type || (node.video_versions && node.video_versions.length > 0 ? 2 : 1);

    // 1. Multi-item Carousel (media_type === 8 or carousel_media present)
    if (mediaType === 8 || (Array.isArray(node.carousel_media) && node.carousel_media.length > 0)) {
      const carItems = node.carousel_media || [];
      carItems.forEach((cItem, cIdx) => {
        const isVideo = cItem.media_type === 2 || (cItem.video_versions && cItem.video_versions.length > 0);
        let highResUrl = null;
        let thumbUrl = null;
        let width = 0;
        let height = 0;

        if (isVideo && cItem.video_versions && cItem.video_versions.length > 0) {
          const sortedVideos = [...cItem.video_versions].sort((a, b) => (b.width || 0) - (a.width || 0));
          highResUrl = sortedVideos[0].url;
          width = sortedVideos[0].width || 1080;
          height = sortedVideos[0].height || 1920;
        }

        if (cItem.image_versions2?.candidates?.length > 0) {
          const sortedImgs = InstagramNormalizer.sortCandidates(cItem.image_versions2.candidates);
          if (!highResUrl) {
            highResUrl = sortedImgs[0].url;
            width = sortedImgs[0].width || 1080;
            height = sortedImgs[0].height || 1080;
          }
          // Use medium/high res image for thumbnail (avoid low-res 150px)
          const midIdx = Math.min(1, sortedImgs.length - 1);
          thumbUrl = sortedImgs[midIdx]?.url || sortedImgs[0]?.url;
        }

        if (highResUrl) {
          const cleanUrl = MetaCdn.upgradeUrl(highResUrl);
          const cleanThumb = thumbUrl ? MetaCdn.upgradeUrl(thumbUrl) : cleanUrl;
          results.push(MediaItemModel.create({
            id: `${postId}_slide${cIdx + 1}`,
            platform: 'instagram',
            type: isVideo ? 'video' : 'image',
            sourceType: 'carousel_item',
            url: cleanUrl,
            downloadUrl: cleanUrl,
            thumbnailUrl: cleanThumb,
            width,
            height,
            title: caption ? caption.slice(0, 60) : undefined,
            caption,
            metadata: {
              shortcode: postCode,
              postId,
              mediaType: 8,
              slideIndex: cIdx + 1,
              slideTotal: carItems.length,
              takenAt,
              category: 'posts',
              isCarousel: true,
              isVideo
            }
          }));
        }
      });
      return results;
    }

    // 2. Single Video / Reel
    if (mediaType === 2 || (Array.isArray(node.video_versions) && node.video_versions.length > 0)) {
      const sortedVideos = [...(node.video_versions || [])].sort((a, b) => (b.width || 0) - (a.width || 0));
      const highResUrl = sortedVideos[0] ? sortedVideos[0].url : null;
      let thumbUrl = null;
      let width = sortedVideos[0]?.width || 1080;
      let height = sortedVideos[0]?.height || 1920;

      if (node.image_versions2?.candidates?.length > 0) {
        const sortedImgs = InstagramNormalizer.sortCandidates(node.image_versions2.candidates);
        // Use video cover frame candidate for clear preview image
        const midIdx = Math.min(1, sortedImgs.length - 1);
        thumbUrl = sortedImgs[midIdx]?.url || sortedImgs[0]?.url;
      } else if (node.display_url) {
        thumbUrl = node.display_url;
      }

      if (highResUrl) {
        const cleanUrl = MetaCdn.upgradeUrl(highResUrl);
        const cleanThumb = thumbUrl ? MetaCdn.upgradeUrl(thumbUrl) : (node.display_url || cleanUrl);
        results.push(MediaItemModel.create({
          id: postId,
          platform: 'instagram',
          type: 'video',
          sourceType: 'video_post',
          url: cleanUrl,
          downloadUrl: cleanUrl,
          thumbnailUrl: cleanThumb,
          width,
          height,
          title: caption ? caption.slice(0, 60) : undefined,
          caption,
          metadata: {
            shortcode: postCode,
            postId,
            mediaType: 2,
            takenAt,
            category: 'posts',
            isVideo: true
          }
        }));
      }
      return results;
    }

    // 3. Single Photo
    if (node.image_versions2?.candidates?.length > 0) {
      const sortedImgs = InstagramNormalizer.sortCandidates(node.image_versions2.candidates);
      const highResUrl = sortedImgs[0].url;
      const midIdx = Math.min(1, sortedImgs.length - 1);
      const thumbUrl = sortedImgs[midIdx]?.url || highResUrl;
      const width = sortedImgs[0].width || 1080;
      const height = sortedImgs[0].height || 1080;
      const cleanUrl = MetaCdn.upgradeUrl(highResUrl);
      const cleanThumb = MetaCdn.upgradeUrl(thumbUrl);

      results.push(MediaItemModel.create({
        id: postId,
        platform: 'instagram',
        type: 'image',
        sourceType: 'photo_post',
        url: cleanUrl,
        downloadUrl: cleanUrl,
        thumbnailUrl: cleanThumb,
        width,
        height,
        title: caption ? caption.slice(0, 60) : undefined,
        caption,
        metadata: {
          shortcode: postCode,
          postId,
          mediaType: 1,
          takenAt,
          category: 'posts',
          isVideo: false
        }
      }));
      return results;
    }

    return results;
  }

  /**
   * Normalizes an Instagram Story or Highlight item.
   * @param {any} item
   * @param {"stories" | "highlights"} [category="stories"]
   * @param {string} [highlightTitle]
   * @returns {import('../../core/domain/MediaItem.js').MediaItem | null}
   */
  static normalizeStory(item, category = 'stories', highlightTitle = null) {
    if (!item) return null;
    const isVideo = item.media_type === 2 || (Array.isArray(item.video_versions) && item.video_versions.length > 0);
    let highResUrl = null;
    let thumbUrl = null;
    let width = 0;
    let height = 0;

    if (isVideo && item.video_versions?.length > 0) {
      const sortedVideos = [...item.video_versions].sort((a, b) => (b.width || 0) - (a.width || 0));
      highResUrl = sortedVideos[0].url;
      width = sortedVideos[0].width || 1080;
      height = sortedVideos[0].height || 1920;
    }

    if (item.image_versions2?.candidates?.length > 0) {
      const sortedImgs = InstagramNormalizer.sortCandidates(item.image_versions2.candidates);
      if (!highResUrl) {
        highResUrl = sortedImgs[0].url;
        width = sortedImgs[0].width || 1080;
        height = sortedImgs[0].height || 1920;
      }
      const midIdx = Math.min(1, sortedImgs.length - 1);
      thumbUrl = sortedImgs[midIdx]?.url || sortedImgs[0]?.url;
    }

    if (!highResUrl) return null;
    const cleanUrl = MetaCdn.upgradeUrl(highResUrl);
    const cleanThumb = thumbUrl ? MetaCdn.upgradeUrl(thumbUrl) : cleanUrl;

    return MediaItemModel.create({
      id: String(item.id || item.pk),
      platform: 'instagram',
      type: isVideo ? 'video' : 'image',
      sourceType: category === 'highlights' ? 'highlight_item' : 'story_item',
      url: cleanUrl,
      downloadUrl: cleanUrl,
      thumbnailUrl: cleanThumb,
      width,
      height,
      metadata: {
        takenAt: item.taken_at || Math.floor(Date.now() / 1000),
        category,
        highlightTitle,
        albumTitle: highlightTitle,
        isVideo
      }
    });
  }

  /**
   * Normalizes an HD avatar / profile picture.
   * @param {string} username
   * @param {string} hdUrl
   * @param {string} [thumbUrl]
   * @returns {import('../../core/domain/MediaItem.js').MediaItem}
   */
  static normalizeAvatar(username, hdUrl, thumbUrl) {
    const cleanUrl = MetaCdn.upgradeUrl(hdUrl);
    return MediaItemModel.create({
      id: `profile_pic_${username}`,
      platform: 'instagram',
      type: 'image',
      sourceType: 'profile_pic',
      url: cleanUrl,
      downloadUrl: cleanUrl,
      thumbnailUrl: thumbUrl || cleanUrl,
      width: 1080,
      height: 1080,
      metadata: {
        username,
        category: 'profile_pic',
        isVideo: false
      }
    });
  }
}
