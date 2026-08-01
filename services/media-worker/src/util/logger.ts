// services/media-worker/src/util/logger.ts
//
// Minimal structured logger. Emits one JSON line per event, prefixed for easy
// grepping. NEVER pass secrets, tokens, cookies, full media URLs (with query
// tokens), raw transcripts, or entire model responses here.

type Fields = Record<string, unknown>;

const SECRET_KEY_RE = /(secret|token|key|authorization|cookie|password)/i;

function scrub(fields: Fields): Fields {
  const out: Fields = {};
  for (const [k, v] of Object.entries(fields)) {
    if (SECRET_KEY_RE.test(k)) {
      out[k] = '[redacted]';
    } else if (typeof v === 'string' && v.length > 512) {
      out[k] = `${v.slice(0, 512)}…`;
    } else {
      out[k] = v;
    }
  }
  return out;
}

function emit(level: 'info' | 'warn' | 'error', event: string, fields: Fields): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...scrub(fields) });
  if (level === 'error') console.error(`[media-worker] ${line}`);
  else if (level === 'warn') console.warn(`[media-worker] ${line}`);
  else console.log(`[media-worker] ${line}`);
}

export const log = {
  info: (event: string, fields: Fields = {}) => emit('info', event, fields),
  warn: (event: string, fields: Fields = {}) => emit('warn', event, fields),
  error: (event: string, fields: Fields = {}) => emit('error', event, fields),
};
