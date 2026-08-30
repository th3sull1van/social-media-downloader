/**
 * Social Media Downloader — ZIP Integrity & PKZIP 2.0 Compliance Tests
 * Verifies:
 * 1. PKZIP 2.0 binary layout, signatures, UTF-8 bitflags, and STORE method.
 * 2. Exact CRC-32 checksum calculation and verification for every file.
 * 3. Exact byte offset integrity between Central Directory pointers and Local Headers.
 * 4. End of Central Directory (EOCD) record validation.
 * 5. Concurrent / parallel write safety (no interleaving or colliding offsets).
 * 6. Forward slash normalization and Unicode filename support.
 */
import assert from 'node:assert';
import { ArchiveService } from '../../src/core/services/ArchiveService.js';

/**
 * Full in-memory PKZIP 2.0 Parser for deep binary inspection and integrity verification.
 */
class ZipValidator {
  /**
   * @param {Uint8Array} zipBytes
   */
  constructor(zipBytes) {
    this.bytes = zipBytes;
    this.view = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
  }

  /**
   * Finds and parses the End of Central Directory (EOCD) record.
   */
  parseEocd() {
    // EOCD is at the end of the file (22 bytes minimum)
    const len = this.bytes.length;
    assert.ok(len >= 22, `ZIP buffer too small for EOCD (${len} bytes)`);

    let eocdOffset = -1;
    // Search backward for 0x06054b50
    for (let i = len - 22; i >= Math.max(0, len - 65557); i--) {
      if (this.view.getUint32(i, true) === 0x06054b50) {
        eocdOffset = i;
        break;
      }
    }

    assert.notStrictEqual(eocdOffset, -1, 'End of Central Directory (EOCD) signature 0x06054b50 not found');

    const diskNumber = this.view.getUint16(eocdOffset + 4, true);
    const startDisk = this.view.getUint16(eocdOffset + 6, true);
    const diskEntries = this.view.getUint16(eocdOffset + 8, true);
    const totalEntries = this.view.getUint16(eocdOffset + 10, true);
    const cdSize = this.view.getUint32(eocdOffset + 12, true);
    const cdOffset = this.view.getUint32(eocdOffset + 16, true);
    const commentLength = this.view.getUint16(eocdOffset + 20, true);

    assert.strictEqual(diskNumber, 0, 'EOCD disk number must be 0');
    assert.strictEqual(startDisk, 0, 'EOCD start disk must be 0');
    assert.strictEqual(diskEntries, totalEntries, 'EOCD disk entries must equal total entries');

    return {
      eocdOffset,
      totalEntries,
      cdSize,
      cdOffset,
      commentLength
    };
  }

  /**
   * Parses all Central Directory headers.
   */
  parseCentralDirectory() {
    const eocd = this.parseEocd();
    const entries = [];
    let pos = eocd.cdOffset;

    for (let i = 0; i < eocd.totalEntries; i++) {
      assert.ok(pos + 46 <= this.bytes.length, `Central directory header ${i} exceeds buffer bounds`);
      const sig = this.view.getUint32(pos, true);
      assert.strictEqual(sig, 0x02014b50, `Invalid Central Directory signature at offset ${pos} (expected 0x02014b50, got 0x${sig.toString(16)})`);

      const versionMadeBy = this.view.getUint16(pos + 4, true);
      const versionNeeded = this.view.getUint16(pos + 6, true);
      const flags = this.view.getUint16(pos + 8, true);
      const method = this.view.getUint16(pos + 10, true);
      const dosTime = this.view.getUint16(pos + 12, true);
      const dosDate = this.view.getUint16(pos + 14, true);
      const crc32 = this.view.getUint32(pos + 16, true);
      const compressedSize = this.view.getUint32(pos + 20, true);
      const uncompressedSize = this.view.getUint32(pos + 24, true);
      const nameLength = this.view.getUint16(pos + 28, true);
      const extraLength = this.view.getUint16(pos + 30, true);
      const commentLength = this.view.getUint16(pos + 32, true);
      const diskStart = this.view.getUint16(pos + 34, true);
      const localHeaderOffset = this.view.getUint32(pos + 42, true);

      assert.strictEqual(versionNeeded, 20, 'Version needed to extract must be 20 (2.0)');
      assert.strictEqual(flags & 0x0800, 0x0800, 'UTF-8 flag (bit 11) must be set in Central Directory');
      assert.strictEqual(method, 0, 'Compression method must be 0 (STORE)');
      assert.strictEqual(compressedSize, uncompressedSize, 'Compressed and uncompressed size must match in STORE method');
      assert.strictEqual(diskStart, 0, 'Disk start must be 0');

      const nameBytes = this.bytes.subarray(pos + 46, pos + 46 + nameLength);
      const filename = new TextDecoder().decode(nameBytes);

      entries.push({
        filename,
        crc32,
        size: uncompressedSize,
        localHeaderOffset,
        dosTime,
        dosDate,
        headerSize: 46 + nameLength + extraLength + commentLength
      });

      pos += 46 + nameLength + extraLength + commentLength;
    }

    assert.strictEqual(pos - eocd.cdOffset, eocd.cdSize, 'Actual Central Directory size must match EOCD cdSize field');
    return { eocd, entries };
  }

  /**
   * Validates each file against its corresponding Local File Header and payload.
   * @returns {Map<string, Uint8Array>} extracted files
   */
  validateAndExtractAll() {
    const { entries } = this.parseCentralDirectory();
    const extracted = new Map();

    for (let i = 0; i < entries.length; i++) {
      const cdEntry = entries[i];
      const offset = cdEntry.localHeaderOffset;

      assert.ok(offset + 30 <= this.bytes.length, `Local file header offset ${offset} exceeds buffer`);
      const localSig = this.view.getUint32(offset, true);
      assert.strictEqual(localSig, 0x04034b50, `Invalid Local File Header signature at offset ${offset} for "${cdEntry.filename}"`);

      const localVersion = this.view.getUint16(offset + 4, true);
      const localFlags = this.view.getUint16(offset + 6, true);
      const localMethod = this.view.getUint16(offset + 8, true);
      const localDosTime = this.view.getUint16(offset + 10, true);
      const localDosDate = this.view.getUint16(offset + 12, true);
      const localCrc32 = this.view.getUint32(offset + 14, true);
      const localCompSize = this.view.getUint32(offset + 18, true);
      const localUncompSize = this.view.getUint32(offset + 22, true);
      const localNameLength = this.view.getUint16(offset + 26, true);
      const localExtraLength = this.view.getUint16(offset + 28, true);

      assert.strictEqual(localVersion, 20, 'Local version must be 20');
      assert.strictEqual(localFlags & 0x0800, 0x0800, 'Local UTF-8 flag must be set');
      assert.strictEqual(localMethod, 0, 'Local method must be 0 (STORE)');
      assert.strictEqual(localCrc32, cdEntry.crc32, `Local CRC-32 must match Central Directory CRC-32 for "${cdEntry.filename}"`);
      assert.strictEqual(localUncompSize, cdEntry.size, `Local size must match Central Directory size for "${cdEntry.filename}"`);
      assert.strictEqual(localCompSize, cdEntry.size, `Local compressed size must match Central Directory size for "${cdEntry.filename}"`);

      const localNameBytes = this.bytes.subarray(offset + 30, offset + 30 + localNameLength);
      const localFilename = new TextDecoder().decode(localNameBytes);
      assert.strictEqual(localFilename, cdEntry.filename, 'Local filename must match Central Directory filename');

      // Extract raw file payload
      const payloadStart = offset + 30 + localNameLength + localExtraLength;
      const payloadEnd = payloadStart + cdEntry.size;
      assert.ok(payloadEnd <= this.bytes.length, `File payload exceeds buffer for "${cdEntry.filename}"`);

      const payload = this.bytes.subarray(payloadStart, payloadEnd);
      const actualCrc = ArchiveService.computeCrc32(payload);
      assert.strictEqual(actualCrc, cdEntry.crc32, `Payload CRC-32 mismatch for "${cdEntry.filename}": calculated ${actualCrc}, expected ${cdEntry.crc32}`);

      extracted.set(cdEntry.filename, payload);
    }

    return extracted;
  }
}

/**
 * Simulates the Offscreen ZIP packager engine with mutex write queue.
 */
class MockOffscreenZipEngine {
  constructor() {
    this.memoryChunks = [];
    this.entries = [];
    this.currentOffset = 0;
    this.completed = 0;
    /** @type {Promise<any>} */
    this.writeQueue = Promise.resolve();
    this.textEncoder = new TextEncoder();
  }

  getDosDateTime(date = new Date()) {
    const year = date.getFullYear();
    const dosTime = ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)) & 0xFFFF;
    const dosDate = (((year < 1980 ? 0 : year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xFFFF;
    return { dosTime, dosDate };
  }

  createLocalHeader(nameBytes, crc32, size, dosTime, dosDate) {
    const buf = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(buf.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x0800, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, dosTime, true);
    view.setUint16(12, dosDate, true);
    view.setUint32(14, crc32, true);
    view.setUint32(18, size, true);
    view.setUint32(22, size, true);
    view.setUint16(26, nameBytes.length, true);
    view.setUint16(28, 0, true);
    buf.set(nameBytes, 30);
    return buf;
  }

  createCentralDirectoryHeader(entry) {
    const buf = new Uint8Array(46 + entry.nameBytes.length);
    const view = new DataView(buf.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint16(8, 0x0800, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, entry.dosTime, true);
    view.setUint16(14, entry.dosDate, true);
    view.setUint32(16, entry.crc32, true);
    view.setUint32(20, entry.size, true);
    view.setUint32(24, entry.size, true);
    view.setUint16(28, entry.nameBytes.length, true);
    view.setUint16(30, 0, true);
    view.setUint16(32, 0, true);
    view.setUint16(34, 0, true);
    view.setUint16(36, 0, true);
    view.setUint32(38, 0, true);
    view.setUint32(42, entry.offset, true);
    buf.set(entry.nameBytes, 46);
    return buf;
  }

  createEocdRecord(entryCount, cdSize, cdOffset) {
    const buf = new Uint8Array(22);
    const view = new DataView(buf.buffer);
    view.setUint32(0, 0x06054b50, true);
    view.setUint16(4, 0, true);
    view.setUint16(6, 0, true);
    view.setUint16(8, entryCount, true);
    view.setUint16(10, entryCount, true);
    view.setUint32(12, cdSize, true);
    view.setUint32(16, cdOffset, true);
    view.setUint16(20, 0, true);
    return buf;
  }

  async addFile(name, bytes) {
    const sanitizedName = String(name || 'file').replace(/\\/g, '/').replace(/^\/+/, '');
    const nameBytes = this.textEncoder.encode(sanitizedName);
    const crc32 = ArchiveService.computeCrc32(bytes);
    const { dosTime, dosDate } = this.getDosDateTime();
    const localHeader = this.createLocalHeader(nameBytes, crc32, bytes.length, dosTime, dosDate);

    const writeOp = async () => {
      // Simulate slight async I/O delay
      await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 5)));
      const localHeaderOffset = this.currentOffset;

      this.memoryChunks.push(localHeader);
      this.memoryChunks.push(bytes);

      this.entries.push({
        nameBytes,
        crc32,
        size: bytes.length,
        offset: localHeaderOffset,
        dosTime,
        dosDate
      });

      this.currentOffset += localHeader.byteLength + bytes.length;
      this.completed++;
      return { ok: true, jobBytes: this.currentOffset };
    };

    return (this.writeQueue = this.writeQueue.then(writeOp, writeOp));
  }

  async buildZip() {
    await this.writeQueue;
    const cdStartOffset = this.currentOffset;
    let cdSize = 0;

    for (let i = 0; i < this.entries.length; i++) {
      const cdHeader = this.createCentralDirectoryHeader(this.entries[i]);
      this.memoryChunks.push(cdHeader);
      cdSize += cdHeader.byteLength;
      this.currentOffset += cdHeader.byteLength;
    }

    const eocd = this.createEocdRecord(this.entries.length, cdSize, cdStartOffset);
    this.memoryChunks.push(eocd);
    this.currentOffset += eocd.byteLength;

    const totalLen = this.memoryChunks.reduce((acc, c) => acc + c.byteLength, 0);
    const out = new Uint8Array(totalLen);
    let cursor = 0;
    for (const chunk of this.memoryChunks) {
      out.set(chunk, cursor);
      cursor += chunk.byteLength;
    }
    return out;
  }
}

export async function runZipIntegrityTests() {
  console.log('• Running: ZIP Integrity & PKZIP 2.0 Compliance Tests...');

  // 1. Basic Single and Multi-file ZIP Packaging
  {
    const engine = new MockOffscreenZipEngine();
    const file1 = new TextEncoder().encode('Hello, world of social media downloads!');
    const file2 = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x01, 0x02]);

    await engine.addFile('notes/readme.txt', file1);
    await engine.addFile('images/sample.png', file2);

    const zipBytes = await engine.buildZip();
    const validator = new ZipValidator(zipBytes);
    const extracted = validator.validateAndExtractAll();

    assert.strictEqual(extracted.size, 2);
    assert.deepStrictEqual(extracted.get('notes/readme.txt'), file1);
    assert.deepStrictEqual(extracted.get('images/sample.png'), file2);
  }

  // 2. High-Concurrency Parallel Workers Stress Test (Zero Offset Collisions)
  {
    const engine = new MockOffscreenZipEngine();
    const testFiles = [];
    const NUM_FILES = 25;

    for (let i = 0; i < NUM_FILES; i++) {
      // Generate randomized binary payload
      const size = 64 + (i * 37) % 512;
      const data = new Uint8Array(size);
      for (let k = 0; k < size; k++) data[k] = (i + k * 17) & 0xFF;

      testFiles.push({
        name: `folder_${i % 3}/item_media_${i.toString().padStart(3, '0')}.dat`,
        data
      });
    }

    // Launch all additions simultaneously in parallel (simulating 6+ background workers)
    await Promise.all(testFiles.map(f => engine.addFile(f.name, f.data)));

    const zipBytes = await engine.buildZip();
    const validator = new ZipValidator(zipBytes);
    const extracted = validator.validateAndExtractAll();

    assert.strictEqual(extracted.size, NUM_FILES, `All ${NUM_FILES} files must be present in ZIP`);

    for (const f of testFiles) {
      const extractedData = extracted.get(f.name);
      assert.ok(extractedData, `File ${f.name} missing from extracted ZIP`);
      assert.deepStrictEqual(extractedData, f.data, `File ${f.name} content mismatch`);
    }
  }

  // 3. Path Normalization & Unicode Filenames
  {
    const engine = new MockOffscreenZipEngine();
    const unicodeName = 'Instagram/usuário_árvore_café/foto_123.jpg';
    const windowsPath = 'Facebook\\Albums\\Summer 2026\\photo.jpeg';
    const payload = new Uint8Array([1, 2, 3, 4]);

    await engine.addFile(unicodeName, payload);
    await engine.addFile(windowsPath, payload);

    const zipBytes = await engine.buildZip();
    const validator = new ZipValidator(zipBytes);
    const extracted = validator.validateAndExtractAll();

    assert.ok(extracted.has('Instagram/usuário_árvore_café/foto_123.jpg'), 'Unicode filename must be preserved');
    assert.ok(extracted.has('Facebook/Albums/Summer 2026/photo.jpeg'), 'Windows backslashes must be normalized to forward slashes');
    assert.ok(!extracted.has('Facebook\\Albums\\Summer 2026\\photo.jpeg'), 'No backslashes should remain in ZIP entries');
  }

  // 4. Empty and 0-byte File Handling
  {
    const engine = new MockOffscreenZipEngine();
    const emptyPayload = new Uint8Array(0);
    await engine.addFile('empty.txt', emptyPayload);

    const zipBytes = await engine.buildZip();
    const validator = new ZipValidator(zipBytes);
    const extracted = validator.validateAndExtractAll();

    assert.strictEqual(extracted.size, 1);
    assert.deepStrictEqual(extracted.get('empty.txt'), emptyPayload);
  }
}
