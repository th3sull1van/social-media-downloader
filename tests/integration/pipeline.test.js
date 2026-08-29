/**
 * Social Media Downloader — Integration Pipeline Tests
 * Tests detection, normalization, naming, and artifact resolution across all platforms.
 */
import assert from 'node:assert';
import { InstagramPlugin } from '../../src/plugins/instagram/InstagramPlugin.js';
import { FacebookPlugin } from '../../src/plugins/facebook/FacebookPlugin.js';
import { RedditPlugin } from '../../src/plugins/reddit/RedditPlugin.js';
import { InstagramNormalizer } from '../../src/plugins/instagram/InstagramNormalizer.js';
import { FacebookNormalizer } from '../../src/plugins/facebook/FacebookNormalizer.js';
import { RedditNormalizer } from '../../src/plugins/reddit/RedditNormalizer.js';
import { MetaCdn } from '../../src/plugins/meta-shared/MetaCdn.js';

export async function runPipelineTests() {
  // 1. Instagram Pipeline
  const igRawCarousel = {
    id: '3000000000123',
    code: 'CpAbCdEfGh',
    media_type: 8,
    taken_at: 1690000000,
    caption: { text: 'Testing Instagram carousel pipeline' },
    carousel_media: [
      {
        media_type: 1,
        image_versions2: {
          candidates: [
            { url: 'https://instagram.fpoa1-1.fna.fbcdn.net/v/t51.2885-15/s150x150/111_n.jpg?stp=dst-jpg_s150x150_tt6', width: 150, height: 150 },
            { url: 'https://instagram.fpoa1-1.fna.fbcdn.net/v/t51.2885-15/111_n.jpg', width: 1080, height: 1080 }
          ]
        }
      },
      {
        media_type: 2,
        video_versions: [
          { url: 'https://instagram.fpoa1-1.fna.fbcdn.net/v/t50.2886-16/222_n.mp4', width: 1080, height: 1920 }
        ]
      }
    ]
  };

  const igItems = InstagramNormalizer.normalizePost(igRawCarousel);
  assert.strictEqual(igItems.length, 2);
  assert.strictEqual(igItems[0].type, 'image');
  assert.strictEqual(igItems[0].metadata.slideIndex, 1);
  assert.ok(!igItems[0].url.includes('s150x150')); // Verifies CDN upscaler
  assert.strictEqual(igItems[1].type, 'video');
  assert.strictEqual(igItems[1].metadata.slideIndex, 2);

  const igFilename = InstagramPlugin.getFilename(igItems[0], { targetName: 'test_influencer' });
  assert.strictEqual(igFilename, 'SMD/Instagram/test_influencer/posts/111_n.jpg');

  // 2. Facebook Pipeline
  const fbRawPhoto = {
    node: {
      __typename: 'Photo',
      id: '998877665544',
      viewer_image: {
        uri: 'https://scontent.fpoa1-1.fna.fbcdn.net/v/t39.30808-6/s206x206/333_n.jpg?stp=dst-jpg_s206x206_tt6',
        width: 206,
        height: 206
      }
    }
  };

  const fbItem = FacebookNormalizer.normalizePhoto(fbRawPhoto);
  assert.ok(fbItem);
  assert.strictEqual(fbItem.id, '998877665544');
  assert.strictEqual(fbItem.platform, 'facebook');
  assert.ok(!fbItem.url.includes('/s206x206/')); // Verifies CDN upscaler

  const fbFilename = FacebookPlugin.getFilename(fbItem, { targetName: 'Vacation_Album' });
  // Authentic CDN basename kept; photo-id fallback only when the basename does not
  // match the classic numeric `_n` convention (see FacebookNaming.AUTHENTIC_BASENAME_PATTERN).
  assert.strictEqual(fbFilename, 'SMD/Facebook/Vacation_Album/333_n.jpg');

  // 3. Reddit Pipeline (Preview cleanup & deduplication)
  const redditItems = [
    RedditNormalizer.normalizeItem({
      id: 'img1',
      url: 'https://preview.redd.it/example-v0-jbx4ht0eptkh1.jpg?width=1080&crop=smart&auto=webp&s=abcdef',
      type: 'image'
    }, { id: 'post_1', title: 'First post', subreddit: 'pics', score: 100 }),
    RedditNormalizer.normalizeItem({
      id: 'img1',
      url: 'https://preview.redd.it/example-v0-jbx4ht0eptkh1.jpg?width=640&crop=smart&auto=webp&s=xyz',
      type: 'image'
    }, { id: 'post_2', title: 'Crosspost', subreddit: 'aww', score: 500 })
  ];

  assert.strictEqual(redditItems[0].url, 'https://i.redd.it/jbx4ht0eptkh1.jpg'); // Verifies clean uncompressed URL

  const dedupResult = RedditNormalizer.deduplicateMediaItems(redditItems, { keepHighestScore: true });
  assert.strictEqual(dedupResult.uniqueItems.length, 1);
  assert.strictEqual(dedupResult.duplicatesCount, 1);
  assert.strictEqual(dedupResult.uniqueItems[0].metadata.score, 500); // Kept the higher score post

  const redditFilename = RedditPlugin.getFilename(dedupResult.uniqueItems[0]);
  assert.ok(redditFilename.startsWith('SMD/Reddit/u_user/r_aww/'));
  assert.ok(redditFilename.includes('jbx4ht0eptkh1.jpg'));
}
