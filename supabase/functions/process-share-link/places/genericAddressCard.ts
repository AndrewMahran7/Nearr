// supabase/functions/process-share-link/places/genericAddressCard.ts
//
// Thin re-export of the generic-address-card detector from
// `lib/shareAgent/recoveryHints.ts`. A "generic address card" is
// the Google Places result that returns the raw address (e.g.
// "415 Seabright Ave") as the venue NAME because Places couldn't
// resolve an actual business at that location. These must never
// be auto-saved.

export { isGenericAddressCard } from '../../../../lib/shareAgent/recoveryHints.ts';
