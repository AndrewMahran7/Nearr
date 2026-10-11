import test from 'node:test';
import assert from 'node:assert/strict';
import { solHighImageTokenBound } from '../src/evaluation/solInputTokenBound.js';
import { ProviderBudgetLedger, type ProviderBudgetConfig } from '../src/evaluation/providerBudgetLedger.js';
const jpeg = 'data:image/jpeg;base64,' + Buffer.from([255,216,255,224,0,16]).toString('base64');
const body = () => ({ model: 'gpt-5.6-sol', instructions: 'Synthetic UTF-8 text: 東京', store: false,
  input: [{ role: 'user', content: [{ type: 'input_text', text: 'Synthetic frame' }, { type: 'input_image', image_url: jpeg, detail: 'high' }] }],
  reasoning: { effort: 'high' }, text: { format: { type: 'json_schema', schema: { type: 'object' } } } });

test('documented high-detail ceiling includes image rounding, nonimage bytes and protocol margin without mutation', () => {
  const original = body(), clone = structuredClone(original), stripped = body();
  stripped.input[0]!.content[1]!.image_url = '';
  assert.equal(solHighImageTokenBound(original), Buffer.byteLength(JSON.stringify(stripped)) + 4096 + 3001);
  assert.deepEqual(original, clone);
  const more = body(); more.input[0]!.content.push({ type: 'input_image', image_url: jpeg, detail: 'high' });
  assert.ok(solHighImageTokenBound(more)! >= solHighImageTokenBound(original)! + 3001);
});

test('original detail, other models, files, remote/history/tools and unknown content cannot use the reduced bound', () => {
  const cases: any[] = [];
  for (const detail of ['auto', 'original', 'low', undefined]) { const b = body(); b.input[0]!.content[1]!.detail = detail; cases.push(b); }
  cases.push({ ...body(), model: 'another-model' }, { ...body(), previous_response_id: 'stored' },
    { ...body(), conversation: 'stored' }, { ...body(), tools: [{ type: 'web_search' }] });
  for (const image of ['https://example.test/frame.jpg', 'data:image/png;base64,aGVsbG8=', 'data:image/jpeg;base64,aGVsbG8=']) {
    const b = body(); b.input[0]!.content[1]!.image_url = image; cases.push(b);
  }
  const file = body() as any; file.input[0].content.push({ type: 'input_file', file_id: 'stored' }); cases.push(file);
  for (const b of cases) assert.equal(solHighImageTokenBound(b), null);
});

test('tighter opt-in reservation preserves request bytes, full output ceiling and actual tariff charging', async () => {
  const rate = { operation: 'openai_responses' as const, model: 'gpt-5.6-sol', inputUsdPerMillion: 4,
    cachedInputUsdPerMillion: .4, cacheWriteInputUsdPerMillion: 5, outputUsdPerMillion: 20,
    maxInputTokens: 1050000, maxOutputTokens: 128000, outputTokenPolicy: 'verified_provider_ceiling' as const,
    outputTokenPolicyBasis: 'Preserve output configuration', inputTokenPolicy: 'sol_high_image_patch_bound_v1' as const,
    maxRequestUsd: 15, maxCalls: 3, source: 'https://developers.openai.com/api/docs/guides/images-vision?api-mode=responses', verifiedAt: '2026-10-11T00:00:00Z' };
  const cfg: ProviderBudgetConfig = { allowPaidRequests: true, maxUsd: 3, maxCalls: 3, requestTimeoutMs: 1000, maxRequestBytes: 1000000, rates: [rate] };
  const b = body(); b.input[0]!.content[1]!.image_url = jpeg + 'A'.repeat(400000);
  const wire = JSON.stringify(b);
  const ledger = new ProviderBudgetLedger(cfg, async (_url, init) => {
    assert.equal(init?.body, wire);
    return new Response(JSON.stringify({ model: 'gpt-5.6-sol', usage: { input_tokens: 3500, output_tokens: 40,
      input_tokens_details: { cached_tokens: 1000, cache_write_tokens: 0 } } }));
  }, async () => {});
  await ledger.fetch('https://api.openai.com/v1/responses', { method: 'POST', body: wire });
  const entry = ledger.entries[0]!;
  assert.equal(entry.original_request_sha256, entry.request_sha256);
  assert.deepEqual(entry.transport_overrides, []);
  assert.equal(entry.input_token_bound_basis, 'sol_high_image_patch_bound_v1');
  assert.equal(entry.input_token_upper_bound, solHighImageTokenBound(b));
  assert.ok(entry.reservation_usd > 2.56 && entry.reservation_usd < 2.7);
  assert.equal(entry.cost_usd, (2500 * 4 + 1000 * .4 + 40 * 20) / 1e6);
  assert.throws(() => new ProviderBudgetLedger({ ...cfg, rates: [{ ...rate, model: 'other' }] }, fetch, async () => {}), /invalid_input_token_policy/);
});
