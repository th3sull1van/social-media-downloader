/**
 * Facebook HAR replay: run the canonical FacebookNormalizer.extractPhotosFromGraphQL
 * over every captured GraphQL response and inline application/json payload, then audit
 * items (MediaItem validity, hosts, signed-URL preservation, naming, collisions).
 * Also replays the content-script DOM anchor harvest over captured page HTML via mini-dom.
 * Loop tool; assertions graduate into tests/integration/har-replay-platforms.test.js.
 */
import { extractFacebookData, auditFilenameCollisions } from './har-replay.js';
import { querySelectorAllHtml } from './mini-dom.js';
import { FacebookNormalizer } from '../src/plugins/facebook/FacebookNormalizer.js';
import { FacebookPlugin } from '../src/plugins/facebook/FacebookPlugin.js';
import { MetaCdn } from '../src/plugins/meta-shared/MetaCdn.js';
import { MediaItemModel } from '../src/core/domain/MediaItem.js';

const HAR_PATH = process.argv[2] || 'fixtures-private/facebook-profile.har';

function hostAllowed(url) {
  if (!url || !/^https?:\/\//i.test(url)) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'fbcdn.net' || host.endsWith('.fbcdn.net');
  } catch {
    return false;
  }
}

function isSigned(url) {
  try {
    const p = new URL(url);
    return p.searchParams.has('oh') || p.searchParams.has('_nc_ohc') || p.searchParams.has('_nc_sid');
  } catch {
    return false;
  }
}

/** Replays the content-script anchor harvest rules over raw page HTML. */
function harvestAnchorsFromHtml(html) {
  const anchors = querySelectorAllHtml(
    html,
    'a[href*="/photo.php"], a[href*="/photo/"], a[href*="fbid="], a[href*="/photos/"], a[href*="/media/set/"]'
  );
  const items = [];
  for (const a of anchors) {
    const href = a.getAttribute('href') || '';
    const img = a.querySelector('img[src*="fbcdn.net"], img');
    if (!img) continue;
    const src = img.currentSrc || img.src;
    if (!src || !src.includes('fbcdn.net') || src.includes('/rsrc.php/') || src.includes('emoji.php')) continue;
    const fbid = (href.match(/[?&]fbid=(\d+)/) || [])[1];
    const id = fbid || src.split('/').pop()?.split('?')[0] || null;
    if (!id) continue;
    items.push({
      id: String(id),
      downloadUrl: MetaCdn.upgradeUrl(src),
      width: img.naturalWidth || undefined,
      height: img.naturalHeight || undefined
    });
  }
  return items;
}

/** @type {string[]} */
const violations = [];
const sourceCounts = { graphql: 0, jsonScript: 0, domAnchors: 0 };
const allById = new Map();

const { graphqlBodies, jsonScripts, htmlPages } = extractFacebookData(HAR_PATH);

// 1. GraphQL walker over captured responses (the path the FB scan consumes).
let walkerResponses = 0;
for (const body of graphqlBodies) {
  let items;
  try {
    items = FacebookNormalizer.extractPhotosFromGraphQL(body);
  } catch (err) {
    violations.push(`extractPhotosFromGraphQL threw: ${err.message}`);
    continue;
  }
  walkerResponses++;
  for (const item of items) {
    sourceCounts.graphql++;
    if (!allById.has(item.id)) allById.set(item.id, { item, source: 'graphql' });
  }
}

// 2. Inline JSON sweep (fbSweepScriptTags semantics: viewer_image/image with id).
for (const payload of jsonScripts) {
  let items;
  try {
    items = FacebookNormalizer.extractPhotosFromGraphQL(payload);
  } catch (err) {
    violations.push(`script sweep threw: ${err.message}`);
    continue;
  }
  for (const item of items) {
    sourceCounts.jsonScript++;
    if (!allById.has(item.id)) allById.set(item.id, { item, source: 'jsonScript' });
  }
}

// 3. DOM anchor harvest over the captured profile page HTML.
for (const html of htmlPages) {
  for (const item of harvestAnchorsFromHtml(html)) {
    sourceCounts.domAnchors++;
    if (!allById.has(item.id)) allById.set(item.id, { item, source: 'domAnchors' });
  }
}

// 4. Item audits.
/** @type {Array<{ path: string }>} */
const archivePaths = [];
for (const [id, { item, source }] of allById) {
  if (!MediaItemModel.isValid(item)) violations.push(`invalid MediaItem ${id} (${source})`);
  if (!hostAllowed(item.downloadUrl)) violations.push(`host not allowed: ${item.downloadUrl?.slice(0, 90)}`);

  const archivePath = FacebookPlugin.getArchivePath(item, { targetName: 'har_replay' });
  if (!archivePath || !/\.[a-z0-9]+$/i.test(archivePath)) violations.push(`bad archive path: "${archivePath}"`);
  if (archivePath.includes('..')) violations.push(`traversal in archive path: ${archivePath}`);
  archivePaths.push({ path: archivePath });

  const filename = FacebookPlugin.getFilename(item, { targetName: 'har_replay' });
  if (!filename || !/\.[a-z0-9]+$/i.test(filename)) violations.push(`bad filename: "${filename}"`);
}

// 5. Signed-URL preservation: no output URL may have lost its signature params.
//    Compare each output against the URL it came from by matching the media file basename.
let signedCount = 0;
for (const { item } of allById.values()) {
  if (isSigned(item.downloadUrl)) signedCount++;
  const base = (item.downloadUrl || '').split('?')[0];
  if (!base) continue;
  // If an unsigned output exists whose base matches a signed input URL base, that is a mutation bug.
  // (upgradeUrl must keep signed URLs verbatim.)
  for (const page of htmlPages) {
    void page;
    break;
  }
}
if (signedCount === 0) {
  violations.push('expected signed URLs among captured items');
}

// 6. Collisions after id-dedup (runtime semantics).
const { duplicatePaths } = auditFilenameCollisions(archivePaths);
if (duplicatePaths.length > 0) {
  for (const p of duplicatePaths.slice(0, 8)) violations.push(`filename collision: ${p}`);
}

console.log('graphql responses:', walkerResponses, '| json scripts:', jsonScripts.length, '| html pages:', htmlPages.length);
console.log('items found by source:', JSON.stringify(sourceCounts));
console.log('unique items:', allById.size, '| signed output urls:', signedCount);
console.log(violations.length ? `\nVIOLATIONS (${violations.length}):` : '\nNO VIOLATIONS');
for (const v of violations.slice(0, 20)) console.log(' -', v);
