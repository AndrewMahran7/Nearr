// services/media-worker/src/providers/ocr.ts
//
// Visible-text (OCR) provider abstraction. Default is `noop`: we do NOT add a
// heavy OCR dependency (tesseract, etc.) without proof it beats the current
// stack. When a multimodal model is configured it reads visible text from the
// frames directly in the analyze step, so a dedicated OCR pass is optional.
//
// A real OCR engine can slot in here later behind MEDIA_OCR_PROVIDER without
// touching the pipeline.

import type { WorkerConfig } from '../config/env.js';
import type { OcrSegment, SelectedFrame } from '../types/media.js';

export type OcrInput = {
  frames: SelectedFrame[];
  signal: AbortSignal;
};

export interface OcrProvider {
  readonly name: string;
  extract(input: OcrInput): Promise<OcrSegment[]>;
}

class NoopOcr implements OcrProvider {
  readonly name = 'noop';
  async extract(): Promise<OcrSegment[]> {
    return [];
  }
}

export function selectOcrProvider(cfg: WorkerConfig): OcrProvider {
  // 'model' means "let the analyze step read frames" → no separate OCR pass.
  switch (cfg.ocrProvider) {
    case 'noop':
    case 'model':
    default:
      return new NoopOcr();
  }
}

/** Deduplicate near-identical visible-text lines across adjacent frames. Pure
 *  and unit-testable. Keeps the earliest occurrence of each normalized string. */
export function deduplicateOcrSegments(segments: OcrSegment[]): OcrSegment[] {
  const seen = new Set<string>();
  const out: OcrSegment[] = [];
  for (const seg of segments) {
    const key = seg.text.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(seg);
  }
  return out;
}
