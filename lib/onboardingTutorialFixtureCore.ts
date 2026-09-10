import { NEARR_DEV_SUPABASE_REF } from './appEnvironmentCore';
import { canonicalContentIdentity } from './shareAgent/contentIdentity';
import { normalizeResultCandidates } from './shareJobResult';
import type { OnboardingPlatform, OnboardingTutorialFixture, OnboardingTutorialResult } from './onboardingV2Core';
import type { ShareJob } from '../services/shareJobsService';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PLATFORMS = new Set<Exclude<OnboardingPlatform, 'other'>>(['instagram', 'tiktok', 'youtube', 'facebook']);

export function canLoadOnboardingTutorialFixture(input: { appEnv: string; backendEnv: string; appEnvWasDefaulted: boolean; backendEnvWasDefaulted: boolean; supabaseProjectRef: string | null }): boolean {
  return input.appEnv === 'development' && input.backendEnv === 'development' &&
    !input.appEnvWasDefaulted && !input.backendEnvWasDefaulted && input.supabaseProjectRef === NEARR_DEV_SUPABASE_REF;
}

export function parsePublicOnboardingTutorialFixture(input: unknown): OnboardingTutorialFixture | null {
  const row = input && typeof input === 'object' ? input as Record<string, unknown> : null;
  if (!row) return null;
  const id = typeof row.fixtureId === 'string' ? row.fixtureId : '';
  const role = row.fixtureRole; const platform = row.platform;
  const identityKey = typeof row.identityKey === 'string' ? row.identityKey : '';
  const contentId = typeof row.contentId === 'string' ? row.contentId : '';
  const canonicalUrl = typeof row.canonicalUrl === 'string' ? row.canonicalUrl : '';
  const launchUrl = typeof row.launchUrl === 'string' ? row.launchUrl : '';
  const revision = Number(row.fixtureRevision); const identityVersion = Number(row.identityVersion);
  const selectedAt = typeof row.selectedAt === 'string' ? row.selectedAt : '';
  if (!UUID.test(id) || (role !== 'primary' && role !== 'backup') || typeof platform !== 'string' ||
      !PLATFORMS.has(platform as Exclude<OnboardingPlatform, 'other'>) || !contentId ||
      identityKey !== `v${identityVersion}:${platform}:${contentId}` || !Number.isSafeInteger(revision) || revision < 1 ||
      !Number.isSafeInteger(identityVersion) || identityVersion < 1 || !canonicalUrl.startsWith('https://') || !launchUrl.startsWith('https://') ||
      !Number.isFinite(Date.parse(selectedAt))) return null;
  return { id, revision, role, platform: platform as Exclude<OnboardingPlatform, 'other'>, identityKey, identityVersion, contentId, canonicalUrl, launchUrl, thumbnailUrl: typeof row.thumbnailUrl === 'string' && row.thumbnailUrl.startsWith('https://') ? row.thumbnailUrl : null, selectedAt };
}

export function isShareJobForTutorialFixture(job: Pick<ShareJob, 'source_url' | 'canonical_url' | 'recognition_identity_key'>, fixture: OnboardingTutorialFixture): boolean {
  if (job.recognition_identity_key) return job.recognition_identity_key === fixture.identityKey;
  return canonicalContentIdentity(job.canonical_url || job.source_url)?.key === fixture.identityKey;
}

export function tutorialResultFromShareJob(job: ShareJob, fixture: OnboardingTutorialFixture): OnboardingTutorialResult | null {
  if (job.status !== 'completed' || !job.saved_place_id || job.resolution_source !== 'tutorial_fixture' ||
      job.tutorial_fixture_id !== fixture.id || job.tutorial_fixture_revision !== fixture.revision ||
      job.tutorial_fixture_role !== fixture.role || !isShareJobForTutorialFixture(job, fixture)) return null;
  const payload = job.candidate_payload as { candidates?: unknown } | null;
  const candidate = normalizeResultCandidates(payload?.candidates ?? job.candidate_payload)[0];
  if (!candidate || !candidate.googlePlaceId || !candidate.name || candidate.latitude == null || candidate.longitude == null) return null;
  return { jobId: job.id, savedPlaceId: job.saved_place_id, fixtureId: fixture.id, fixtureRevision: fixture.revision,
    fixtureRole: fixture.role, resolutionSource: 'tutorial_fixture', sourceUrl: job.canonical_url || job.source_url,
    place: { googlePlaceId: candidate.googlePlaceId, name: candidate.name, formattedAddress: candidate.formattedAddress,
      latitude: candidate.latitude, longitude: candidate.longitude, primaryType: candidate.primaryType ?? null,
      typeLabel: candidate.primaryTypeDisplayName ?? candidate.googleMapsTypeLabel ?? null,
      photoUrl: candidate.photoUrl ?? null, photoUrls: candidate.photoUrls ?? [] } };
}
