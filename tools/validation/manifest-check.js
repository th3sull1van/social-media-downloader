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

export function checkManifestPermissions(manifest) {
  const permissions = Array.isArray(manifest?.permissions) ? manifest.permissions : [];
  const required = ['downloads', 'offscreen', 'scripting', 'storage', 'unlimitedStorage', 'activeTab'];
  return required
    .filter((permission) => !permissions.includes(permission))
    .map((permission) => `Required runtime permission missing in manifest: ${permission}`);
}

/** @param {{manifest?: any, rootDir?: string}} [options] */
export function checkManifestIntegrity({ manifest: suppliedManifest, rootDir: suppliedRootDir } = {}) {
  const baseDir = suppliedRootDir || rootDir;
  const manifestPath = path.join(baseDir, 'manifest.json');
  if (!suppliedManifest && !fs.existsSync(manifestPath)) {
    return ['manifest.json not found'];
  }

  let manifest = suppliedManifest;
  if (!manifest) {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (err) {
      return [`manifest.json is invalid JSON: ${err.message}`];
    }
  }
  const errors = checkManifestPermissions(manifest);

  if (manifest.manifest_version !== 3) {
    errors.push(`manifest_version must be 3 (got ${manifest.manifest_version})`);
  }

  const checkFile = (relativePath, description) => {
    if (!relativePath || !fs.existsSync(path.join(baseDir, relativePath))) {
      errors.push(`${description} missing: ${relativePath || '(empty path)'}`);
      return false;
    }
    return true;
  };

  // Check background service worker
  if (manifest.background?.service_worker) {
    checkFile(manifest.background.service_worker, 'Background service worker file');
    if (manifest.background.type !== 'module') {
      errors.push(`background.type must be "module" (got ${manifest.background.type || 'missing'})`);
    }
  } else {
    errors.push('Missing background.service_worker in manifest.json');
  }

  // Check action popup and its linked local assets
  if (manifest.action?.default_popup && checkFile(manifest.action.default_popup, 'Popup HTML file')) {
    const popupHtmlPath = path.join(baseDir, manifest.action.default_popup);
    const popupHtml = fs.readFileSync(popupHtmlPath, 'utf8');
    const popupDir = path.dirname(popupHtmlPath);
    for (const m of popupHtml.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)\s*=\s*['"]([^'"]+)['"]/gi)) {
      const ref = m[1];
      if (/^https?:\/\//i.test(ref)) continue;
      const target = ref.startsWith('/') ? path.join(baseDir, ref.slice(1)) : path.resolve(popupDir, ref);
      if (!fs.existsSync(target)) {
        errors.push(`Popup referenced asset missing: ${ref}`);
      }
    }
  }

  if (manifest.permissions?.includes('offscreen')) {
    if (checkFile('src/offscreen/offscreen.html', 'Offscreen HTML file')) {
      const offscreenPath = path.join(baseDir, 'src/offscreen/offscreen.html');
      const offscreenHtml = fs.readFileSync(offscreenPath, 'utf8');
      for (const m of offscreenHtml.matchAll(/<script\b[^>]*\bsrc\s*=\s*['"]([^'"]+)['"]/gi)) {
        const ref = m[1];
        const target = ref.startsWith('/') ? path.join(baseDir, ref.slice(1)) : path.resolve(path.dirname(offscreenPath), ref);
        if (!fs.existsSync(target)) {
          errors.push(`Offscreen referenced script missing: ${ref}`);
        }
      }
    }
  }

  // Check content scripts + ensure main-world plugins are wired in world:"MAIN"
  const mainWorldScripts = new Set();
  if (Array.isArray(manifest.content_scripts)) {
    for (const cs of manifest.content_scripts) {
      if (Array.isArray(cs.js)) {
        for (const js of cs.js) {
          checkFile(js, 'Content script JS file');
          if (cs.world === 'MAIN') mainWorldScripts.add(js);
        }
      }
      if (Array.isArray(cs.css)) {
        for (const css of cs.css) {
          checkFile(css, 'Content script CSS file');
        }
      }
    }
  }

  // Check version parity between manifest.json, package.json, and plugin classes
  const pkgPath = path.join(baseDir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    if (pkg.version && manifest.version !== pkg.version) {
      errors.push(`Version mismatch: manifest.version=${manifest.version} != package.json version=${pkg.version}`);
    }
  }
  for (const [pluginRel, expectedMainWorld] of [
    ['src/plugins/instagram/InstagramPlugin.js', 'src/plugins/instagram/main-world/injected.js'],
    ['src/plugins/facebook/FacebookPlugin.js', 'src/plugins/facebook/main-world/injected.js'],
    ['src/plugins/reddit/RedditPlugin.js', null]
  ]) {
    const pluginFull = path.join(baseDir, pluginRel);
    if (fs.existsSync(pluginFull)) {
      const src = fs.readFileSync(pluginFull, 'utf8');
      const vMatch = src.match(/static\s+version\s*=\s*['"]([^'"]+)['"]/);
      if (vMatch && manifest.version && vMatch[1] !== manifest.version) {
        errors.push(`Version mismatch: ${pluginRel} version=${vMatch[1]} != manifest.version=${manifest.version}`);
      }
      if (expectedMainWorld && !mainWorldScripts.has(expectedMainWorld)) {
        errors.push(`Plugin ${pluginRel} requires world:"MAIN" content script ${expectedMainWorld}`);
      }
    }
  }

  // Check icons
  if (manifest.icons) {
    for (const [size, iconPath] of Object.entries(manifest.icons)) {
      if (!iconPath || !fs.existsSync(path.join(baseDir, iconPath))) {
        errors.push(`Extension icon (${size}px) missing: ${iconPath || '(empty path)'}`);
      }
    }
  }

  if (manifest.action?.default_icon) {
    for (const [size, iconPath] of Object.entries(manifest.action.default_icon)) {
      if (!iconPath || !fs.existsSync(path.join(baseDir, iconPath))) {
        errors.push(`Action icon (${size}px) missing: ${iconPath || '(empty path)'}`);
      }
    }
  }

  if (manifest.default_locale) {
    checkFile(`_locales/${manifest.default_locale}/messages.json`, 'Default locale messages file');
  }

  const declaredWar = new Set();
  if (Array.isArray(manifest.web_accessible_resources)) {
    for (const [index, resourceSet] of manifest.web_accessible_resources.entries()) {
      if (!Array.isArray(resourceSet.resources) || resourceSet.resources.length === 0) {
        errors.push(`web_accessible_resources[${index}] must declare at least one resource`);
      } else {
        for (const resource of resourceSet.resources) {
          checkFile(resource, `Web-accessible resource file`);
          declaredWar.add(resource);
          if (/main-world\/injected\.js$/i.test(resource)) {
            errors.push(`Main-world script must not be exposed in web_accessible_resources: ${resource}`);
          }
        }
      }
      if (!Array.isArray(resourceSet.matches) || resourceSet.matches.length === 0) {
        errors.push(`web_accessible_resources[${index}] must declare at least one match pattern`);
      }
    }
  } else {
    errors.push('Missing web_accessible_resources in manifest.json');
  }

  // Verify transitive ES module graph dynamically imported by src/content/content.js
  // is completely declared in web_accessible_resources (Chrome blocks unlisted imports).
  const contentScriptPath = path.join(baseDir, 'src/content/content.js');
  if (fs.existsSync(contentScriptPath)) {
    const contentSrc = fs.readFileSync(contentScriptPath, 'utf8');
    /** @type {string[]} */
    const roots = [];
    for (const m of contentSrc.matchAll(/['"](src\/[^'"]+\.js)['"]/g)) {
      if (!roots.includes(m[1])) roots.push(m[1]);
    }
    const visited = new Set();
    const walkModule = (relMod) => {
      if (visited.has(relMod)) return;
      visited.add(relMod);
      const abs = path.join(baseDir, relMod);
      if (!fs.existsSync(abs)) {
        errors.push(`Content-loaded ES module missing on disk: ${relMod}`);
        return;
      }
      if (!declaredWar.has(relMod)) {
        errors.push(`Content-loaded ES module missing from web_accessible_resources: ${relMod}`);
      }
      const modSrc = fs.readFileSync(abs, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');
      const modDir = path.dirname(abs);
      for (const m of modSrc.matchAll(/\b(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"](\.\.?\/[^'"]+)['"]/g)) {
        const depRel = path.relative(baseDir, path.resolve(modDir, m[1])).replace(/\\/g, '/');
        walkModule(depRel);
      }
    };
    for (const root of roots) walkModule(root);
  }

  // Check host permissions
  const requiredHosts = [
    '*://*.instagram.com/*',
    '*://*.cdninstagram.com/*',
    '*://*.facebook.com/*',
    '*://*.fbcdn.net/*',
    '*://*.reddit.com/*',
    '*://*.redd.it/*',
    '*://*.redgifs.com/*'
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
