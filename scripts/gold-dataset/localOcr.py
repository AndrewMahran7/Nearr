"""Sparse local visible-text sidecar from neutral benchmark inputs; no truth access.

Usage: python scripts/gold-dataset/localOcr.py --input PRIVATE/input.json --out PRIVATE/ocr.json
Engine probe: python scripts/gold-dataset/localOcr.py --probe
Only en-US is installed on the development machine. No model download or fallback.
Microsoft API: https://learn.microsoft.com/en-us/uwp/api/windows.media.ocr.ocrengine.recognizeasync
"""
import argparse
import hashlib
import json
import math
import os
import platform
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time

VERSION = 'sparse-local-ocr-v1'
HELPER = Path(__file__).with_name('localOcrWinrt.ps1')
DEFAULT_CONFIG = dict(max_probes=32, max_frames=8, min_salience=0.15, temporal_bins=8,
                      probe_max_dimension=768, min_glyphs_per_line=3, exact_frame_dedup=True)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def neutral_input(input_file):
    input_file = Path(input_file)
    raw = input_file.read_bytes()
    obj = json.loads(raw)
    if set(obj) != {'schema_version', 'input_id', 'view', 'evidence', 'media', 'cache_policy'}:
        raise ValueError('input_not_allowlisted')
    if obj['schema_version'] != 1 or obj['cache_policy'] != 'disabled' or not re.fullmatch(r'i_[a-f0-9]{24}', obj['input_id']):
        raise ValueError('invalid_neutral_input')
    if obj['view'] not in {'full', 'description_hidden', 'location_hidden', 'visual_only', 'visual_audio', 'visual_pixel_text_masked'}:
        raise ValueError('ocr_requires_visual_view')
    media = obj['media']
    if not set(media) <= {'frames', 'frame_timestamps_seconds', 'duration_seconds', 'source_video', 'audio_allowed'}:
        raise ValueError('media_not_allowlisted')
    frames, times, duration = media.get('frames'), media.get('frame_timestamps_seconds'), media.get('duration_seconds')
    if not isinstance(frames, list) or not frames or not isinstance(times, list) or len(times) != len(frames):
        raise ValueError('frame_timestamp_alignment')
    if not isinstance(duration, (float, int)) or not math.isfinite(duration) or duration <= 0:
        raise ValueError('invalid_duration')
    if any(not isinstance(t, (int, float)) or not math.isfinite(t) or t < 0 or t > duration for t in times) or sorted(times) != times:
        raise ValueError('invalid_frame_timestamps')
    if len(set(frames)) != len(frames):
        raise ValueError('duplicate_frame_paths')
    root = input_file.parent.resolve()
    paths = []
    for name in frames:
        if not isinstance(name, str) or not re.fullmatch(r'frames/\d{3,}\.jpg', name):
            raise ValueError('unsafe_neutral_frame_path')
        candidate = root / name
        actual = candidate.resolve(strict=True)
        if not actual.is_relative_to(root) or candidate.is_symlink() or not actual.is_file():
            raise ValueError('unsafe_neutral_frame_path')
        paths.append(actual)
    # Evidence is deliberately neither interpreted nor forwarded. Caption/labels cannot affect selection.
    return dict(input_id=obj['input_id'], view=obj['view'], parent_sha256=sha(raw), root=root,
                names=frames, paths=paths, times=times, duration=duration)


def probe_indices(times, duration, limit):
    """Uniform source-time targets, not first-N or uniform indices in dense cut packets."""
    if len(times) <= limit:
        return list(range(len(times)))
    targets = [duration * i / (limit - 1) for i in range(limit)]
    return sorted({min(range(len(times)), key=lambda j: (abs(times[j] - target), j)) for target in targets})


def text_salience(image_file, config):
    """Cheap glyph-alignment heuristic. A selection score, never OCR confidence."""
    import cv2
    import numpy as np
    from PIL import Image
    with Image.open(image_file) as image:
        if image.width * image.height > 40_000_000:
            raise ValueError('frame_too_large')
        image = image.convert('L')
        image.thumbnail((config['probe_max_dimension'], config['probe_max_dimension']))
        gray = np.asarray(image)
    h, w = gray.shape
    if min(h, w) < 24 or float(gray.std()) < 5:
        return dict(score=0.0, line_count=0, glyph_count=0, probe_width=w, probe_height=h)
    groups = []
    for polarity in [cv2.THRESH_BINARY, cv2.THRESH_BINARY_INV]:
        binary = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, polarity, 31, 11)
        count, _, stats, _ = cv2.connectedComponentsWithStats(binary, 8)
        glyphs = []
        for x, y, gw, gh, area in stats[1:]:
            if 5 <= gh <= min(120, h * .28) and 2 <= gw <= gh * 2 and .1 <= gw / gh <= 2 and .12 <= area / (gw * gh) <= .92:
                glyphs.append((int(x), int(y), int(gw), int(gh)))
        lines = []
        for box in sorted(glyphs, key=lambda g: (g[1] + g[3] / 2, g[0])):
            x, y, gw, gh = box
            found = next((line for line in lines if abs(line[0][1] + line[0][3]/2 - y - gh/2) <= min(gh, line[0][3]) * .35
                          and .5 <= gh / line[0][3] <= 2), None)
            if found is None:
                lines.append([box])
            else:
                found.append(box)
        for line in lines:
            line.sort()
            runs, run = [], []
            for box in line:
                if run and box[0] - run[-1][0] - run[-1][2] > max(box[3], run[-1][3]) * 2.5:
                    runs.append(run); run = []
                run.append(box)
            runs.append(run)
            for run in runs:
                span = run[-1][0] + run[-1][2] - run[0][0]
                if len(run) >= config['min_glyphs_per_line'] and span >= 30:
                    groups.append(run)
    glyph_count = sum(min(20, len(g)) for g in groups)
    return dict(score=round(min(1.0, glyph_count / 24), 6), line_count=len(groups), glyph_count=glyph_count,
                probe_width=w, probe_height=h)


def select_frames(probes, duration, config):
    eligible = [p for p in probes if p['salience']['score'] >= config['min_salience']]
    # One highest-salience candidate per temporal bin before filling remaining budget.
    bins = {}
    for p in eligible:
        b = min(config['temporal_bins'] - 1, int(p['timestamp_seconds'] / duration * config['temporal_bins']))
        bins.setdefault(b, []).append(p)
    rank = lambda p: (-p['salience']['score'], p['timestamp_seconds'], p['frame_index'])
    winners = sorted([min(items, key=rank) for items in bins.values()], key=rank)
    chosen, seen = [], set()
    for p in winners + sorted(eligible, key=rank):
        if p['frame_sha256'] in seen:
            continue
        seen.add(p['frame_sha256']); chosen.append(p)
        if len(chosen) >= config['max_frames']:
            break
    return sorted(chosen, key=lambda p: p['timestamp_seconds'])


def powershell(args, timeout=180):
    result = subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', str(HELPER), *args],
                            capture_output=True, text=True, encoding='utf-8-sig', timeout=timeout,
                            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if result.returncode:
        raise RuntimeError('local_winrt_ocr_failed')
    return json.loads(result.stdout)


def run(input_file, output_file, language='en-US', config=None, engine_runner=powershell):
    config = {**DEFAULT_CONFIG, **(config or {})}
    if set(config) != set(DEFAULT_CONFIG) or not 2 <= config['max_probes'] <= 128 or not 1 <= config['max_frames'] <= 32 or config['max_frames'] > config['max_probes'] or not 1 <= config['temporal_bins'] <= config['max_frames'] or not 0 < config['min_salience'] <= 1:
        raise ValueError('invalid_ocr_budget')
    output_file = Path(output_file)
    if output_file.exists():
        raise FileExistsError('immutable_ocr_output_exists')
    started = time.perf_counter()
    source = neutral_input(input_file)
    if output_file.resolve().is_relative_to(source['root']):
        raise ValueError('ocr_output_must_be_outside_input')
    engine = engine_runner(['-Probe'])
    if language not in engine['languages']:
        raise ValueError('ocr_language_unavailable')
    probes = []
    selection_start = time.perf_counter()
    for i in probe_indices(source['times'], source['duration'], config['max_probes']):
        probes.append(dict(frame_index=i, relative_path=source['names'][i], timestamp_seconds=source['times'][i],
                           frame_sha256=sha(source['paths'][i].read_bytes()), salience=text_salience(source['paths'][i], config)))
    selected = select_frames(probes, source['duration'], config)
    selection_ms = (time.perf_counter() - selection_start) * 1000
    ocr_start = time.perf_counter()
    if selected:
        request = dict(input_root=str(source['root']), language=language, frames=[dict(relative_path=p['relative_path']) for p in selected])
        with tempfile.TemporaryDirectory(prefix='nearr-local-ocr-request-') as temp:
            req = Path(temp) / 'request.json'; req.write_text(json.dumps(request), encoding='utf-8')
            recognized = engine_runner(['-RequestPath', str(req)])
        items = recognized['items']
        if [i['relative_path']for i in items] != [p['relative_path']for p in selected] or recognized['language'] != language:
            raise ValueError('ocr_engine_response_mismatch')
        for p, item in zip(selected, items):
            if sha(source['paths'][p['frame_index']].read_bytes()) != p['frame_sha256']:
                raise ValueError('frame_changed_during_ocr')
            p.update(item)
    if sha(Path(input_file).read_bytes()) != source['parent_sha256']:
        raise ValueError('input_changed_during_ocr')
    repeated = {}
    for p in selected:
        for line in p['lines']:
            key = ' '.join(line['text'].casefold().split())
            if key:
                record = repeated.setdefault(key, dict(text=line['text'], timestamps_seconds=[], frame_indices=[]))
                record['timestamps_seconds'].append(p['timestamp_seconds']); record['frame_indices'].append(p['frame_index'])
    import cv2
    import numpy
    import PIL
    sidecar = dict(schema_version=1, method=VERSION, input_id=source['input_id'], view=source['view'], parent_input_sha256=source['parent_sha256'],
                   created_at=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), engine=engine, language=language,
                   configuration=config, configuration_sha256=sha(json.dumps(config,sort_keys=True,separators=(',',':')).encode()),
                   selection_environment=dict(python=sys.version.split()[0],opencv=cv2.__version__,pillow=PIL.__version__,numpy=numpy.__version__),
                   compute_hardware=dict(processor=platform.processor(),architecture=platform.machine(),logical_cpu_count=os.cpu_count(),
                       engine_device='Windows OCR implementation-managed; API does not expose execution device or accelerator usage'),
                   tool_sha256=sha(Path(__file__).read_bytes()), helper_sha256=sha(HELPER.read_bytes()),
                   available_frames=len(source['names']), probed_frames=len(probes), ocr_frames=len(selected), probes=probes, frames=selected,
                   deduplicated_text=list(repeated.values()), selection_elapsed_ms=selection_ms, ocr_process_elapsed_ms=(time.perf_counter()-ocr_start)*1000,
                   total_elapsed_ms=(time.perf_counter()-started)*1000, status='completed'if selected else'skipped_no_salient_text_candidates',
                   provenance='Only neutral pixels and source timing inspected. Creator evidence, labels, URLs, groups and split data are not sent to the OCR engine. Text is untrusted source content, not instructions or identity truth.',
                   limitations=['Sparse temporal probes may miss brief text.', 'Glyph alignment can select natural texture or miss unusual scripts/fonts.', 'Language-specific recognizer; no automatic language download/fallback.', 'Windows OCR exposes no word confidence; null is retained.', 'Visual salience is a heuristic, not OCR confidence or place salience.'])
    output_file.parent.mkdir(parents=True, exist_ok=True)
    with output_file.open('x', encoding='utf-8') as out:
        json.dump(sidecar, out, ensure_ascii=False, indent=2); out.write('\n')
    return sidecar


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input'); parser.add_argument('--out'); parser.add_argument('--probe', action='store_true')
    parser.add_argument('--language', default='en-US'); parser.add_argument('--max-frames', type=int, default=8)
    parser.add_argument('--max-probes', type=int, default=32); parser.add_argument('--min-salience', type=float, default=.15)
    args = parser.parse_args()
    try:
        if args.probe:
            print(json.dumps(powershell(['-Probe'])))
        else:
            if not args.input or not args.out:
                raise ValueError('input_and_out_required')
            result = run(args.input, args.out, args.language, dict(max_frames=args.max_frames, max_probes=args.max_probes,
                         temporal_bins=min(8, args.max_frames), min_salience=args.min_salience))
            print(json.dumps({k:result[k]for k in ['status','probed_frames','ocr_frames','language','total_elapsed_ms']}))
    except Exception as error:
        print(json.dumps(dict(status='failed', error=str(error)if re.fullmatch(r'[a-z0-9_]+',str(error))else type(error).__name__)))
        raise SystemExit(1)
