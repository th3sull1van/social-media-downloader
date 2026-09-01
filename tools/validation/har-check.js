#!/usr/bin/env bun
import fs from 'node:fs';
import path from 'node:path';
import { validateFixtureSet } from './har-validation.js';

const rootDir = process.cwd();
const requirePublic = process.argv.includes('--require-public');
const includePrivate = process.argv.includes('--private');
const reportPath = process.argv.find((arg) => arg.startsWith('--report='))?.slice('--report='.length);

try {
  const report = validateFixtureSet(rootDir, { requirePublic, includePrivate });
  const output = JSON.stringify(report, null, 2);
  if (reportPath) {
    fs.mkdirSync(path.dirname(path.resolve(reportPath)), { recursive: true });
    fs.writeFileSync(reportPath, `${output}\n`, 'utf8');
  }
  console.log(`HAR fixture validation passed: ${report.publicFixtureCount} public, ${report.privateFixtureCount} private`);
  console.log(`HAR entries inspected: ${[...report.public, ...report.private].reduce((sum, fixture) => sum + fixture.entries, 0)}`);
  if (requirePublic && report.publicFixtureCount === 0) process.exitCode = 1;
} catch (error) {
  console.error(`HAR fixture validation failed: ${error.message}`);
  process.exitCode = 1;
}

