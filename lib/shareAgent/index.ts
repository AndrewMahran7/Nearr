/**
 * Public entry points for the share-extraction agent.
 *
 * STAGE 2 — agent now drives the candidate picker / manual fallback in
 * the host app. Auto-save still goes through the legacy pipeline; the
 * `userFacing` module enforces that hardcap. Do not import from app/ or
 * components/ from inside this folder.
 */

export * from './types.ts';
export * from './tools.ts';
export * from './safety.ts';
export * from './agent.ts';
export * from './userFacing.ts';
