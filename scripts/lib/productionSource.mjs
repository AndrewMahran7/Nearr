import { execFileSync } from 'node:child_process';

/**
 * Prove that a production-capable command originates from the one approved
 * source of truth. Calls onFail(message) on any uncertainty.
 */
export function assertProductionSource({ repoRoot, onFail }) {
  const git = (args) =>
    execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();

  const branch = git(['branch', '--show-current']);
  const head = git(['rev-parse', 'HEAD']);
  const dirty = git(['status', '--porcelain']);
  if (branch !== 'main') {
    onFail(`Production commands run only from main; current branch is "${branch || '(detached)'}".`);
  }
  if (dirty) {
    onFail('Production commands require a clean working tree so the deployment matches a commit.');
  }

  try {
    execFileSync('git', ['fetch', 'origin', 'main', '--quiet'], { cwd: repoRoot });
  } catch {
    onFail('Could not fetch origin/main. Refusing because the production source cannot be proven.');
  }
  const remoteHead = git(['rev-parse', 'origin/main']);
  if (head !== remoteHead) {
    onFail(
      `Production commands require local main to equal origin/main (local ${head.slice(0, 8)}, ` +
        `origin ${remoteHead.slice(0, 8)}).`,
    );
  }
  return { branch, head };
}
