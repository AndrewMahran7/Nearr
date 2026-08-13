export {};

type InputRow = {
  placeId: string;
  googlePlaceId: string;
  name: string;
};

type RefreshResult = InputRow & {
  ok: boolean;
  provider: 'new' | 'legacy' | null;
  primaryType: string | null;
  types: string[];
  primaryTypeDisplayName: string | null;
  googleMapsTypeLabel: string | null;
  error: string | null;
};

async function stdinText(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8').trim();
}

function localizedText(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const text = (value as { text?: unknown }).text;
  return typeof text === 'string' && text.trim() ? text.trim() : null;
}

async function refreshLegacy(row: InputRow, apiKey: string): Promise<RefreshResult> {
  try {
    const params = new URLSearchParams({ place_id: row.googlePlaceId, fields: 'place_id,types,name', key: apiKey });
    const response = await fetch(`https://maps.googleapis.com/maps/api/place/details/json?${params}`);
    if (!response.ok) {
      return { ...row, ok: false, provider: null, primaryType: null, types: [], primaryTypeDisplayName: null, googleMapsTypeLabel: null, error: `legacy HTTP ${response.status}` };
    }
    const body = await response.json() as { status?: unknown; error_message?: unknown; result?: { types?: unknown } };
    if (body.status !== 'OK' || !body.result) {
      const detail = typeof body.error_message === 'string' ? `: ${body.error_message}` : '';
      return { ...row, ok: false, provider: null, primaryType: null, types: [], primaryTypeDisplayName: null, googleMapsTypeLabel: null, error: `legacy ${String(body.status ?? 'UNKNOWN')}${detail}` };
    }
    return {
      ...row,
      ok: true,
      provider: 'legacy',
      // Legacy Places returns an unordered types array, not primaryType.
      primaryType: null,
      types: Array.isArray(body.result.types) ? body.result.types.filter((type): type is string => typeof type === 'string') : [],
      primaryTypeDisplayName: null,
      googleMapsTypeLabel: null,
      error: null,
    };
  } catch (error) {
    return { ...row, ok: false, provider: null, primaryType: null, types: [], primaryTypeDisplayName: null, googleMapsTypeLabel: null, error: error instanceof Error ? error.message : String(error) };
  }
}

async function refresh(row: InputRow, apiKey: string, legacyApiKey: string | null): Promise<RefreshResult> {
  if (process.env.GOOGLE_PLACES_REFRESH_MODE === 'legacy') {
    if (!legacyApiKey) return { ...row, ok: false, provider: null, primaryType: null, types: [], primaryTypeDisplayName: null, googleMapsTypeLabel: null, error: 'legacy key missing' };
    return refreshLegacy(row, legacyApiKey);
  }
  try {
    const response = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(row.googlePlaceId)}`, {
      headers: {
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'id,types,primaryType,primaryTypeDisplayName,googleMapsTypeLabel',
      },
    });
    if (!response.ok) {
      if (legacyApiKey) return refreshLegacy(row, legacyApiKey);
      return { ...row, ok: false, provider: null, primaryType: null, types: [], primaryTypeDisplayName: null, googleMapsTypeLabel: null, error: `HTTP ${response.status}` };
    }
    const body = await response.json() as Record<string, unknown>;
    return {
      ...row,
      ok: true,
      provider: 'new',
      primaryType: typeof body.primaryType === 'string' ? body.primaryType : null,
      types: Array.isArray(body.types) ? body.types.filter((type): type is string => typeof type === 'string') : [],
      primaryTypeDisplayName: localizedText(body.primaryTypeDisplayName),
      googleMapsTypeLabel: localizedText(body.googleMapsTypeLabel),
      error: null,
    };
  } catch (error) {
    if (legacyApiKey) return refreshLegacy(row, legacyApiKey);
    return { ...row, ok: false, provider: null, primaryType: null, types: [], primaryTypeDisplayName: null, googleMapsTypeLabel: null, error: error instanceof Error ? error.message : String(error) };
  }
}

async function main(): Promise<void> {
  const apiKey = process.env.GOOGLE_PLACES_KEY?.trim();
  if (!apiKey) throw new Error('GOOGLE_PLACES_KEY is required.');
  const legacyApiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() || null;
  const parsed = JSON.parse(await stdinText());
  if (!Array.isArray(parsed)) throw new Error('Expected a JSON array on stdin.');
  const rows = parsed as InputRow[];
  const results: RefreshResult[] = [];
  const concurrency = 6;
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < rows.length) {
      const index = cursor++;
      results[index] = await refresh(rows[index]!, apiKey!, legacyApiKey);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, () => worker()));
  console.log(JSON.stringify(results, null, process.argv.includes('--compact') ? 0 : 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
