/**
 * Social Media Downloader — HAR Replay Regression Tests
 * Runs the REAL content script (src/content/content.js) in a Node vm with a stubbed DOM
 * and replays captured Instagram GraphQL traffic through the real postMessage bridge.
 * Verifies: nonce-gated ingestion, spoof rejection, and field-level parity between the
 * content script's normalized items and the canonical plugin pipeline.
 *
 * Fixtures are private (fixtures-private/, gitignored). The suite skips gracefully
 * when captures are absent so CI without fixtures stays green.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import { extractTimelineNodes, extractStoryItems, auditFilenameCollisions } from '../../tools/har-replay.js';
import { InstagramNormalizer } from '../../src/plugins/instagram/InstagramNormalizer.js';
import { InstagramPlugin } from '../../src/plugins/instagram/InstagramPlugin.js';
import { MediaItemModel } from '../../src/core/domain/MediaItem.js';
import { replayContentScript } from '../../tools/replay-content.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

const HAR_FILES = [
  path.join(rootDir, 'tests/fixtures/har/instagram/example-profile.har'),
  path.join(rootDir, 'fixtures-private/instagram-profile-v2.har'),
  path.join(rootDir, 'fixtures-private/instagram-profile.har')
];

const availableHars = HAR_FILES.filter((p) => fs.existsSync(p));

export async function runHarReplayTests() {
  // Canonical replay always runs (it doubles as the guard for the private-fixture contract).
  let totalNodes = 0;
  let totalItems = 0;
  let throwCount = 0;
  let zeroYield = 0;
  let signedKept = 0;
  let signedMutated = 0;
  /** @type {string[]} */
  const violations = [];
  /** @type {Array<{ path: string }>} */
  const archivePaths = [];

  for (const harPath of availableHars) {
    const { nodes } = extractTimelineNodes(harPath);
    const { storyItems } = extractStoryItems(harPath);

    for (const node of nodes) {
      totalNodes++;
      let items;
      try {
        items = InstagramNormalizer.normalizePost(node);
      } catch (err) {
        throwCount++;
        violations.push(`normalizePost threw for ${node.id}: ${err.message}`);
        continue;
      }
      if (!items.length) {
        zeroYield++;
        continue;
      }
      for (const item of items) {
        totalItems++;
        if (!MediaItemModel.isValid(item)) violations.push(`invalid MediaItem ${item.id}`);
        if (!item.downloadUrl || !/^https:\/\/[a-z0-9.-]*(instagram\.com|cdninstagram\.com|fbcdn\.net)/i.test(item.downloadUrl)) {
          violations.push(`bad host on ${item.id}`);
        }
        const rawCandidates = [
          ...(node.image_versions2?.candidates || []).map((c) => c.url),
          ...(node.video_versions || []).map((v) => v.url),
          ...(node.carousel_media || []).flatMap((c) => [
            ...(c.image_versions2?.candidates || []).map((x) => x.url),
            ...(c.video_versions || []).map((v) => v.url)
          ])
        ];
        const rawMatch = rawCandidates.find((u) => u === item.downloadUrl);
        if (rawMatch) {
          try {
            const p = new URL(rawMatch);
            if (p.searchParams.has('oh') || p.searchParams.has('_nc_ohc') || p.searchParams.has('_nc_sid')) {
              signedKept++;
            }
          } catch { /* ignore */ }
        } else {
          // URL was rewritten by the CDN upscaler; ensure it did not mutate a signed URL
          // (a mutated signed URL would 403). Only unsigned URLs may be rewritten.
          for (const raw of rawCandidates) {
            try {
              const p = new URL(raw);
              const signed = p.searchParams.has('oh') || p.searchParams.has('_nc_ohc') || p.searchParams.has('_nc_sid');
              if (signed && (item.downloadUrl.split('?')[0] === raw.split('?')[0])) {
                signedMutated++;
                violations.push(`signed URL mutated for ${item.id}`);
              }
            } catch { /* ignore */ }
          }
        }
        const archivePath = InstagramPlugin.getArchivePath(item, { targetName: 'har_replay' });
        if (!archivePath || !/\.[a-z0-9]+$/i.test(archivePath)) violations.push(`bad archive path: ${archivePath}`);
        if (archivePath.includes('..')) violations.push(`traversal in archive path: ${archivePath}`);
        archivePaths.push({ path: archivePath });
      }
    }

    for (const it of storyItems) {
      const item = InstagramNormalizer.normalizeStory(it, it._highlightTitle ? 'highlights' : 'stories', it._highlightTitle);
      if (!item) {
        violations.push(`normalizeStory null for ${it.id}`);
        continue;
      }
      totalItems++;
      const archivePath = InstagramPlugin.getArchivePath(item, { targetName: 'har_replay' });
      if (!archivePath || !/\.[a-z0-9]+$/i.test(archivePath)) violations.push(`bad story path: ${archivePath}`);
      archivePaths.push({ path: archivePath });
    }

    // Per-capture filename collision audit (real ZIP overwrite check).
    // Mirrors runtime behavior: state.media dedups by item id BEFORE download, so
    // pagination overlap inside one capture (same node twice) must be collapsed first.
    const captureById = new Map();
    for (const node of nodes) {
      for (const item of InstagramNormalizer.normalizePost(node)) {
        captureById.set(item.id, item);
      }
    }
    for (const it of storyItems) {
      const item = InstagramNormalizer.normalizeStory(it, it._highlightTitle ? 'highlights' : 'stories', it._highlightTitle);
      if (item && !captureById.has(item.id)) captureById.set(item.id, item);
    }
    const capturePaths = [...captureById.values()].map(
      (item) => ({ path: InstagramPlugin.getArchivePath(item, { targetName: 'har_replay' }) })
    );
    const { duplicatePaths } = auditFilenameCollisions(capturePaths);
    if (duplicatePaths.length > 0) {
      violations.push(`${duplicatePaths.length} filename collisions inside ${path.basename(harPath)}`);
    }
  }

  // Content-script parity replay (uses the same fixtures via the vm harness)
  for (const harPath of availableHars) {
    const result = await replayContentScript(harPath);

    assert.ok(result.spoofRejected, `spoofed batch (no nonce) must be rejected for ${path.basename(harPath)}`);
    assert.strictEqual(
      result.contentItems.length, result.canonicalCount,
      `content script must produce exactly the canonical item set for ${path.basename(harPath)}`
    );
    assert.strictEqual(result.missingInContent.length, 0, `missing ids in content script for ${path.basename(harPath)}: ${result.missingInContent.slice(0, 3)}`);
    assert.strictEqual(result.extraInContent.length, 0, `extra ids in content script for ${path.basename(harPath)}: ${result.extraInContent.slice(0, 3)}`);
    assert.strictEqual(result.fieldMismatches.length, 0, `field mismatches for ${path.basename(harPath)}: ${result.fieldMismatches.slice(0, 3)}`);
  }

  // Summary assertions (also guard the fixtures stay present)
  assert.ok(totalNodes > 0, 'HAR replay must exercise captured nodes; fixtures-private missing?');
  assert.strictEqual(throwCount, 0, `normalizer threw on ${throwCount} captured nodes`);
  assert.strictEqual(zeroYield, 0, `${zeroYield} captured nodes produced zero items`);
  assert.strictEqual(signedMutated, 0, 'signed URLs must never be mutated');
  assert.ok(signedKept > 0, 'expected signed URLs in fixtures to verify signature preservation');
  assert.strictEqual(violations.length, 0, violations.slice(0, 5).join(' | '));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log('Running HAR replay tests...');
  runHarReplayTests()
    .then(() => console.log('✔ HAR replay tests passed.'))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
