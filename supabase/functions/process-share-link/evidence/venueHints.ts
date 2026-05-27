// supabase/functions/process-share-link/evidence/venueHints.ts
//
// Re-export of `extractCaptionVenueHints` from recoveryHints. A
// venue hint is a name-shaped phrase pulled out of the caption
// using conservative patterns (📍 pin marker, "<Name>, <City>",
// "<Name> in <City>"). Used by the resolver as a name candidate.

export {
  extractCaptionVenueHints,
  derivePlaceNameHintFromHandle,
} from '../../../../lib/shareAgent/recoveryHints.ts';
