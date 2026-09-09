import * as fs from 'fs';
import * as path from 'path';

export type TutorialPlatform = 'instagram' | 'tiktok' | 'facebook' | 'youtube';
export type TutorialEligibility =
  | 'candidate'
  | 'primary'
  | 'backup'
  | 'ineligible'
  | 'quarantined';
export type GroundTruthStatus = 'verified' | 'provisional' | 'unverified';
export type SourceStatus = 'public' | 'unavailable' | 'blocked' | 'unknown';
export type SourceHealthStatus = 'healthy' | 'degraded' | 'unavailable' | 'blocked';
export type QualificationOutcome =
  | 'pass'
  | 'controlled_non_success'
  | 'hard_fail'
  | 'infrastructure_failure';

export type TutorialMetadata = {
  groundTruthStatus: GroundTruthStatus;
  expectedGooglePlaceId: string | null;
  expectedCanonicalPlaceName: string | null;
  expectedCityRegion: string | null;
  expectedCountry: string | null;
  expectedCoordinates?: { latitude: number; longitude: number } | null;
  groundTruthEvidence?: string[];
  interestTags: string[];
  sourceStatus: SourceStatus;
  sourceHealth?: {
    lastCheckedAt: string;
    status: SourceHealthStatus;
    identityMarker: string;
    checkMethod: string;
  };
  eligibility: TutorialEligibility;
  singlePlace: boolean | null;
  triviallyDisclosed: boolean | null;
  allowedTerminalOutcomes: string[];
  /** Hidden-place tutorials must actually exercise media analysis rather than
   * pass through a reused/metadata-only result. */
  expectedRecognitionPath?: 'metadata' | 'media_fallback' | 'either';
  qualification: {
    lastQualifiedAt: string;
    attempts: number;
    freshJobs: number;
    mediaFallbackObserved: number;
    correct: number;
    controlledNonSuccess: number;
    wrong: number;
    wrongSave: number;
    infrastructureFailure: number;
    medianLatencyMs: number | null;
  } | null;
  suitabilityNotes: string;
  limitations: string[];
};

export type TutorialCorpusEntry = {
  id: string;
  platform: string;
  url: string;
  tutorial?: TutorialMetadata;
};

export type TutorialCorpus = {
  version: number;
  safetyCoverage?: Array<{
    riskClass: string;
    fixture: string;
    expectedBehavior: string;
  }>;
  entries: TutorialCorpusEntry[];
};

export type RecognitionObservation = {
  terminalStatus: string;
  decision: string | null;
  returnedGooglePlaceIds: string[];
  savedGooglePlaceIds: string[];
  sourceAvailable: boolean;
  infrastructureFailure: string | null;
};

export type QualificationJobFailure = {
  status: string;
  failureCategory?: string | null;
  failureCode?: string | null;
  failureReason?: string | null;
  needsHelpReason?: string | null;
};

/** Technical terminal states invalidate a trial; they are never recognition
 * non-successes and must not be counted toward the three fresh repetitions. */
export function qualificationInfrastructureFailure(
  job: QualificationJobFailure,
): string | null {
  const code = job.failureCode?.trim() || job.failureReason?.trim() || job.needsHelpReason?.trim() || '';
  if (job.failureCategory === 'technical_failure') return code || 'technical_failure';
  if (
    job.status === 'failed' &&
    /(?:fresh_recognition_unavailable|metadata_unavailable|enqueue_media_task|worker|provider|acquisition|timeout)/i.test(code)
  ) {
    return code || 'technical_failure';
  }
  return null;
}

export function loadTutorialCorpus(
  corpusPath = path.resolve(__dirname, 'mediaRegressionCorpus.json'),
): TutorialCorpus {
  return JSON.parse(fs.readFileSync(corpusPath, 'utf8')) as TutorialCorpus;
}

export function tutorialEntries(corpus: TutorialCorpus): Array<TutorialCorpusEntry & { tutorial: TutorialMetadata }> {
  return corpus.entries.filter(
    (entry): entry is TutorialCorpusEntry & { tutorial: TutorialMetadata } => !!entry.tutorial,
  );
}

export function validateTutorialCorpus(corpus: TutorialCorpus): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const entry of corpus.entries) {
    if (!entry.id || ids.has(entry.id)) errors.push(`duplicate or missing fixture id: ${entry.id || '(missing)'}`);
    ids.add(entry.id);
    if (!entry.tutorial) continue;

    const t = entry.tutorial;
    if (!(['instagram', 'tiktok', 'facebook', 'youtube'] as string[]).includes(entry.platform)) {
      errors.push(`${entry.id}: tutorial platform is unsupported`);
    }
    try {
      const source = new URL(entry.url);
      if (source.protocol !== 'https:') errors.push(`${entry.id}: tutorial source must use https`);
    } catch {
      errors.push(`${entry.id}: invalid source URL`);
    }
    if (!t.interestTags.length) errors.push(`${entry.id}: interestTags must not be empty`);
    if (!t.allowedTerminalOutcomes.length) errors.push(`${entry.id}: allowedTerminalOutcomes must not be empty`);
    if (!t.suitabilityNotes.trim()) errors.push(`${entry.id}: suitabilityNotes is required`);

    if (t.eligibility === 'primary' || t.eligibility === 'backup') {
      if (t.groundTruthStatus !== 'verified') errors.push(`${entry.id}: eligible fixture needs verified ground truth`);
      if (t.sourceStatus !== 'public') errors.push(`${entry.id}: eligible fixture source must be public`);
      if (!t.sourceHealth || t.sourceHealth.status !== 'healthy' || !t.sourceHealth.identityMarker.trim()) {
        errors.push(`${entry.id}: eligible fixture needs a healthy timestamped source identity check`);
      }
      if (t.singlePlace !== true) errors.push(`${entry.id}: eligible fixture must be single-place`);
      if (t.triviallyDisclosed !== false) errors.push(`${entry.id}: eligible fixture cannot be trivially disclosed`);
      if (!t.expectedGooglePlaceId || !t.expectedCanonicalPlaceName || !t.expectedCityRegion || !t.expectedCountry) {
        errors.push(`${entry.id}: eligible fixture needs complete place ground truth`);
      }
      if (!t.expectedCoordinates || !Number.isFinite(t.expectedCoordinates.latitude) || !Number.isFinite(t.expectedCoordinates.longitude)) {
        errors.push(`${entry.id}: eligible fixture needs canonical coordinates`);
      }
      if (!t.groundTruthEvidence || t.groundTruthEvidence.length < 2) {
        errors.push(`${entry.id}: eligible fixture needs at least two independent ground-truth references`);
      }
      const q = t.qualification;
      if (!q || q.attempts < 3 || q.freshJobs !== q.attempts || q.correct !== q.attempts || q.wrong !== 0 || q.wrongSave !== 0 || q.infrastructureFailure !== 0) {
        errors.push(`${entry.id}: eligible fixture needs at least three fresh, all-correct Dev runs and zero wrong/infrastructure runs`);
      }
      if (q && t.expectedRecognitionPath === 'media_fallback' && q.mediaFallbackObserved !== q.attempts) {
        errors.push(`${entry.id}: eligible fixture must observe media fallback in every qualification run`);
      }
    }
  }
  return errors;
}

/**
 * Evaluate only after the live pipeline has completed. Expected ground truth is
 * deliberately absent from the request body and is used here only as an assertion.
 */
export function classifyRecognition(
  expectedGooglePlaceId: string | null,
  observation: RecognitionObservation,
): { outcome: QualificationOutcome; reason: string } {
  if (observation.infrastructureFailure) {
    return { outcome: 'infrastructure_failure', reason: observation.infrastructureFailure };
  }
  if (!observation.sourceAvailable) {
    return { outcome: 'infrastructure_failure', reason: 'source_unavailable_or_blocked' };
  }
  if (!expectedGooglePlaceId) {
    const confidentlySelected =
      observation.savedGooglePlaceIds.length > 0 ||
      observation.decision === 'auto_save' ||
      (observation.decision === 'candidate_confirmation' && observation.returnedGooglePlaceIds.length === 1);
    return confidentlySelected
      ? { outcome: 'hard_fail', reason: 'confident_place_returned_for_no-place_fixture' }
      : { outcome: 'controlled_non_success', reason: 'no_confident_place_selected' };
  }

  const returned = new Set(observation.returnedGooglePlaceIds.filter(Boolean));
  const saved = new Set(observation.savedGooglePlaceIds.filter(Boolean));
  const wrongSaved = [...saved].find((id) => id !== expectedGooglePlaceId);
  if (wrongSaved) return { outcome: 'hard_fail', reason: `wrong_place_saved:${wrongSaved}` };

  if (saved.has(expectedGooglePlaceId)) return { outcome: 'pass', reason: 'expected_place_saved' };

  const confidentSingleton =
    observation.decision === 'auto_save' ||
    (observation.decision === 'candidate_confirmation' && returned.size === 1);
  if (confidentSingleton && returned.size === 1 && !returned.has(expectedGooglePlaceId)) {
    return { outcome: 'hard_fail', reason: `wrong_confident_singleton:${[...returned][0]}` };
  }

  if (
    returned.has(expectedGooglePlaceId) &&
    observation.decision === 'candidate_confirmation' &&
    returned.size === 1
  ) {
    return { outcome: 'pass', reason: 'expected_place_returned_for_reveal' };
  }
  return {
    outcome: 'controlled_non_success',
    reason: observation.decision || observation.terminalStatus || 'no_matching_candidate',
  };
}

export function buildShareJobRequest(url: string, clientRequestId: string): {
  url: string;
  clientRequestId: string;
  qualificationMode: 'fresh_media';
} {
  return { url, clientRequestId, qualificationMode: 'fresh_media' };
}

/**
 * Qualification attempts must be backed by newly-created jobs. The API can
 * legitimately return a recent duplicate for normal app traffic, but that
 * response is not an independent qualification observation.
 */
export function recordFreshQualificationJob(
  jobId: string | undefined,
  duplicate: boolean | undefined,
  seenJobIds: Set<string>,
): string {
  if (!jobId) throw new Error('create_share_job_missing_job_id');
  if (duplicate) throw new Error(`duplicate_job_returned:${jobId}`);
  if (seenJobIds.has(jobId)) throw new Error(`non_independent_job_id_reused:${jobId}`);
  seenJobIds.add(jobId);
  return jobId;
}
