"""Bounded local OCR pilot. Synthetic reading controls are never venue labels."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time

parser = argparse.ArgumentParser()
parser.add_argument('--deps', required=True)
parser.add_argument('--public-media', required=True)
parser.add_argument('--onboarding-media', required=True)
args = parser.parse_args()
sys.path.insert(0, args.deps)
root = Path(__file__).resolve().parents[2]
out = root / 'artifacts' / 'recognition-optimization-2026-10-08'
scratch = root / '.tmp' / 'ocr-pilot'
scratch.mkdir(parents=True, exist_ok=True)
plan_file = out / 'OCR_PLAN.json'
plan = json.loads(plan_file.read_text())
sha = lambda file: hashlib.sha256(Path(file).read_bytes()).hexdigest()

from PIL import Image, ImageDraw, ImageFont
import numpy as np
import torch
import easyocr

inputs = []
font_file = Path('C:/Windows/Fonts/arialbd.ttf')
font = ImageFont.truetype(str(font_file), 42)
for control in plan['controls']:
    im = Image.new('RGB', (768, 512), '#e9ecef')
    draw = ImageDraw.Draw(im)
    # Deliberately simple engineering controls, not simulated real photographs.
    if control['id'] == 'brand_clothing':
        draw.polygon([(230, 100), (160, 190), (235, 220), (235, 400), (533, 400), (533, 220), (610, 190), (530, 100)], fill='#202020')
        draw.text((270, 225), control['expectedText'], font=font, fill='white')
    elif control['expectedText']:
        draw.rectangle((25, 170, 744, 285), fill='white', outline='#444444', width=3)
        draw.text((45, 200), control['expectedText'], font=font, fill='black')
    target = scratch / (control['id'] + '.png')
    im.save(target)
    inputs.append({**control, 'kind': 'synthetic_reading_control', 'path': target, 'timestampSeconds': None, 'sourceSha256': None})

for item in plan['realInputs']:
    if item['id'].startswith('mad_yolks'):
        source = Path(args.onboarding_media) / 'mad-yolks-loop.mp4'
    elif item['id'].startswith('griffith'):
        source = Path(args.public_media) / 'griffith_video.webm'
    else:
        source = Path(args.public_media) / 'dettifoss_video.webm'
    target = scratch / (item['id'] + '.jpg')
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', str(item['timestampSeconds']), '-i', str(source),
                    '-frames:v', '1', '-vf', "scale='min(768,iw)':-2", '-q:v', '3', str(target)], check=True,
                   timeout=30, creationflags=subprocess.CREATE_NO_WINDOW)
    inputs.append({**item, 'path': target, 'sourceSha256': sha(source), 'role': 'unadjudicated_source_text'})

started = time.perf_counter()
reader = easyocr.Reader(['en'], gpu=torch.cuda.is_available(), model_storage_directory=str(scratch / 'models'),
                        user_network_directory=str(scratch / 'networks'), verbose=False)
load_ms = (time.perf_counter() - started) * 1000
rows = []
for item in inputs:
    frame = Image.open(item['path']).convert('RGB')
    if torch.cuda.is_available(): torch.cuda.synchronize()
    start = time.perf_counter()
    result = reader.readtext(np.array(frame), detail=1, paragraph=False, batch_size=1, workers=0)
    if torch.cuda.is_available(): torch.cuda.synchronize()
    elapsed = (time.perf_counter() - start) * 1000
    regions = [{ 'text': text, 'confidence': float(confidence),
                 'polygonNormalized': [[float(x) / frame.width, float(y) / frame.height] for x, y in box] }
               for box, text, confidence in result]
    observed = ' '.join(r['text'] for r in regions)
    normalize = lambda value: ' '.join(value.upper().split())
    row = {key: value for key, value in item.items() if key != 'path'}
    row.update({'frameSha256': sha(item['path']), 'width': frame.width, 'height': frame.height, 'latencyMs': elapsed,
                'regions': regions, 'exactTextMatch': None if item['expectedText'] is None else normalize(observed) == normalize(item['expectedText'])})
    rows.append(row)
    print(json.dumps({'id': item['id'], 'latencyMs': round(elapsed), 'regions': len(regions), 'exactTextMatch': row['exactTextMatch']}), flush=True)

report = {'schemaVersion': 1, 'planSha256': sha(plan_file), 'engine': easyocr.__version__, 'torch': torch.__version__,
          'device': torch.cuda.get_device_name() if torch.cuda.is_available() else 'cpu', 'loadAndDownloadMs': load_ms,
          'fontSha256': sha(font_file), 'weights': [{'filename': p.name, 'sha256': sha(p), 'bytes': p.stat().st_size}
                                                  for p in sorted((scratch / 'models').glob('*')) if p.is_file()],
          'peakGpuAllocatedBytes': torch.cuda.max_memory_allocated() if torch.cuda.is_available() else None,
          'scope': 'OCR reading feasibility; no venue-identity recognition, no held-out recognition accuracy', 'rows': rows}
with (out / 'ocr_pilot_results.json').open('x') as handle:
    json.dump(report, handle, indent=2)
    handle.write('\n')
