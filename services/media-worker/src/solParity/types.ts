import type { SelectedFrame, TranscriptSegment, OcrSegment } from '../types/media.js';

export const SOL_PARITY_MODEL = 'gpt-5.6-sol';
export const SOL_PARITY_PROMPT_VERSION = 'sol-parity-natural-v1';
export const SOL_PARITY_INPUT_BOUNDS = Object.freeze({
  captionCharacters: 4_000,
  transcriptCharacters: 8_000,
  ocrCharacters: 3_000,
  locationCharacters: 300,
  clueItems: 8,
  clueCharacters: 240,
  alternativeItems: 3,
});

export type FrameArm = 'F1' | 'F2' | 'F3';
export type ModelArm = 'M1' | 'M2' | 'M3';
export type SceneClass = 'ONE_DESTINATION' | 'MULTIPLE_DESTINATIONS' | 'CONTEXT_ONLY' | 'UNKNOWN';
export type EntityType =
  | 'NAMED_NATURAL_FEATURE'
  | 'BUSINESS'
  | 'HOTEL'
  | 'LANDMARK'
  | 'EVENT'
  | 'ADMIN_AREA'
  | 'BROAD_AREA'
  | 'UNKNOWN';
export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW';

export type SolAlternative = {
  name: string;
  entity_type: EntityType;
  city: string | null;
  region: string | null;
  country: string | null;
};

export type SolDestination = SolAlternative & {
  confidence: Confidence;
  alternatives: SolAlternative[];
  supporting_clues: string[];
  contradictions: string[];
  web_research_used: boolean;
};

export type SolParityPayload = {
  scene_class: SceneClass;
  destination_count: number;
  results: SolDestination[];
};

/** Deliberately contains no label, expected answer, prior hypothesis, or candidate fields. */
export type InferenceCase = {
  case_id: string;
  source: string;
  platform: 'instagram' | 'tiktok' | 'youtube' | 'facebook' | 'snapchat';
  source_url: string;
  categories: string[];
  manual_frames_directory: string;
};

export type SourceEvidence = {
  caption: string | null;
  transcript: TranscriptSegment[];
  ocr: OcrSegment[];
  source_location_context: string | null;
  creator_handle: string | null;
  creator_name: string | null;
};

export type FrameSet = {
  arm: FrameArm;
  strategy: string;
  considered_count: number;
  mean_pairwise_distance: number | null;
  frames: SelectedFrame[];
};

export type SolUsage = {
  input_tokens: number | null;
  cached_input_tokens: number | null;
  output_tokens: number | null;
  reasoning_tokens: number | null;
  total_tokens: number | null;
};

export type PersistedModelAttempt = {
  schema_version: 1;
  run_id: string;
  attempt_id: string;
  persisted_at: string;
  case_id: string;
  source_url: string;
  platform: string;
  frame_arm: FrameArm;
  model_arm: ModelArm;
  model: string;
  prompt_version: string;
  web_search_enabled: boolean;
  images_only: boolean;
  input_manifest: {
    frame_count: number;
    frames: Array<{ timestamp_seconds: number; sha256: string; width: number; height: number; reason: string }>;
    caption_characters: number;
    transcript_characters: number;
    ocr_characters: number;
    source_location_characters: number;
  };
  timings_ms: {
    acquisition: number | null;
    frame_extraction: number | null;
    transcription: number | null;
    ocr: number | null;
    sol: number;
    web_search: number | null;
    canonicalization: number | null;
    total: number;
  };
  usage: SolUsage;
  estimated_model_cost_usd: number | null;
  web_search_calls: number;
  web_search_queries: string[];
  web_search_sources: Array<{ title: string | null; url: string }>;
  response_id: string | null;
  response_status: string | null;
  raw_model_output: string | null;
  payload: SolParityPayload | null;
  failure: { kind: 'missing_key' | 'transport' | 'http' | 'malformed'; code: string } | null;
};

export type CanonicalStatus = 'CANONICAL_EXACT' | 'CANONICAL_ALIAS' | 'AMBIGUOUS_CANONICAL' | 'NAMED_LEAD';
export type CanonicalizedDestination = {
  model_identity: SolDestination;
  status: CanonicalStatus;
  selected: null | {
    google_place_id: string;
    name: string;
    formatted_address: string | null;
    latitude: number | null;
    longitude: number | null;
    provider_types: string[];
  };
  alternatives: Array<{ google_place_id: string; name: string; formatted_address: string | null }>;
  places_calls: number;
  query: string;
};

export type SimulatedDecision =
  | 'WOULD_AUTO_SAVE'
  | 'WOULD_REVIEW'
  | 'WOULD_SHOW_NAMED_LEAD'
  | 'WOULD_SHOW_OPTIONS'
  | 'WOULD_SHOW_FALLBACK';
