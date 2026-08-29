/**
 * Social Media Downloader — Architecture Dependency Rule Checker
 * Machine-verifiable enforcement of architectural boundaries and dependency directions.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');
const srcDir = path.join(rootDir, 'src');

function getAllJsFiles(dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getAllJsFiles(fullPath));
    } else if (file.endsWith('.js')) {
      results.push(fullPath);
    }
  }
  return results;
}

export function checkDependencyRules() {
  const violations = [];
  const files = getAllJsFiles(srcDir);

  for (const filePath of files) {
    const relPath = path.relative(rootDir, filePath).replace(/\\/g, '/');
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const importMatch = line.match(/(?:import|from)\s+['"]([^'"]+)['"]/);
      if (!importMatch) continue;

      const importTarget = importMatch[1];

      // Rule 1: Core MUST NOT import platform implementations
      if (relPath.startsWith('src/core/')) {
        if (importTarget.includes('/plugins/instagram') ||
            importTarget.includes('/plugins/facebook') ||
            importTarget.includes('/plugins/reddit') ||
            importTarget.includes('/plugins/meta-shared')) {
          violations.push({
            file: relPath,
            line: i + 1,
            rule: 'Core MUST NOT import platform plugins or meta-shared',
            importTarget
          });
        }
      }

      // Rule 2: Platform plugins MUST NOT import other platform plugins
      if (relPath.startsWith('src/plugins/instagram/')) {
        if (importTarget.includes('/plugins/facebook') || importTarget.includes('/plugins/reddit')) {
          violations.push({
            file: relPath,
            line: i + 1,
            rule: 'Instagram plugin MUST NOT import Facebook or Reddit',
            importTarget
          });
        }
      }

      if (relPath.startsWith('src/plugins/facebook/')) {
        if (importTarget.includes('/plugins/instagram') || importTarget.includes('/plugins/reddit')) {
          violations.push({
            file: relPath,
            line: i + 1,
            rule: 'Facebook plugin MUST NOT import Instagram or Reddit',
            importTarget
          });
        }
      }

      if (relPath.startsWith('src/plugins/reddit/')) {
        if (importTarget.includes('/plugins/instagram') || importTarget.includes('/plugins/facebook') || importTarget.includes('/plugins/meta-shared')) {
          violations.push({
            file: relPath,
            line: i + 1,
            rule: 'Reddit plugin MUST NOT import Instagram, Facebook, or Meta Shared',
            importTarget
          });
        }
      }
    }
  }

  return violations;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
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
