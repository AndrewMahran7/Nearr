#!/usr/bin/env node
import releaseGate from './lib/releaseGate.js';

const { readReleaseRecord, releaseVerdict, validateReleaseRecord } = releaseGate;
const args = process.argv.slice(2);
const fileIndex = args.indexOf('--record');
const file = fileIndex >= 0 ? args[fileIndex + 1] : '';
if (!file) {
  console.error('Usage: npm run release:status -- --record <release-record.json> [--require-healthy]');
  process.exit(1);
}

try {
  const { record } = readReleaseRecord(file);
  const errors = validateReleaseRecord(record);
  if (errors.length) {
    console.error(`INVALID RELEASE RECORD: ${errors.join(', ')}`);
    process.exit(1);
  }
  const result = releaseVerdict(record);
  console.log(result.verdict);
  if (args.includes('--require-healthy') && !result.healthy) process.exit(2);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
