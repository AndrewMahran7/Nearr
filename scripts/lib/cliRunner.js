/**
 * scripts/lib/cliRunner.js
 *
 * Spawn an external CLI with an argv ARRAY and never a shell.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every deployment wrapper used `spawnSync(cmd, args, { shell: process.platform === 'win32' })`,
 * because Node refuses to execute a Windows `.cmd` shim without a shell. But
 * with `shell: true` Node joins argv into ONE command line with no quoting, so
 *
 *   npm run dev:update -- -m "Fix RootLayout development render loop"
 *
 * reached EAS as five separate arguments:
 *
 *   Unexpected arguments: development, RootLayout, render, loop
 *
 * Same mechanism, worse consequence: anything a caller puts in a message would
 * be interpreted by cmd.exe. It also emits Node's DEP0190 warning, which is
 * warning about exactly this.
 *
 * The fix is to stop needing a shell. npm's Windows shim is a small .cmd that
 * ends in a line naming the real JS entry point:
 *
 *   ... "%_prog%"  "%dp0%\node_modules\eas-cli\bin\run" %*
 *
 * so we read the entry out of the shim and run it with `process.execPath`
 * directly. Native executables (supabase is a real .exe) are spawned as-is.
 * Either way `shell` stays false and argv is passed as an array, which means a
 * message containing spaces, quotes, `&&` or `$(...)` is one opaque argument
 * with no interpolation anywhere.
 *
 * If neither form can be resolved we refuse and print the command for the user
 * to run by hand. We never fall back to building a shell string.
 */

const { execFileSync, spawnSync } = require('node:child_process');
const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');

/** @type {Map<string, {file: string, prefixArgs: string[], via: string} | null>} */
const cache = new Map();

/** Locate a command on PATH without a shell. Returns [] when not found. */
function whichAll(command) {
  const finder = process.platform === 'win32' ? 'where' : 'which';
  try {
    return execFileSync(finder, [command], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Read the JS entry point out of an npm-generated Windows .cmd shim.
 * The generated shim always ends with the interpreter followed by a quoted
 * path relative to the shim directory (`%dp0%`).
 */
function entryFromCmdShim(shimPath) {
  let contents;
  try {
    contents = readFileSync(shimPath, 'utf8');
  } catch {
    return null;
  }
  // The shim mentions several %dp0%-relative paths: first an `IF EXIST
  // "%dp0%\node.exe"` probe for a bundled interpreter, then the real entry
  // point. Collect them all and pick the one under node_modules — taking the
  // first match would resolve the interpreter probe instead.
  const dir = path.dirname(shimPath);
  const candidates = [];
  for (const re of [/"%dp0%\\(.+?)"/gi, /"%~dp0\\(.+?)"/gi]) {
    for (const match of contents.matchAll(re)) candidates.push(match[1]);
  }
  const resolve = (relative) => path.join(dir, relative);
  const underNodeModules = candidates.find(
    (relative) => /node_modules/i.test(relative) && existsSync(resolve(relative)),
  );
  if (underNodeModules) return resolve(underNodeModules);
  const other = candidates.find(
    (relative) => !/node(\.exe)?$/i.test(relative) && existsSync(resolve(relative)),
  );
  return other ? resolve(other) : null;
}

/**
 * Resolve a command to something spawnable WITHOUT a shell.
 * @returns {{file: string, prefixArgs: string[], via: string} | null}
 */
function resolveCli(command) {
  if (cache.has(command)) return cache.get(command);

  // Already an absolute path to a real executable (e.g. process.execPath):
  // nothing to look up, and PATH search would not find it anyway.
  if (path.isAbsolute(command) && existsSync(command)) {
    const direct = { file: command, prefixArgs: [], via: 'absolute path' };
    cache.set(command, direct);
    return direct;
  }

  let resolved = null;
  const candidates = whichAll(command);

  if (process.platform === 'win32') {
    // A real executable can be spawned directly.
    const exe = candidates.find((c) => /\.(exe|com)$/i.test(c));
    if (exe) {
      resolved = { file: exe, prefixArgs: [], via: 'native executable' };
    } else {
      const shim = candidates.find((c) => /\.cmd$/i.test(c));
      const entry = shim ? entryFromCmdShim(shim) : null;
      if (entry) {
        resolved = { file: process.execPath, prefixArgs: [entry], via: 'node + npm shim entry' };
      }
    }
  } else if (candidates.length > 0) {
    resolved = { file: candidates[0], prefixArgs: [], via: 'PATH' };
  }

  cache.set(command, resolved);
  return resolved;
}

/**
 * Resolve a Node script inside this repo's own node_modules (e.g. ts-node),
 * so wrappers never have to shell out through `npx`.
 * @returns {string | null}
 */
function resolveLocalBin(specifier) {
  try {
    return require.resolve(specifier, { paths: [path.resolve(__dirname, '..', '..')] });
  } catch {
    return null;
  }
}

/**
 * Run a CLI with an argv array. Returns its exit status.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {{cwd?: string, stdio?: any, encoding?: string}} [options]
 * @returns {number}
 */
function runCli(command, args, options = {}) {
  const resolved = resolveCli(command);
  if (!resolved) {
    throw new Error(
      `Could not locate "${command}" as something runnable without a shell.\n` +
        `Install it, or run this by hand:\n\n  ${command} ${args.join(' ')}\n`,
    );
  }
  const result = spawnSync(resolved.file, [...resolved.prefixArgs, ...args], {
    cwd: options.cwd,
    stdio: options.stdio ?? 'inherit',
    // Deliberately absent: shell. See the header.
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

/**
 * Run a CLI and capture stdout. Throws on non-zero exit.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {{cwd?: string}} [options]
 * @returns {string}
 */
function captureCli(command, args, options = {}) {
  const resolved = resolveCli(command);
  if (!resolved) {
    throw new Error(`Could not locate "${command}" as something runnable without a shell.`);
  }
  const result = spawnSync(resolved.file, [...resolved.prefixArgs, ...args], {
    cwd: options.cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) throw result.error;
  if ((result.status ?? 1) !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} exited ${result.status}: ${(result.stderr || '').trim()}`,
    );
  }
  return result.stdout ?? '';
}

module.exports = { resolveCli, resolveLocalBin, runCli, captureCli };
