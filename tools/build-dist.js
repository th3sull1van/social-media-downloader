#!/usr/bin/env bun
/**
 * Social Media Downloader — Build Distributable Chrome Extension ZIP
 * Packages the extension ready to be loaded via chrome://extensions ("Load unpacked")
 * or installed into Chromium-based browsers.
 */

import fs from 'node:fs';
import path from 'node:path';

const rootDir = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const version = pkg.version || '1.1.0';
const distDir = path.join(rootDir, 'dist');
const zipFileName = `social-media-downloader-v${version}-chrome.zip`;
const zipFilePath = path.join(distDir, zipFileName);

if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// Files and directories to include in the Chrome Extension bundle
const includeItems = [
  'manifest.json',
  '_locales',
  'assets',
  'src',
  'README.md',
  'LICENSE'
];

function getAllFiles(dir, base = '') {
  let results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const relPath = base ? `${base}/${entry.name}` : entry.name;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(getAllFiles(fullPath, relPath));
    } else {
      results.push({ relPath, fullPath });
    }
  }
  return results;
}

console.log(`[Build] Packaging Social Media Downloader v${version}...`);

const fileList = [];
for (const item of includeItems) {
  const itemPath = path.join(rootDir, item);
  if (!fs.existsSync(itemPath)) {
    console.warn(`[Build] Warning: '${item}' does not exist, skipping.`);
    continue;
  }
  const stat = fs.statSync(itemPath);
  if (stat.isDirectory()) {
    const files = getAllFiles(itemPath, item);
    fileList.push(...files);
  } else {
    fileList.push({ relPath: item, fullPath: itemPath });
  }
}

console.log(`[Build] Collected ${fileList.length} files for extension bundle.`);

// Build PKZIP 2.0 file
const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC32_TABLE[i] = c;
}

function calculateCrc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ bytes[i]) & 0xFF];
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function dosDateTime(date) {
  const d = date || new Date();
  const time = ((d.getHours() & 0x1F) << 11) | ((d.getMinutes() & 0x3F) << 5) | ((d.getSeconds() >> 1) & 0x1F);
  const dateNum = (((d.getFullYear() - 1980) & 0x7F) << 9) | (((d.getMonth() + 1) & 0xF) << 5) | (d.getDate() & 0x1F);
  return { time, date: dateNum };
}

const entries = [];
const chunks = [];
let currentOffset = 0;
const now = new Date();
const { time: dosTime, date: dosDate } = dosDateTime(now);

for (const file of fileList) {
  const data = fs.readFileSync(file.fullPath);
  const nameBytes = Buffer.from(file.relPath.replace(/\\/g, '/'), 'utf8');
  const crc = calculateCrc32(data);
  const size = data.length;

  const localHeader = Buffer.alloc(30 + nameBytes.length);
  localHeader.writeUInt32LE(0x04034b50, 0); // signature
  localHeader.writeUInt16LE(20, 4);         // version needed: 2.0
  localHeader.writeUInt16LE(0x0800, 6);     // flags: UTF-8
  localHeader.writeUInt16LE(0, 8);          // compression: STORE
  localHeader.writeUInt16LE(dosTime, 10);
  localHeader.writeUInt16LE(dosDate, 12);
  localHeader.writeUInt32LE(crc, 14);
  localHeader.writeUInt32LE(size, 18);
  localHeader.writeUInt32LE(size, 22);
  localHeader.writeUInt16LE(nameBytes.length, 26);
  localHeader.writeUInt16LE(0, 28);
  nameBytes.copy(localHeader, 30);

  entries.push({
    nameBytes,
    crc,
    size,
    offset: currentOffset
  });

  chunks.push(localHeader);
  chunks.push(data);
  currentOffset += localHeader.length + data.length;
}

const centralDirStart = currentOffset;
let centralDirSize = 0;

for (const entry of entries) {
  const cdHeader = Buffer.alloc(46 + entry.nameBytes.length);
  cdHeader.writeUInt32LE(0x02014b50, 0); // signature
  cdHeader.writeUInt16LE(20, 4);         // version made by
  cdHeader.writeUInt16LE(20, 6);         // version needed
  cdHeader.writeUInt16LE(0x0800, 8);     // flags: UTF-8
  cdHeader.writeUInt16LE(0, 10);         // compression: STORE
  cdHeader.writeUInt16LE(dosTime, 12);
  cdHeader.writeUInt16LE(dosDate, 14);
  cdHeader.writeUInt32LE(entry.crc, 16);
  cdHeader.writeUInt32LE(entry.size, 20);
  cdHeader.writeUInt32LE(entry.size, 24);
  cdHeader.writeUInt16LE(entry.nameBytes.length, 28);
  cdHeader.writeUInt16LE(0, 30);         // extra len
  cdHeader.writeUInt16LE(0, 32);         // comment len
  cdHeader.writeUInt16LE(0, 34);         // disk start
  cdHeader.writeUInt16LE(0, 36);         // internal attrs
  cdHeader.writeUInt32LE(0, 38);         // external attrs
  cdHeader.writeUInt32LE(entry.offset, 42);
  entry.nameBytes.copy(cdHeader, 46);

  chunks.push(cdHeader);
  centralDirSize += cdHeader.length;
  currentOffset += cdHeader.length;
}

// End of Central Directory Record
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);       // signature
eocd.writeUInt16LE(0, 4);                // disk number
eocd.writeUInt16LE(0, 6);                // central dir disk
eocd.writeUInt16LE(entries.length, 8);   // entries on disk
eocd.writeUInt16LE(entries.length, 10);  // total entries
eocd.writeUInt32LE(centralDirSize, 12);  // central dir size
eocd.writeUInt32LE(centralDirStart, 16); // central dir offset
eocd.writeUInt16LE(0, 20);               // comment len

chunks.push(eocd);

const finalBuffer = Buffer.concat(chunks);
fs.writeFileSync(zipFilePath, finalBuffer);

console.log(`✔ Successfully built Chrome extension bundle:`);
console.log(`  Path: ${zipFilePath}`);
console.log(`  Size: ${(finalBuffer.length / 1024).toFixed(1)} KB`);
console.log(`  Files: ${entries.length}`);
