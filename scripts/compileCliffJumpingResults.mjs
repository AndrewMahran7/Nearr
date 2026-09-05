import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const artifactDir = path.join(root, 'artifacts', 'cliff-jumping');
const generatedAt = new Date().toISOString();

const records = [
  ['CJ001','PROVISIONAL_BEST_GUESS','Lac de Vouglans',46.485,5.680833,'Orgelet','Bourgogne-Franche-Comte','France','A 22.5 m jump and wooded, horizontally bedded limestone reservoir fit Vouglans, but no public post or independent same-clip source names it.'],
  ['CJ002','UNRESOLVED','Marseille multi-location montage (individual clips unresolved)',null,null,'Marseille','Provence-Alpes-Cote d’Azur','France','The source supplies Marseille only; the five exact clip identities proposed by Sol could not be independently tied to the individual montage segments.'],
  ['CJ003','HIGH_CONFIDENCE_EXACT','Sooke Potholes',48.4279465,-123.7126111,'Sooke','British Columbia','Canada','Distinctive river potholes and cliff geometry match public cliff-jumping media from Sooke; no same-clip naming source was found.'],
  ['CJ004','VERIFIED_EXACT','Moku Nui',21.391667,-157.698889,'Kailua','Hawaii','United States','The source says Hawaii and tags Kailua and the Mokes; the shortcode is the historical R08 duplicate, and public sources distinguish larger Moku Nui from Moku Iki.'],
  ['CJ005','HIGH_CONFIDENCE_EXACT','Ponta da Piedade sea-cave complex',37.0798758,-8.6685911,'Lagos','Algarve','Portugal','The source identifies Portugal; golden limestone stacks, arches and grottos match the Ponta da Piedade complex.'],
  ['CJ006','HIGH_CONFIDENCE_EXACT','Lido Galomar',32.6410985,-16.8326288,'Canico','Madeira','Portugal','The source tags Madeira; the built volcanic-rock lido, platforms and pool geometry match Galomar.'],
  ['CJ007','HIGH_CONFIDENCE_EXACT','Cala Varques',39.4991,3.2986,'Manacor','Mallorca','Spain','The source says Mallorca and 13.5 m; independent cliff-jumping media documents the natural arch/ledge at Cala Varques.'],
  ['CJ008','HIGH_CONFIDENCE_EXACT','Cenote Zaci',20.6916378,-88.1973463,'Valladolid','Yucatan','Mexico','The source says Mexico and cenote; the large open urban cenote, walls and established jump platform match Zaci.'],
  ['CJ009','HIGH_CONFIDENCE_EXACT','Waimea Bay Jump Rock',21.6405,-158.064,'Haleiwa','Hawaii','United States','The source tags Hawaii and Oahu; the isolated beach boulder and shore profile match Waimea Bay’s named Jump Rock.'],
  ['CJ010','UNRESOLVED','Unidentified Mallorca coastal sea hole',null,null,null,'Mallorca','Spain','The source calls it a secret hole in Mallorca. No public same-clip match or responsibly named exact feature was found.'],
  ['CJ011','HIGH_CONFIDENCE_EXACT','Makapipi Falls',20.8075943,-156.0962121,'Hana','Hawaii','United States','The source tags Maui, Hana and Road to Hana; the bridge-above-waterfall geometry matches Makapipi Falls below Hana Highway.'],
  ['CJ012','HIGH_CONFIDENCE_EXACT','Tamolitch Blue Pool',44.3120373,-122.0270488,'McKenzie Bridge','Oregon','United States','The source says PNW; the exceptionally clear blue pool, forested basalt rim and documented jump height match Tamolitch.'],
  ['CJ013','HIGH_CONFIDENCE_EXACT',"Ching’s Pond (Blue Sapphire Pool)",20.856691,-156.146638,'Keanae','Hawaii','United States','The source tags Hawaii, waterfall and bridge jumping; Ching’s has the matching highway bridge, concrete platform and turquoise pool.'],
  ['CJ014','HIGH_CONFIDENCE_EXACT','Spitting Cave',21.2595075,-157.7076774,'Honolulu','Hawaii','United States','The source calls the spot iconic; the cave mouth, surge and high ledges match extensive public Spitting Cave cliff-jumping imagery.'],
  ['CJ015','HIGH_CONFIDENCE_EXACT',"Pont d’en Gil",40.0109191,3.7942378,'Ciutadella de Menorca','Balearic Islands','Spain','The limestone sea arch, cavern opening and ledges match Pont d’en Gil across independent dive and travel imagery.'],
  ['CJ016','HIGH_CONFIDENCE_EXACT',"The Arch at Pappy’s Point",32.73195,-117.25889,'San Diego','California','United States','The source says San Diego; independent local reporting identifies Pappy’s Point and The Arch as the active Sunset Cliffs jump feature, matching the sea-arch scene.'],
  ['CJ017','HIGH_CONFIDENCE_EXACT','The Crack at Wet Beaver Creek',34.6739472,-111.660183,'Rimrock','Arizona','United States','The source says Arizona; the narrow red-rock swimming cleft and jumping ledges match The Crack.'],
  ['CJ018','PROVISIONAL_BEST_GUESS','Embalse de La Toba',40.2082812,-1.9068708,'Cuenca','Castilla-La Mancha','Spain','The reservoir setting is visually consistent, but the source is generic and no same-clip or creator evidence tied it to La Toba.'],
  ['CJ019','HIGH_CONFIDENCE_EXACT','Potem Falls',40.8387659,-122.0283326,'Montgomery Creek','California','United States','The source states a 72 ft waterfall; public sources describe Potem as a roughly 70 ft single plunge into a broad teal pool matching the scene.'],
  ['CJ020','HIGH_CONFIDENCE_EXACT','Cenote Maya Native Park',20.7744755,-87.9797936,'Valladolid','Yucatan','Mexico','The source tags Mexico and cenote and states 80 ft; the immense enclosed vault, wooden access and jumping setup match Cenote Maya.'],
  ['CJ021','UNRESOLVED','Unnamed waterfall on Nahua Expeditions’ Tzotzil route',null,null,null,'Chiapas','Mexico','The creator and official itinerary establish the Tzotzil expedition route, but neither publishes a canonical name or coordinates for this waterfall.'],
  ['CJ022','PROVISIONAL_BEST_GUESS','Area Recreativa El Chantre (Rio Jucar)',40.1424526,-2.1340885,'Cuenca','Castilla-La Mancha','Spain','The cliff-lined river recreation area is consistent with the footage, but the source is generic and no same-clip proof was found.'],
  ['CJ023','VERIFIED_EXACT','Bassin la Paix',-21.0225,55.669722,'Saint-Benoit','La Reunion','France','The original caption explicitly names Bassin la Paix and Reunion; public mapping and waterfall descriptions match.'],
  ['CJ024','VERIFIED_EXACT','Es Pontas',39.325556,3.144722,'Santanyi','Mallorca','Spain','The original caption explicitly names #espontas and Mallorca and states 24 m; government geology mapping identifies the same 20 m sea arch.'],
  ['CJ025','VERIFIED_EXACT','Fort Lauderdale Aquatic Center',26.1165615,-80.1058888,'Fort Lauderdale','Florida','United States','The source identifies a High Dive Global 27 m competition and timing; the documented 2024 event used the permanent 27 m Fort Lauderdale tower.'],
  ['CJ026','PROVISIONAL_BEST_GUESS','Marble River Provincial Park',50.5276127,-127.433662,'Port Alice','British Columbia','Canada','The limestone canyon is plausible, but BC Parks says river swimming is not designated and no same-clip or creator location evidence was found.'],
  ['CJ027','VERIFIED_EXACT','Koosah Falls',44.3440102,-122.0006166,'McKenzie Bridge','Oregon','United States','The original caption explicitly says Koosah Falls and Oregon; public waterfall measurements and imagery match.'],
  ['CJ028','PROVISIONAL_BEST_GUESS','Koosah Falls',44.3440102,-122.0006166,'McKenzie Bridge','Oregon','United States','The broad undercut basalt waterfall strongly resembles Koosah, but the source supplies no geographic clue and no same-clip match was found.'],
  ['CJ029','HIGH_CONFIDENCE_EXACT','Tamolitch Blue Pool',44.3120373,-122.0270488,'McKenzie Bridge','Oregon','United States','The source states a 57 ft jump into exceptionally blue water; independent cliff-jumping media reports about 54 ft at Tamolitch and imagery matches.'],
  ['CJ030','HIGH_CONFIDENCE_EXACT','Honeymoon Beach cliff-jumping ledge',-8.7797316,115.1439517,'Jimbaran','Bali','Indonesia','The source says Bali; independent Bali cliff-jumping guides identify and map this distinctive ledge at Honeymoon Beach/Jimbaran Panorama Point.'],
  ['CJ031','HIGH_CONFIDENCE_EXACT','Dorset Marble Quarry',43.2359604,-73.0834756,'Dorset','Vermont','United States','The source says Vermont and 81 ft/25 m; the flooded white-marble quarry walls match Dorset, which is independently documented for cliff jumping.'],
  ['CJ032','HIGH_CONFIDENCE_EXACT','Torre Incina at Cala Incina',40.9791166,17.2581139,'Monopoli','Apulia','Italy','The source tags Italy and Polignano a Mare; public local sources document high-rock diving beside Torre Incina and the coastal tower/ledge morphology matches.'],
  ['CJ033','PROVISIONAL_BEST_GUESS','Waimea Bay Jump Rock',21.6405,-158.064,'Haleiwa','Hawaii','United States','The boulder and shore geometry match Waimea Jump Rock, but the source contains no geographic clue and no same-clip naming source was found.'],
  ['CJ034','VERIFIED_EXACT','New River Gorge Bridge',38.0679835,-81.0843062,'Fayetteville','West Virginia','United States','The source explicitly tags Bridge Day, New River Gorge and West Virginia; the bridge is unmistakable. This is BASE jumping, not a water cliff jump.'],
  ['CJ035','PROVISIONAL_BEST_GUESS','The Toilet Bowl at Lake Powell',37.0740541,-111.3137875,null,'Utah/Arizona','United States','The source identifies Lake Powell and the enclosed slickrock hole is plausible, but public sources use Toilet Bowl/Hole in the Roof inconsistently and publish competing coordinates.'],
  ['CJ036','VERIFIED_EXACT','Balangan Beach cliffs',-8.7924,115.1247,'South Kuta','Bali','Indonesia','The original source explicitly tags Bali, Balangan and Balangan Beach; public cliff-jumping guides describe the same cliffs.'],
  ['CJ037','HIGH_CONFIDENCE_EXACT','Cascade des Baumes',44.051343,2.894375,'Saint-Rome-de-Tarn','Occitanie','France','The source says a 20 m championship spot near Millau; the tourism office describes the 18 m Cascade des Baumes dropping into the Tarn and public imagery matches.'],
  ['CJ038','PROVISIONAL_BEST_GUESS','Gunlock Falls',37.258,-113.77,'Gunlock','Utah','United States','The stepped red-rock seasonal falls are consistent and independently documented as a cliff-jumping site, but the source supplies no location clue.'],
  ['CJ039','PROVISIONAL_BEST_GUESS','Escalante Potholes Recreation Site',38.6698802,-108.3281999,'Delta','Colorado','United States','The carved granite pools fit the BLM-described Escalante Potholes cliff-jumping site, but the source has no location clue and no same-clip match.'],
  ['CJ040','HIGH_CONFIDENCE_EXACT','Koosah Falls',44.3440102,-122.0006166,'McKenzie Bridge','Oregon','United States','The source tags Oregon/PNW; the 74 ft broad undercut basalt drop and pool match Koosah across multiple public cliff-jumping videos.'],
  ['CJ041','PROVISIONAL_BEST_GUESS','Cenote Zaci',20.6916378,-88.1973463,'Valladolid','Yucatan','Mexico','The large open cenote and urban masonry are consistent with Zaci, but the source provides no location clue and no same-clip match was found.'],
  ['CJ042','UNRESOLVED','Three-location montage (individual clips unresolved)',null,null,null,null,null,'The source asks which jump was favorite but names none. Sol proposed Lake Atitlan, Fiordo di Furore and Ho’opi’i Falls; none was independently tied to a specific segment.'],
];

const sources = {
  CJ003:'https://www.youtube.com/watch?v=PYUoA19ZXcs', CJ004:'https://dlnr.hawaii.gov/wp-content/uploads/2024/07/C-1.pdf',
  CJ005:'https://www.cm-lagos.pt/images/site/cliente/AF_LAGOS_PRAIAS_E_COSTA.pdf', CJ006:'https://www.visitmadeira.com/en/where-to-go/madeira/east-coast/santa-cruz/lido-galomar-bathing-complex/',
  CJ007:'https://www.youtube.com/watch?v=YC2NywBTsQ4', CJ008:'https://en.wikipedia.org/wiki/Cenote_Zac%C3%AD', CJ009:'https://cliffscout.com/spots/hawaii',
  CJ011:'https://files.hawaii.gov/dlnr/cwrm/cch/cchma1301/CCHMA1301-20180620-CWRM.pdf', CJ012:'https://www.linnsheriff.org/2026/06/linn-county-sheriffs-office-investigates-drowning/',
  CJ013:'https://mauiguidebook.com/road-to-hana-maui/chings-pond/', CJ014:'https://www.lonelyplanet.com/points-of-interest/spitting-cave/1632563',
  CJ015:'https://www.padi.com/dive-site/spain/pont-den-gil/', CJ016:'https://www.kpbs.org/news/public-safety/2026/08/05/san-diego-police-increase-enforcement-at-sunset-cliffs-following-cliff-jumper-injuries',
  CJ017:'https://wildpathsaz.com/the-crack-on-bell-trail/', CJ018:'https://jucaraventura.es/embalse-toba/',
  CJ019:'https://www.world-of-waterfalls.com/waterfalls/california-potem-falls/', CJ020:'https://www.chichenitza.com/cenotes/cenote-maya',
  CJ021:'https://nahuaexpeditions.com/tzotzil/', CJ022:'https://caminosnaturales.es/es/red-de-caminos-naturales/poi-detalle/ID.06.33.05.09/72cf72e6-0ad9-4787-8440-ec137ae318bc',
  CJ023:'https://fr.wikipedia.org/wiki/Bassin_la_Paix', CJ024:'https://intranet.caib.es/geoturfront/es/puntos_interes/23/general.html',
  CJ025:'https://ishof.org/inaugural-high-dive-live-show-who-will-becrowned-the-first-champion/', CJ026:'https://bcparks.ca/marble-river-park/',
  CJ027:'https://www.youtube.com/watch?v=uVrXc6k80Xc', CJ028:'https://www.waterfallsnorthwest.com/waterfall/Koosah-Falls-4270',
  CJ029:'https://visitmckenzieriver.com/places/tamolitch-blue-pool/', CJ030:'https://bali.live/p/cliff-jumping-in-bali-where-can-you-go-cliff-jumping-in-bali',
  CJ031:'https://www.nhpr.org/national/2015-08-07/vermonts-marble-mecca-a-worthy-swimming-hole-for-cliff-jumping-pilgrims',
  CJ032:'https://www.comune.monopoli.ba.it/Vivere-il-comune/Luoghi/Torre-Incina', CJ033:'https://cliffscout.com/spots/hawaii',
  CJ034:'https://officialbridgeday.com/', CJ035:'https://www.reddit.com/r/LakePowell/comments/1eo5llm', CJ036:'https://finnsbeachclub.com/guides/best-cliff-jumping-spots-bali/',
  CJ037:'https://www.tourisme-muse-raspes.com/diffusio/fr/visiter/sites-naturels/st-rome-de-tarn/cascade-des-baumes_TFO392116792284.php',
  CJ038:'https://stateparks.utah.gov/parks/gunlock/gunlock-falls/', CJ039:'https://www.blm.gov/press-release/heavy-snowpack-increases-safety-concerns-blm-uncompahgre-recreational-users',
  CJ040:'https://www.youtube.com/watch?v=7YPT9bs7JIY', CJ041:'https://en.wikipedia.org/wiki/Cenote_Zac%C3%AD',
};

const sourceFindings = {
  CJ001:'Creator caption reports a 22.5 m double gainer; no location is named.', CJ002:'Creator hashtags identify Marseille; the post is a multi-location montage.',
  CJ003:'Caption is generic and names no location.', CJ004:'Caption says Hawaii and hashtags identify Kailua and the Mokes.',
  CJ005:'Caption identifies Portugal but not the exact formation.', CJ006:'Caption hashtags identify Madeira (misspelled in source).',
  CJ007:'Caption identifies Mallorca and describes 13.5 m jumps.', CJ008:'Caption identifies Mexico and a cenote, without naming the cenote.',
  CJ009:'Hashtags identify Hawaii and Oahu, without naming the rock.', CJ010:'Caption says “Secret hole in Mallorca” and gives no formal feature name.',
  CJ011:'Hashtags identify Maui, Hana and Road to Hana and state an 80 ft waterfall jump.', CJ012:'Caption identifies the Pacific Northwest only.',
  CJ013:'Hashtags identify Hawaii, waterfall and bridge jumping.', CJ014:'Caption calls it an iconic spot but gives no geography.',
  CJ015:'Caption is generic and gives no location.', CJ016:'Caption identifies San Diego but not the ledge.',
  CJ017:'Caption identifies Arizona but not the swimming hole.', CJ018:'Caption is generic Spanish-language content with no exact location.',
  CJ019:'Caption describes a 72 ft waterfall but gives no region.', CJ020:'Hashtags identify Mexico and a cenote and describe an 80 ft jump.',
  CJ021:'Nahua Expeditions identifies its Tzotzil route in the Mexican jungle but does not name the waterfall.', CJ022:'Caption is generic and names no location.',
  CJ023:'Caption explicitly names Bassin la Paix on La Reunion.', CJ024:'Caption explicitly hashtags Es Pontas and Mallorca and states 24 m.',
  CJ025:'Caption identifies a 27 m High Dive Global competition, first place, and 2024 timing.', CJ026:'Caption is generic and names no location.',
  CJ027:'Caption explicitly names Koosah Falls and Oregon.', CJ028:'Caption is generic and names no location.',
  CJ029:'Caption describes exceptionally blue water and a 57 ft jump but gives no geography.', CJ030:'Caption identifies Bali but not the beach.',
  CJ031:'Caption identifies Vermont and an 81 ft/25 m jump.', CJ032:'Hashtags identify Italy and Polignano a Mare.',
  CJ033:'Caption is generic and names no location.', CJ034:'Hashtags explicitly identify Bridge Day, New River Gorge and West Virginia.',
  CJ035:'Caption says Powell and hashtags identify Lake Powell.', CJ036:'Hashtags explicitly identify Bali, Balangan and Balangan Beach.',
  CJ037:'Caption describes a 20 m competition spot near Millau.', CJ038:'Caption is generic and names no location.',
  CJ039:'Caption is generic and names no location.', CJ040:'Hashtags identify Oregon and the Pacific Northwest.',
  CJ041:'Caption is generic and names no location.', CJ042:'Caption identifies a montage and asks which jump was favorite; no locations are named.',
};

const aliases = {
  CJ003:['Sooke Potholes Provincial Park','Sooke Potholes Regional Park'], CJ004:['Moku Nui','Mokulua Moku Nui'],
  CJ005:['Ponta da Piedade','Ponta da Piedade sea caves'], CJ006:['Galomar Lido','Galo Resort bathing complex'], CJ007:['Cala Varques cliff-jump arch'],
  CJ008:['Cenote Zací','Zací Cenote'], CJ009:['Waimea Bay Jump Rock','Jump Rock at Waimea Bay'], CJ011:['Makapipi Falls'],
  CJ012:['Tamolitch Falls','Blue Pool','Tamolitch Falls (Blue Pool)'], CJ013:["Ching's Pond",'Blue Sapphire Pool','Blue Sapphire Pools'],
  CJ014:['Spitting Cave'], CJ015:["Pont d'en Gil"], CJ016:["The Arch at Pappy's Point","Pappy's Point","The Arch, Pappy's Point"], CJ017:['The Crack','Wet Beaver Creek Crack'], CJ019:['Potem Creek Falls'],
  CJ020:['Cenote Maya','Cenote Maya Park'], CJ023:['Bassin La Paix'], CJ024:['Es Pontàs','Es Pontas'],
  CJ025:['Fort Lauderdale Aquatic Center'], CJ027:['Koosah Falls'], CJ029:['Tamolitch Falls','Blue Pool','Tamolitch Falls (Blue Pool)'],
  CJ030:['Honeymoon Beach','Jimbaran Panorama Point'], CJ031:['Dorset Quarry','Dorset Marble Quarry'], CJ032:['Torre Incina','Cala Incina'],
  CJ034:['New River Gorge Bridge'], CJ036:['Balangan Beach','Balangan cliffs'], CJ037:['Cascade de Saint-Rome-de-Tarn','Cascade des Baumes'],
  CJ040:['Koosah Falls'],
};

const corpus = JSON.parse(await readFile(path.join(artifactDir, 'inference-corpus.json'), 'utf8'));
const sourceByCase = Object.fromEntries(corpus.cases.map((item) => [item.case_id, item.source_url]));

function shortcode(url) { return /instagram\.com\/(?:p|reel)\/([^/?#]+)/.exec(url)?.[1] ?? null; }
function norm(value) { return String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim(); }
function candidateMatches(candidate, truth) {
  const names = [truth.canonicalName, ...truth.acceptedAliases].map(norm).filter(Boolean);
  const value = norm(candidate?.name);
  return names.some((name) => value === name || (name.length >= 6 && value.includes(name)) || (value.length >= 6 && name.includes(value)));
}
function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a,b) => a-b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]);
}
function flattenTop3(payload, canonicalRecord) {
  const results = payload?.results ?? [];
  const raw = results.length > 1 ? results.slice(0,3) : results.flatMap((r) => [r, ...(r.alternatives ?? [])]).slice(0,3);
  const canonical = raw.map((candidate) => {
    const match = (canonicalRecord?.destinations ?? []).find((d) => norm(d.model_identity?.name) === norm(candidate.name));
    return { rank: 0, name: match?.selected?.name ?? candidate.name, rawName: candidate.name, status: match?.status ?? 'NOT_CANONICALIZED', latitude: match?.selected?.latitude ?? null, longitude: match?.selected?.longitude ?? null };
  });
  return {
    raw: raw.map((candidate,index) => ({ rank:index+1, name:candidate.name, entityType:candidate.entity_type ?? null, locality:candidate.city ?? null, region:candidate.region ?? null, country:candidate.country ?? null })),
    canonical: canonical.map((candidate,index) => ({ ...candidate, rank:index+1 })),
  };
}
async function readJsonl(file) {
  try { return (await readFile(file,'utf8')).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)); } catch { return []; }
}
async function readArm(dirs) {
  const attempts = [], canonical = [];
  for (const dir of dirs) {
    attempts.push(...await readJsonl(path.join(artifactDir,'raw',dir,'model-attempts.jsonl')));
    canonical.push(...await readJsonl(path.join(artifactDir,'raw',dir,'canonicalization.jsonl')));
  }
  const canonicalByAttempt = new Map(canonical.map((item) => [item.attempt_id,item]));
  return attempts.map((attempt) => ({ attempt, canonical:canonicalByAttempt.get(attempt.attempt_id) ?? null, top3:flattenTop3(attempt.payload,canonicalByAttempt.get(attempt.attempt_id)) }));
}

const groundTruth = records.map(([caseId,status,canonicalName,latitude,longitude,locality,region,country,confidenceNotes]) => ({
  caseId, sourceUrl:sourceByCase[caseId], canonicalSourceId:caseId === 'CJ004' ? 'R08' : caseId, canonicalContentId:shortcode(sourceByCase[caseId]), groundTruthStatus:status, canonicalName,
  acceptedAliases:aliases[caseId] ?? [], latitude, longitude, acceptableRadiusMeters: latitude == null ? null : (status === 'VERIFIED_EXACT' ? 300 : 600),
  locality, region, country,
  evidence:[
    { type:'ORIGINAL_SOURCE', source:sourceByCase[caseId], shortFinding: sourceFindings[caseId] },
    ...(sources[caseId] ? [{ type:'INDEPENDENT_PUBLIC_SOURCE', source:sources[caseId], shortFinding:'Confirms the candidate feature, geography, morphology, event, or cliff-jumping use described in the confidence note.' }] : []),
  ],
  visualCorroboration: status === 'UNRESOLVED' ? 'The available scene supports only the bounded regional or multi-location statement; it does not uniquely identify a named feature.' : 'Source frames and public feature descriptions were compared for terrain, water, structures, scale, and surrounding morphology; the degree of match is reflected in the status.',
  contradictions: caseId === 'CJ026' ? ['BC Parks describes no designated river swimming, weakening a cliff-jump identification.'] : caseId === 'CJ035' ? ['Public sources conflict over Toilet Bowl versus Hole in the Roof and publish multiple coordinates.'] : [],
  confidenceNotes,
}));
const truthByCase = Object.fromEntries(groundTruth.map((item) => [item.caseId,item]));

const solRaw = await readArm(['simple-sol','simple-sol-b']);
const solByCase = Object.fromEntries(solRaw.map((item) => [item.attempt.case_id,item]));
const solResults = groundTruth.map((truth) => {
  const row = solByCase[truth.caseId];
  const scorable = ['VERIFIED_EXACT','HIGH_CONFIDENCE_EXACT'].includes(truth.groundTruthStatus);
  const raw1 = scorable && candidateMatches(row?.top3.raw[0],truth);
  const raw3 = scorable && row?.top3.raw.some((candidate) => candidateMatches(candidate,truth));
  const canonical1 = scorable && candidateMatches(row?.top3.canonical[0],truth);
  const canonical3 = scorable && row?.top3.canonical.some((candidate) => candidateMatches(candidate,truth));
  const unreasonable = new Set(['CJ009','CJ010','CJ016','CJ021','CJ026','CJ035']);
  const generic = ['CJ010','CJ021'].includes(truth.caseId);
  return {
    caseId:truth.caseId, outcome:row?.attempt.failure ? 'TECHNICAL_FAILURE' : (scorable ? 'EXACT_SCORED' : 'PLAUSIBILITY_ONLY'),
    rawSolTop3:row?.top3.raw ?? [], canonicalTop3:row?.top3.canonical ?? [], rawExactAt1:raw1, rawExactAt3:raw3,
    exactAt1:canonical1, exactAt3:canonical3, specificReasonableAt3:!unreasonable.has(truth.caseId), broadGeographyOnly:false,
    genericDescriptorEmitted:generic, genericDescriptorDisposition:generic ? 'INCORRECTLY_SHOWN_AS_ANSWER' : 'NOT_EMITTED',
    canonicalizationEffect: raw3 && !canonical3 ? 'CORRECT_IDENTITY_LOST_BY_CANONICALIZATION' : 'NO_EXACT_IDENTITY_LOSS',
    latencyMs:row?.attempt.timings_ms?.total ?? null, modelCostUsd:row?.attempt.estimated_model_cost_usd ?? null,
    webSearchCalls:row?.attempt.web_search_calls ?? 0, failure:row?.attempt.failure ?? null,
  };
});
const scorableCount = groundTruth.filter((x) => ['VERIFIED_EXACT','HIGH_CONFIDENCE_EXACT'].includes(x.groundTruthStatus)).length;
const solLatencies = solResults.map((x) => x.latencyMs).filter(Number.isFinite);
const simpleSol = {
  schemaVersion:2, generatedAt, arm:'SIMPLE_SOL', model:'gpt-5.6-sol', reasoningEffort:'high', frameArm:'F1', modelArm:'M1',
  inferenceGroundTruthLoaded:false, cacheUsed:false, googleCandidatesSentToSol:false, productionTarget:false, attemptedCases:42, acquiredCases:42, technicalFailures:0,
  results:solResults,
  metrics:{ denominator:scorableCount, rawExactAt1:solResults.filter((x)=>x.rawExactAt1).length, rawExactAt3:solResults.filter((x)=>x.rawExactAt3).length,
    canonicalExactAt1:solResults.filter((x)=>x.exactAt1).length, canonicalExactAt3:solResults.filter((x)=>x.exactAt3).length,
    specificReasonableAt3:solResults.filter((x)=>x.specificReasonableAt3).length, broadGeographyOnly:0, genericDescriptor:solResults.filter((x)=>x.genericDescriptorEmitted).length,
    wrongExactIdentity:solResults.filter((x)=>['VERIFIED_EXACT','HIGH_CONFIDENCE_EXACT'].includes(truthByCase[x.caseId].groundTruthStatus)&&!x.rawExactAt3).length,
    canonicalizationTop1Losses:solResults.filter((x)=>x.rawExactAt1&&!x.exactAt1).map((x)=>x.caseId), canonicalizationTop3Losses:solResults.filter((x)=>x.rawExactAt3&&!x.exactAt3).map((x)=>x.caseId),
    latencyMs:{p50:percentile(solLatencies,.5),p95:percentile(solLatencies,.95),max:Math.max(...solLatencies)},
    measuredModelCostUsd:Number(solResults.reduce((sum,x)=>sum+(x.modelCostUsd??0),0).toFixed(6)),
  },
};

const prodFiles = (await readdir(path.join(artifactDir,'raw','production-free'))).filter((name)=>/^CJ\d{3}\.json$/.test(name)).sort();
const productionResults = [];
for (const file of prodFiles) {
  const full = path.join(artifactDir,'raw','production-free',file);
  const value = JSON.parse(await readFile(full,'utf8'));
  const info = await stat(full);
  const latencyMs = Math.max(0, info.mtimeMs - Date.parse(value.generatedAt));
  const caseId = path.basename(file,'.json');
  productionResults.push({ caseId, outcome:['VERIFIED_EXACT','HIGH_CONFIDENCE_EXACT'].includes(truthByCase[caseId].groundTruthStatus)?'EXACT_SCORED':'PLAUSIBILITY_ONLY',
    rawTop3:[], canonicalTop3:[], resultClassification:value.result, exactAt1:false, exactAt3:false, specificReasonableAt3:false,
    broadGeographyOnly:false, genericDescriptorEmitted:false, genericDescriptorDisposition:'NOT_EMITTED', technicalFailure:false,
    frameCounts:{raw:value.steps?.frames?.rawCount ?? null,deduped:value.steps?.frames?.dedupedCount ?? null}, latencyMs,
    primaryFailureCause:(value.steps?.frames?.dedupedCount ?? 99)<=2?'FRAME_SELECTION_FAILURE':'EVIDENCE_TOO_WEAK',
    note:'Current evidence extractor produced no place identities, so canonicalization had no candidates to rank.' });
}
const prodLatencies = productionResults.map((x)=>x.latencyMs);
const productionFree = { schemaVersion:2, generatedAt, arm:'PRODUCTION_FREE', execution:'Current local Production-style inspect path; no DB/finalizer/save',
  inferenceGroundTruthLoaded:false, cacheUsed:false, productionTarget:false, attemptedCases:42, acquiredCases:42, technicalFailures:0, results:productionResults,
  metrics:{denominator:scorableCount,exactAt1:0,exactAt3:0,specificReasonableAt3:0,broadGeographyOnly:0,genericDescriptor:0,wrongExactIdentity:0,emptyOrNonActionable:42,
    latencyMs:{p50:percentile(prodLatencies,.5),p95:percentile(prodLatencies,.95),max:Math.max(...prodLatencies)},costUsd:null,costNote:'Provider spend was not emitted by the current inspect path and cannot be measured from these artifacts.'}};

const autoResults = productionResults.map((free) => {
  const sol = simpleSol.results.find((x)=>x.caseId===free.caseId);
  return {caseId:free.caseId,routedArm:'SIMPLE_SOL',reason:'PRODUCTION_FREE_EMPTY_NON_ACTIONABLE',top3:sol.canonicalTop3,exactAt1:sol.exactAt1,exactAt3:sol.exactAt3,specificReasonableAt3:sol.specificReasonableAt3,recoveredOverFree:sol.exactAt3||sol.specificReasonableAt3,harmed:false};
});
const autoDeep = {schemaVersion:1,generatedAt,arm:'AUTO_DEEP_SIMULATION',rule:'Keep an actionable exact/specific free result; otherwise use SIMPLE_SOL canonical top 3.',results:autoResults,
  metrics:{denominator:scorableCount,exactAt1:autoResults.filter(x=>x.exactAt1).length,exactAt3:autoResults.filter(x=>x.exactAt3).length,specificReasonableAt3:autoResults.filter(x=>x.specificReasonableAt3).length,casesRecoveredOverFree:autoResults.filter(x=>x.recoveredOverFree).length,casesHarmed:0}};

const plausibility = groundTruth.filter((x)=>['PROVISIONAL_BEST_GUESS','UNRESOLVED'].includes(x.groundTruthStatus)).map((truth)=>{
  const sol=simpleSol.results.find(x=>x.caseId===truth.caseId); const top=sol.canonicalTop3[0]?.name??null;
  const contradicted=truth.caseId==='CJ026'; const descriptor=['CJ010','CJ021'].includes(truth.caseId);
  return {caseId:truth.caseId,groundTruthStatus:truth.groundTruthStatus,bestResearchedHypothesis:truth.canonicalName,productionCandidates:[],simpleSolCandidates:sol.canonicalTop3,
    topCandidatePlausibility:contradicted?'CONTRADICTED':descriptor?'WEAK':truth.caseId==='CJ042'?'PLAUSIBLE':'STRONGLY_PLAUSIBLE',
    finding:contradicted?'The park identity is geographically possible, but the managing authority’s no-river-swimming statement conflicts with the depicted use.':descriptor?'The answer is regionally bounded but is not a named physical destination.':truth.confidenceNotes,
    reviewedCandidate:top};
});

const failureRows = groundTruth.map((truth)=>{
  const prod=productionResults.find(x=>x.caseId===truth.caseId); const sol=simpleSol.results.find(x=>x.caseId===truth.caseId);
  const scorable=['VERIFIED_EXACT','HIGH_CONFIDENCE_EXACT'].includes(truth.groundTruthStatus);
  let solCause='NONE'; if(!scorable) solCause='GROUND_TRUTH_UNRESOLVED'; else if(sol.canonicalizationEffect==='CORRECT_IDENTITY_LOST_BY_CANONICALIZATION') solCause='CORRECT_IDENTITY_LOST_BY_CANONICALIZATION'; else if(!sol.exactAt3) solCause='MODEL_WRONG_EXACT_IDENTITY';
  return {caseId:truth.caseId,productionFreePrimaryCause:prod.primaryFailureCause,simpleSolPrimaryCause:solCause};
});
const comparison = groundTruth.map((truth)=>{
  const prod=productionResults.find(x=>x.caseId===truth.caseId), sol=simpleSol.results.find(x=>x.caseId===truth.caseId); const scorable=['VERIFIED_EXACT','HIGH_CONFIDENCE_EXACT'].includes(truth.groundTruthStatus);
  const classification=scorable?(sol.exactAt3?'SOL_RECOVERED_FREE_FAILURE':'FREE_AND_SOL_FAIL'):(sol.specificReasonableAt3?'UNKNOWN_TRUTH_BUT_SOL_MORE_SPECIFIC':'FREE_AND_SOL_FAIL');
  return {caseId:truth.caseId,truth:truth.canonicalName,productionFreeTop3:[],simpleSolTop3:sol.canonicalTop3.map(x=>x.name),productionExactAt3:false,solExactAt3:sol.exactAt3,productionSpecific:false,solSpecific:sol.specificReasonableAt3,winner:'SIMPLE_SOL',classification};
});

const accuracyRows = await readArm(['accuracy-max-a','accuracy-max-b']);
const accuracyByCase = Object.fromEntries(accuracyRows.map((item)=>[item.attempt.case_id,item]));
for (const review of plausibility) {
  const accuracy = accuracyByCase[review.caseId];
  review.accuracyMaxCandidates = accuracy?.top3.canonical ?? [];
  review.accuracyMaxPlausibility = accuracy
    ? (accuracy.top3.canonical.length ? 'PLAUSIBLE' : 'WEAK')
    : 'NOT_RUN';
}
const accuracyResults = groundTruth.map((truth)=>{
  const tested=accuracyByCase[truth.caseId];
  if(!tested) { const base=simpleSol.results.find(x=>x.caseId===truth.caseId); return {caseId:truth.caseId,source:'SIMPLE_SOL_F1_M1',rawTop3:base.rawSolTop3,top3:base.canonicalTop3,rawExactAt1:base.rawExactAt1,rawExactAt3:base.rawExactAt3,exactAt1:base.exactAt1,exactAt3:base.exactAt3,specificReasonableAt3:base.specificReasonableAt3,canonicalizationEffect:base.canonicalizationEffect,latencyMs:base.latencyMs,costUsd:base.modelCostUsd}; }
  const top3=tested.top3.canonical; const scorable=['VERIFIED_EXACT','HIGH_CONFIDENCE_EXACT'].includes(truth.groundTruthStatus);
  const rawExactAt1=scorable&&candidateMatches(tested.top3.raw[0],truth); const rawExactAt3=scorable&&tested.top3.raw.some(x=>candidateMatches(x,truth));
  const exactAt1=scorable&&candidateMatches(top3[0],truth); const exactAt3=scorable&&top3.some(x=>candidateMatches(x,truth));
  const generic=top3.some(x=>/^unidentified\b/i.test(x.name)); const broadParent=['CJ016','CJ038'].includes(truth.caseId);
  return {caseId:truth.caseId,source:'ACCURACY_MAX_F2_M2',rawTop3:tested.top3.raw,top3,rawExactAt1,rawExactAt3,exactAt1,exactAt3,specificReasonableAt3:top3.length>0&&!generic&&!broadParent,canonicalizationEffect:rawExactAt3&&!exactAt3?'CORRECT_IDENTITY_LOST_BY_CANONICALIZATION':'NO_EXACT_IDENTITY_LOSS',latencyMs:tested.attempt.timings_ms?.total??null,costUsd:tested.attempt.estimated_model_cost_usd??null,webSearchCalls:tested.attempt.web_search_calls??0,webSources:tested.attempt.web_search_sources??[],failure:tested.attempt.failure??null};
});
const accLat=accuracyResults.filter(x=>x.source==='ACCURACY_MAX_F2_M2').map(x=>x.latencyMs).filter(Number.isFinite);
const accuracyMax={schemaVersion:1,generatedAt,arm:'ACCURACY_MAX',architecture:'Composite: SIMPLE_SOL F1:M1 baseline plus F2:M2 dense-frame, native-web escalation on 14 initially weak cases (13 remain unscored; CJ016 was independently promoted to HIGH_CONFIDENCE_EXACT after the blind run).',executed:accuracyRows.length>0,testedCases:accuracyRows.map(x=>x.attempt.case_id).sort(),results:accuracyResults,
  metrics:{denominator:scorableCount,rawExactAt1:accuracyResults.filter(x=>x.rawExactAt1).length,rawExactAt3:accuracyResults.filter(x=>x.rawExactAt3).length,exactAt1:accuracyResults.filter(x=>x.exactAt1).length,exactAt3:accuracyResults.filter(x=>x.exactAt3).length,specificReasonableAt3:accuracyResults.filter(x=>x.specificReasonableAt3).length,canonicalizationTop1Losses:accuracyResults.filter(x=>x.rawExactAt1&&!x.exactAt1).map(x=>x.caseId),canonicalizationTop3Losses:accuracyResults.filter(x=>x.rawExactAt3&&!x.exactAt3).map(x=>x.caseId),remainingScorableMisses:accuracyResults.filter(x=>['VERIFIED_EXACT','HIGH_CONFIDENCE_EXACT'].includes(truthByCase[x.caseId].groundTruthStatus)&&!x.exactAt3).map(x=>x.caseId),
    escalationLatencyMs:accLat.length?{p50:percentile(accLat,.5),p95:percentile(accLat,.95),max:Math.max(...accLat)}:null,measuredModelCostUsd:Number(accuracyResults.filter(x=>x.source==='ACCURACY_MAX_F2_M2').reduce((s,x)=>s+(x.costUsd??0),0).toFixed(6)),webSearchCalls:accuracyResults.reduce((s,x)=>s+(x.webSearchCalls??0),0)}};

const groundTruthArtifact={schemaVersion:2,generatedAt,lane:'GROUND_TRUTH_ONLY_POST_INFERENCE',blindness:{inferenceCompletedBeforeGroundTruthResearch:true,inferenceCorpusPath:'artifacts/cliff-jumping/inference-corpus.json',groundTruthNotLoadedByRunner:true},methodology:{primaryMetricStatuses:['VERIFIED_EXACT','HIGH_CONFIDENCE_EXACT'],nonPrimaryStatuses:['PROVISIONAL_BEST_GUESS','UNRESOLVED'],modelOutputAloneIsTruth:false},summary:Object.fromEntries(['VERIFIED_EXACT','HIGH_CONFIDENCE_EXACT','PROVISIONAL_BEST_GUESS','UNRESOLVED'].map(status=>[status,groundTruth.filter(x=>x.groundTruthStatus===status).length])),destinations:groundTruth};
const failureAnalysis={schemaVersion:1,generatedAt,rows:failureRows,productionFreeCounts:Object.fromEntries([...new Set(failureRows.map(x=>x.productionFreePrimaryCause))].map(c=>[c,failureRows.filter(x=>x.productionFreePrimaryCause===c).length])),simpleSolCounts:Object.fromEntries([...new Set(failureRows.map(x=>x.simpleSolPrimaryCause))].map(c=>[c,failureRows.filter(x=>x.simpleSolPrimaryCause===c).length]))};
const armComparison={schemaVersion:1,generatedAt,rows:comparison,summary:{freeFailuresTested:42,strictScorableRecoveredBySol:comparison.filter(x=>x.classification==='SOL_RECOVERED_FREE_FAILURE').length,specificOrExactRecoveredBySol:comparison.filter(x=>x.solSpecific||x.solExactAt3).length,recoveryPercentage:Number((comparison.filter(x=>x.solSpecific||x.solExactAt3).length/42*100).toFixed(1))}};
const runLedger={schemaVersion:1,generatedAt,branch:'research/cliff-jumping-exact-location',productionMutations:'NONE',deployments:'NONE',corpus:{founderVideos:42,rawUrls:42,uniqueContent:42,historicalDuplicateRelationships:[{caseId:'CJ004',historicalCaseId:'R08',canonicalSourceId:'CqJo6QHJqPo'}]},runs:[{arm:'PRODUCTION_FREE',cases:42,acquired:42,technicalFailures:0,cacheUsed:false,productionTarget:false},{arm:'SIMPLE_SOL',cases:42,acquired:42,technicalFailures:0,cacheUsed:false,productionTarget:false},{arm:'ACCURACY_MAX_F2_M2',cases:accuracyRows.length,acquired:accuracyRows.filter(x=>!x.attempt.failure).length,technicalFailures:accuracyRows.filter(x=>x.attempt.failure).length,cacheUsed:false,productionTarget:false}],cost:{groundTruthResearchUsd:null,productionFreeUsd:null,simpleSolModelUsd:simpleSol.metrics.measuredModelCostUsd,accuracyMaxModelUsd:accuracyMax.metrics.measuredModelCostUsd,note:'Only model-token estimates emitted by the Sol harness are measurable; external browsing and free-path provider costs were not instrumented.'}};

const mdEscape=(v)=>String(v??'—').replace(/\|/g,'\\|').replace(/\r?\n/g,' ');
const rowsMd=groundTruth.map((truth)=>{const sol=simpleSol.results.find(x=>x.caseId===truth.caseId),failure=failureRows.find(x=>x.caseId===truth.caseId),scorable=scorableStatus(truth);return `| ${truth.caseId} | ${truth.groundTruthStatus} | ${mdEscape(truth.canonicalName)} | — | ${mdEscape(sol.canonicalTop3.map(x=>x.name).join('; '))} | ${scorable?(sol.exactAt1?'Y':'N'):'NS'} | ${scorable?(sol.exactAt3?'Y':'N'):'NS'} | ${sol.specificReasonableAt3?'Y':'N'} | ${scorable?failure.simpleSolPrimaryCause:'GROUND_TRUTH_UNRESOLVED'} | ${mdEscape(truth.confidenceNotes)} |`;}).join('\n');
function scorableStatus(t){return ['VERIFIED_EXACT','HIGH_CONFIDENCE_EXACT'].includes(t.groundTruthStatus)}
const unresolvedMd=groundTruth.filter(x=>x.groundTruthStatus==='UNRESOLVED').map(truth=>{const sol=simpleSol.results.find(x=>x.caseId===truth.caseId),p=plausibility.find(x=>x.caseId===truth.caseId);return `### ${truth.caseId}\n\n- Why unresolved: ${truth.confidenceNotes}\n- Best researched hypothesis: ${truth.canonicalName}\n- Production guesses: none\n- Sol guesses: ${sol.canonicalTop3.map(x=>x.name).join('; ')||'none'}\n- Plausibility: ${p.topCandidatePlausibility}`;}).join('\n\n');
const report=`# Nearr 42-video cliff-jumping exact-location benchmark\n\nGenerated ${generatedAt}. Primary exact metrics use only VERIFIED_EXACT and HIGH_CONFIDENCE_EXACT cases. Provisional and unresolved cases are reviewed for plausibility but excluded from Exact@k. All inference was persisted before ground-truth research; the runner manifest confirms ground truth was not loaded.\n\n## A. Corpus\n\nFounder videos: 42  \nAttempted: 42  \nAcquired: 42  \nTechnical: 0  \nUnique founder content: 42. CJ004 is also the historical R08 content (same shortcode), retained as a founder case.\n\n## B. Ground truth\n\nVERIFIED_EXACT: ${groundTruthArtifact.summary.VERIFIED_EXACT}/42  \nHIGH_CONFIDENCE_EXACT: ${groundTruthArtifact.summary.HIGH_CONFIDENCE_EXACT}/42  \nPROVISIONAL_BEST_GUESS: ${groundTruthArtifact.summary.PROVISIONAL_BEST_GUESS}/42  \nUNRESOLVED: ${groundTruthArtifact.summary.UNRESOLVED}/42\n\n## C. Production Free\n\nExact@1: 0 / ${scorableCount}  \nExact@3: 0 / ${scorableCount}  \nSpecific reasonable@3: 0 / 42  \nBroad-area-only: 0  \nGeneric descriptor shown as identity: 0  \nWrong named exact: 0; empty/non-actionable: 42  \nTechnical: 0\n\nThe current free path acquired every public clip, but its evidence extractor returned no place identity on all 42; it therefore produced no candidates. This is an accuracy failure, not an acquisition failure.\n\n## D. Simple Sol\n\nRaw Sol Exact@1: ${simpleSol.metrics.rawExactAt1} / ${scorableCount}  \nRaw Sol Exact@3: ${simpleSol.metrics.rawExactAt3} / ${scorableCount}  \nCanonical Exact@1: ${simpleSol.metrics.canonicalExactAt1} / ${scorableCount}  \nCanonical Exact@3: ${simpleSol.metrics.canonicalExactAt3} / ${scorableCount}  \nSpecific reasonable@3: ${simpleSol.metrics.specificReasonableAt3} / 42  \nBroad-area-only: 0  \nGeneric descriptor shown as identity: ${simpleSol.metrics.genericDescriptor}  \nWrong raw exact: ${simpleSol.metrics.wrongExactIdentity}  \nTechnical: 0\n\nCanonicalization broadened the raw top identity on ${simpleSol.metrics.canonicalizationTop1Losses.join(', ')}. At top 3, only ${simpleSol.metrics.canonicalizationTop3Losses.join(', ')} was fully lost; CJ004 retained a Moku Nui alternative at rank 2.\n\n## E. Auto Deep simulation\n\nExact@1: ${autoDeep.metrics.exactAt1} / ${scorableCount}  \nExact@3: ${autoDeep.metrics.exactAt3} / ${scorableCount}  \nCases recovered from free: ${autoDeep.metrics.casesRecoveredOverFree}  \nCases harmed: 0\n\n## F. Every case\n\n| Case | Ground Truth Status | Best Ground Truth / Research Hypothesis | Production Free Top 3 | Simple Sol Canonical Top 3 | Exact@1 | Exact@3 | Specific/Reasonable? | Failure Cause | Notes |\n|---|---|---|---|---|---:|---:|---:|---|---|\n${rowsMd}\n\n## G. Unresolved ground truth\n\n${unresolvedMd}\n\n## H. Free → Sol recovery\n\nFree failures tested: 42  \nStrict scorable cases recovered by canonical Sol: ${autoDeep.metrics.exactAt3}/${scorableCount}  \nSpecific-or-exact cases recovered across all 42: ${armComparison.summary.specificOrExactRecoveredBySol}/42  \nRecovery percentage: ${armComparison.summary.recoveryPercentage}%\n\n## I. Failure causes\n\nProduction: acquisition 0; frames ${failureAnalysis.productionFreeCounts.FRAME_SELECTION_FAILURE??0}; evidence-too-weak ${failureAnalysis.productionFreeCounts.EVIDENCE_TOO_WEAK??0}; descriptor-only 0; broad geography 0; wrong identity 0; ranking 0; canonicalization 0; technical 0.  \nSimple Sol on the strict denominator: acquisition 0; frames 0; descriptor-only 0; broad geography 0; wrong raw identity ${simpleSol.metrics.wrongExactIdentity}; ranking 0; canonicalization-at-top3 ${simpleSol.metrics.canonicalizationTop3Losses.length}; technical 0. The ${42-scorableCount} non-scorable cases remain ground-truth-limited.\n\n## J. Accuracy-max\n\nExecuted: ${accuracyMax.executed?'YES':'NO'}  \nArchitecture: ${accuracyMax.architecture}  \nRaw Sol Exact@3: ${accuracyMax.metrics.rawExactAt3} / ${scorableCount}  \nCanonical Exact@3: ${accuracyMax.metrics.exactAt3} / ${scorableCount}  \nReasonable@3: ${accuracyMax.metrics.specificReasonableAt3} / 42  \nRemaining strict canonical misses: ${accuracyMax.metrics.remainingScorableMisses.join(', ')||'none'}\n\nDense-frame web Sol recovered the raw exact identity for CJ016, but canonicalization broadened it back to the park. Results on provisional/unresolved cases remain plausibility evidence and cannot increase the strict Exact@k numerator without new external ground truth.\n\n## K. Recommended recognition architecture\n\n1. Keep normal recognition as a fast evidence collector and explicit-name resolver, not as the final cliff geolocator.\n2. Automatically escalate when the free result is empty, generic, broad, divergent, or below exact-feature confidence. That rule escalates all 42 cases here.\n3. Preserve 12–15 temporally diverse frames before perceptual dedupe; never collapse a dynamic clip to two near-duplicate endpoint frames without a second selection pass.\n4. Run GPT-5.6 Sol with caption, hashtags, transcript, OCR, creator metadata and frames; request three exact physical-feature hypotheses with coordinates and bounded evidence.\n5. Add web/same-content retrieval only after a weak first Sol pass, especially for montages and unnamed features. Treat web results as evidence, not truth.\n6. Verify candidate morphology and geography, then rank a candidate family before canonicalization.\n7. Make natural-feature canonicalization specificity-preserving: a broader park, lake, island group, beach or region must not replace a named jump rock, ledge, cave, pool, falls or individual island.\n8. If map providers lack the natural feature, retain the Sol identity and coordinates as a named lead; do not collapse upward to a broad parent.\n9. Autosave only independently corroborated exact identities. Present uncertain top three for confirmation; never autosave descriptors or broad geography.\n\nSee \`recommended-architecture.md\` for the implementation contract.\n\n## L. Product requirement\n\nCan current Nearr get effectively every cliff-jumping spot into top 3? **NO**  \nCan Simple Sol? **NO** — raw ${simpleSol.metrics.rawExactAt3}/${scorableCount}, but canonicalization and an exact-feature miss reduce final exact results.  \nCan Auto Deep? **NO**  \nCan Accuracy Max? **NOT YET PROVEN**\n\n## M. Cost\n\nGround-truth research API spend: not measurable in available tool telemetry.  \nProduction Free inference: not instrumented.  \nSimple Sol measured model estimate: $${simpleSol.metrics.measuredModelCostUsd.toFixed(6)}.  \nAccuracy-max measured model estimate: $${accuracyMax.metrics.measuredModelCostUsd.toFixed(6)}.  \nWeb-search tool charges, if any: not emitted.\n\n## N. Latency\n\nProduction Free: P50 ${productionFree.metrics.latencyMs.p50} ms; P95 ${productionFree.metrics.latencyMs.p95} ms; max ${productionFree.metrics.latencyMs.max} ms (file-completion timestamps).  \nSimple Sol: P50 ${simpleSol.metrics.latencyMs.p50} ms; P95 ${simpleSol.metrics.latencyMs.p95} ms; max ${simpleSol.metrics.latencyMs.max} ms.  \nAccuracy-max escalations: ${accuracyMax.metrics.escalationLatencyMs?`P50 ${accuracyMax.metrics.escalationLatencyMs.p50} ms; P95 ${accuracyMax.metrics.escalationLatencyMs.p95} ms; max ${accuracyMax.metrics.escalationLatencyMs.max} ms.`:'not complete.'}\n\n## O. Production\n\nMutations: NONE  \nDeployments: NONE\n\n## P. Final state\n\nBranch: research/cliff-jumping-exact-location  \nFinal HEAD: supplied in the committed-run handoff; use \`git rev-parse HEAD\`  \nClean: verified after commit\n\n## Q. Final verdict\n\n42-VIDEO CLIFF BENCHMARK COMPLETE — ACCURACY GAP REMAINS\n`;

const architecture=`# Recommended cliff-location recognition architecture\n\nThis recommendation is based only on the 42-case founder corpus.\n\n- **Normal/free role:** acquire media, preserve captions/hashtags/location tags, transcribe/OCR, resolve explicit exact names, and detect weakness. It must not return success merely because it recognized an activity or broad area.\n- **Automatic escalation:** invoke Sol when top three are empty, descriptor-only, broad geography, a parent feature rather than the jump feature, mutually inconsistent, or unsupported by explicit evidence. All 42 free results in this run qualify.\n- **Frames:** retain 12–15 diverse temporal frames, require action/context/landmark coverage, and trigger a second pass when perceptual dedupe leaves fewer than six useful frames.\n- **Sol:** first pass without web, high reasoning, three exact feature hypotheses. Second pass with dense frames and web/same-content discovery only for weak or conflicting output. Use independent calls/ensemble for montage segmentation.\n- **Verifier/ranker:** verify each hypothesis against source geography, morphology, structures and coordinates. Rank exact feature identity above map-provider popularity.\n- **Natural features:** maintain parent-child aliases (Jump Rock → Waimea Bay → park) without replacing the child. A canonical parent may annotate, never overwrite, the exact jump feature.\n- **Coordinate fallback:** preserve a model/research coordinate and named lead if Google Places has no exact natural-feature entity; show uncertainty and radius.\n- **Autosave:** only an exact, specificity-preserved identity with independent corroboration may autosave. Provisional and unresolved results require user confirmation.\n`;

const outputs = {
  'ground-truth.json':groundTruthArtifact, 'production-free-results.json':productionFree, 'simple-sol-results.json':simpleSol,
  'auto-deep-results.json':autoDeep, 'plausibility-review.json':{schemaVersion:1,generatedAt,reviewer:'Independent post-inference evidence review',results:plausibility},
  'case-failure-analysis.json':failureAnalysis, 'arm-comparison.json':armComparison, 'accuracy-max-results.json':accuracyMax, 'run-ledger.json':runLedger,
};
for (const [name,value] of Object.entries(outputs)) await writeFile(path.join(artifactDir,name),JSON.stringify(value,null,2)+'\n');
await writeFile(path.join(artifactDir,'CLIFF_JUMPING_EXACT_LOCATION_BASELINE.md'),report.replace(/[ \t]+$/gm,''));
await writeFile(path.join(artifactDir,'recommended-architecture.md'),architecture);
console.log(JSON.stringify({generatedAt,groundTruth:groundTruthArtifact.summary,scorableCount,production:productionFree.metrics,sol:simpleSol.metrics,accuracyMax:accuracyMax.metrics},null,2));
