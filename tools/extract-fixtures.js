#!/usr/bin/env bun
/**
 * Generates small, deterministic, sanitized replay fixtures from local HARs.
 *
 * Raw captures are read only from fixtures-private/ and are never copied to
 * the output.  The generator projects an allowlisted subset of each platform's
 * observed shape, replaces identifiers/URLs deterministically, validates the
 * result, and writes only compact JSON/HTML fixtures under
 * tests/fixtures/extracted/.
 *
 * Usage:
 *   bun tools/extract-fixtures.js
 *   bun tools/extract-fixtures.js --source=fixtures-private/facebook-profile.har
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  decodeEntryBody,
  extractFacebookData,
  extractRedditPosts,
  extractStoryItems,
  extractTimelineNodes
} from './har-replay.js';
import { FacebookNormalizer } from '../src/plugins/facebook/FacebookNormalizer.js';
import { MetaCdn } from '../src/plugins/meta-shared/MetaCdn.js';
import { validateCompactFixture } from './validation/fixture-validation.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = path.join(rootDir, 'tests', 'fixtures', 'extracted');
const CAPTURE_DATE = '2026-08-31';
const SAFE_CAPTURE_IDS = new Set([
  'example-profile',
  'example-feed',
  'instagram-profile',
  'instagram-profile-v2',
  'reddit-feed',
  'reddit-post',
  'reddit-gallery',
  'reddit-empty-profile',
  'reddit-private-profile',
  'facebook-profile',
  'facebook-reels',
  'facebook-206x206'
]);

function captureIdFor(harPath, platform) {
  const candidate = path.basename(harPath, path.extname(harPath)).toLowerCase();
  return SAFE_CAPTURE_IDS.has(candidate) ? candidate : `${platform}-capture`;
}

function createAnonymizer() {
  const maps = new Map();
  const counters = new Map();
  return {
    value(kind, original, prefix = kind) {
      const raw = String(original ?? '');
      const key = `${kind}\u0000${raw}`;
      if (!maps.has(key)) {
        const next = (counters.get(prefix) || 0) + 1;
        counters.set(prefix, next);
        maps.set(key, `${prefix}_${String(next).padStart(3, '0')}`);
      }
      return maps.get(key);
    },
    number(kind, original, base = 1000000000000000) {
      const raw = String(original ?? '');
      const key = `${kind}\u0000${raw}`;
      if (!maps.has(key)) {
        const next = (counters.get(kind) || 0) + 1;
        counters.set(kind, next);
        maps.set(key, String(base + next));
      }
      return maps.get(key);
    }
  };
}

function safeExtension(value, fallback = 'bin') {
  const match = String(value || '').match(/\.([a-z0-9]{2,5})(?:$|[?#])/i);
  return match ? match[1].toLowerCase() : fallback;
}

function renderSize(value) {
  const match = String(value || '').match(/^((?:mx|x|s|p)?)(\d+)x(\d+)$/i);
  return match ? `${match[1].toLowerCase()}${match[2]}x${match[3]}` : null;
}

function renderStp(value) {
  const raw = String(value || '');
  const format = /dst-(?:jpg|webp|png)/i.exec(raw)?.[0]?.toLowerCase() || 'dst-jpg';
  const crop = /c\d+(?:\.\d+){3}[a-z]?/i.exec(raw)?.[0]?.toLowerCase();
  const size = /[sp]\d+x\d+/i.exec(raw)?.[0]?.toLowerCase();
  return [format, crop, size].filter(Boolean).join('_');
}

function escapeAttr(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeText(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function sanitizeUrl(rawUrl, platform, anonymizer, kind = 'media') {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  const decoded = rawUrl.replace(/&amp;/g, '&');
  let parsed;
  try {
    parsed = new URL(decoded);
  } catch {
    return '';
  }

  const originalHost = parsed.hostname.toLowerCase();
  const ext = safeExtension(parsed.pathname, platform === 'reddit' ? 'jpg' : 'jpg');
  const assetKey = anonymizer.value('asset', `${platform}:${parsed.pathname}`, 'asset');
  const output = new URL('https://fixture.invalid/');
  output.protocol = 'https:';

  if (platform === 'instagram') {
    output.hostname = 'cdninstagram.com';
    output.pathname = `/fixture/${assetKey}.${ext}`;
  } else if (platform === 'facebook') {
    output.hostname = 'scontent.example.fbcdn.net';
    output.pathname = `/fixture/${assetKey}.${ext}`;
  } else {
    if (originalHost.includes('redgifs.com')) {
      output.hostname = 'www.redgifs.com';
      output.pathname = `/watch/${anonymizer.value('redgifs', parsed.pathname, 'gif')}`;
    } else if (originalHost === 'v.redd.it') {
      output.hostname = 'v.redd.it';
      const parts = parsed.pathname.split('/').filter(Boolean);
      const videoId = anonymizer.value('reddit-video', parts[0] || parsed.pathname, 'video');
      output.pathname = `/${videoId}/${parts.slice(1).join('/') || 'DASH_1080.mp4'}`;
    } else if (originalHost.includes('reddit') || originalHost.includes('redd.it')) {
      output.hostname = originalHost.includes('preview') ? 'preview.redd.it' : 'i.redd.it';
      // Reddit's preview upgrader accepts only an alphanumeric media basename
      // in its captured URL matcher.  Keep the identifier synthetic but
      // remove the separator used by the generic anonymizer.
      const redditAssetKey = assetKey.replace(/[^a-z0-9]/gi, '') || 'asset000';
      output.pathname = `/fixture/${redditAssetKey}.${ext}`;
    } else if (originalHost.includes('imgur.com')) {
      output.hostname = 'i.imgur.com';
      output.pathname = `/fixture/${assetKey}.${ext}`;
    } else if (originalHost.includes('redditstatic.com')) {
      output.hostname = 'www.redditstatic.com';
      output.pathname = '/avatars/defaults/v2/avatar_default_3.png';
    } else {
      output.hostname = 'fixture.invalid';
      output.pathname = `/fixture/${assetKey}.${ext}`;
    }
  }

  const allowQuery = new Set(['stp', 'cstp', 'ctp', 'oh', 'oe', '_nc_ohc', '_nc_sid', '_nc_cat', 'width', 'height', 'format', 'auto', 'crop']);
  for (const [key, value] of parsed.searchParams.entries()) {
    if (!allowQuery.has(key)) continue;
    if (key === 'cstp' || key === 'ctp') {
      const size = renderSize(value);
      if (size) output.searchParams.set(key, size);
      continue;
    }
    if (key === 'stp') {
      const stp = renderStp(value);
      if (stp) output.searchParams.set(key, stp);
      continue;
    }
    if (key === 'oh' || key === 'oe' || key === '_nc_ohc' || key === '_nc_sid') {
      output.searchParams.set(key, `synthetic-${key.replace(/^_nc_/, '')}`);
      continue;
    }
    if (key === '_nc_cat') {
      output.searchParams.set(key, '1');
      continue;
    }
    if (['width', 'height'].includes(key) && /^\d+$/.test(value)) {
      output.searchParams.set(key, value);
      continue;
    }
    if (['format', 'auto', 'crop'].includes(key)) {
      output.searchParams.set(key, /^[a-z0-9:_-]+$/i.test(value) ? value : `synthetic-${key}`);
    }
  }
  void kind;
  return output.toString();
}

function sanitizeFacebookLink(raw, anonymizer) {
  let parsed;
  try { parsed = new URL(String(raw || '')); } catch { return '/photo/fixture_photo_001/'; }
  const fbid = parsed.searchParams.get('fbid') || parsed.pathname.split('/').filter(Boolean).pop() || 'photo';
  return `https://www.facebook.example/photo/${anonymizer.value('fb-link', fbid, 'photo')}/`;
}

function sanitizeRedditLink(raw, anonymizer) {
  let parsed;
  try { parsed = new URL(String(raw || '')); } catch { return '/comments/fixture_post_001/fixture-post/'; }
  const host = parsed.hostname.toLowerCase();
  if (host.includes('redgifs.com')) return `https://www.redgifs.com/watch/${anonymizer.value('redgifs-link', parsed.pathname, 'gif')}`;
  if (host === 'v.redd.it') {
    const id = parsed.pathname.split('/').filter(Boolean)[0] || 'video';
    return sanitizeUrl(raw, 'reddit', anonymizer, 'video');
  }
  if (host.includes('redd.it') || host.includes('reddit.com')) {
    return `/comments/${anonymizer.value('reddit-link', parsed.pathname, 'post')}/fixture-post/`;
  }
  return `/comments/${anonymizer.value('reddit-link', parsed.pathname, 'post')}/fixture-post/`;
}

function projectImageCandidate(candidate, platform, anonymizer) {
  if (!candidate?.url) return null;
  const url = sanitizeUrl(candidate.url, platform, anonymizer);
  if (!url) return null;
  return {
    url,
    ...(Number.isFinite(Number(candidate.width)) ? { width: Number(candidate.width) } : {}),
    ...(Number.isFinite(Number(candidate.height)) ? { height: Number(candidate.height) } : {})
  };
}

function projectInstagramPart(part, anonymizer, index) {
  const result = {
    id: part?.id ? anonymizer.value('ig-media', part.id, 'media') : `media_${String(index + 1).padStart(3, '0')}`,
    media_type: part?.media_type === 2 ? 2 : 1
  };
  const imageCandidates = (part?.image_versions2?.candidates || [])
    .map((candidate) => projectImageCandidate(candidate, 'instagram', anonymizer))
    .filter(Boolean);
  const videoCandidates = (part?.video_versions || [])
    .map((candidate) => projectImageCandidate(candidate, 'instagram', anonymizer))
    .filter(Boolean);
  if (imageCandidates.length) result.image_versions2 = { candidates: imageCandidates };
  if (videoCandidates.length) result.video_versions = videoCandidates;
  return result;
}

function projectInstagramNode(node, anonymizer, index) {
  const result = {
    id: anonymizer.value('ig-node', node?.id || node?.pk || `node-${index}`, 'ig_post'),
    code: anonymizer.value('ig-code', node?.code || node?.id || `code-${index}`, 'shortcode'),
    media_type: Number(node?.media_type) === 8 ? 8 : (Number(node?.media_type) === 2 ? 2 : 1),
    taken_at: 1700000000 + index,
    caption: { text: node?.caption ? `fixture caption ${index + 1}` : '' }
  };
  const imageCandidates = (node?.image_versions2?.candidates || [])
    .map((candidate) => projectImageCandidate(candidate, 'instagram', anonymizer))
    .filter(Boolean);
  const videoCandidates = (node?.video_versions || [])
    .map((candidate) => projectImageCandidate(candidate, 'instagram', anonymizer))
    .filter(Boolean);
  if (imageCandidates.length) result.image_versions2 = { candidates: imageCandidates };
  if (videoCandidates.length) result.video_versions = videoCandidates;
  if (node?.display_url) result.display_url = sanitizeUrl(node.display_url, 'instagram', anonymizer);
  if (Array.isArray(node?.carousel_media)) {
    result.carousel_media = node.carousel_media.map((part, partIndex) => projectInstagramPart(part, anonymizer, partIndex));
  }
  return result;
}

function projectInstagramStory(item, anonymizer, index) {
  const result = projectInstagramPart(item, anonymizer, index);
  result.id = anonymizer.value('ig-story', item?.id || item?.pk || `story-${index}`, 'story');
  result.taken_at = 1700001000 + index;
  if (item?._highlightTitle) result._highlightTitle = `Fixture Highlight ${index + 1}`;
  return result;
}

function baseFixture(platform, fixtureType, sourceCaptureId, purpose) {
  return {
    fixtureVersion: 1,
    fixtureType,
    extractionVersion: 1,
    sanitizationVersion: 1,
    platform,
    scenario: sourceCaptureId,
    sourceCaptureId,
    capturedAt: CAPTURE_DATE,
    browser: 'Chrome',
    sanitized: true,
    source: 'local-har-extraction',
    purpose
  };
}

function extractInstagramFixture(harPath) {
  const sourceCaptureId = captureIdFor(harPath, 'instagram');
  const anonymizer = createAnonymizer();
  const timeline = extractTimelineNodes(harPath);
  const stories = extractStoryItems(harPath);
  return {
    ...baseFixture('instagram', 'instagram-replay', sourceCaptureId, 'Offline Instagram parser and content-script parity regression'),
    nodes: timeline.nodes.map((node, index) => projectInstagramNode(node, anonymizer, index)),
    storyItems: stories.storyItems.map((item, index) => projectInstagramStory(item, anonymizer, index)),
    expected: {
      timelineResponses: timeline.timelineResponses,
      nodeCount: timeline.nodes.length,
      storyCount: stories.storyItems.length,
      highlightTitles: stories.highlightTitles.size
    }
  };
}

function htmlMediaUrls(html) {
  const urls = [];
  for (const match of String(html || '').matchAll(/\b(?:src|data-src|data-lazy-src|stream-url|poster)="([^"]+)"/gi)) {
    const value = match[1].replace(/&amp;/g, '&');
    if (/(?:preview|i|v)\.redd\.it|redgifs\.com|imgur\.com/i.test(value)) urls.push(value);
  }
  return [...new Set(urls)];
}

function projectRedditPost(post, anonymizer, index) {
  const rawAttrs = post.attrs || {};
  const rawContentHref = rawAttrs['content-href'] || '';
  const rawType = String(rawAttrs['post-type'] || '').toLowerCase();
  const sourceUrls = htmlMediaUrls(post.html);
  const isGallery = rawType === 'gallery' || /gallery-carousel|faceplate-carousel/i.test(post.html);
  const isVideo = rawType === 'video' || /v\.redd\.it|shreddit-player/i.test(rawContentHref) || /<shreddit-player\b/i.test(post.html);
  const isRedGifs = /redgifs\.com/i.test(rawContentHref) || /redgifs\.com/i.test(sourceUrls.join(' '));
  const contentUrl = rawContentHref && !/^https?:\/\/www\.reddit\.com\b/i.test(rawContentHref)
    ? sanitizeUrl(rawContentHref, 'reddit', anonymizer, 'media')
    : '';
  const mediaUrls = sourceUrls.map((url) => sanitizeUrl(url, 'reddit', anonymizer, 'media')).filter(Boolean);
  const preferredUrl = contentUrl || mediaUrls[0] || '';
  const postId = anonymizer.value('reddit-post', rawAttrs.id || `post-${index}`, 'post');
  const title = `Fixture Reddit Post ${index + 1}`;
  const attrs = {
    id: `t3_${postId}`,
    'post-type': isGallery ? 'gallery' : (isVideo ? 'video' : (isRedGifs ? 'link' : 'image')),
    'post-title': title,
    author: 'fixture_author',
    'author-name': 'fixture_author',
    'subreddit-name': 'fixture_subreddit',
    'subreddit-prefixed-name': 'r/fixture_subreddit',
    domain: isRedGifs ? 'www.redgifs.com' : (isVideo ? 'v.redd.it' : 'i.redd.it'),
    permalink: `/comments/${postId}/fixture-post/`,
    score: /^-?\d+$/.test(rawAttrs.score || '') ? rawAttrs.score : '0',
    'created-timestamp': '1700000000'
  };
  if (isGallery) attrs['gallery-data'] = 'true';
  if (preferredUrl) attrs['content-href'] = isRedGifs
    ? sanitizeRedditLink(rawContentHref, anonymizer)
    : preferredUrl;

  const tags = [`<a slot="title" href="${escapeAttr(attrs.permalink)}">${escapeText(title)}</a>`];
  if (isGallery) {
    const galleryUrls = mediaUrls.length ? mediaUrls : (preferredUrl ? [preferredUrl] : []);
    tags.push(`<gallery-carousel>${galleryUrls.map((url) => `<img src="${escapeAttr(url)}">`).join('')}</gallery-carousel>`);
  } else if (isVideo && preferredUrl) {
    tags.push(`<shreddit-player src="${escapeAttr(preferredUrl)}" poster=""></shreddit-player>`);
  } else if (preferredUrl && !isRedGifs) {
    tags.push(`<img src="${escapeAttr(preferredUrl)}">`);
  }
  const html = `<shreddit-post ${Object.entries(attrs).map(([key, value]) => `${key}="${escapeAttr(value)}"`).join(' ')}>${tags.join('')}</shreddit-post>`;
  return { attrs, html };
}

function extractRedditFixture(harPath) {
  const sourceCaptureId = captureIdFor(harPath, 'reddit');
  const anonymizer = createAnonymizer();
  const extracted = extractRedditPosts(harPath);
  return {
    ...baseFixture('reddit', 'reddit-replay', sourceCaptureId, 'Offline Reddit DOM scanner and media classification regression'),
    posts: extracted.posts.map((post, index) => projectRedditPost(post, anonymizer, index)),
    pageCount: extracted.pageCount,
    expected: { posts: extracted.posts.length, pageCount: extracted.pageCount }
  };
}

function parseJsonBody(entry) {
  const text = decodeEntryBody(entry);
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

function parseJsonBodies(entry) {
  const text = decodeEntryBody(entry);
  if (!text) return [];
  const whole = parseJsonBody(entry);
  if (whole) return [whole];
  return text.split('\n').map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

function projectRedditApiPost(raw, anonymizer, index) {
  if (!raw || typeof raw !== 'object') return null;
  const rawId = String(raw.id || `post-${index}`).replace(/^t3_/, '');
  const result = {
    id: anonymizer.value('reddit-api-post', rawId, 'post'),
    title: `Fixture API Post ${index + 1}`,
    author: 'fixture_author',
    subreddit: 'fixture_subreddit',
    score: Number.isFinite(Number(raw.score)) ? Number(raw.score) : 0
  };
  if (raw.is_gallery && raw.media_metadata) {
    result.is_gallery = true;
    result.gallery_data = { items: (raw.gallery_data?.items || []).map((item, itemIndex) => ({
      media_id: anonymizer.value('reddit-api-media', item.media_id || `media-${itemIndex}`, 'media'),
      id: itemIndex + 1
    })) };
    result.media_metadata = {};
    for (const [rawMediaId, rawMeta] of Object.entries(raw.media_metadata)) {
      const mediaId = anonymizer.value('reddit-api-media', rawMediaId, 'media');
      const projectMeta = {
        status: rawMeta?.status || 'valid',
        e: rawMeta?.e || 'Image',
        m: /^image\/[a-z0-9.+-]+$/i.test(rawMeta?.m || '') ? rawMeta.m : 'image/jpeg'
      };
      const source = projectImageCandidate({ url: rawMeta?.s?.u, width: rawMeta?.s?.x, height: rawMeta?.s?.y }, 'reddit', anonymizer);
      if (source) projectMeta.s = { x: source.width || 100, y: source.height || 100, u: source.url };
      const previews = (rawMeta?.p || []).map((candidate) => projectImageCandidate({ url: candidate?.u, width: candidate?.x, height: candidate?.y }, 'reddit', anonymizer)).filter(Boolean);
      if (previews.length) projectMeta.p = previews.map((candidate) => ({ u: candidate.url, x: candidate.width, y: candidate.height }));
      result.media_metadata[mediaId] = projectMeta;
    }
    return result;
  }
  if (raw.is_video && raw.media?.reddit_video) {
    result.is_video = true;
    const video = raw.media.reddit_video;
    result.media = { reddit_video: {
      fallback_url: sanitizeUrl(video.fallback_url, 'reddit', anonymizer, 'video'),
      height: Number(video.height) || 720,
      width: Number(video.width) || 1280,
      dash_url: sanitizeUrl(video.dash_url, 'reddit', anonymizer, 'video'),
      hls_url: sanitizeUrl(video.hls_url, 'reddit', anonymizer, 'video')
    } };
    return result;
  }
  if (raw.url && /redgifs\.com/i.test(raw.url)) {
    result.url = sanitizeRedditLink(raw.url, anonymizer);
    return result;
  }
  if (raw.url) {
    result.url = sanitizeUrl(raw.url, 'reddit', anonymizer, 'media');
    const preview = raw.preview?.images?.[0]?.resolutions || [];
    const resolutions = preview.map((candidate) => projectImageCandidate({ url: candidate?.url, width: candidate?.width, height: candidate?.height }, 'reddit', anonymizer)).filter(Boolean);
    if (resolutions.length) result.preview = { images: [{ resolutions: resolutions.map((candidate) => ({ url: candidate.url, width: candidate.width, height: candidate.height })) }] };
    if (raw.thumbnail && /^https?:\/\//i.test(raw.thumbnail)) result.thumbnail = sanitizeUrl(raw.thumbnail, 'reddit', anonymizer, 'media');
  }
  return result;
}

function projectRedditListing(raw, anonymizer) {
  const children = raw?.data?.children || [];
  return {
    kind: 'listing',
    data: {
      after: raw?.data?.after ? anonymizer.value('reddit-cursor', raw.data.after, 'cursor') : null,
      children: children.map((child, index) => ({
        kind: child?.kind || 't3',
        data: projectRedditApiPost(child?.data, anonymizer, index)
      })).filter((child) => child.data)
    }
  };
}

function extractRedditApiFixture(harPath) {
  const sourceCaptureId = captureIdFor(harPath, 'reddit');
  const anonymizer = createAnonymizer();
  const har = JSON.parse(fs.readFileSync(harPath, 'utf8'));
  const entries = har.log?.entries || [];
  const findJson = (needle) => {
    const entry = entries.find((candidate) => String(candidate?.request?.url || '').includes(needle));
    return entry ? parseJsonBody(entry) : null;
  };
  const submittedRaw = findJson('/submitted.json');
  const searchRaw = findJson('/search.json');
  const aboutRaw = findJson('/about.json');
  if (!submittedRaw || !searchRaw || !aboutRaw) throw new Error(`Reddit API capture lacks submitted/search/about responses: ${harPath}`);
  const submitted = projectRedditListing(submittedRaw, anonymizer);
  const search = projectRedditListing(searchRaw, anonymizer);
  const expectedPostIds = [];
  const seen = new Set();
  for (const listing of [submitted, search]) {
    for (const child of listing.data.children) {
      if (!seen.has(child.data.id)) {
        seen.add(child.data.id);
        expectedPostIds.push(child.data.id);
      }
    }
  }
  return {
    ...baseFixture('reddit', 'reddit-api', sourceCaptureId, 'Offline Reddit profile API fallback and avatar regression'),
    username: 'fixture_user',
    submitted,
    search,
    about: { data: { icon_img: 'https://www.redditstatic.com/avatars/defaults/v2/avatar_default_3.png', snoovatar_img: '' } },
    expected: { postIds: expectedPostIds, totalPosts: expectedPostIds.length }
  };
}

function isFacebookVideoNode(node) {
  return node?.__typename === 'Video' || node?.__typename === 'ReelsTrayItem' || !!node?.playable_url || !!node?.playable_url_dash || (Array.isArray(node?.video_versions) && node.video_versions.length > 0);
}

function isFacebookCollectionTile(node) {
  return node?.__typename === 'TimelineAppCollectionItem' || Object.prototype.hasOwnProperty.call(node || {}, 'collection_item_type');
}

function projectFacebookRender(value, anonymizer) {
  if (!value?.uri || !/fbcdn\.net/i.test(value.uri)) return null;
  return {
    uri: sanitizeUrl(value.uri, 'facebook', anonymizer),
    ...(Number.isFinite(Number(value.width)) ? { width: Number(value.width) } : {}),
    ...(Number.isFinite(Number(value.height)) ? { height: Number(value.height) } : {})
  };
}

function projectFacebookPhoto(node, anonymizer) {
  const id = node?.id || node?.photo_id;
  const result = {
    __typename: node?.__typename || 'Photo',
    id: anonymizer.value('fb-photo', id || 'photo', 'fb_photo')
  };
  if (node?.photo_id) result.photo_id = result.id;
  for (const field of ['image', 'viewer_image', 'thumbnail_image']) {
    const render = projectFacebookRender(node[field], anonymizer);
    if (render) result[field] = render;
  }
  if (Array.isArray(node?.images)) {
    result.images = node.images.map((render) => projectFacebookRender(render, anonymizer)).filter(Boolean);
  }
  if (node?.url && /fbcdn\.net/i.test(node.url)) result.url = sanitizeUrl(node.url, 'facebook', anonymizer);
  return result;
}

function collectFacebookPayload(root, anonymizer) {
  const photos = [];
  const profiles = [];
  const photoIds = new Set();
  const profileIds = new Set();
  const visited = new Set();
  const walk = (value, depth = 0, videoAncestor = false) => {
    if (!value || typeof value !== 'object' || depth > 40 || visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) {
      value.forEach((entry) => walk(entry, depth + 1, videoAncestor));
      return;
    }
    const inVideo = videoAncestor || isFacebookVideoNode(value);
    if (value.profile_picture?.uri && /fbcdn\.net/i.test(value.profile_picture.uri)) {
      const profileId = anonymizer.value('fb-profile', value.id || value.profile_id || 'profile', 'fb_profile');
      if (!profileIds.has(profileId)) {
        profileIds.add(profileId);
        profiles.push({
          id: profileId,
          name: 'Example Target Profile',
          url: 'https://www.facebook.example/example-target-profile',
          profile_picture: projectFacebookRender(value.profile_picture, anonymizer)
        });
      }
    }
    const id = value.id || value.photo_id;
    const isCandidate = !!id && !inVideo && !isFacebookCollectionTile(value) && !value.profile_picture &&
      (value.__typename === 'Photo' || !!value.viewer_image?.uri || !!value.image?.uri);
    if (isCandidate) {
      const photo = projectFacebookPhoto(value, anonymizer);
      if (!photoIds.has(photo.id)) {
        photoIds.add(photo.id);
        photos.push(photo);
      }
    }
    for (const child of Object.values(value)) walk(child, depth + 1, inVideo);
  };
  walk(root);
  return { photos, profiles };
}

function makeCompactFacebookPayload(collected, { deep = false } = {}) {
  const nest = (value, depth) => {
    if (depth <= 0) return value;
    return { compact_wrapper: nest(value, depth - 1) };
  };
  return {
    data: {
      compact_media: deep ? nest(collected.photos, 15) : collected.photos,
      compact_profiles: collected.profiles
    }
  };
}

function extractFacebookFixture(harPath, options = {}) {
  const sourceCaptureId = captureIdFor(harPath, 'facebook');
  const anonymizer = createAnonymizer();
  const extracted = extractFacebookData(harPath);
  const graphqlBodies = extracted.graphqlBodies.map((body) => makeCompactFacebookPayload(collectFacebookPayload(body, anonymizer)));
  const jsonScripts = extracted.jsonScripts.map((body) => makeCompactFacebookPayload(collectFacebookPayload(body, anonymizer), { deep: true }));
  const allPhotos = [...graphqlBodies, ...jsonScripts].flatMap((payload) => {
    const result = [];
    const walk = (value) => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) return value.forEach(walk);
      if (value.__typename === 'Photo' || value.__typename === 'Story' || value.viewer_image?.uri) result.push(value);
      Object.values(value).forEach(walk);
    };
    walk(payload);
    return result;
  });
  const uniquePhotos = new Map(allPhotos.map((photo) => [photo.id, photo]));
  const anchors = [...uniquePhotos.values()].slice(0, 80).map((photo) => {
    const render = photo.image || photo.viewer_image;
    return `<a href="https://www.facebook.example/photo/${escapeAttr(photo.id)}/"><img src="${escapeAttr(render?.uri || 'https://scontent.example.fbcdn.net/fixture/asset_001.jpg')}" /></a>`;
  }).join('');
  const cdnRequests = options.cdnRequests || [];
  const allItems = [...uniquePhotos.values()].map((photo) => FacebookNormalizer.normalizePhoto(photo)).filter(Boolean);
  const knownDownscaledIds = allItems.filter((item) => MetaCdn.isDownscaledRender(item.downloadUrl)).map((item) => item.id);
  return {
    ...baseFixture('facebook', 'facebook-replay', sourceCaptureId, 'Offline Facebook GraphQL, DOM anchor and CDN render regression'),
    graphqlBodies,
    jsonScripts,
    htmlPages: anchors ? [`<main>${anchors}</main>`] : [],
    cdnRequests,
    knownDownscaledIds,
    expected: {
      graphqlResponses: graphqlBodies.length,
      jsonScripts: jsonScripts.length,
      photos: uniquePhotos.size,
      htmlPages: anchors ? 1 : 0
    }
  };
}

function extractFacebookReelsFixture(harPath) {
  const sourceCaptureId = captureIdFor(harPath, 'facebook');
  const anonymizer = createAnonymizer();
  const har = JSON.parse(fs.readFileSync(harPath, 'utf8'));
  const reelPayloads = [];
  for (const entry of har.log?.entries || []) {
    const url = String(entry?.request?.url || '');
    if (!/api\/graphql/.test(url)) continue;
    const body = decodeEntryBody(entry);
    if (!body.includes('profile_reel_node')) continue;
    for (const parsed of parseJsonBodies(entry)) {
      reelPayloads.push(makeCompactFacebookPayload(collectFacebookPayload(parsed, anonymizer)));
    }
  }
  return {
    ...baseFixture('facebook', 'facebook-replay', sourceCaptureId, 'Offline Facebook Reel video-wrapper regression'),
    graphqlBodies: reelPayloads,
    jsonScripts: [],
    htmlPages: [],
    cdnRequests: [],
    reelPayloads,
    expected: { reelResponses: reelPayloads.length, emittedPhotos: 0 }
  };
}

function extractFacebookCdnFixture(harPath) {
  const sourceCaptureId = captureIdFor(harPath, 'facebook');
  const anonymizer = createAnonymizer();
  const har = JSON.parse(fs.readFileSync(harPath, 'utf8'));
  const cdnRequests = [];
  for (const entry of har.log?.entries || []) {
    const url = String(entry?.request?.url || '');
    if (/fbcdn\.net/i.test(url)) cdnRequests.push(sanitizeUrl(url, 'facebook', anonymizer, 'request'));
  }
  return {
    ...baseFixture('facebook', 'facebook-replay', sourceCaptureId, 'Offline Facebook thumbnail rejection regression'),
    graphqlBodies: [],
    jsonScripts: [],
    htmlPages: [],
    cdnRequests,
    knownDownscaledIds: [],
    expected: { cdnRequests: cdnRequests.length }
  };
}

function writeFixture(relativePath, fixture) {
  const absolute = path.join(outputRoot, relativePath);
  validateCompactFixture(fixture, absolute);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
  console.log(`generated ${path.relative(rootDir, absolute)} (${fs.statSync(absolute).size} bytes)`);
}

function writeFixtureManifest() {
  if (!fs.existsSync(outputRoot)) return;
  const files = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.json') && name !== 'manifest.json') files.push(full);
    }
  };
  walk(outputRoot);
  const entries = files.sort().map((filePath) => {
    const fixture = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return {
      path: path.relative(outputRoot, filePath).replace(/\\/g, '/'),
      platform: fixture.platform,
      fixtureType: fixture.fixtureType,
      sourceCaptureId: fixture.sourceCaptureId,
      bytes: fs.statSync(filePath).size
    };
  });
  const manifest = {
    manifestVersion: 1,
    generatedBy: 'tools/extract-fixtures.js',
    sanitized: true,
    fixtures: entries,
    totalBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0)
  };
  fs.writeFileSync(path.join(outputRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`generated tests/fixtures/extracted/manifest.json (${manifest.totalBytes} fixture bytes)`);
}

function existing(relativePath) {
  const absolute = path.join(rootDir, relativePath);
  return fs.existsSync(absolute) ? absolute : null;
}

function main() {
  const requestedSource = process.argv.find((arg) => arg.startsWith('--source='))?.slice('--source='.length);
  if (requestedSource) {
    const source = path.resolve(rootDir, requestedSource);
    if (!fs.existsSync(source)) throw new Error(`HAR source does not exist: ${source}`);
    const platform = /instagram/i.test(source) ? 'instagram' : (/facebook/i.test(source) ? 'facebook' : 'reddit');
    const fixture = platform === 'instagram'
      ? extractInstagramFixture(source)
      : (platform === 'facebook' ? extractFacebookFixture(source) : extractRedditFixture(source));
    writeFixture(`${platform}/${fixture.sourceCaptureId}.json`, fixture);
    writeFixtureManifest();
    return;
  }

  const igSources = [
    existing('tests/fixtures/har/instagram/example-profile.har'),
    existing('fixtures-private/instagram-profile.har'),
    existing('fixtures-private/instagram-profile-v2.har')
  ].filter(Boolean);
  for (const source of igSources) {
    const fixture = extractInstagramFixture(source);
    writeFixture(`instagram/${fixture.sourceCaptureId}.json`, fixture);
  }

  const redditSources = [
    existing('tests/fixtures/har/reddit/example-feed.har'),
    existing('fixtures-private/reddit-feed.har'),
    existing('fixtures-private/reddit-post.har'),
    existing('fixtures-private/reddit-gallery.har'),
    existing('fixtures-private/reddit-empty-profile.har')
  ].filter(Boolean);
  for (const source of redditSources) {
    const fixture = extractRedditFixture(source);
    writeFixture(`reddit/${fixture.sourceCaptureId}.json`, fixture);
  }
  const redditProfile = existing('fixtures-private/reddit-private-profile.har');
  if (redditProfile) {
    const fixture = extractRedditApiFixture(redditProfile);
    writeFixture(`reddit/${fixture.sourceCaptureId}.json`, fixture);
  }

  const facebookProfile = existing('fixtures-private/facebook-profile.har') || existing('tests/fixtures/har/facebook/example-profile.har');
  if (facebookProfile) {
    const fixture = extractFacebookFixture(facebookProfile);
    writeFixture(`facebook/${fixture.sourceCaptureId}.json`, fixture);
  }
  const facebookReels = existing('fixtures-private/facebook-reels.har');
  if (facebookReels) {
    const fixture = extractFacebookReelsFixture(facebookReels);
    writeFixture(`facebook/${fixture.sourceCaptureId}.json`, fixture);
  }
  const facebookCdn = existing('fixtures-private/facebook-206x206.har');
  if (facebookCdn) {
    const fixture = extractFacebookCdnFixture(facebookCdn);
    writeFixture(`facebook/${fixture.sourceCaptureId}.json`, fixture);
  }
  writeFixtureManifest();
}

try {
  main();
} catch (error) {
  console.error(error?.stack || error);
  process.exitCode = 1;
}
