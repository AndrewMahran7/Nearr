// services/media-worker/src/server/httpServer.ts
//
// Minimal Node HTTP server (no framework):
//   GET  /health                 → process is alive
//   GET  /ready                  → config + ffmpeg/ffprobe/yt-dlp + Supabase OK
//   POST /v1/process-media-tasks → claim + process a batch (worker secret auth)
//
// Secrets are never included in any response.

import http from 'node:http';
import { checkWorkerSecret } from '../auth/workerSecret.js';
import { validateConfig, redactedConfigSummary, type WorkerConfig } from '../config/env.js';
import { binaryAvailable } from '../util/exec.js';
import { processMediaTasks } from '../queue/processMediaTasks.js';
import type { TaskDeps } from '../pipeline/runMediaTask.js';
import { log } from '../util/logger.js';
import {
  inspectYtDlpRuntime,
  ytDlpRuntimeFields,
  type YtDlpRuntimeDiagnostic,
} from '../util/runtimeDiagnostics.js';

export type ServerContext = {
  cfg: WorkerConfig;
  deps: TaskDeps | null;
  /** Test seam; production always uses the bounded binary probe above. */
  inspectYtDlp?: (ytDlpPath: string) => Promise<YtDlpRuntimeDiagnostic>;
};

type RuntimeLogger = Pick<typeof log, 'info' | 'warn'>;

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(payload);
}

async function drainBody(req: http.IncomingMessage, maxBytes = 64 * 1024): Promise<void> {
  let total = 0;
  await new Promise<void>((resolve) => {
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) req.destroy();
    });
    req.on('end', () => resolve());
    req.on('error', () => resolve());
    req.on('close', () => resolve());
  });
}

async function handleReady(ctx: ServerContext, res: http.ServerResponse): Promise<void> {
  const cfgCheck = validateConfig(ctx.cfg);
  const [ffmpeg, ffprobe, ytDlpDiagnostic] = await Promise.all([
    binaryAvailable(ctx.cfg.ffmpegPath, '-version'),
    binaryAvailable(ctx.cfg.ffprobePath, '-version'),
    (ctx.inspectYtDlp ?? inspectYtDlpRuntime)(ctx.cfg.ytDlpPath),
  ]);

  let supabase = false;
  if (ctx.deps) {
    try {
      const { error } = await ctx.deps.client.from('share_media_tasks').select('id').limit(1);
      supabase = !error;
    } catch {
      supabase = false;
    }
  }

  const checks = {
    config: cfgCheck.ok,
    ffmpeg,
    ffprobe,
    ytdlp: ytDlpDiagnostic.status === 'ok',
    supabase,
  };
  const ready = Object.values(checks).every(Boolean);
  sendJson(res, ready ? 200 : 503, {
    status: ready ? 'ready' : 'not_ready',
    checks,
    capabilities: {
      aiNoteEnrichment: true,
      scrapeCreatorsTikTokFallback:
        ctx.cfg.scrapeCreatorsTikTokFallbackEnabled && !!ctx.cfg.scrapeCreatorsApiKey,
      scrapeCreatorsFacebookFallback:
        ctx.cfg.scrapeCreatorsFacebookFallbackEnabled && !!ctx.cfg.scrapeCreatorsApiKey,
    },
    runtime: ytDlpRuntimeFields(ytDlpDiagnostic),
    missingConfig: cfgCheck.ok ? [] : cfgCheck.missing,
  });
}

export async function logStartupRuntimeDiagnostics(
  ctx: ServerContext,
  logger: RuntimeLogger = log,
): Promise<YtDlpRuntimeDiagnostic> {
  const diagnostic = await (ctx.inspectYtDlp ?? inspectYtDlpRuntime)(ctx.cfg.ytDlpPath);
  const fields = ytDlpRuntimeFields(diagnostic);
  if (diagnostic.status === 'ok') logger.info('runtime_diagnostics', fields);
  else logger.warn('runtime_diagnostics', fields);
  return diagnostic;
}

export function startServer(ctx: ServerContext): http.Server {
  let inFlight = false;

  const server = http.createServer((req, res) => {
    const url = req.url ?? '/';
    const method = req.method ?? 'GET';

    void (async () => {
      try {
        if (method === 'GET' && url === '/health') {
          return sendJson(res, 200, { status: 'ok', service: 'nearr-media-worker' });
        }
        if (method === 'GET' && url === '/ready') {
          return await handleReady(ctx, res);
        }
        if (method === 'POST' && url.startsWith('/v1/process-media-tasks')) {
          const auth = req.headers['authorization'];
          const authHeader = Array.isArray(auth) ? auth[0] : auth;
          if (!checkWorkerSecret(authHeader, ctx.cfg.workerSecret)) {
            await drainBody(req);
            return sendJson(res, 401, { error: 'unauthorized' });
          }
          await drainBody(req);
          if (!ctx.deps) return sendJson(res, 503, { error: 'not_ready' });
          if (inFlight) return sendJson(res, 200, { ok: true, busy: true, claimed: 0, processed: 0 });
          inFlight = true;
          try {
            const result = await processMediaTasks(ctx.deps);
            return sendJson(res, 200, { ok: true, ...result });
          } finally {
            inFlight = false;
          }
        }
        return sendJson(res, 404, { error: 'not_found' });
      } catch (err) {
        log.error('request_error', { url, msg: err instanceof Error ? err.message : 'unknown' });
        return sendJson(res, 500, { error: 'internal_error' });
      }
    })();
  });

  server.listen(ctx.cfg.port, () => {
    log.info('listening', { port: ctx.cfg.port, config: redactedConfigSummary(ctx.cfg) });
    void logStartupRuntimeDiagnostics(ctx);
  });
  return server;
}
