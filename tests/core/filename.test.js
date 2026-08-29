/**
 * Social Media Downloader — Filename & Path Service Unit Tests
 */
import assert from 'node:assert';
import { FilenameService } from '../../src/core/services/FilenameService.js';

export async function runFilenameTests() {
  // 1. Basic sanitization
  assert.strictEqual(FilenameService.sanitize('my:file*name?.jpg'), 'my_file_name_.jpg');
  assert.strictEqual(FilenameService.sanitize('  hello   world  '), 'hello_world');
  assert.strictEqual(FilenameService.sanitize(''), 'media');
  assert.strictEqual(FilenameService.sanitize(null), 'media');

  // 2. Traversal prevention
  assert.strictEqual(FilenameService.sanitizePath('../../../etc/passwd'), 'etc/passwd');
  assert.strictEqual(FilenameService.sanitizePath('C:\\Windows\\System32\\calc.exe'), 'Windows/System32/calc.exe');
  assert.strictEqual(FilenameService.sanitizePath('Instagram/../Facebook/./photo.jpg'), 'Instagram/Facebook/photo.jpg');

  // 3. DOS reserved names
  assert.strictEqual(FilenameService.sanitize('CON'), '_CON');
  assert.strictEqual(FilenameService.sanitize('aux'), '_aux');

  // 4. Template rendering
  const rendered = FilenameService.render('r_{subreddit}_u_{author}_{id}.{ext}', {
    subreddit: 'funny',
    author: 'john_doe',
    id: 'post_123',
    ext: 'mp4'
  }, 'Reddit/funny');

  assert.strictEqual(rendered, 'Reddit/funny/r_funny_u_john_doe_post_123.mp4');

  // 5. Personal name sanitization (accents, quotes, unicode, zero-width chars)
  assert.strictEqual(FilenameService.sanitize('João da Silva'), 'João_da_Silva');
  assert.strictEqual(FilenameService.sanitize('Maria Cláudia & Cia'), 'Maria_Cláudia_&_Cia');
  assert.strictEqual(FilenameService.sanitize('Robert "Bob" O\'Connor'), "Robert_Bob_O'Connor");
  assert.strictEqual(FilenameService.sanitize('Yuri\u200B Rangel\u202E'), 'Yuri_Rangel');
  assert.strictEqual(FilenameService.sanitize('Алексей Иванов'), 'Алексей_Иванов');
  assert.strictEqual(FilenameService.sanitize('田中 太郎'), '田中_太郎');

  // 6. Timestamp format
  const ts = FilenameService.getTimestamp();
  assert.match(ts, /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/);
}
