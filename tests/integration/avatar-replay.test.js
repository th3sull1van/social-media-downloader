/**
 * Target avatar replay tests for the real classic content script.
 * Facebook and Reddit use different transport paths and must both populate
 * the target avatar state instead of falling back to the extension icon.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { extractFacebookData } from '../../tools/har-replay.js';
import { replayTargetAvatarContentScript } from '../../tools/replay-content.js';

function findFacebookProfilePictureOwner(root, depth = 0) {
  if (!root || typeof root !== 'object' || depth > 40) return null;
  if (Array.isArray(root)) {
    for (const value of root) {
      const owner = findFacebookProfilePictureOwner(value, depth + 1);
      if (owner) return owner;
    }
    return null;
  }
  const profile = root.profile_picture;
  if (profile?.uri) return root;
  for (const value of Object.values(root)) {
    const owner = findFacebookProfilePictureOwner(value, depth + 1);
    if (owner) return owner;
  }
  return null;
}

export async function runAvatarReplayTests() {
  const facebookHar = path.resolve('fixtures-private/facebook-profile.har');
  let facebookOwner = null;
  if (fs.existsSync(facebookHar)) {
    const { graphqlBodies } = extractFacebookData(facebookHar);
    for (const body of graphqlBodies) {
      facebookOwner = findFacebookProfilePictureOwner(body);
      if (facebookOwner) break;
    }
  }
  const facebookAvatar = facebookOwner?.profile_picture?.uri
    || 'https://scontent.example.fbcdn.net/v/t39.30808-1/profile.jpg?cstp=mx1080x1080&ctp=s200x200';
  const facebookTargetUrl = facebookOwner?.url || 'https://www.facebook.com/target-page';
  const facebookTarget = new URL(facebookTargetUrl);
  const facebook = await replayTargetAvatarContentScript({
    platform: 'facebook',
    location: {
      hostname: facebookTarget.hostname,
      pathname: facebookTarget.pathname,
      origin: facebookTarget.origin,
      href: facebookTarget.href
    },
    facebookPayload: facebookOwner || {
      id: '123456789',
      name: 'Target Page',
      url: facebookTargetUrl,
      profile_picture: { uri: facebookAvatar, width: 200, height: 200 }
    }
  });
  assert.strictEqual(
    new URL(facebook.avatarUrl).pathname,
    new URL(facebookAvatar).pathname,
    'Facebook profile_picture.uri must reach content state'
  );

  // 2. Private-profile header shape captured on 2026-08-31: Facebook does
  // not expose the target image as `profile_picture`; it sends
  // `profilePicLarge` plus `cover_photo.photo.image`. Both must become
  // downloadable items, while the facepile friend must remain excluded.
  const privateHeaderFixture = JSON.parse(fs.readFileSync(
    path.resolve('tests/fixtures/facebook/private-profile-header.json'),
    'utf8'
  ));
  const privateHeaderUser = privateHeaderFixture.data.user.profile_header_renderer.user;
  const privateHeader = await replayTargetAvatarContentScript({
    platform: 'facebook',
    location: {
      hostname: 'www.facebook.com',
      pathname: '/example.private.user/photos',
      origin: 'https://www.facebook.com',
      href: 'https://www.facebook.com/example.private.user/photos'
    },
    facebookPayloads: [
      // Simulate a generic Photo node arriving before the profile header. The
      // dedicated header item must win and retain its category.
      { data: { node: { id: '425404418603025', image: privateHeaderUser.cover_photo.photo.image } } },
      privateHeaderFixture
    ]
  });
  const profileItem = privateHeader.media.find((item) => item.category === 'facebook_profile_picture');
  const coverItem = privateHeader.media.find((item) => item.category === 'facebook_cover_photo');
  assert.ok(profileItem, 'private Facebook profile header must yield a profile-picture download item');
  assert.ok(coverItem, 'private Facebook profile header must yield a cover-photo download item');
  assert.ok(profileItem.downloadUrl.includes('ctp=s1080x1080'), 'profilePicLarge must use the signed max render');
  assert.strictEqual(privateHeader.avatarUrl, profileItem.downloadUrl, 'header preview and profile download must use the same URL');
  assert.strictEqual(privateHeader.media.some((item) => item.id === '100000000000002'), false, 'friend facepile avatar must not leak into downloads');

  let redditAvatar = 'https://www.redditstatic.com/avatars/defaults/v2/avatar_default_3.png';
  const redditHar = path.resolve('fixtures-private/reddit-private-profile.har');
  if (fs.existsSync(redditHar)) {
    const har = JSON.parse(fs.readFileSync(redditHar, 'utf8'));
    const about = har.log.entries.find((entry) => String(entry.request?.url || '').includes('/about.json'));
    const aboutJson = about ? JSON.parse(about.response.content.text) : null;
    redditAvatar = aboutJson?.data?.icon_img || aboutJson?.data?.snoovatar_img || redditAvatar;
  }
  const reddit = await replayTargetAvatarContentScript({
    platform: 'reddit',
    location: {
      hostname: 'www.reddit.com',
      pathname: '/user/target_user/',
      origin: 'https://www.reddit.com',
      href: 'https://www.reddit.com/user/target_user/'
    },
    redditAvatarUrl: redditAvatar
  });
  assert.strictEqual(reddit.avatarUrl, redditAvatar, 'Reddit about avatar must reach content state');
  assert.ok(reddit.messages.some((message) => message.type === 'REDDIT_FETCH_AVATAR'));
}

if (process.argv[1]?.endsWith('avatar-replay.test.js')) {
  runAvatarReplayTests()
    .then(() => console.log('✔ target avatar replay tests passed.'))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
