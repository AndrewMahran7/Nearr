// services/media-worker/src/index.ts
//
// Media worker entrypoint. Starts the HTTP server unconditionally (so /health
// is always available), and wires the processing dependencies only when the
// required configuration is present (otherwise /ready reports not_ready and
// /v1/process-media-tasks returns 503).

import { loadConfig, validateConfig } from './config/env.js';
import { createAdminClient } from './db/supabase.js';
import { InstagramMediaResolver } from './resolvers/InstagramMediaResolver.js';
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
      resolvers: [new InstagramMediaResolver(cfg)],
      transcription: selectTranscriptionProvider(cfg),
      model: selectModelProvider(cfg),
      ocr: selectOcrProvider(cfg),
    };
  } else {
    log.warn('starting_not_ready', { missingConfig: check.missing });
  }

  const ctx: ServerContext = { cfg, deps };
  startServer(ctx);

  const shutdown = (signal: string) => {
    log.info('shutdown', { signal });
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main();
