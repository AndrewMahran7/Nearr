import {
  CATEGORY_MODEL_VERSION,
  isNearrCategory,
  resolvePlaceCategory,
  type CategorySource,
  type NearrCategory,
} from '../lib/placeCategory';

type ReplayRow = {
  id: string;
  name: string;
  category: string | null;
  categorySource: string | null;
  categoryUserOverridden: boolean;
  googlePlaceId: string | null;
  googlePrimaryType: string | null;
  googleTypes: string[] | null;
};

type ProposedChange = {
  id: string;
  name: string;
  oldCategory: NearrCategory;
  newCategory: NearrCategory;
  source: CategorySource;
  confidence: number;
  googlePlaceId: string | null;
  googlePrimaryType: string | null;
  googleTypes: string[];
  reason: string;
};

async function stdinText(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8').trim();
}

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function emitSql(changes: ProposedChange[]): void {
  const safe = changes.filter((change) => /^[0-9a-f-]{36}$/i.test(change.id));
  if (safe.length === 0) {
    console.log('-- No deterministic category changes proposed.');
    return;
  }
  console.log('begin;');
  console.log('with proposed(id, category, category_source, confidence, model_version) as (');
  console.log('  values');
  safe.forEach((change, index) => {
    const suffix = index === safe.length - 1 ? '' : ',';
    console.log(`    (${sqlLiteral(change.id)}::uuid, ${sqlLiteral(change.newCategory)}, ${sqlLiteral(change.source)}, ${change.confidence}, ${sqlLiteral(CATEGORY_MODEL_VERSION)})${suffix}`);
  });
  console.log(')');
  console.log('update public.saved_places sp');
  console.log('   set category = proposed.category,');
  console.log('       category_source = proposed.category_source,');
  console.log('       category_confidence = proposed.confidence,');
  console.log('       category_model_version = proposed.model_version,');
  console.log('       categorized_at = now()');
  console.log('  from proposed');
  console.log(' where sp.id = proposed.id');
  console.log('   and sp.category_user_overridden = false');
  console.log('   and sp.category is distinct from proposed.category;');
  console.log('commit;');
}

async function main(): Promise<void> {
  const raw = await stdinText();
  const parsed = raw ? JSON.parse(raw) : [];
  if (!Array.isArray(parsed)) throw new Error('Expected a JSON array on stdin.');
  const rows = parsed as ReplayRow[];
  const distribution = new Map<NearrCategory, number>();
  const remainingSignals = new Map<string, number>();
  const changes: ProposedChange[] = [];
  let oldOther = 0;
  let newOther = 0;

  for (const row of rows) {
    const oldCategory = isNearrCategory(row.category) ? row.category : 'other';
    if (oldCategory === 'other') oldOther += 1;
    const resolution = resolvePlaceCategory({
      userOverride: row.categoryUserOverridden && isNearrCategory(row.category) ? row.category : null,
      placeName: row.name,
      googlePrimaryType: row.googlePrimaryType,
      googleTypes: row.googleTypes,
    });
    distribution.set(resolution.category, (distribution.get(resolution.category) ?? 0) + 1);
    if (resolution.category === 'other') {
      newOther += 1;
      const signals = [row.googlePrimaryType, ...(row.googleTypes ?? [])].filter((value): value is string => !!value);
      if (signals.length === 0) remainingSignals.set('<missing provider types>', (remainingSignals.get('<missing provider types>') ?? 0) + 1);
      else for (const signal of new Set(signals)) remainingSignals.set(signal, (remainingSignals.get(signal) ?? 0) + 1);
    }
    if (
      !row.categoryUserOverridden &&
      resolution.category !== 'other' &&
      resolution.confidence >= 0.7 &&
      resolution.category !== oldCategory
    ) {
      changes.push({
        id: row.id,
        name: row.name,
        oldCategory,
        newCategory: resolution.category,
        source: resolution.source,
        confidence: resolution.confidence,
        googlePlaceId: row.googlePlaceId,
        googlePrimaryType: row.googlePrimaryType,
        googleTypes: row.googleTypes ?? [],
        reason: resolution.evidenceTags.join(','),
      });
    }
  }

  if (process.argv.includes('--sql')) return emitSql(changes);
  const report = {
    total: rows.length,
    oldOther,
    oldOtherPercentage: rows.length ? Number((oldOther * 100 / rows.length).toFixed(2)) : 0,
    newOther,
    newOtherPercentage: rows.length ? Number((newOther * 100 / rows.length).toFixed(2)) : 0,
    distribution: Object.fromEntries([...distribution].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))),
    remainingOtherSignals: Object.fromEntries([...remainingSignals].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))),
    proposedChanges: changes,
  };
  console.log(JSON.stringify(report, null, process.argv.includes('--compact') ? 0 : 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
