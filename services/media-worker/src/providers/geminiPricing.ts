/** Official paid-tier token prices, USD per 1M tokens (checked 2026-09-06). */
const PRICES: Array<{ match: RegExp; input: number; output: number }> = [
  { match: /^gemini-2\.5-flash(?:$|-)/, input: 0.30, output: 2.50 },
  { match: /^gemini-3\.1-flash-lite(?:$|-)/, input: 0.25, output: 1.50 },
  { match: /^gemini-3\.5-flash-lite(?:$|-)/, input: 0.30, output: 2.50 },
  { match: /^gemini-3\.8-flash(?:$|-)/, input: 0.75, output: 3.75 },
  { match: /^gemini-3\.5-flash(?:$|-)/, input: 1.50, output: 9.00 },
];

export function estimateGeminiCostUsd(args: {
  model: string | null | undefined;
  inputTokens: number;
  outputTokens: number;
  thinkingTokens?: number;
}): number | null {
  const price = PRICES.find(({ match }) => match.test(args.model ?? ''));
  if (!price) return null;
  const input = Math.max(0, Number(args.inputTokens) || 0);
  const output = Math.max(0, Number(args.outputTokens) || 0) + Math.max(0, Number(args.thinkingTokens) || 0);
  return Number(((input * price.input + output * price.output) / 1_000_000).toFixed(8));
}
export function geminiGenerationConfig(model: string, targetPlace: boolean): Record<string, unknown> {
  const isGemini3 = /^gemini-3(?:\.|-)/.test(model);
  if (targetPlace) {
    return {
      responseMimeType: 'text/plain',
      maxOutputTokens: 96,
      ...(!isGemini3 ? { temperature: 0.7, thinkingConfig: { thinkingBudget: 0 } } : {}),
    };
  }
  return {
    responseMimeType: 'application/json',
    ...(!isGemini3 ? { temperature: 0 } : {}),
  };
}
