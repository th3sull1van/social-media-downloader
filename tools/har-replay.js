/**
 * Social Media Downloader — HAR Replay Harness
 * Extracts Instagram GraphQL payloads from HAR captures and classifies them so
 * replay tests (tests/integration/har-replay.test.js) and manual analysis can run
 * the real pipeline (content script / normalizer) against captured traffic.
 *
 * Usage (CLI): bun tools/har-replay.js <path/to/capture.har> [--summary]
 */

import fs from 'node:fs';

const TIMELINE_SHAPES = /** @type {const} */ ({
  xdt_timeline: 'xdt_api__v1__feed__user_timeline_graphql_connection',
  edge_timeline: 'edge_owner_to_timeline_media'
});

/**
 * Decodes a HAR response body (plain or base64) to a UTF-8 string.
 * @param {any} entry
 * @returns {string}
 */
export function decodeEntryBody(entry) {
  const content = entry?.response?.content;
  const text = content?.text;
  if (!text) return '';
  if (content.encoding === 'base64') {
    try {
      return Buffer.from(text, 'base64').toString('utf8');
    } catch (e) {
      return '';
    }
  }
  return text;
}

/**
 * Classifies a single HAR entry against the response shapes the extension consumes.
 * @param {any} entry
 * @returns {string} one of: timeline | highlights_tray | reels_media | profile_info | other
 */
export function classifyEntry(entry) {
  if (!entry?.response?.content?.text) return 'other';
  const body = decodeEntryBody(entry);
  if (!body.startsWith('{')) return 'other';
  let json;
  try {
    json = JSON.parse(body);
  } catch (e) {
    return 'other';
  }

  if (json?.data?.xdt_api__v1__feed__user_timeline_graphql_connection?.edges) return 'timeline';
  if (json?.data?.user?.edge_owner_to_timeline_media?.edges) return 'timeline';
  if (json?.data?.highlights?.edges) return 'highlights_tray';
  if (json?.reels || json?.data?.reels) return 'reels_media';
  if (String(entry.request.url).includes('/api/v1/users/web_profile_info/')) return 'profile_info';
  return 'other';
}

/**
 * Extracts raw timeline nodes (Instagram post objects) from a HAR file.
 * @param {string} harPath
 * @returns {{ nodes: any[], timelineResponses: number, otherShapes: Record<string, number> }}
 */
export function extractTimelineNodes(harPath) {
  const har = JSON.parse(fs.readFileSync(harPath, 'utf8'));
  const entries = har.log.entries || [];

  /** @type {any[]} */
  const nodes = [];
  let timelineResponses = 0;
  /** @type {Record<string, number>} */
  const otherShapes = {};

  for (const entry of entries) {
    const shape = classifyEntry(entry);
    if (shape === 'timeline') {
      timelineResponses++;
      const body = JSON.parse(decodeEntryBody(entry));
      const timeline =
        body?.data?.xdt_api__v1__feed__user_timeline_graphql_connection ||
        body?.data?.user?.edge_owner_to_timeline_media;
      for (const edge of timeline.edges) {
        nodes.push(edge.node || edge);
      }
    } else if (shape !== 'timeline') {
      otherShapes[shape] = (otherShapes[shape] || 0) + 1;
    }
  }

  return { nodes, timelineResponses, otherShapes };
}

/**
 * Extracts highlight/story items from reels_media responses in a HAR file.
 * @param {string} harPath
 * @returns {{ storyItems: any[], highlightTitles: Set<string> }}
 */
export function extractStoryItems(harPath) {
  const har = JSON.parse(fs.readFileSync(harPath, 'utf8'));
  const entries = har.log.entries || [];

  /** @type {any[]} */
  const storyItems = [];
  const highlightTitles = new Set();

  for (const entry of entries) {
    if (classifyEntry(entry) !== 'reels_media') continue;
    const body = JSON.parse(decodeEntryBody(entry));
    const reels = body?.reels || body?.data?.reels || {};
    for (const reelId of Object.keys(reels)) {
      const reel = reels[reelId];
      if (!reel || !Array.isArray(reel.items)) continue;
      for (const item of reel.items) {
        item._highlightTitle = reel.title || item._highlightTitle || null;
        if (item._highlightTitle) highlightTitles.add(item._highlightTitle);
        storyItems.push(item);
      }
    }
  }

  return { storyItems, highlightTitles };
}

/**
 * Extracts Reddit shreddit-post elements (attributes + inner HTML chunk) from HTML
 * responses in a HAR file. Server-rendered shreddit pages embed the full post data
 * even when the JSON API refuses (NSFW / quarantined subreddits).
 * @param {string} harPath
 * @returns {{ posts: Array<{ attrs: Record<string, string>, html: string }>, pageCount: number }}
 */
export function extractRedditPosts(harPath) {
  const har = JSON.parse(fs.readFileSync(harPath, 'utf8'));
  const entries = har.log.entries || [];

  /** @type {Array<{ attrs: Record<string, string>, html: string }>} */
  const posts = [];
  let pageCount = 0;
  const seenIds = new Set();

  for (const entry of entries) {
    const body = decodeEntryBody(entry);
    if (!body || body.length < 500 || !body.includes('<shreddit-post')) continue;
    const mime = entry.response.content?.mimeType || '';
    if (!mime.includes('html') && !body.includes('shreddit')) continue;

    pageCount++;
    // Split on post openings; each chunk carries the post's own attributes and media.
    const openings = [...body.matchAll(/<shreddit-post\s/g)];
    for (let i = 0; i < openings.length; i++) {
      const start = openings[i].index || 0;
      const end = i + 1 < openings.length ? openings[i + 1].index : Math.min(body.length, start + 40000);
      const chunk = body.slice(start, end);

      const openTag = chunk.match(/^<shreddit-post\s([^>]*)>/);
      if (!openTag) continue;
      /** @type {Record<string, string>} */
      const attrs = {};
      for (const m of openTag[1].matchAll(/([a-zA-Z-]+)="([^"]*)"/g)) {
        attrs[m[1]] = m[2];
      }
      const id = attrs.id || '';
      if (!id || seenIds.has(id)) continue;
      seenIds.add(id);
      posts.push({ attrs, html: chunk });
    }
  }

  return { posts, pageCount };
}

/**
 * Extracts Facebook replay material: GraphQL response bodies (parsed), inline
 * application/json script payloads, and HTML page bodies.
 * @param {string} harPath
 * @returns {{ graphqlBodies: any[], jsonScripts: any[], htmlPages: string[] }}
 */
export function extractFacebookData(harPath) {
  const har = JSON.parse(fs.readFileSync(harPath, 'utf8'));
  const entries = har.log.entries || [];

  /** @type {any[]} */
  const graphqlBodies = [];
  /** @type {any[]} */
  const jsonScripts = [];
  /** @type {string[]} */
  const htmlPages = [];

  for (const entry of entries) {
    const url = String(entry.request.url);
    const body = decodeEntryBody(entry);
    if (!body) continue;

    if (url.includes('/api/graphql/') && entry.request.method === 'POST') {
      try {
        graphqlBodies.push(JSON.parse(body));
      } catch { /* skip malformed */ }
      continue;
    }

    const mime = entry.response.content?.mimeType || '';
    if (mime.includes('html') && body.includes('fbcdn.net')) {
      htmlPages.push(body);
      // Parse inline application/json script payloads (what fbSweepScriptTags consumes).
      for (const m of body.matchAll(/<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/g)) {
        const text = m[1];
        if (!text || !text.includes('fbcdn.net')) continue;
        try {
          jsonScripts.push(JSON.parse(text));
        } catch { /* malformed embedded json */ }
      }
    }
  }

  return { graphqlBodies, jsonScripts, htmlPages };
}

/**
 * Audits the resolved item set for filename collisions that would overwrite each
 * other inside a ZIP archive or uniquify-suffixed individual downloads.
 * @param {Array<{ path: string }>} archivePaths
 * @returns {{ collisions: Map<string, number>, duplicatePaths: string[] }}
 */
export function auditFilenameCollisions(archivePaths) {
  const counts = new Map();
  for (const { path } of archivePaths) {
    const normalized = String(path).replace(/\\/g, '/').toLowerCase();
    counts.set(normalized, (counts.get(normalized) || 0) + 1);
  }
  const collisions = new Map();
  for (const [path, count] of counts) {
    if (count > 1) collisions.set(path, count);
  }
  return {
    collisions,
    duplicatePaths: [...collisions.keys()]
  };
}

// CLI summary mode
if (process.argv[1] && process.argv[1].endsWith('har-replay.js')) {
  const harPath = process.argv[2];
  if (!harPath) {
    console.error('Usage: bun tools/har-replay.js <capture.har> [--summary]');
    process.exit(1);
  }
  const { nodes, timelineResponses, otherShapes } = extractTimelineNodes(harPath);
  const { storyItems, highlightTitles } = extractStoryItems(harPath);
  console.log('HAR:', harPath);
  console.log('timeline responses:', timelineResponses, '| timeline nodes:', nodes.length);
  console.log('story/highlight items:', storyItems.length, '| highlight titles:', [...highlightTitles].slice(0, 5));
  console.log('other shapes:', JSON.stringify(otherShapes));
  const mediaTypes = {};
  for (const node of nodes) {
    const mt = node.media_type ?? (node.video_versions?.length ? 2 : 1);
    mediaTypes[mt] = (mediaTypes[mt] || 0) + 1;
  }
  console.log('node media_types:', JSON.stringify(mediaTypes));
}
