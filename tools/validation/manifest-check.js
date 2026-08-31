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

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    return [`manifest.json is invalid JSON: ${err.message}`];
  }
  const errors = [];

  const checkFile = (relativePath, description) => {
    if (!relativePath || !fs.existsSync(path.join(rootDir, relativePath))) {
      errors.push(`${description} missing: ${relativePath || '(empty path)'}`);
    }
  };

  // Check background service worker
  if (manifest.background?.service_worker) {
    checkFile(manifest.background.service_worker, 'Background service worker file');
  } else {
    errors.push('Missing background.service_worker in manifest.json');
  }

  // Check action popup
  if (manifest.action?.default_popup) {
    checkFile(manifest.action.default_popup, 'Popup HTML file');
  }

  if (manifest.permissions?.includes('offscreen')) {
    checkFile('src/offscreen/offscreen.html', 'Offscreen HTML file');
  }

  // Check content scripts
  if (Array.isArray(manifest.content_scripts)) {
    for (const cs of manifest.content_scripts) {
      if (Array.isArray(cs.js)) {
        for (const js of cs.js) {
          checkFile(js, 'Content script JS file');
        }
      }
      if (Array.isArray(cs.css)) {
        for (const css of cs.css) {
          checkFile(css, 'Content script CSS file');
        }
      }
    }
  }

  // Check icons
  if (manifest.icons) {
    for (const [size, iconPath] of Object.entries(manifest.icons)) {
      if (!iconPath || !fs.existsSync(path.join(rootDir, iconPath))) {
        errors.push(`Extension icon (${size}px) missing: ${iconPath || '(empty path)'}`);
      }
    }
  }

  if (manifest.action?.default_icon) {
    for (const [size, iconPath] of Object.entries(manifest.action.default_icon)) {
      if (!iconPath || !fs.existsSync(path.join(rootDir, iconPath))) {
        errors.push(`Action icon (${size}px) missing: ${iconPath || '(empty path)'}`);
      }
    }
  }

  if (manifest.default_locale) {
    checkFile(`_locales/${manifest.default_locale}/messages.json`, 'Default locale messages file');
  }

  if (Array.isArray(manifest.web_accessible_resources)) {
    for (const [index, resourceSet] of manifest.web_accessible_resources.entries()) {
      if (!Array.isArray(resourceSet.resources) || resourceSet.resources.length === 0) {
        errors.push(`web_accessible_resources[${index}] must declare at least one resource`);
      } else {
        for (const resource of resourceSet.resources) {
          checkFile(resource, `Web-accessible resource file`);
        }
      }
      if (!Array.isArray(resourceSet.matches) || resourceSet.matches.length === 0) {
        errors.push(`web_accessible_resources[${index}] must declare at least one match pattern`);
      }
    }
  } else {
    errors.push('Missing web_accessible_resources in manifest.json');
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
