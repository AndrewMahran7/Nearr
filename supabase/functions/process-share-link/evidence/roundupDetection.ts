// supabase/functions/process-share-link/evidence/roundupDetection.ts
//
// Thin re-export of `looksLikeRoundupPost` from recoveryHints.
// Roundup detection prevents the resolver from picking a single
// venue out of a "top 10 burgers" / "5 best spots" post and
// attributing the share to it.

export { looksLikeRoundupPost } from '../../../../lib/shareAgent/recoveryHints.ts';
