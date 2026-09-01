import { validateCompactFixtureSet } from './fixture-validation.js';

try {
  const report = validateCompactFixtureSet(process.cwd());
  console.log(`Compact fixture validation passed: ${report.fixtures.length} fixtures, ${report.totalBytes} bytes`);
} catch (error) {
  console.error(`Compact fixture validation failed: ${error?.message || error}`);
  process.exitCode = 1;
}
