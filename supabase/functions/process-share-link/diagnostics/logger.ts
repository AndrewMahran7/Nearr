// supabase/functions/process-share-link/diagnostics/logger.ts
//
// Edge-function logging helpers. Two surfaces:
//
//   1. `logShareDebug(stage, fields)` — single-line structured marker
//      used to grep through Edge Function logs ("share:fetch:start").
//      Mirrors prior `logShareDebug` in index.ts byte-for-byte so any
//      external log dashboards keep working.
//
//   2. `Timings` — append-only stopwatch the resolver uses to surface
//      per-step millisecond costs into the `extracted.timings` field.

// @ts-nocheck — Deno runtime.

export function logShareDebug(
  stage: string,
  fields: Record<string, unknown> = {},
): void {
  try {
    const safeFields: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined) continue;
      safeFields[k] = v;
    }
    // Plain console.log is the supported surface in Supabase Edge
    // logs; structured JSON travels through unchanged.
    console.log(
      JSON.stringify({ marker: 'share', stage, ...safeFields }),
    );
  } catch {
    // Defensive: never let logging throw into the request path.
  }
}

export class Timings {
  private readonly t0 = Date.now();
  private readonly entries: Record<string, number> = {};
  private lastMark = Date.now();

  /** Record elapsed-since-last-mark under `label`. */
  mark(label: string): void {
    const now = Date.now();
    this.entries[label] = now - this.lastMark;
    this.lastMark = now;
  }

  /** Record a single specific value (e.g. external API duration). */
  set(label: string, ms: number): void {
    this.entries[label] = Math.max(0, Math.round(ms));
  }

  total(): number {
    return Date.now() - this.t0;
  }

  toJSON(): Record<string, number> {
    return { ...this.entries, total_ms: this.total() };
  }
}
