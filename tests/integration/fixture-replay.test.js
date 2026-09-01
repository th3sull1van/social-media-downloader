/**
 * Compact Instagram fixture replay tests.
 *
 * This is the default offline regression path.  It executes the real
 * normalizer, archive naming and classic content-script VM against sanitized
 * projections instead of loading the source HARs.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { InstagramNormalizer } from '../../src/plugins/instagram/InstagramNormalizer.js';
import { InstagramPlugin } from '../../src/plugins/instagram/InstagramPlugin.js';
import { MediaItemModel } from '../../src/core/domain/MediaItem.js';
import { auditFilenameCollisions } from '../../tools/har-replay.js';
import { discoverPlatformFixtures, readCompactFixture } from '../../tools/fixture-replay.js';
import { replayContentFixture } from '../../tools/replay-content.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export async function runCompactInstagramReplayTests() {
  const fixtureFiles = discoverPlatformFixtures(rootDir, 'instagram');
  assert.ok(fixtureFiles.length > 0, 'Compact Instagram fixtures must be present');

  let totalNodes = 0;
  let totalItems = 0;
  let throwCount = 0;
  let zeroYield = 0;
  let signedKept = 0;
  let signedMutated = 0;
  /** @type {string[]} */
  const violations = [];

  for (const fixturePath of fixtureFiles) {
    const fixture = readCompactFixture(fixturePath);
    let fixtureItems = 0;
    /** @type {Array<{ path: string }>} */
    const archivePaths = [];

    for (const node of fixture.nodes || []) {
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
        fixtureItems++;
        if (!MediaItemModel.isValid(item)) violations.push(`invalid MediaItem ${item.id}`);
        if (!item.downloadUrl || !/^https:\/\/[a-z0-9.-]*(instagram\.com|cdninstagram\.com|fbcdn\.net)/i.test(item.downloadUrl)) {
          violations.push(`bad host on ${item.id}`);
        }
        const rawCandidates = [
          ...(node.image_versions2?.candidates || []).map((candidate) => candidate.url),
          ...(node.video_versions || []).map((video) => video.url),
          ...(node.carousel_media || []).flatMap((carousel) => [
            ...(carousel.image_versions2?.candidates || []).map((candidate) => candidate.url),
            ...(carousel.video_versions || []).map((video) => video.url)
          ])
        ];
        const rawMatch = rawCandidates.find((url) => url === item.downloadUrl);
        if (rawMatch) {
          try {
            const parsed = new URL(rawMatch);
            if (parsed.searchParams.has('oh') || parsed.searchParams.has('_nc_ohc') || parsed.searchParams.has('_nc_sid')) signedKept++;
          } catch { /* fixture URL is checked separately */ }
        } else {
          for (const raw of rawCandidates) {
            try {
              const parsed = new URL(raw);
              const signed = parsed.searchParams.has('oh') || parsed.searchParams.has('_nc_ohc') || parsed.searchParams.has('_nc_sid');
              if (signed && item.downloadUrl.split('?')[0] === raw.split('?')[0]) {
                signedMutated++;
                violations.push(`signed URL mutated for ${item.id}`);
              }
            } catch { /* ignore malformed optional candidate */ }
          }
        }
        const archivePath = InstagramPlugin.getArchivePath(item, { targetName: 'fixture_replay' });
        if (!archivePath || !/\.[a-z0-9]+$/i.test(archivePath)) violations.push(`bad archive path: ${archivePath}`);
        if (archivePath.includes('..')) violations.push(`traversal in archive path: ${archivePath}`);
        archivePaths.push({ path: archivePath });
      }
    }

    for (const story of fixture.storyItems || []) {
      const item = InstagramNormalizer.normalizeStory(story, story._highlightTitle ? 'highlights' : 'stories', story._highlightTitle);
      if (!item) {
        violations.push(`normalizeStory null for ${story.id}`);
        continue;
      }
      totalItems++;
      fixtureItems++;
      const archivePath = InstagramPlugin.getArchivePath(item, { targetName: 'fixture_replay' });
      if (!archivePath || !/\.[a-z0-9]+$/i.test(archivePath)) violations.push(`bad story path: ${archivePath}`);
      archivePaths.push({ path: archivePath });
    }

    assert.ok(fixtureItems > 0, `fixture ${fixture.sourceCaptureId} must yield media items`);

    const captureById = new Map();
    for (const node of fixture.nodes || []) {
      for (const item of InstagramNormalizer.normalizePost(node)) captureById.set(item.id, item);
    }
    for (const story of fixture.storyItems || []) {
      const item = InstagramNormalizer.normalizeStory(story, story._highlightTitle ? 'highlights' : 'stories', story._highlightTitle);
      if (item && !captureById.has(item.id)) captureById.set(item.id, item);
    }
    const capturePaths = [...captureById.values()].map((item) => ({
      path: InstagramPlugin.getArchivePath(item, { targetName: 'fixture_replay' })
    }));
    const { duplicatePaths } = auditFilenameCollisions(capturePaths);
    assert.equal(duplicatePaths.length, 0, `filename collisions in ${fixture.sourceCaptureId}`);

    const result = await replayContentFixture(fixturePath);
    assert.ok(result.spoofRejected, `spoofed batch must be rejected for ${fixture.sourceCaptureId}`);
    assert.equal(result.contentItems.length, result.canonicalCount, `content parity count failed for ${fixture.sourceCaptureId}`);
    assert.equal(result.missingInContent.length, 0, `missing content ids for ${fixture.sourceCaptureId}`);
    assert.equal(result.extraInContent.length, 0, `extra content ids for ${fixture.sourceCaptureId}`);
    assert.equal(result.fieldMismatches.length, 0, `content field mismatch for ${fixture.sourceCaptureId}`);
  }

  assert.ok(totalNodes > 0, 'compact replay must exercise captured nodes');
  assert.equal(throwCount, 0, `normalizer threw on ${throwCount} compact nodes`);
  assert.equal(zeroYield, 0, `${zeroYield} compact nodes produced zero items`);
  assert.equal(signedMutated, 0, 'signed URLs must never be mutated');
  assert.ok(signedKept > 0, 'expected signed URLs in compact fixtures to verify preservation');
  assert.equal(violations.length, 0, violations.slice(0, 5).join(' | '));
  assert.ok(totalItems > 0, 'compact replay must produce media items');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log('Running compact Instagram replay tests...');
  runCompactInstagramReplayTests()
    .then(() => console.log('✔ compact Instagram replay tests passed.'))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
