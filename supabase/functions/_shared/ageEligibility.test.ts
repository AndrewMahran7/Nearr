import { checkAgeEligibility } from './ageEligibility.ts';

declare const Deno: { test(name: string, run: () => void | Promise<void>): void };

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

Deno.test('only the server adult decision allows AI dispatch', async () => {
  const decisions = [
    { data: true, error: null, expected: { ok: true } },
    { data: false, error: null, expected: { ok: false, code: 'age_eligibility_required' } },
    { data: null, error: null, expected: { ok: false, code: 'age_check_unavailable' } },
    { data: null, error: { code: 'PGRST' }, expected: { ok: false, code: 'age_check_unavailable' } },
  ];
  for (const sample of decisions) {
    let calledWith: Record<string, unknown> | null = null;
    const result = await checkAgeEligibility({
      rpc: async (name, args) => {
        equal(name, 'is_adult_eligible_for_ai');
        calledWith = args;
        return { data: sample.data, error: sample.error };
      },
    }, 'account-123');
    equal(calledWith, { p_user_id: 'account-123' });
    equal(result, sample.expected);
  }
});

Deno.test('missing owner fails closed without querying', async () => {
  const result = await checkAgeEligibility({
    rpc: async () => { throw new Error('should not query'); },
  }, '');
  equal(result, { ok: false, code: 'age_eligibility_required' });
});
