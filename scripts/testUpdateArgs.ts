/**
 * scripts/testUpdateArgs.ts
 *
 * Regression test for the guarded EAS Update wrappers
 * (scripts/lib/updateArgs.js + scripts/lib/cliRunner.js).
 *
 * Two real failures are locked down here.
 *
 * 1. A message with spaces was destroyed. The wrapper spawned with
 *    `shell: true`, which joins argv into one unquoted command line, so
 *
 *      npm run dev:update -- -m "Fix RootLayout development render loop"
 *
 *    reached EAS as:
 *
 *      Unexpected arguments: development, RootLayout, render, loop
 *
 *    Node's DEP0190 warning was pointing at the same mechanism. The message is
 *    now one element of an argv ARRAY handed to a shell-free spawn.
 *
 * 2. The lane could be retargeted. Caller arguments were appended AFTER the
 *    wrapper's own `--channel`/`--environment`, and EAS honours the last
 *    occurrence, so `npm run dev:update -- -m "x" --channel production`
 *    published to PRODUCTION from the development wrapper.
 *
 * Nothing here spawns EAS; it is all argv construction plus a resolver check.
 *
 * Run:
 *   npx ts-node -P scripts/tsconfig.json scripts/testUpdateArgs.ts
 */

import { resolveCli } from './lib/cliRunner';
import { LANES, buildUpdateArgs, parseUpdateArgs } from './lib/updateArgs';

let failures = 0;
function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`PASS ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

const MESSAGE = 'Fix RootLayout development render loop';

// ---- The reported failure: a message with spaces ---------------------------

const devArgs = buildUpdateArgs('development', ['-m', MESSAGE]);
check(
  'a spaced message survives as ONE argv element',
  devArgs.filter((a) => a === MESSAGE).length === 1,
  `got ${JSON.stringify(devArgs)}`,
);
check(
  'the message is never split on spaces',
  !devArgs.includes('RootLayout') && !devArgs.includes('loop'),
  `got ${JSON.stringify(devArgs)}`,
);
check(
  'the -m flag is still adjacent to its value',
  devArgs[devArgs.indexOf('-m') + 1] === MESSAGE,
);
check('parseUpdateArgs reads the spaced message', parseUpdateArgs(['-m', MESSAGE]).message === MESSAGE);
check(
  'parseUpdateArgs reads --message=value form',
  parseUpdateArgs([`--message=${MESSAGE}`]).message === MESSAGE,
);
check('parseUpdateArgs strips --yes from passthrough', !parseUpdateArgs(['-m', 'x', '--yes']).passthrough.includes('--yes'));
check('parseUpdateArgs reports confirmation', parseUpdateArgs(['-m', 'x', '--yes']).confirmed === true);
check('parseUpdateArgs defaults to unconfirmed', parseUpdateArgs(['-m', 'x']).confirmed === false);

// ---- Shell metacharacters stay inert ---------------------------------------
// These are only dangerous if argv is flattened into a shell command line.
// As array elements they are ordinary text.

for (const hostile of [
  'msg; echo pwned',
  'msg && echo pwned',
  'msg $(echo pwned)',
  'msg `echo pwned`',
  'msg | echo pwned',
  'msg" & echo pwned & "',
  'msg %PATH%',
]) {
  const args = buildUpdateArgs('development', ['-m', hostile]);
  check(
    `shell metacharacters stay one argument: ${JSON.stringify(hostile.slice(0, 22))}`,
    args.filter((a) => a === hostile).length === 1 && args.length === 7,
    `got ${JSON.stringify(args)}`,
  );
}

// ---- Each wrapper can only reach its own lane ------------------------------

for (const [lane, target] of Object.entries(LANES)) {
  const args = buildUpdateArgs(lane, ['-m', MESSAGE]);
  const channel = args[args.indexOf('--channel') + 1];
  const environment = args[args.indexOf('--environment') + 1];
  check(`${lane} wrapper targets channel ${target.channel}`, channel === target.channel);
  check(`${lane} wrapper targets environment ${target.environment}`, environment === target.environment);
}

check(
  'development never mentions the production channel',
  !buildUpdateArgs('development', ['-m', MESSAGE]).includes('production'),
);
check(
  'preview never mentions the production channel',
  !buildUpdateArgs('preview', ['-m', MESSAGE]).includes('production'),
);

// ---- Retargeting is refused, not merged ------------------------------------

function refuses(lane: string, passthrough: string[]): boolean {
  try {
    buildUpdateArgs(lane, passthrough);
    return false;
  } catch {
    return true;
  }
}

check(
  'dev wrapper refuses --channel production',
  refuses('development', ['-m', MESSAGE, '--channel', 'production']),
  'EAS honours the LAST --channel, so appending it would have won',
);
check('dev wrapper refuses --channel=production', refuses('development', ['-m', MESSAGE, '--channel=production']));
check('dev wrapper refuses --environment production', refuses('development', ['-m', MESSAGE, '--environment', 'production']));
check('dev wrapper refuses --branch', refuses('development', ['-m', MESSAGE, '--branch', 'main']));
check('dev wrapper refuses --auto', refuses('development', ['-m', MESSAGE, '--auto']));
check('preview wrapper refuses retargeting too', refuses('preview', ['-m', MESSAGE, '--channel', 'production']));
check('an unknown lane is refused', refuses('staging', ['-m', MESSAGE]));

// Harmless passthrough still works.
const withExtra = buildUpdateArgs('development', ['-m', MESSAGE, '--non-interactive']);
check('harmless flags are still forwarded', withExtra.includes('--non-interactive'));

// ---- The runner never resolves to a shell ----------------------------------

const easResolved = resolveCli('eas');
check('eas resolves to something runnable without a shell', easResolved !== null, 'is eas-cli installed?');
if (easResolved) {
  check(
    'eas is not resolved through a .cmd/.bat shim',
    !/\.(cmd|bat)$/i.test(easResolved.file),
    `resolved to ${easResolved.file}`,
  );
  check(
    'eas resolves to a native executable or node + a JS entry',
    easResolved.prefixArgs.length === 0 || /\.(js|mjs|cjs)$|[\\/]run$/i.test(easResolved.prefixArgs[0]),
    `prefixArgs=${JSON.stringify(easResolved.prefixArgs)}`,
  );
}

if (failures > 0) {
  console.error(`\n${failures} update-argument test(s) FAILED`);
  process.exit(1);
}
console.log('\nAll update-argument tests passed.');
