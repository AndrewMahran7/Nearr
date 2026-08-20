/** Type surface for scripts/lib/updateArgs.js (plain CommonJS, see that file). */

export type Lane = 'development' | 'preview' | 'production';

export type LaneTarget = {
  channel: string;
  environment: string;
  appEnv: string;
};

export const LANES: Record<Lane, LaneTarget>;

/** Flags the wrapper owns; a caller supplying one is refused. */
export const RESERVED_FLAGS: string[];

/** Split caller arguments into message, forwarded args, and confirmation. */
export function parseUpdateArgs(rest: string[]): {
  message: string;
  passthrough: string[];
  confirmed: boolean;
};

/** Build the full `eas` argv with the lane's targeting fixed. Throws on retarget. */
export function buildUpdateArgs(lane: string, passthrough: string[]): string[];
