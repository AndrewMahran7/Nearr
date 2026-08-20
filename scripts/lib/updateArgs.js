/**
 * scripts/lib/updateArgs.js
 *
 * Pure argv construction for the guarded EAS Update wrappers. Kept separate
 * from scripts/publishUpdate.mjs so the argument handling can be tested
 * without publishing anything.
 *
 * Two defects this encodes against:
 *
 *  1. A message with spaces was destroyed. The wrapper spawned with
 *     `shell: true`, which joins argv into one unquoted command line, so
 *     `-m "Fix RootLayout development render loop"` reached EAS as five
 *     arguments. Argv is now built as an ARRAY and handed to a shell-free
 *     spawn (scripts/lib/cliRunner.js), so the message stays one element no
 *     matter what is in it.
 *
 *  2. The lane could be overridden. Caller arguments were appended AFTER the
 *     wrapper's own `--channel`/`--environment`, and EAS honours the last
 *     occurrence — so `npm run dev:update -- -m "x" --channel production`
 *     published to production from the development wrapper. Targeting flags
 *     are now rejected outright rather than merged.
 */

/** lane -> the channel and EAS environment it is permitted to touch. */
const LANES = {
  development: {
    channel: 'development',
    environment: 'development',
    appEnv: 'development',
  },
  preview: {
    channel: 'preview',
    environment: 'preview',
    appEnv: 'preview',
  },
  production: {
    channel: 'production',
    environment: 'production',
    appEnv: 'production',
  },
};

/**
 * Flags that decide WHERE an update lands. The wrapper owns these; a caller
 * supplying one is trying (or about to accidentally manage) to retarget the
 * lane, so it is refused instead of silently winning or silently losing.
 */
const RESERVED_FLAGS = ['--channel', '--environment', '--branch', '--auto'];

/** @param {string} arg */
function reservedFlagOf(arg) {
  return RESERVED_FLAGS.find((flag) => arg === flag || arg.startsWith(`${flag}=`)) ?? null;
}

/**
 * Split the caller's arguments into the update message, the arguments to
 * forward, and whether they confirmed a production publish.
 *
 * @param {string[]} rest
 * @returns {{message: string, passthrough: string[], confirmed: boolean}}
 */
function parseUpdateArgs(rest) {
  const confirmed = rest.includes('--yes');
  const passthrough = rest.filter((arg) => arg !== '--yes');

  let message = '';
  for (let i = 0; i < passthrough.length; i += 1) {
    if (passthrough[i] === '-m' || passthrough[i] === '--message') {
      message = passthrough[i + 1] ?? '';
      i += 1;
    } else if (passthrough[i].startsWith('--message=')) {
      message = passthrough[i].slice('--message='.length);
    }
  }

  return { message, passthrough, confirmed };
}

/**
 * Build the full argv for `eas`, with the lane's targeting fixed.
 *
 * @param {string} lane
 * @param {string[]} passthrough
 * @returns {string[]}
 * @throws when the lane is unknown or a caller argument would retarget it
 */
function buildUpdateArgs(lane, passthrough) {
  const target = LANES[lane];
  if (!target) {
    throw new Error(
      `Unknown lane "${lane}". Expected one of: ${Object.keys(LANES).join(', ')}.`,
    );
  }

  for (const arg of passthrough) {
    const reserved = reservedFlagOf(arg);
    if (reserved) {
      throw new Error(
        `Refusing ${reserved}: the ${lane} wrapper always publishes to ` +
          `--channel ${target.channel} --environment ${target.environment}. ` +
          'Use the wrapper for the lane you actually want.',
      );
    }
  }

  return [
    'update',
    '--channel',
    target.channel,
    '--environment',
    target.environment,
    ...passthrough,
  ];
}

module.exports = { LANES, RESERVED_FLAGS, buildUpdateArgs, parseUpdateArgs };
