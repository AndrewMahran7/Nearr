// services/media-worker/src/index.ts
//
// Media worker entrypoint. Starts the HTTP server unconditionally (so /health
// is always available), and wires the processing dependencies only when the
// required configuration is present (otherwise /ready reports not_ready and
// /v1/process-media-tasks returns 503).

import { loadConfig, validateConfig } from './config/env.js';
import { createAdminClient } from './db/supabase.js';
import { InstagramFallbackMediaResolver } from './resolvers/InstagramFallbackMediaResolver.js';
import { TikTokFallbackMediaResolver } from './resolvers/TikTokFallbackMediaResolver.js';
import { ScrapeCreatorsInstagramProvider } from './providers/ScrapeCreatorsInstagramProvider.js';
import { ScrapeCreatorsTikTokProvider } from './providers/ScrapeCreatorsTikTokProvider.js';
import { YouTubeMediaResolver } from './resolvers/YouTubeMediaResolver.js';
import { FacebookMediaResolver } from './resolvers/FacebookMediaResolver.js';
import { FacebookFallbackMediaResolver } from './resolvers/FacebookFallbackMediaResolver.js';
import { ScrapeCreatorsFacebookProvider } from './providers/ScrapeCreatorsFacebookProvider.js';
import { SnapchatMediaResolver } from './resolvers/SnapchatMediaResolver.js';
import { selectTranscriptionProvider } from './providers/transcription.js';
import { selectModelProvider } from './providers/model.js';
import { selectOcrProvider } from './providers/ocr.js';
import { startServer, type ServerContext } from './server/httpServer.js';
import type { TaskDeps } from './pipeline/runMediaTask.js';
import { log } from './util/logger.js';

function main(): void {
  const cfg = loadConfig();

  let deps: TaskDeps | null = null;
  const check = validateConfig(cfg);
  if (check.ok) {
    const client = createAdminClient(cfg);
    deps = {
      cfg,
      client,
      resolvers: [
        new InstagramFallbackMediaResolver(cfg, new ScrapeCreatorsInstagramProvider(cfg)),
        new TikTokFallbackMediaResolver(cfg, new ScrapeCreatorsTikTokProvider(cfg)),
        new YouTubeMediaResolver(cfg),
        new FacebookFallbackMediaResolver(cfg, new ScrapeCreatorsFacebookProvider(cfg), new FacebookMediaResolver(cfg)),
        new SnapchatMediaResolver(cfg),
      ],
      transcription: selectTranscriptionProvider(cfg),
      model: selectModelProvider(cfg),
      ocr: selectOcrProvider(cfg),
    };
  } else {
    log.warn('starting_not_ready', { missingConfig: check.missing });
  }

  const ctx: ServerContext = { cfg, deps };
  const server = startServer(ctx);

  // Graceful shutdown for the container (Railway sends SIGTERM, then SIGKILL
  // after its drain window). Stop accepting new connections, then exit.
  // In-flight work is safe to abandon: temp storage is ephemeral and the queue
  // reclaims any stale lease, so a redeploy never strands or double-processes a
  // task. The bounded timer guarantees we exit well inside the drain window
  // instead of waiting on a long-running job.
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info('shutdown', { signal });
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main();
