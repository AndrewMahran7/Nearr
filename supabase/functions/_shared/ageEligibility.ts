// Authoritative Development/Production contract. The caller must derive userId
// from auth.getUser(token) or a persisted job/task owner, never a request body.
export type AgeEligibilityDecision =
  | { ok: true }
  | { ok: false; code: 'age_eligibility_required' | 'age_check_unavailable' };

export async function checkAgeEligibility(
  admin: { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> },
  userId: string,
): Promise<AgeEligibilityDecision> {
  if (!userId) return { ok: false, code: 'age_eligibility_required' };
  const { data, error } = await admin.rpc('is_adult_eligible_for_ai', { p_user_id: userId });
  if (error || typeof data !== 'boolean') return { ok: false, code: 'age_check_unavailable' };
  return data ? { ok: true } : { ok: false, code: 'age_eligibility_required' };
}
