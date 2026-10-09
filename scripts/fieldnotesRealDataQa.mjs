import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

// Read-only, explicit Development target. Never uses the linked project or logs credentials.
const ref = 'qnfxnmvxpjzfydgudtvs';
const host = `https://${ref}.supabase.co`;
const command = process.platform === 'win32' ? 'supabase.exe' : 'supabase';
const keysResult = spawnSync(command, ['projects', 'api-keys', '--project-ref', ref, '--reveal', '--output', 'json'], { encoding: 'utf8', windowsHide: true });
if (keysResult.status !== 0) throw new Error('Development API key read unavailable');
const key = JSON.parse(keysResult.stdout).find(entry => entry.name === 'service_role')?.api_key;
if (!key || JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).ref !== ref) throw new Error('Refusing unverified Development credentials');
async function read(table, fields, limit) {
  const url = new URL(`/rest/v1/${table}`, host);
  url.searchParams.set('select', fields); url.searchParams.set('limit', String(limit));
  const response = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'count=exact' } });
  if (!response.ok) throw new Error(`Development read failed: ${table} HTTP ${response.status}`);
  return { rows: await response.json(), total: response.headers.get('content-range')?.split('/')[1] ?? null };
}
const [places, saves, jobs] = await Promise.all([
  read('places', 'name,formatted_address,google_place_id,latitude,longitude', 500),
  read('saved_places', 'notes,ai_note,source_type', 1000),
  read('share_jobs', 'status,source_platform,candidate_payload', 300),
]);
const candidates = jobs.rows.flatMap(job => job.candidate_payload?.candidates ?? []);
const photoCounts = { zero: 0, one: 0, twoToFour: 0, fiveOrMore: 0 };
for (const candidate of candidates) {
  const count = Array.isArray(candidate.photoUrls) ? candidate.photoUrls.filter(Boolean).length : candidate.photoUrl ? 1 : 0;
  photoCounts[count === 0 ? 'zero' : count === 1 ? 'one' : count < 5 ? 'twoToFour' : 'fiveOrMore']++;
}
const histogram = (items, key) => items.reduce((counts, item) => { const value = item[key] ?? 'missing'; counts[value] = (counts[value] ?? 0) + 1; return counts; }, {});
const lengths = values => { const nonempty = values.filter(value => typeof value === 'string' && value.trim()); return { populated: nonempty.length, maximumCharacters: Math.max(0, ...nonempty.map(value => value.length)) }; };
const report = {
  recordedAt: new Date().toISOString(), target: 'Nearr-Dev', ref, access: 'Three REST GET requests only; no mutation, recognition or provider-photo calls',
  places: { total: places.total, sampled: places.rows.length, names: lengths(places.rows.map(row => row.name)), addresses: lengths(places.rows.map(row => row.formatted_address)), missingCoordinates: places.rows.filter(row => row.latitude == null || row.longitude == null).length },
  savedPlaces: { total: saves.total, sampled: saves.rows.length, userNotes: lengths(saves.rows.map(row => row.notes)), generatedNotes: lengths(saves.rows.map(row => row.ai_note)), sourceTypes: histogram(saves.rows, 'source_type') },
  jobs: { total: jobs.total, sampled: jobs.rows.length, statuses: histogram(jobs.rows, 'status'), platforms: histogram(jobs.rows, 'source_platform'), candidates: candidates.length, candidatePhotoCounts: photoCounts },
  limitations: ['Sample is bounded and not exhaustive.', 'Candidate payload photo counts do not measure device-local snapshot caches.', 'No user IDs, user notes, source URLs, photo URLs, credentials or raw job payloads are written to artifacts.', 'This read audit is separate from native visual evidence.'],
};
const destination = 'artifacts/fieldnotes-implementation/real-data';
mkdirSync(destination, { recursive: true });
writeFileSync(`${destination}/development-content-audit.json`, JSON.stringify(report, null, 2));
const publicPlaces = places.rows.filter(row => row.name && !/test|preview|fixture|e2e/i.test(row.name)).sort((a, b) => b.name.length - a.name.length).slice(0, 25);
writeFileSync(`${destination}/public-place-content.json`, JSON.stringify(publicPlaces, null, 2));
console.log(JSON.stringify(report, null, 2));
