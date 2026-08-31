/**
 * Social Media Downloader — Reddit Plugin Message Types
 * Platform-specific message types are owned by the Reddit plugin so that the
 * generic Core messaging layer and the service worker do not need to know about
 * Reddit internals (SPEC §54, AGENTS §27).
 */
export const RedditMessages = {
  REDDIT_SCAN: 'REDDIT_SCAN',
  REDDIT_FETCH_AVATAR: 'REDDIT_FETCH_AVATAR',
  RESOLVE_REDGIFS: 'RESOLVE_REDGIFS',
  TRIGGER_SCAN_REDGIFS: 'TRIGGER_SCAN_REDGIFS'
};
