/**
 * Social Media Downloader — Manifest V3 Integrity Checker
 * Verifies that all resources, scripts, icons, and contexts referenced in manifest.json exist on disk.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

export function checkManifestIntegrity() {
  const manifestPath = path.join(rootDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    return ['manifest.json not found'];
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const errors = [];

  // Check background service worker
  if (manifest.background?.service_worker) {
    const swPath = path.join(rootDir, manifest.background.service_worker);
    if (!fs.existsSync(swPath)) {
      errors.push(`Background service worker file missing: ${manifest.background.service_worker}`);
    }
  } else {
    errors.push('Missing background.service_worker in manifest.json');
  }

  // Check action popup
  if (manifest.action?.default_popup) {
    const popupPath = path.join(rootDir, manifest.action.default_popup);
    if (!fs.existsSync(popupPath)) {
      errors.push(`Popup HTML file missing: ${manifest.action.default_popup}`);
    }
  }

  // Check content scripts
  if (Array.isArray(manifest.content_scripts)) {
    for (const cs of manifest.content_scripts) {
      if (Array.isArray(cs.js)) {
        for (const js of cs.js) {
          if (!fs.existsSync(path.join(rootDir, js))) {
            errors.push(`Content script JS file missing: ${js}`);
          }
        }
      }
      if (Array.isArray(cs.css)) {
        for (const css of cs.css) {
          if (!fs.existsSync(path.join(rootDir, css))) {
            errors.push(`Content script CSS file missing: ${css}`);
          }
        }
      }
    }
  }

  // Check icons
  if (manifest.icons) {
    for (const [size, iconPath] of Object.entries(manifest.icons)) {
      if (!fs.existsSync(path.join(rootDir, iconPath))) {
        errors.push(`Extension icon (${size}px) missing: ${iconPath}`);
      }
    }
  }

  // Check host permissions
  const requiredHosts = [
    '*://*.instagram.com/*',
    '*://*.facebook.com/*',
    '*://*.reddit.com/*'
  ];
  for (const host of requiredHosts) {
    if (!manifest.host_permissions?.includes(host)) {
      errors.push(`Required host permission missing in manifest: ${host}`);
    }
  }

  return errors;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log('Checking Manifest V3 file integrity...');
  const errors = checkManifestIntegrity();
  if (errors.length === 0) {
    console.log('\x1b[32m✔ Manifest V3 integrity verified successfully (0 errors).\x1b[0m');
  } else {
    console.error(`\x1b[31m✖ Manifest validation failed with ${errors.length} errors:\x1b[0m`);
    errors.forEach(e => console.error(`  - ${e}`));
    process.exit(1);
  }
}
