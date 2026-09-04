import type { InferenceCase } from './types.js';

const ALLOWED_INFERENCE_KEYS = new Set(['case_id', 'source', 'platform', 'source_url', 'categories', 'manual_frames_directory']);

export function validateInferenceCase(value: unknown): InferenceCase {
  if (!value || typeof value !== 'object') throw new Error('inference_case_not_object');
  const raw = value as Record<string, unknown>;
  const forbidden = Object.keys(raw).filter((key) => !ALLOWED_INFERENCE_KEYS.has(key));
  if (forbidden.length) throw new Error(`inference_case_forbidden_fields:${forbidden.join(',')}`);
  if (typeof raw.case_id !== 'string' || typeof raw.source_url !== 'string' || typeof raw.platform !== 'string') throw new Error('inference_case_missing_required');
  if (!['instagram', 'tiktok', 'youtube', 'facebook', 'snapchat'].includes(raw.platform)) throw new Error('inference_case_bad_platform');
  if (!Array.isArray(raw.categories) || typeof raw.source !== 'string' || typeof raw.manual_frames_directory !== 'string') throw new Error('inference_case_missing_metadata');
  return raw as InferenceCase;
}
