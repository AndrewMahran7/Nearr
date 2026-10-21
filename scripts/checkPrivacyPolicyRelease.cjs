#!/usr/bin/env node
// This gate verifies recorded approval and exact content integrity, not legal
// sufficiency. Never populate the manifest without the actual founder decision.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { getPrivacyPolicyErrors, privacyPolicyApprovalPayload } = require('../lib/privacyPolicyManifest');

function resolveProfile(profiles, name, visited = new Set()) {
  if (!name || !profiles[name] || visited.has(name)) throw new Error('Missing, unknown or cyclic EAS build profile; privacy approval is required.');
  visited.add(name);
  const profile = profiles[name];
  const base = profile.extends ? resolveProfile(profiles, profile.extends, visited) : {};
  return { ...base, ...profile, env: { ...base.env, ...profile.env } };
}

function requiresPrivacyApproval(easConfig, env) {
  const profile = resolveProfile(easConfig.build || {}, env.EAS_BUILD_PROFILE);
  const production = [env.EXPO_PUBLIC_APP_ENV, profile.env?.EXPO_PUBLIC_APP_ENV, profile.environment, profile.channel]
    .some((value) => String(value || '').toLowerCase() === 'production');
  // Only positively identified non-Production, internal/dev builds may preview
  // the pending UI. Unknown profiles and all Store distributions fail closed.
  return production || profile.distribution === 'store' || !(profile.developmentClient === true || profile.distribution === 'internal');
}

function checkApprovedPolicy(manifest) {
  const errors = getPrivacyPolicyErrors(manifest);
  if (errors.length) throw new Error(errors.join('\n'));
  const actual = createHash('sha256').update(privacyPolicyApprovalPayload(manifest), 'utf8').digest('hex');
  if (actual !== manifest.approval.contentSha256) throw new Error('Policy content or canonical URL changed after approval; SHA-256 does not match.');
  return actual;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length && args[0] !== '--eas-build')) throw new Error('Usage: node scripts/checkPrivacyPolicyRelease.cjs [--eas-build]');
  const root = path.resolve(__dirname, '..');
  if (args[0] === '--eas-build') {
    const easConfig = JSON.parse(fs.readFileSync(path.join(root, 'eas.json'), 'utf8'));
    if (!requiresPrivacyApproval(easConfig, process.env)) {
      console.log('Privacy policy: non-Production internal/development build; pending policy preview is permitted.');
      return;
    }
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'constants/privacyPolicy.json'), 'utf8'));
  const hash = checkApprovedPolicy(manifest);
  console.log(`Privacy policy release gate passed: approved snapshot SHA-256 ${hash}`);
}

module.exports = { resolveProfile, requiresPrivacyApproval, checkApprovedPolicy };
if (require.main === module) {
  try { main(); } catch (error) {
    console.error(`[PRIVACY_RELEASE_BLOCKED] ${error.message}`);
    process.exitCode = 1;
  }
}
