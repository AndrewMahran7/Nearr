/** Type surface for scripts/lib/cliRunner.js (plain CommonJS, see that file). */

export type ResolvedCli = {
  /** Executable to spawn — a native binary, or process.execPath. */
  file: string;
  /** Arguments that must precede the caller's argv (e.g. the JS entry point). */
  prefixArgs: string[];
  /** How it was resolved, for diagnostics. */
  via: string;
};

/** Resolve a command to something spawnable WITHOUT a shell, or null. */
export function resolveCli(command: string): ResolvedCli | null;

/** Resolve a Node bin inside this repo's node_modules, or null. */
export function resolveLocalBin(specifier: string): string | null;

/** Run a CLI with an argv array (never a shell). Returns the exit status. */
export function runCli(
  command: string,
  args: string[],
  options?: { cwd?: string; stdio?: unknown },
): number;

/** Run a CLI and capture stdout. Throws on non-zero exit. */
export function captureCli(
  command: string,
  args: string[],
  options?: { cwd?: string },
): string;
