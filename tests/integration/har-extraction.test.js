/**
 * Social Media Downloader — HAR Fixture Extraction Integration Tests
 * Validates the compact, sanitized Instagram projections generated from HARs.
 */
import path from 'node:path';
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import { InstagramNormalizer } from '../../src/plugins/instagram/InstagramNormalizer.js';
import { InstagramNaming } from '../../src/plugins/instagram/InstagramNaming.js';
import { loadPlatformFixtures } from '../../tools/fixture-replay.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

export function runHarExtractionTests() {
  const fixtures = loadPlatformFixtures(rootDir, 'instagram');
  assert.ok(fixtures.length > 0, 'Expected compact Instagram fixtures');

  for (const fixture of fixtures) {

    let totalGqlPosts = 0;
    let totalNormalizedItems = 0;
    const filenames = new Set();

    for (const node of fixture.nodes || []) {
      totalGqlPosts++;
      const items = InstagramNormalizer.normalizePost(node);
      for (const it of items) {
        totalNormalizedItems++;
        const fname = InstagramNaming.getOriginalFilename(it);
        filenames.add(fname);
        assert.ok(
          /\.(jpg|jpeg|png|webp|heic|mp4|webm)$/i.test(fname),
          `Filename ${fname} is missing a valid media extension`
        );
      }
    }
    for (const story of fixture.storyItems || []) {
      const item = InstagramNormalizer.normalizeStory(
        story,
        story._highlightTitle ? 'highlights' : 'stories',
        story._highlightTitle || null
      );
      if (item) {
        totalNormalizedItems++;
        const fname = InstagramNaming.getOriginalFilename(item);
        filenames.add(fname);
        assert.ok(/\.(jpg|jpeg|png|webp|heic|mp4|webm)$/i.test(fname));
      }
    }

    assert.ok(totalGqlPosts > 0, `Expected fixture ${fixture.sourceCaptureId} to contain GraphQL posts`);
    assert.ok(totalNormalizedItems >= totalGqlPosts, `Expected normalized items >= post nodes for ${fixture.sourceCaptureId}`);
    assert.ok(filenames.size > 0, `Expected filenames for ${fixture.sourceCaptureId}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log('Running compact Instagram fixture extraction tests...');
  runHarExtractionTests();
  console.log('✔ compact Instagram fixture extraction tests passed successfully.');
}
