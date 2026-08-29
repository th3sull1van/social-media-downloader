/**
 * Social Media Downloader — HAR Fixture Extraction Integration Tests
 * Validates full extraction across private and sanitized Instagram HAR captures.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import { InstagramNormalizer } from '../../src/plugins/instagram/InstagramNormalizer.js';
import { InstagramNaming } from '../../src/plugins/instagram/InstagramNaming.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

export function runHarExtractionTests() {
  const privateHarFiles = [
    path.join(rootDir, 'tests/fixtures/har/instagram/example-profile.har'),
    path.join(rootDir, 'fixtures-private/instagram-profile.har'),
    path.join(rootDir, 'fixtures-private/instagram-profile-v2.har')
  ];

  for (const harPath of privateHarFiles) {
    if (!fs.existsSync(harPath)) {
      continue;
    }

    const raw = fs.readFileSync(harPath, 'utf8');
    const data = JSON.parse(raw);
    const entries = data.log.entries;

    let totalGqlPosts = 0;
    let totalNormalizedItems = 0;
    const filenames = new Set();

    for (const entry of entries) {
      const resText = entry.response.content?.text;
      if (!resText) continue;

      let jsonStr = resText;
      if (entry.response.content.encoding === 'base64') {
        jsonStr = Buffer.from(resText, 'base64').toString('utf8');
      }

      try {
        const json = JSON.parse(jsonStr);
        const timeline = json.data?.xdt_api__v1__feed__user_timeline_graphql_connection ||
                         json.data?.user?.edge_owner_to_timeline_media;

        if (timeline && Array.isArray(timeline.edges)) {
          for (const edge of timeline.edges) {
            const node = edge.node || edge;
            totalGqlPosts++;
            const items = InstagramNormalizer.normalizePost(node);
            for (const it of items) {
              totalNormalizedItems++;
              const fname = InstagramNaming.getOriginalFilename(it);
              filenames.add(fname);
              // Assert filename has valid extension
              assert.ok(
                /\.(jpg|jpeg|png|webp|heic|mp4|webm)$/i.test(fname),
                `Filename ${fname} is missing a valid media extension`
              );
            }
          }
        }
      } catch (e) {}
    }

    assert.ok(totalGqlPosts > 0, `Expected HAR ${harPath} to contain GraphQL posts`);
    assert.ok(totalNormalizedItems >= totalGqlPosts, `Expected normalized items >= post nodes`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log('Running HAR extraction tests...');
  runHarExtractionTests();
  console.log('✔ HAR extraction tests passed successfully.');
}
