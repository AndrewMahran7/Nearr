// supabase/functions/process-share-link/evidence/addressExtraction.ts
//
// Thin re-export of the deterministic US street-address extractor
// from `lib/shareAgent/queryCleaner.ts`. Centralized so resolver
// code imports only from the local module tree.

export {
  extractLikelyAddress,
  extractLikelyAddresses,
  cleanPlacesSeed,
  type LikelyAddress,
} from '../../../../lib/shareAgent/queryCleaner.ts';
