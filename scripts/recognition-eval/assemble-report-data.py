"""Assemble transparent report tables from immutable local experiment outputs."""
import csv
import io
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ART = ROOT / 'artifacts/recognition-optimization-2026-10-08'


def read_json(relative):
    return json.loads((ART / relative).read_text(encoding='utf-8'))


def write_csv(name, rows, columns):
    buffer = io.StringIO(newline='')
    writer = csv.DictWriter(buffer, fieldnames=columns, extrasaction='ignore', lineterminator='\n')
    writer.writeheader()
    for row in rows:
        writer.writerow({k: json.dumps(v, ensure_ascii=False) if isinstance(v, (dict, list)) else v for k, v in row.items()})
    (ART / name).write_text(buffer.getvalue(), encoding='utf-8', newline='\n')


def main():
    baseline = (ART / 'runs/baseline_repaired/baseline_results.csv').read_bytes()
    destination = ART / 'baseline_results.csv'
    if destination.exists():
        assert destination.read_bytes() == baseline, 'immutable baseline copy differs'
    else:
        with destination.open('xb') as handle:
            handle.write(baseline)
    cases, ledger = [], []
    for variant in ('baseline_repaired', 'winner'):
        cases.extend({'variant': variant, **row} for row in read_json(f'runs/{variant}/scores.json'))
    for variant in ('baseline_repaired', 'harness_hardening_validation', 'winner'):
        with (ART / f'runs/{variant}/provider_usage_ledger.csv').open(encoding='utf-8', newline='') as handle:
            ledger.extend(csv.DictReader(handle))
    columns = list(dict.fromkeys(k for row in cases for k in row))
    write_csv('RECOGNITION_PER_CASE_RESULTS.csv', cases, columns)

    def local(variant, case, boundary, provider, operation, count=1):
        ledger.append(dict(variant=variant, caseId=case, boundary=boundary, provider=provider,
                           operation=operation, calls=count, costUsd=0, measurement='measured'))

    for split in ('development', 'calibration', 'held_out'):
        for row in read_json(f'media_{split}_results.json')['rows']:
            local(row['variant'], f"{row['id']}:{split}:{row['repeat']}", 'local_media_microbenchmark', 'local_ffmpeg', 'pipeline_execution_including_failures')
    for row in read_json('media_preparation_controls.json')['rows']:
        local(row['variant'], f"synthetic:{row['repeat']}", 'synthetic_scheduling_control', 'mock_asr', 'fixed_1000ms_response')
        local(row['variant'], f"synthetic:{row['repeat']}", 'synthetic_scheduling_control', 'local_ffmpeg', 'audio_and_frames_execution')
    for row in read_json('evidence/places/places-session-benchmark.json')['records']:
        local('places_' + row['mode'], f"{row['caseId']}:{row['repeat']}", 'real_query_workload_mock_transport', 'mock_places', 'fixed_5ms_request', row['actualMockRequests'])
    for row in read_json('ocr_pilot_results.json')['rows']:
        local('ocr_selective_pilot', row['id'], row['kind'], 'local_easyocr', 'frame_inference')
    retrieval = read_json('evidence/retrieval-pilot-results.json')
    local('retrieval_eigenplaces', 'aggregate_44_frames', 'local_descriptor_pilot', 'local_eigenplaces', 'frame_embedding', retrieval['frameCount'])
    used = set()
    for row in retrieval['retrieval']:
        if row['geography'] == 'country':
            used.add(row['queryIndex'])
            used.update(row['shortlistReferenceIndices'])
    local('geometry_disk_lightglue', 'aggregate_cached_frames', 'local_overlap_pilot', 'local_disk', 'frame_features', len(used))
    local('geometry_disk_lightglue', 'aggregate_pairs', 'local_overlap_pilot', 'local_lightglue', 'pair_match', len(retrieval['geometry']))
    write_csv('provider_usage_ledger.csv', ledger, ['variant', 'caseId', 'boundary', 'provider', 'operation', 'calls', 'costUsd', 'measurement'])
    print(json.dumps({'recognitionRows': len(cases), 'usageRows': len(ledger), 'paidExperimentUsd': 0}))


if __name__ == '__main__':
    main()
