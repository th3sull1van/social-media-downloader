/**
 * Social Media Downloader — Domain Unit Tests
 */
import assert from 'node:assert';
import { MediaItemModel } from '../../src/core/domain/MediaItem.js';
import { PlatformTargetModel } from '../../src/core/domain/PlatformTarget.js';
import { ScanResultModel } from '../../src/core/domain/ScanResult.js';
import { DownloadArtifactModel } from '../../src/core/domain/DownloadArtifact.js';
import { DownloadJobModel } from '../../src/core/domain/DownloadJob.js';
import { CapabilitiesModel } from '../../src/core/domain/Capabilities.js';
import { AppError, RateLimitedError, AuthenticationRequiredError } from '../../src/core/domain/Errors.js';

export async function runDomainTests() {
  // 1. MediaItemModel
  const item = MediaItemModel.create({
    id: 'post_123',
    platform: 'instagram',
    type: 'image',
    sourceType: 'photo_post',
    url: 'https://example.com/photo.jpg',
    width: 1080,
    height: 1080
  });

  assert.strictEqual(item.id, 'post_123');
  assert.strictEqual(item.platform, 'instagram');
  assert.strictEqual(item.type, 'image');
  assert.strictEqual(item.extension, 'jpg');
  assert.strictEqual(MediaItemModel.isValid(item), true);

  // Invalid item should throw
  assert.throws(() => MediaItemModel.create(/** @type {any} */ ({ id: '' })), TypeError);

  // 2. PlatformTargetModel
  const target = PlatformTargetModel.create({
    platform: 'reddit',
    type: 'subreddit',
    name: 'r/javascript'
  });
  assert.strictEqual(target.platform, 'reddit');
  assert.strictEqual(target.type, 'subreddit');
  assert.strictEqual(PlatformTargetModel.formatDisplayName(target), 'r/javascript');

  // 3. ScanResultModel
  const scanResult = ScanResultModel.create({
    platform: 'instagram',
    target,
    items: [item],
    hasMore: true
  });
  assert.strictEqual(scanResult.status, 'success');
  assert.strictEqual(scanResult.items.length, 1);
  assert.strictEqual(scanResult.hasMore, true);

  const emptyScan = ScanResultModel.create({
    platform: 'instagram',
    target,
    items: []
  });
  assert.strictEqual(emptyScan.status, 'empty');

  // 4. DownloadArtifactModel
  const directArtifact = DownloadArtifactModel.direct('https://example.com/file.mp4', 'SMD/file.mp4');
  assert.strictEqual(directArtifact.kind, 'direct');
  assert.strictEqual(directArtifact.output.filename, 'SMD/file.mp4');

  const genArtifact = DownloadArtifactModel.generated(new Uint8Array([1, 2, 3]), 'test.bin');
  assert.strictEqual(genArtifact.kind, 'generated');

  // 5. DownloadJobModel
  const job = DownloadJobModel.create({
    platform: 'reddit',
    targetName: 'r_pics',
    total: 10,
    format: 'zip'
  });
  assert.strictEqual(job.format, 'zip');
  assert.strictEqual(job.total, 10);
  assert.strictEqual(job.status, 'QUEUED');
  assert.strictEqual(DownloadJobModel.isActive(job), true);

  // 6. CapabilitiesModel
  const caps = CapabilitiesModel.merge({
    scan: { profile: true },
    media: { video: true }
  });
  assert.strictEqual(caps.scan.profile, true);
  assert.strictEqual(caps.scan.page, false);
  assert.strictEqual(caps.media.video, true);
  assert.strictEqual(caps.media.image, true);

  // 7. Errors
  const rateLimitErr = new RateLimitedError('reddit', '60s');
  assert.strictEqual(rateLimitErr.code, 'RATE_LIMITED');
  assert.ok(rateLimitErr instanceof AppError);

  const authErr = new AuthenticationRequiredError('instagram');
  assert.strictEqual(authErr.code, 'AUTHENTICATION_REQUIRED');
}
