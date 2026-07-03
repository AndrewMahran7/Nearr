// supabase/functions/process-share-link/resolver/placeScoring.ts
//
// Score and rank Places API candidates against the extracted
// evidence. Combines:
//   - `hasMeaningfulNameMatch` / `hasStrongNameMatch` (placeNormalization)
//   - `compactNameMatches` (recoveryHints) — matches "Mc Fadden" to
//     "McFadden Public Market" without false positives
//   - Distance from a city/state bias (if any)
//   - Wrong-location guard demotion
//   - Generic-address-card demotion

import type { Evidence } from '../evidence/extractEvidence.ts';
import type { PlacesCandidate } from '../places/googlePlaces.ts';
import type { ResolvedCandidate } from '../types.ts';
import {
  hasMeaningfulNameMatch,
  hasStrongNameMatch,
  nameOverlapScore,
  haversineMeters,
  BUSINESS_LIKE,
  isAddressLikeTypes,
  isLocalityLikeTypes,
} from '../places/placeNormalization.ts';
import {
  isWrongLocationCandidate,
  extractStateFromFormattedAddress,
} from '../places/locationGuards.ts';
import { isGenericAddressCard } from '../places/genericAddressCard.ts';
import { compactNameMatches } from '../../../../lib/shareAgent/recoveryHints.ts';
import { isPlatformNoiseName } from '../../../../lib/shareAgent/platformNoise.ts';

export type ScoredCandidate = {
  candidate: PlacesCandidate;
  score: number;
  reasons: string[];
  rejected: boolean;
  rejectionReason: string | null;
};

const REJECT_SCORE = -1_000;

export function scoreCandidates(
  candidates: PlacesCandidate[],
  evidence: Evidence,
  placeNameHint: string | null,
  bias: { lat: number; lng: number } | null,
): ScoredCandidate[] {
  const expectedState =
    evidence.cityState?.state ?? evidence.address?.state ?? null;

  return candidates.map((candidate) => {
    const reasons: string[] = [];
    let score = 0;

    // Platform-noise hard veto (TikTok only). Generic TikTok metadata can
    // make Places return the platform/company itself ("TikTok Inc.",
    // "Tiktok Verification", "… TikTok Marketing Agency"). Never a real
    // saved place for a TikTok post — drop it before any scoring so it can
    // neither win nor pad the candidate list.
    if (isPlatformNoiseName(candidate.name, evidence.platform)) {
      return {
        candidate,
        score: REJECT_SCORE,
        reasons: [...reasons, 'platform_noise_rejected'],
        rejected: true,
        rejectionReason: 'platform_noise',
      };
    }

    // Type-based base.
    if (candidate.types?.some((t) => BUSINESS_LIKE.has(t))) {
      score += 25;
      reasons.push('business_type');
    }
    if (isAddressLikeTypes(candidate.types)) {
      score -= 30;
      reasons.push('address_like_type_penalty');
    }
    if (isLocalityLikeTypes(candidate.types)) {
      score -= 50;
      reasons.push('locality_like_type_penalty');
    }

    // Name match.
    if (placeNameHint) {
      if (compactNameMatches(candidate.name, placeNameHint)) {
        score += 30;
        reasons.push('compact_name_match');
      } else if (hasStrongNameMatch(candidate.name, placeNameHint)) {
        score += 24;
        reasons.push('strong_name_match');
      } else if (hasMeaningfulNameMatch(candidate.name, placeNameHint)) {
        score += 10;
        reasons.push('meaningful_name_match');
      }
      score += nameOverlapScore(candidate.name, placeNameHint) * 6;
    }

    // Generic-address-card hard demotion. Only meaningful when
    // the caption carried an explicit street address — otherwise
    // there is no "card" to detect.
    if (
      evidence.address &&
      isGenericAddressCard({ name: candidate.name }, evidence.address)
    ) {
      score -= 80;
      reasons.push('generic_address_card');
    }

    // Wrong-location hard veto (drop, don't just demote).
    if (
      isWrongLocationCandidate(
        candidate.formattedAddress ?? null,
        expectedState,
      )
    ) {
      return {
        candidate,
        score: REJECT_SCORE,
        reasons: [...reasons, 'wrong_location_rejected'],
        rejected: true,
        rejectionReason: 'wrong_location',
      };
    }

    // Distance from bias.
    if (
      bias &&
      Number.isFinite(candidate.latitude) &&
      Number.isFinite(candidate.longitude)
    ) {
      const km =
        haversineMeters(bias.lat, bias.lng, candidate.latitude!, candidate.longitude!) /
        1000;
      if (km > 250) {
        score -= 220;
        reasons.push('distance_far');
      } else if (km > 100) {
        score -= 120;
        reasons.push('distance_medium');
      } else if (km > 40) {
        score -= 60;
        reasons.push('distance_close');
      } else {
        score -= Math.min(30, km * 0.75);
        reasons.push('distance_nearby');
      }
    }

    // State match — strong positive when caption asserts a state
    // and the candidate's address backs it up.
    if (expectedState) {
      const candidateState = extractStateFromFormattedAddress(
        candidate.formattedAddress ?? null,
      );
      if (candidateState === expectedState) {
        score += 15;
        reasons.push('state_match');
      }
    }

    return {
      candidate,
      score,
      reasons,
      rejected: false,
      rejectionReason: null,
    };
  });
}

export function toResolvedCandidate(
  scored: ScoredCandidate,
  evidenceKeys: string[],
): ResolvedCandidate {
  // Normalize score to [0, 1] using a soft sigmoid centered around
  // 30 (a strong-name+business-type candidate). Pure cosmetic.
  const raw = scored.score;
  const confidenceScore = 1 / (1 + Math.exp(-(raw - 25) / 15));

  return {
    googlePlaceId: scored.candidate.googlePlaceId,
    name: scored.candidate.name,
    formattedAddress: scored.candidate.formattedAddress ?? '',
    latitude: scored.candidate.latitude,
    longitude: scored.candidate.longitude,
    types: scored.candidate.types,
    confidenceScore,
    evidence: evidenceKeys,
    reasons: scored.reasons,
  };
}
