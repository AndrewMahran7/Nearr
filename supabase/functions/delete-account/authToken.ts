// supabase/functions/delete-account/authToken.ts
//
// Pure, runtime-agnostic auth helpers for the account-deletion function.
//
// This file intentionally has NO Deno or Supabase imports so it can be
// unit-tested with ts-node (see scripts/testAccountDeletion.ts) and reused
// by the Deno handler in index.ts. It encodes two security invariants:
//
//   1. The only accepted credential is a Bearer access token in the
//      Authorization header.
//   2. The account to delete is ALWAYS the token-authenticated user. A
//      user id / email supplied in the request body is ignored — it can
//      never redirect the deletion at another account.

/**
 * Extract a Bearer access token from an Authorization header value.
 * Returns '' when the header is missing or not a Bearer credential.
 * Never throws.
 */
export function extractBearerToken(
  authorizationHeader: string | null | undefined,
): string {
  if (!authorizationHeader) return '';
  const header = authorizationHeader.trim();
  if (!/^bearer\s+/i.test(header)) return '';
  return header.replace(/^bearer\s+/i, '').trim();
}

/**
 * Resolve which account the request is allowed to delete.
 *
 * The authority is exclusively the token-authenticated user id. Any
 * `requestBodyUserId` is deliberately ignored; the boolean flag lets the
 * caller log that a mismatching id was seen (without ever acting on it)
 * so forged-id attempts are auditable.
 */
export function resolveDeleteAuthority(args: {
  authenticatedUserId: string;
  requestBodyUserId?: unknown;
}): { userId: string; ignoredBodyUserId: boolean } {
  const { authenticatedUserId, requestBodyUserId } = args;
  const ignoredBodyUserId =
    typeof requestBodyUserId === 'string' &&
    requestBodyUserId.length > 0 &&
    requestBodyUserId !== authenticatedUserId;
  return { userId: authenticatedUserId, ignoredBodyUserId };
}
