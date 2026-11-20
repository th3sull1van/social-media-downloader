/**
 * Social Media Downloader — Architecture Dependency Rule Checker
 * Machine-verifiable enforcement of architectural boundaries and dependency directions.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRootDir = path.resolve(__dirname, '../..');

function collectFiles(dir, extensions) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  for (const file of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      results = results.concat(collectFiles(fullPath, extensions));
    } else if (extensions.some((ext) => file.endsWith(ext))) {
      results.push(fullPath);
    }
  }
  return results;
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');
}

function resolveSpecifiers(filePath, content, rootDir) {
  const specs = [];
  const fileDir = path.dirname(filePath);
  const relFile = path.relative(rootDir, filePath).replace(/\\/g, '/');
  if (filePath.endsWith('.html')) {
    const lines = content.split('\n');
    lines.forEach((line, i) => {
      for (const m of line.matchAll(/<script\b[^>]*\bsrc\s*=\s*['"]([^'"]+)['"]/gi)) {
        const raw = m[1];
        const target = raw.startsWith('/') ? raw.slice(1) : path.relative(rootDir, path.resolve(fileDir, raw)).replace(/\\/g, '/');
        specs.push({ line: i + 1, target, raw });
      }
    });
    return specs;
  }

  const clean = stripComments(content);
  const lines = clean.split('\n');
  lines.forEach((line, i) => {
    const lineNum = i + 1;
    for (const m of line.matchAll(/\b(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g)) {
      const raw = m[1];
      const target = raw.startsWith('.') ? path.relative(rootDir, path.resolve(fileDir, raw)).replace(/\\/g, '/') : raw;
      specs.push({ line: lineNum, target, raw });
    }
    for (const m of line.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const raw = m[1];
      const target = raw.startsWith('.') ? path.relative(rootDir, path.resolve(fileDir, raw)).replace(/\\/g, '/') : raw;
      specs.push({ line: lineNum, target, raw });
    }
    for (const m of line.matchAll(/\bimportScripts\s*\(([^)]+)\)/g)) {
      for (const s of m[1].matchAll(/['"]([^'"]+)['"]/g)) {
        const raw = s[1];
        const target = raw.startsWith('/') ? raw.slice(1) : path.relative(rootDir, path.resolve(fileDir, raw)).replace(/\\/g, '/');
        specs.push({ line: lineNum, target, raw });
      }
    }
    for (const m of line.matchAll(/chrome\.runtime\.getURL\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const raw = m[1];
      specs.push({ line: lineNum, target: raw.replace(/^\/+/, ''), raw });
    }
  });
  void relFile;
  return specs;
}

/** @param {{ rootDir?: string }} [options] */
export function checkDependencyRules({ rootDir: suppliedRootDir } = {}) {
  const rootDir = suppliedRootDir || defaultRootDir;
  const srcDir = path.join(rootDir, 'src');
  const violations = [];
  const files = collectFiles(srcDir, ['.js', '.html']);

  for (const filePath of files) {
    const relPath = path.relative(rootDir, filePath).replace(/\\/g, '/');
    const content = fs.readFileSync(filePath, 'utf8');
    const specs = resolveSpecifiers(filePath, content, rootDir);

    for (const { line, target, raw } of specs) {
      if (relPath.startsWith('src/core/')) {
        if (target.startsWith('src/plugins/')) {
          violations.push({ file: relPath, line, rule: 'Core MUST NOT depend on plugins or meta-shared', importTarget: raw });
        }
      } else if (relPath.startsWith('src/offscreen/')) {
        if (target.startsWith('src/plugins/')) {
          violations.push({ file: relPath, line, rule: 'Offscreen MUST NOT depend on platform plugins', importTarget: raw });
        }
      } else if (relPath.startsWith('src/popup/')) {
        if (target.startsWith('src/plugins/')) {
          violations.push({ file: relPath, line, rule: 'Popup MUST NOT depend directly on platform plugins', importTarget: raw });
        }
      } else if (relPath.startsWith('src/content/ui/') || relPath.startsWith('src/content/runtime/') || relPath.startsWith('src/content/bridge/')) {
        if (target.startsWith('src/plugins/')) {
          violations.push({ file: relPath, line, rule: 'Content runtime/UI/bridge MUST remain platform-agnostic (no plugin imports)', importTarget: raw });
        }
      } else if (relPath.startsWith('src/plugins/instagram/')) {
        if (target.startsWith('src/plugins/facebook/') || target.startsWith('src/plugins/reddit/') || target.startsWith('src/content/')) {
          violations.push({ file: relPath, line, rule: 'Instagram plugin MUST NOT import Facebook, Reddit, or content shell', importTarget: raw });
        }
      } else if (relPath.startsWith('src/plugins/facebook/')) {
        if (target.startsWith('src/plugins/instagram/') || target.startsWith('src/plugins/reddit/') || target.startsWith('src/content/')) {
          violations.push({ file: relPath, line, rule: 'Facebook plugin MUST NOT import Instagram, Reddit, or content shell', importTarget: raw });
        }
      } else if (relPath.startsWith('src/plugins/reddit/')) {
        if (target.startsWith('src/plugins/instagram/') || target.startsWith('src/plugins/facebook/') || target.startsWith('src/plugins/meta-shared/') || target.startsWith('src/content/')) {
          violations.push({ file: relPath, line, rule: 'Reddit plugin MUST NOT import Instagram, Facebook, Meta Shared, or content shell', importTarget: raw });
        }
      } else if (relPath.startsWith('src/plugins/meta-shared/')) {
        if (target.startsWith('src/plugins/instagram/') || target.startsWith('src/plugins/facebook/') || target.startsWith('src/plugins/reddit/') || target.startsWith('src/content/')) {
          violations.push({ file: relPath, line, rule: 'Meta Shared MUST NOT depend on any platform plugin or content shell', importTarget: raw });
        }
      }
    }
  }

  return violations;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  console.log('Checking architectural dependency rules...');
  const violations = checkDependencyRules();
  if (violations.length === 0) {
    console.log('\x1b[32m✔ All architectural dependency rules satisfied (0 violations).\x1b[0m');
  } else {
    console.error(`\x1b[31m✖ Found ${violations.length} dependency rule violations:\x1b[0m`);
    for (const v of violations) {
      console.error(`  - [${v.file}:${v.line}] ${v.rule} (imported: "${v.importTarget}")`);
    }
    process.exit(1);
  }
}
