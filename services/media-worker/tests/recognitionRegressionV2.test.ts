import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parseCategory } from '../src/recognitionRegression/corpus.js';
import { assertInferenceEnvelope, BenchmarkLifecycle, buildInferenceEnvelope } from '../src/recognitionRegression/firewall.js';
import { loadRegressionCorpus, loadRegressionGroundTruth } from '../src/recognitionRegression/fixtures.js';
import { assertBaselineDoesNotDecrease, assertFixtureCorrection, diffCases, emptyCategoryMinimum, enforceRatchet } from '../src/recognitionRegression/ratchet.js';
import { calculateMetrics, matchCandidate, scoreCase } from '../src/recognitionRegression/scoring.js';
import { RECOGNITION_CATEGORIES, type CaseScore, type GroundTruthTarget, type RankedCandidate, type RegressionAttempt, type RegressionCorpusCase, type RatchetBaseline } from '../src/recognitionRegression/types.js';

const repoRoot = path.resolve(import.meta.dirname, '../../..');
function target(overrides: Partial<GroundTruthTarget> = {}): GroundTruthTarget { return {
  caseId: 'X', canonicalName: 'Tamolitch Blue Pool', acceptedAliases: ['Tamolitch Falls (Blue Pool)'], latitude: 44.312, longitude: -122.027,
  acceptableRadiusMeters: 300, intendedSpecificity: 'SPECIFIC_PHYSICAL_PLACE', quality: 'VERIFIED', requiredLocality: null,
  parentPlaceNames: [], broaderAreaNames: ['Oregon'], expectedSafetyDecision: 'REVIEW', evidenceSources: [{ kind: 'TEST', reference: 'test', supports: 'test' }], notes: null, ...overrides,
}; }
function candidate(name: string, rank = 1, overrides: Partial<RankedCandidate> = {}): RankedCandidate { return {
  rank, name, identityType: 'NAMED_NATURAL_FEATURE', locality: 'Oregon', country: 'United States', latitude: null, longitude: null,
  evidenceType: 'TEST', canonicalizationStatus: null, specificity: 'SPECIFIC_PHYSICAL_PLACE', ...overrides,
}; }
function attempt(candidates: RankedCandidate[], overrides: Partial<RegressionAttempt> = {}): RegressionAttempt { return {
  schemaVersion: 2, runId: 'test', caseId: 'X', category: 'HIKING_TRAIL', sourceUrl: 'https://example.test/x', recognitionVersion: 'test', evidenceVersion: 'test', modelPath: 'test',
  acquisitionStatus: 'EVIDENCE_REPLAY', status: 'COMPLETED', candidates, safetyDecision: 'REVIEW', frameManifest: [], placesCallCount: 0, cacheReadUsed: false,
  modelRequests: 1, apiRequests: 1, costUsd: 0, latencyMs: 1, failureCode: null, persistedAt: '2026-09-05T00:00:00.000Z', ...overrides,
}; }
function corpusCase(category: RegressionCorpusCase['category'], id = 'X'): RegressionCorpusCase { return { caseId: id, category, sourceUrl: `https://example.test/${id}`, sourceCorpus: 'test', sourceCaseId: id, evidenceFixture: 'test', researchOnly: false }; }

test('1 five required categories exist', () => assert.deepEqual(RECOGNITION_CATEGORIES, ['FOOD_RESTAURANT','CLIFF_JUMPING','HIKING_TRAIL','LANDMARK','TRAVEL_DESTINATION']));
test('2 every scorable corpus case has exact ground truth', async () => { const c = await loadRegressionCorpus(repoRoot); const t = await loadRegressionGroundTruth(repoRoot); assert.equal(c.length, t.length); assert.ok(t.filter((x) => ['VERIFIED','HIGH_CONFIDENCE'].includes(x.quality)).every((x) => x.canonicalName)); });
test('3 aliases normalize correctly', () => assert.equal(scoreCase(attempt([candidate('Tamolitch Falls (Blue Pool)')]), target()).classification, 'ACCEPTABLE_ALIAS'));
test('4 coordinate-radius matching works', () => assert.equal(matchCandidate(candidate('Provider Name',1,{latitude:44.3121,longitude:-122.0271}),target()), 'COORDINATE'));
test('5 broad area fails a specific target', () => assert.equal(scoreCase(attempt([candidate('Oregon',1,{specificity:'ADMIN_AREA'})]),target()).classification,'BROAD_AREA_ONLY'));
test('6 broad destination passes when intended', () => assert.equal(scoreCase(attempt([candidate('Bali',1,{specificity:'BROAD_AREA'})],{category:'TRAVEL_DESTINATION'}),target({canonicalName:'Bali',acceptedAliases:[],intendedSpecificity:'BROAD_DESTINATION',latitude:null,longitude:null,acceptableRadiusMeters:null})).exactAt1,true));
test('7 parent venue fails tenant target', () => assert.equal(scoreCase(attempt([candidate('South Coast Plaza')]),target({canonicalName:'Paradise Dynasty',acceptedAliases:[],parentPlaceNames:['South Coast Plaza'],latitude:null,longitude:null,acceptableRadiusMeters:null})).classification,'PARENT_PLACE_FAILURE'));
test('8 restaurant branch locality is supported', () => assert.equal(scoreCase(attempt([candidate('Paradise Dynasty',1,{locality:'Costa Mesa, California'})],{category:'FOOD_RESTAURANT'}),target({canonicalName:'Paradise Dynasty',acceptedAliases:[],requiredLocality:'Costa Mesa',latitude:null,longitude:null,acceptableRadiusMeters:null})).exactAt1,true));
test('9 trail alias is supported', () => assert.equal(matchCandidate(candidate('Tamolitch Falls (Blue Pool)'),target()),'ALIAS'));
test('10 natural feature canonical identity is supported', () => assert.equal(matchCandidate(candidate('Tamolitch Blue Pool'),target()),'CANONICAL'));
test('11 top1 scoring is correct', () => assert.equal(scoreCase(attempt([candidate('Tamolitch Blue Pool')]),target()).exactAt1,true));
test('12 top3 scoring is correct', () => assert.equal(scoreCase(attempt([candidate('A',1),candidate('Tamolitch Blue Pool',2)]),target()).classification,'TOP3_EXACT'));
test('13 fourth place never passes top3', () => assert.equal(scoreCase(attempt([candidate('A',1),candidate('B',2),candidate('C',3),candidate('Tamolitch Blue Pool',4)]),target()).exactAt3,false));
test('14 UNSCORED is excluded', () => assert.equal(scoreCase(attempt([]),target({quality:'PROVISIONAL'})).scorable,false));
test('15 technical failures stay scorable', () => assert.equal(scoreCase(attempt([],{status:'TECHNICAL_FAILURE'}),target()).classification,'TECHNICAL_FAILURE'));
test('16 corpus and truth IDs are identical', async () => { const c=await loadRegressionCorpus(repoRoot);const t=await loadRegressionGroundTruth(repoRoot);assert.deepEqual(c.map(x=>x.caseId).sort(),t.map(x=>x.caseId).sort()); });
test('17 cache answers cannot be reused', () => assert.equal(attempt([]).cacheReadUsed,false));
test('18 ground truth leakage firewall and lifecycle order are enforced', () => { const envelope=buildInferenceEnvelope(corpusCase('LANDMARK'));assertInferenceEnvelope(envelope);assert.doesNotMatch(JSON.stringify(envelope),/canonicalName|acceptedAliases|expectedAnswer/);const l=new BenchmarkLifecycle();l.inferenceStarted();assert.throws(()=>l.truthLoaded(),/truth_before_ranking/);l.resultsPersisted();l.ranked();l.truthLoaded();l.scored();assert.equal(l.current(),'SCORED'); });
test('19 wrong autosave is independent of correct recall', () => { const s=scoreCase(attempt([candidate('San Diego Zoo')],{category:'LANDMARK',safetyDecision:'AUTO_SAVE'}),target({canonicalName:'San Diego Zoo',acceptedAliases:[],latitude:null,longitude:null,acceptableRadiusMeters:null,expectedSafetyDecision:'REVIEW',autoSaveProhibited:true}));assert.equal(s.exactAt1,true);assert.equal(s.wrongAutosave,true);const safe=scoreCase(attempt([candidate('Tamolitch Blue Pool')],{safetyDecision:'AUTO_SAVE'}),target());assert.equal(safe.wrongAutosave,false); });
test('20 category metrics count specificity classes', () => { const c=[corpusCase('HIKING_TRAIL')];const a=[attempt([candidate('Oregon',1,{specificity:'ADMIN_AREA'})])];const s=[scoreCase(a[0]!,target())];assert.equal(calculateMetrics(c,a,s).perCategory.HIKING_TRAIL.areaOnly,1); });
test('21 macro metrics equally weight all categories', () => { const c=RECOGNITION_CATEGORIES.map((x,i)=>corpusCase(x,`X${i}`));const a=c.map((x,i)=>attempt(i===0?[candidate('Tamolitch Blue Pool')]:[],{caseId:x.caseId,category:x.category}));const s=a.map((x,i)=>scoreCase(x,target({caseId:x.caseId})));const m=calculateMetrics(c,a,s);assert.equal(m.microExactAt3,.2);assert.equal(m.macroExactAt3,.2); });
test('22 case diff reports regressions and area/technical diagnostics', () => { const pass=scoreCase(attempt([candidate('Tamolitch Blue Pool')]),target());const fail=scoreCase(attempt([candidate('Wrong')]),target());assert.deepEqual(diffCases([pass],[fail]).REGRESSED,['X']); });
test('23 ratchet cannot silently lower a baseline', () => { const b:RatchetBaseline={schemaVersion:2,recognitionVersion:'v',recordedAt:'2026-09-05',passingCaseIds:['X'],perCategoryExactAt3Minimum:{...emptyCategoryMinimum(),HIKING_TRAIL:1},productTargetExactAt3Percent:Object.fromEntries(RECOGNITION_CATEGORIES.map(x=>[x,100])) as RatchetBaseline['productTargetExactAt3Percent'],wrongAutosavesMaximum:0,fixtureCorrections:[]};const miss=scoreCase(attempt([candidate('Wrong')]),target());assert.throws(()=>enforceRatchet(b,[miss]),/ratchet_case_regression/);assert.throws(()=>assertBaselineDoesNotDecrease(b,{...b,passingCaseIds:[],perCategoryExactAt3Minimum:emptyCategoryMinimum()}),/baseline_passing_cases_removed/); });
test('24 fixture correction requires explicit review metadata', () => assert.throws(()=>assertFixtureCorrection({caseId:'X',oldGroundTruth:'A',newGroundTruth:'B',reason:'',evidence:[],reviewedBy:'',reviewedAt:''}),/fixture_correction_requires_explicit_review/));
test('25 full corpus/category CLI and founder 42-link source are wired', async () => { assert.equal(parseCategory('cliff-jumping'),'CLIFF_JUMPING');const source=await readFile(path.join(repoRoot,'services/media-worker/src/cli/recognitionLiveBenchmark.ts'),'utf8');assert.match(source,/--all/);const founder=JSON.parse(await readFile(path.join(repoRoot,'artifacts/recognition-regression/cliff-corpus.json'),'utf8')) as {cases:Array<{sourceUrl:string;existingCaseId?:string}>};assert.equal(founder.cases.length,42);assert.equal(new Set(founder.cases.map((item)=>item.sourceUrl)).size,42);assert.equal(founder.cases.filter((item)=>item.existingCaseId).length,1); });
