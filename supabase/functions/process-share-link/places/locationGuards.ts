// supabase/functions/process-share-link/places/locationGuards.ts
//
// Thin re-exports of the wrong-location guards already implemented
// in `lib/shareAgent/recoveryHints.ts`. Centralized so callers in
// the Edge Function only import from the local module tree.

export {
  isWrongLocationCandidate,
  extractStateFromFormattedAddress,
  extractCityStateContext,
  addressIsNonUS,
} from '../../../../lib/shareAgent/recoveryHints.ts';
