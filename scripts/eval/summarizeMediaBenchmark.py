"""Derive resource/latency tables without changing immutable per-run evidence."""
import csv
import json
from pathlib import Path
import random
import statistics

root = Path(__file__).resolve().parents[2]
artifacts = root / 'artifacts' / 'recognition-optimization-2026-10-08'
source_groups = {item['id']: item['group'] for item in json.loads((artifacts / 'media_manifest.json').read_text())['items']}

def quantile(values, p):
    values = sorted(values)
    position = (len(values) - 1) * p
    left = int(position)
    return values[left] + (values[min(left + 1, len(values) - 1)] - values[left]) * (position - left)

report = {}
csv_rows = []
for filename in sorted(artifacts.glob('media_*_results.json')):
    data = json.loads(filename.read_text())
    rows = data['rows']
    arms = {}
    for variant in data['variants']:
        selected = [r for r in rows if r['variant'] == variant]
        times = [r['durationMs'] for r in selected if r['durationMs'] is not None]
        resources = [r['metrics'] for r in selected if r.get('metrics')]
        arms[variant] = {'runs': len(selected), 'uniqueSources': len({r['id'] for r in selected}),
                         'failures': sum(bool(r['failure']) for r in selected),
                         'exactParity': sum(bool(r['exactEvidenceParity']) for r in selected),
                         **{f'p{int(p * 100)}Ms': quantile(times, p) for p in [.5, .75, .9, .95]},
                         'meanCpuMs': statistics.mean(r['cpuMs'] for r in resources) if resources else None,
                         'peakChildRssKiB': max(r['peakChildRssKiB'] for r in resources) if resources else None,
                         'processCount': sum(r['processCount'] for r in resources) if resources else None}
        for row in selected:
            csv_rows.append({key: row.get(key) for key in ['id', 'split', 'repeat', 'variant', 'durationMs', 'rawCount', 'keptCount', 'exactEvidenceParity', 'dedupParity', 'failure']} |
                            {key: (row.get('metrics') or {}).get(key) for key in ['processCount', 'cpuMs', 'peakChildRssKiB']})
    groups = {}
    for row in rows:
        if row['variant'] not in ['baseline_repaired', 'batched_hash'] or row['failure']: continue
        groups.setdefault(row['id'], {}).setdefault(row['variant'], []).append(row['durationMs'])
    grouped_ratios = {}
    for source, g in groups.items():
        grouped_ratios.setdefault(source_groups[source], []).append(statistics.median(g['batched_hash']) / statistics.median(g['baseline_repaired']))
    ratios = [statistics.median(values) for values in grouped_ratios.values()]
    randomizer = random.Random(20261008)
    simulated = [statistics.median(randomizer.choices(ratios, k=len(ratios))) for _ in range(5000)]
    report[data['split']] = {'arms': arms, 'medianPairedSourceReduction': 1 - statistics.median(ratios),
                            'medianPairedSourceReductionBootstrap95': [1 - quantile(simulated, .975), 1 - quantile(simulated, .025)],
                            'independentSourceGroups': len(ratios),
                            'bootstrapCaution': 'Related source clips grouped together; small group counts and hardware jitter limit population inference.'}

prep = artifacts / 'media_preparation_controls.json'
if prep.exists():
    rows = json.loads(prep.read_text())['rows']
    report['syntheticSchedulingControls'] = {variant: {'n': len(times := [r['wallMs'] for r in rows if r['variant'] == variant]),
       **{f'p{int(p*100)}Ms': quantile(times, p) for p in [.5, .75, .9, .95]},
       'allEvidenceIdentical': all(r['evidenceParity'] for r in rows if r['variant'] == variant)} for variant in sorted({r['variant'] for r in rows})}

with (artifacts / 'MEDIA_METRICS.json').open('w') as file:
    json.dump(report, file, indent=2); file.write('\n')
with (artifacts / 'media_latency_results.csv').open('w', newline='') as file:
    writer = csv.DictWriter(file, fieldnames=list(csv_rows[0]))
    writer.writeheader(); writer.writerows(csv_rows)
print(json.dumps(report, indent=2))
