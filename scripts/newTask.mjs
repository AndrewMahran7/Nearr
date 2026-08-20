#!/usr/bin/env node
/**
 * scripts/newTask.mjs
 *
 * Create an isolated worktree for one task, so several agents (or several of
 * your own sessions) can work at once without sharing a checkout.
 *
 *   npm run task:new -- shazam-v2
 *   npm run task:new -- shazam-v2 --kind fix --base main
 *
 * produces
 *
 *   branch    feat/shazam-v2
 *   worktree  ../Nearr-shazam-v2      (matches the existing Nearr-<slug> convention)
 *
 * and prints the base commit, which the agent working there must record.
 *
 * Deliberately thin: this wraps `git worktree add` and nothing else. It does
 * not install dependencies, start Metro, or talk to any cloud service — a
 * task-launcher that can deploy is exactly the thing this workflow exists to
 * prevent.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const KINDS = ['feat', 'fix', 'chore', 'docs', 'test', 'integration'];

function git(args, opts = {}) {
  return execFileSync('git', args, { encoding: 'utf8', ...opts }).trim();
}

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

const argv = process.argv.slice(2);
const positional = [];
const flags = {};
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i].startsWith('--')) {
    flags[argv[i].slice(2)] = argv[i + 1];
    i += 1;
  } else {
    positional.push(argv[i]);
  }
}

const slug = (positional[0] || '').trim();
if (!slug) {
  fail(
    'Usage: npm run task:new -- <slug> [--kind feat|fix|chore|docs|test|integration] [--base <ref>]\n' +
      'Example: npm run task:new -- shazam-v2',
  );
}
if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
  fail(`Invalid slug "${slug}". Use lowercase letters, digits and hyphens, e.g. shazam-v2.`);
}

const kind = (flags.kind || 'feat').trim();
if (!KINDS.includes(kind)) {
  fail(`Invalid --kind "${kind}". Expected one of: ${KINDS.join(', ')}.`);
}

const base = (flags.base || 'main').trim();
const branch = `${kind}/${slug}`;
const repoRoot = git(['rev-parse', '--show-toplevel']);
const worktreePath = path.resolve(repoRoot, '..', `Nearr-${slug}`);

// --- Preconditions ---------------------------------------------------------

let baseCommit;
try {
  baseCommit = git(['rev-parse', '--verify', `${base}^{commit}`]);
} catch {
  fail(`Base ref "${base}" does not exist. Fetch it first, or pass --base <ref>.`);
}

const branchExists = (() => {
  try {
    git(['rev-parse', '--verify', `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
})();
if (branchExists) {
  fail(
    `Branch ${branch} already exists.\n` +
      `If its worktree is gone, reattach it with:\n` +
      `  git worktree add "${worktreePath}" ${branch}`,
  );
}
if (existsSync(worktreePath)) {
  fail(`${worktreePath} already exists. Remove it first, or choose another slug.`);
}

// --- Create ----------------------------------------------------------------

console.log(`Creating worktree for ${branch}`);
console.log(`  base      ${base} @ ${baseCommit.slice(0, 8)}`);
console.log(`  worktree  ${worktreePath}`);

execFileSync('git', ['worktree', 'add', '-b', branch, worktreePath, baseCommit], {
  stdio: 'inherit',
});

console.log(`
Worktree ready.

  cd ${worktreePath}
  npm install          # worktrees do NOT share node_modules

Record this in the task brief (docs/AGENT_TASK_TEMPLATE.md):

  branch       ${branch}
  worktree     ${worktreePath}
  base commit  ${baseCommit}

When the task is done and merged:

  git worktree remove "${worktreePath}"
  git branch -d ${branch}
`);
