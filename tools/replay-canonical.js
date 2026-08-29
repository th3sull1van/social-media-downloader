/**
 * Canonical HAR replay: run the plugin pipeline (InstagramNormalizer → MediaItemModel →
 * InstagramNaming/Plugin paths) against every captured node and audit the results.
 * Loop tool: used to find defects; its assertions graduate into tests/integration/har-replay.test.js.
 */
import { extractTimelineNodes, extractStoryItems, auditFilenameCollisions } from './har-replay.js';
import { InstagramNormalizer } from '../src/plugins/instagram/InstagramNormalizer.js';
import { InstagramPlugin } from '../src/plugins/instagram/InstagramPlugin.js';
import { MediaItemModel } from '../src/core/domain/MediaItem.js';

const HARS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      'fixtures-private/instagram-profile-v2.har',
      'fixtures-private/instagram-profile.har'
    ];

const ALLOWED_SUFFIXES = ['instagram.com', 'cdninstagram.com', 'fbcdn.net'];

function hostAllowed(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return ALLOWED_SUFFIXES.some((s) => host === s || host.endsWith('.' + s));
  } catch {
    return false;
  }
}

function isSignedUrl(url) {
  try {
    const p = new URL(url);
    return p.searchParams.has('oh') || p.searchParams.has('_nc_ohc') || p.searchParams.has('_nc_sid');
  } catch {
    return false;
  }
}

function hasDownscaleResidue(url) {
  try {
    const p = new URL(url);
    const stp = p.searchParams.get('stp');
    if (stp && /[sp]?\d+x\d+/.test(stp)) return `stp=${stp}`;
    if (/(?:^|\/)(?:[sp]\d+x\d+|c\d+\.\d+\.\d+\.\d+[a-z]?)\//.test(p.pathname)) {
      return `path:${p.pathname.slice(0, 60)}`;
    }
    return null;
  } catch {
    return 'unparseable';
  }
}

let totalNodes = 0;
let totalItems = 0;
let throwNodes = 0;
let zeroYieldNodes = [];
/** @type {string[]} */
const violations = [];
/** @type {Array<{ path: string }>} */
const archivePaths = [];
const signedChecked = { kept: 0, mutated: 0 };
const upgraded = { before: new Set(), after: 0 };
const sourceTypes = {};
const extensions = {};

for (const harPath of HARS) {
  const { nodes } = extractTimelineNodes(harPath);
  for (const node of nodes) {
    totalNodes++;
    let items;
    try {
      items = InstagramNormalizer.normalizePost(node);
    } catch (err) {
      throwNodes++;
      violations.push(`normalizePost threw for node ${node.id}: ${err.message}`);
      continue;
    }

    if (!items.length) {
      zeroYieldNodes.push(node);
      continue;
    }

    for (const item of items) {
      totalItems++;
      sourceTypes[item.sourceType] = (sourceTypes[item.sourceType] || 0) + 1;
      extensions[item.extension] = (extensions[item.extension] || 0) + 1;

      if (!MediaItemModel.isValid(item)) {
        violations.push(`invalid MediaItem: ${item.id}`);
      }
      if (!item.downloadUrl || !hostAllowed(item.downloadUrl)) {
        violations.push(`disallowed/missing download host: ${item.downloadUrl?.slice(0, 80)}`);
      }

      // Signature preservation: compare against the raw source URL inside the node
      const rawCandidates = [
        ...(node.image_versions2?.candidates || []).map((c) => c.url),
        ...(node.video_versions || []).map((v) => v.url),
        ...(node.carousel_media || []).flatMap((c) => [
          ...(c.image_versions2?.candidates || []).map((x) => x.url),
          ...(c.video_versions || []).map((v) => v.url)
        ])
      ];
      const rawMatch = rawCandidates.find((u) => u === item.url || u === item.downloadUrl);
      if (rawMatch && isSignedUrl(rawMatch)) {
        if (item.downloadUrl === rawMatch) signedChecked.kept++;
        else signedChecked.mutated++;
      }
      // Downscale residue check on final URLs (unsigned ones)
      if (!isSignedUrl(item.downloadUrl)) {
        const residue = hasDownscaleResidue(item.downloadUrl);
        if (residue) violations.push(`downscale residue on ${item.id}: ${residue}`);
      }
      // Track upgrade effectiveness
      if (rawCandidates.length && rawCandidates[0] !== item.downloadUrl) {
        upgraded.after++;
      }

      const ctx = { targetName: 'matiasvazquezok', index: totalItems };
      const archivePath = InstagramPlugin.getArchivePath(item, ctx);
      if (!archivePath || !/\.[a-z0-9]+$/i.test(archivePath)) {
        violations.push(`bad archive path: "${archivePath}" for ${item.id}`);
      }
      if (archivePath.includes('..')) {
        violations.push(`traversal in archive path: ${archivePath}`);
      }
      archivePaths.push({ path: archivePath });
      const filename = InstagramPlugin.getFilename(item, ctx);
      if (!filename || !/\.[a-z0-9]+$/i.test(filename)) {
        violations.push(`bad filename: "${filename}" for ${item.id}`);
      }
    }
  }

  // Stories / highlights replay
  const { storyItems, highlightTitles } = extractStoryItems(harPath);
  for (const it of storyItems) {
    const isHl = !!it._highlightTitle;
    const item = InstagramNormalizer.normalizeStory(
      it,
      isHl ? 'highlights' : 'stories',
      it._highlightTitle
    );
    if (!item) {
      violations.push(`normalizeStory returned null for ${it.id}`);
      continue;
    }
    totalItems++;
    const ctx = { targetName: 'matiasvazquezok' };
    const archivePath = InstagramPlugin.getArchivePath(item, ctx);
    archivePaths.push({ path: archivePath });
    if (!archivePath || !/\.[a-z0-9]+$/i.test(archivePath)) {
      violations.push(`bad story archive path: "${archivePath}"`);
    }
    if (highlightTitles.size && isHl && !archivePath.includes('highlights/')) {
      violations.push(`highlight item not in highlights/ dir: ${archivePath}`);
    }
  }
}

const { collisions, duplicatePaths } = auditFilenameCollisions(archivePaths);

console.log('nodes:', totalNodes, '| items produced:', totalItems, '| throw nodes:', throwNodes, '| zero-yield nodes:', zeroYieldNodes.length);
console.log('sourceTypes:', JSON.stringify(sourceTypes));
console.log('extensions:', JSON.stringify(extensions));
console.log('signed urls kept:', signedChecked.kept, '| mutated:', signedChecked.mutated);
console.log('filename collisions:', collisions.size);
if (collisions.size) {
  for (const [p, c] of [...collisions.entries()].slice(0, 10)) console.log('  DUP', c, 'x', p);
}
if (zeroYieldNodes.length) {
  const z = zeroYieldNodes[0];
  console.log('zero-yield sample:', JSON.stringify({ id: z.id, media_type: z.media_type, keys: Object.keys(z).slice(0, 12) }));
}
console.log(violations.length ? `\nVIOLATIONS (${violations.length}):` : '\nNO VIOLATIONS');
for (const v of violations.slice(0, 25)) console.log(' -', v);
