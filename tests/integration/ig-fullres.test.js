/**
 * Social Media Downloader — Instagram Maximum Resolution Extraction Tests
 * Validates that candidate sorting and media normalization always pick the highest
 * resolution asset (by pixel area, width, and uncropped priority) across all post types:
 * single images, multi-item carousels, videos, stories, and real HAR captures.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { InstagramNormalizer } from '../../src/plugins/instagram/InstagramNormalizer.js';
import { extractTimelineNodes, extractStoryItems } from '../../tools/har-replay.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HAR_FILES = [
  path.join(rootDir, 'tests/fixtures/har/instagram/example-profile.har'),
  path.join(rootDir, 'fixtures-private/instagram-profile.har'),
  path.join(rootDir, 'fixtures-private/instagram-profile-v2.har')
].filter((p) => fs.existsSync(p));

export function runIgFullResTests() {
  // 1. Candidate sorting by pixel area (width * height)
  {
    const candidates = [
      { url: 'https://cdn.example.com/thumb_150x150.jpg', width: 150, height: 150 },
      { url: 'https://cdn.example.com/square_1080x1080.jpg', width: 1080, height: 1080 },
      { url: 'https://cdn.example.com/portrait_1080x1350.jpg', width: 1080, height: 1350 },
      { url: 'https://cdn.example.com/medium_640x640.jpg', width: 640, height: 640 }
    ];
    const sorted = InstagramNormalizer.sortCandidates(candidates);
    assert.equal(sorted[0].url, 'https://cdn.example.com/portrait_1080x1350.jpg', 'Largest pixel area must rank first');
    assert.equal(sorted[0].width, 1080);
    assert.equal(sorted[0].height, 1350);
  }

  // 2. Uncropped URL preference when dimensions match
  {
    const croppedUrl = 'https://cdn.example.com/img.jpg?stp=c0.108.864.864a_dst-jpg_e35';
    const uncroppedUrl = 'https://cdn.example.com/img.jpg?stp=dst-jpg_e35';
    const candidates = [
      { url: croppedUrl, width: 864, height: 864 },
      { url: uncroppedUrl, width: 864, height: 864 }
    ];
    const sorted = InstagramNormalizer.sortCandidates(candidates);
    assert.equal(sorted[0].url, uncroppedUrl, 'Uncropped candidate must rank above cropped variant');
  }

  // 3. Single image post normalization selects maximum candidate
  {
    const singleNode = {
      id: '123456789',
      code: 'CXyz123',
      media_type: 1,
      image_versions2: {
        candidates: [
          { url: 'https://cdn.example.com/320.jpg', width: 320, height: 320 },
          { url: 'https://cdn.example.com/1080.jpg', width: 1080, height: 1350 },
          { url: 'https://cdn.example.com/640.jpg', width: 640, height: 800 }
        ]
      }
    };
    const items = InstagramNormalizer.normalizePost(singleNode);
    assert.equal(items.length, 1);
    assert.equal(items[0].downloadUrl, 'https://cdn.example.com/1080.jpg');
    assert.equal(items[0].width, 1080);
    assert.equal(items[0].height, 1350);
  }

  // 4. Carousel normalization selects max-res candidate per slide
  {
    const carouselNode = {
      id: '987654321',
      code: 'CarouselCode',
      media_type: 8,
      carousel_media: [
        {
          id: 'slide_1',
          media_type: 1,
          image_versions2: {
            candidates: [
              { url: 'https://cdn.example.com/slide1_thumb.jpg', width: 150, height: 150 },
              { url: 'https://cdn.example.com/slide1_full.jpg', width: 1080, height: 1080 }
            ]
          }
        },
        {
          id: 'slide_2',
          media_type: 2,
          video_versions: [
            { url: 'https://cdn.example.com/slide2_480p.mp4', width: 480, height: 854 },
            { url: 'https://cdn.example.com/slide2_1080p.mp4', width: 1080, height: 1920 }
          ],
          image_versions2: {
            candidates: [
              { url: 'https://cdn.example.com/slide2_cover.jpg', width: 1080, height: 1920 }
            ]
          }
        }
      ]
    };
    const items = InstagramNormalizer.normalizePost(carouselNode);
    assert.equal(items.length, 2);
    assert.equal(items[0].downloadUrl, 'https://cdn.example.com/slide1_full.jpg');
    assert.equal(items[0].width, 1080);
    assert.equal(items[0].height, 1080);

    assert.equal(items[1].downloadUrl, 'https://cdn.example.com/slide2_1080p.mp4');
    assert.equal(items[1].width, 1080);
    assert.equal(items[1].height, 1920);
    assert.equal(items[1].type, 'video');
  }

  // 5. Story / Highlight normalization picks highest candidate
  {
    const storyItem = {
      id: 'story_999',
      image_versions2: {
        candidates: [
          { url: 'https://cdn.example.com/story_low.jpg', width: 360, height: 640 },
          { url: 'https://cdn.example.com/story_max.jpg', width: 1080, height: 1920 }
        ]
      }
    };
    const item = InstagramNormalizer.normalizeStory(storyItem);
    assert.ok(item !== null, 'Normalized story item must not be null');
    assert.equal(item.downloadUrl, 'https://cdn.example.com/story_max.jpg');
    assert.equal(item.width, 1080);
    assert.equal(item.height, 1920);
  }

  // 6. HAR Replay Validation across captured fixtures
  for (const harPath of HAR_FILES) {
    const { nodes } = extractTimelineNodes(harPath);
    const { storyItems } = extractStoryItems(harPath);

    for (const node of nodes) {
      const items = InstagramNormalizer.normalizePost(node);
      assert.ok(items.length > 0, `Node ${node.id} must yield at least one normalized item`);

      // Verify that for each item, the selected URL matches the max candidate available
      if (node.carousel_media && node.carousel_media.length > 0) {
        node.carousel_media.forEach((cItem, idx) => {
          const item = items[idx];
          if (!item) return;
          if (cItem.image_versions2?.candidates?.length > 0) {
            const expectedMax = InstagramNormalizer.sortCandidates(cItem.image_versions2.candidates)[0];
            if (item.type === 'image') {
              assert.equal(item.downloadUrl, expectedMax.url, `Carousel item ${item.id} must use max image candidate`);
            }
          }
        });
      } else if (node.image_versions2?.candidates?.length > 0 && items[0].type === 'image') {
        const expectedMax = InstagramNormalizer.sortCandidates(node.image_versions2.candidates)[0];
        assert.equal(items[0].downloadUrl, expectedMax.url, `Single post ${node.id} must use max image candidate`);
      }
    }

    for (const story of storyItems) {
      const item = InstagramNormalizer.normalizeStory(story);
      if (item && story.image_versions2?.candidates?.length > 0 && item.type === 'image') {
        const expectedMax = InstagramNormalizer.sortCandidates(story.image_versions2.candidates)[0];
        assert.equal(item.downloadUrl, expectedMax.url, `Story ${story.id} must use max image candidate`);
      }
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log('Running Instagram full resolution tests...');
  runIgFullResTests();
  console.log('✔ Instagram full resolution tests passed.');
}
