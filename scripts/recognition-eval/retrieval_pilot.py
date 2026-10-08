"""Bounded offline pilot. Optional dependencies/weights remain outside runtime.

See frozen RETRIEVAL_PILOT_PLAN.json. All result files are write-once. No Google
imagery, provider credentials, databases, or autosave calls are used.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import time
import urllib.request


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--repo', required=True)
    parser.add_argument('--catalog', required=True)
    parser.add_argument('--media', required=True)
    parser.add_argument('--deps', required=True)
    parser.add_argument('--eigen-code', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    repo = Path(args.repo).resolve()
    output = Path(args.output)
    if output.exists():
        raise RuntimeError('immutable output already exists')
    sys.path.insert(0, args.deps)
    sys.path.insert(0, args.eigen_code)
    os.environ['TORCH_HOME'] = str(repo / '.tmp/models/torch')
    import cv2
    import numpy as np
    import torch
    import torchvision
    from PIL import Image, ImageDraw
    from torchvision import transforms
    from eigenplaces_model import eigenplaces_network
    from kornia.feature import DISK, LightGlue

    torch.set_num_threads(2)
    torch.manual_seed(20261008)
    cv2.setRNGSeed(20261008)
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    plan_path = repo / 'artifacts/recognition-optimization-2026-10-08/RETRIEVAL_PILOT_PLAN.json'
    plan = json.loads(plan_path.read_text())
    catalog = json.loads(Path(args.catalog).read_text(encoding='utf-8-sig'))
    source_meta = {row['id']: row for row in catalog['sources']}
    images_dir = repo / '.tmp/retrieval-frames'
    images_dir.mkdir(parents=True, exist_ok=True)
    groups = {'cavitt_a_video': 'cavitt', 'cavitt_b_video': 'cavitt',
              'la_jolla_a_video': 'la_jolla_locality', 'la_jolla_b_video': 'la_jolla_locality'}
    countries = {'cavitt': 'US', 'la_jolla_locality': 'US', 'dettifoss_video': 'IS',
                 'cocoa_pier_video': 'US', 'griffith_video': 'US', 'niagara_video': None,
                 'golden_gate_video': 'US', 'sydney_opera_video': 'AU',
                 'summersville_video': 'US', 'etretat_video': 'FR'}
    records, skipped, rights = [], [], []
    for source in plan['sources']:
        media = Path(args.media) / (source + '.webm')
        if not media.exists():
            skipped.append({'source': source, 'reason': 'not_cached'})
            continue
        rights.append({**source_meta[source], 'sha256': digest(media)})
        cap = cv2.VideoCapture(str(media))
        frames, fps = cap.get(cv2.CAP_PROP_FRAME_COUNT), cap.get(cv2.CAP_PROP_FPS)
        duration = frames / fps if fps > 0 else 0
        independent = source in ('cavitt_b_video', 'la_jolla_b_video')
        positions = [('query', p) for p in (.2, .8)] if independent else [('reference', p) for p in (.15, .5, .85)] + [('query', .3)]
        for role, fraction in positions:
            timestamp = duration * fraction
            cap.set(cv2.CAP_PROP_POS_MSEC, timestamp * 1000)
            ok, frame = cap.read()
            if not ok:
                skipped.append({'source': source, 'fraction': fraction, 'reason': 'decode_failed'})
                continue
            h, w = frame.shape[:2]
            scale = 640 / max(h, w)
            frame = cv2.resize(frame, (max(1, round(w * scale)), max(1, round(h * scale))))
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            image_path = images_dir / f'{source}-{role}-{fraction}.png'
            Image.fromarray(rgb).save(image_path)
            group = groups.get(source, source)
            records.append({'source': source, 'group': group, 'country': countries[group], 'role': role,
                            'boundary': 'independent_source_locality' if independent else 'same_video_temporal_control',
                            'timestampSeconds': timestamp, 'fraction': fraction, 'path': str(image_path),
                            'sha256': digest(image_path), 'pixels': rgb})
        cap.release()
    # Freeze byte identities before model execution, and prevent silent reuse.
    manifest = {'planSha256': digest(plan_path), 'catalogSha256': digest(args.catalog), 'sources': rights,
                'frames': [{k: v for k, v in r.items() if k not in ('pixels', 'path')} for r in records], 'skipped': skipped}
    manifest_path = output.with_name(output.stem + '-inputs.json')
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    with manifest_path.open('x', encoding='utf8') as f:
        json.dump(manifest, f, indent=2)

    # The upstream constructor warm-starts CosPlace before replacing ALL weights
    # with EigenPlaces. Avoid that redundant checkpoint/hub-code download; keep
    # the exact reviewed architecture, then require a strict full state load.
    eigenplaces_network._get_backbone = lambda name: (torch.nn.Sequential(*list(getattr(torchvision.models, name.lower())(weights=None).children())[:-2]), 512)
    model = eigenplaces_network.GeoLocalizationNet_('ResNet18', 512)
    checkpoint = repo / '.tmp/models/ResNet18_512_eigenplaces.pth'
    checkpoint.parent.mkdir(parents=True, exist_ok=True)
    if not checkpoint.exists():
        urllib.request.urlretrieve('https://github.com/gmberton/EigenPlaces/releases/download/v1.0/ResNet18_512_eigenplaces.pth', checkpoint)
    model.load_state_dict(torch.load(checkpoint, map_location='cpu', weights_only=True), strict=True)
    model.eval().to(device)
    normalize = transforms.Compose([transforms.ToTensor(), transforms.Normalize([.485, .456, .406], [.229, .224, .225])])
    def sync():
        if device.type == 'cuda':
            torch.cuda.synchronize()
    embeddings, embedding_ms = [], []
    with torch.inference_mode():
        for record in records:
            tensor = normalize(record['pixels']).unsqueeze(0).to(device)
            sync(); started = time.perf_counter()
            descriptor = model(tensor)
            sync(); embedding_ms.append((time.perf_counter() - started) * 1000)
            embeddings.append(descriptor[0].cpu().numpy())
    descriptors = np.stack(embeddings)
    reference_indices = [i for i, r in enumerate(records) if r['role'] == 'reference']
    query_indices = [i for i, r in enumerate(records) if r['role'] == 'query']
    retrieval = []
    for qi in query_indices:
        query = records[qi]
        for geography in ('global', 'country'):
            candidates = [i for i in reference_indices if geography == 'global' or not query['country'] or records[i]['country'] == query['country']]
            started = time.perf_counter()
            rank = sorted(candidates, key=lambda ri: -float(descriptors[qi] @ descriptors[ri]))
            seen, distinct = set(), []
            for ri in rank:
                if records[ri]['group'] not in seen:
                    distinct.append(ri); seen.add(records[ri]['group'])
            retrieval.append({'queryIndex': qi, 'source': query['source'], 'boundary': query['boundary'], 'geography': geography,
                              'candidatePlaces': len(distinct), 'rankedGroups': [records[i]['group'] for i in distinct],
                              'correctRank': next((i + 1 for i, ri in enumerate(distinct) if records[ri]['group'] == query['group']), None),
                              'searchMs': (time.perf_counter() - started) * 1000,
                              'shortlistReferenceIndices': distinct[:3]})

    # Models are used only to establish overlapping views inside the shortlist.
    disk = DISK.from_pretrained('depth', device=device).eval()
    matcher = LightGlue(features='disk').eval().to(device)
    features, extraction_ms = {}, []
    def extract(index):
        if index not in features:
            record = records[index]
            tensor = transforms.ToTensor()(record['pixels']).unsqueeze(0).to(device)
            sync(); started = time.perf_counter()
            with torch.inference_mode():
                feature = disk(tensor, n=512, pad_if_not_divisible=True)[0]
            sync(); extraction_ms.append((time.perf_counter() - started) * 1000)
            features[index] = {'keypoints': feature.keypoints[None], 'descriptors': feature.descriptors[None],
                               'image_size': torch.tensor([[tensor.shape[-1], tensor.shape[-2]]], device=device)}
        return features[index]
    geometry = []
    for row in retrieval:
        if row['geography'] != 'country':
            continue
        qi = row['queryIndex']
        for ri in row['shortlistReferenceIndices']:
            f0, f1 = extract(qi), extract(ri)
            sync(); started = time.perf_counter()
            with torch.inference_mode():
                match = matcher({'image0': f0, 'image1': f1})
            sync(); matcher_ms = (time.perf_counter() - started) * 1000
            matches = match['matches'][0].cpu().numpy()
            inliers = 0
            ransac_start = time.perf_counter()
            if len(matches) >= 4:
                p0 = f0['keypoints'][0].cpu().numpy()[matches[:, 0]]
                p1 = f1['keypoints'][0].cpu().numpy()[matches[:, 1]]
                _, mask = cv2.findHomography(p0, p1, cv2.RANSAC, 4.0)
                inliers = int(mask.sum()) if mask is not None else 0
            ratio = inliers / len(matches) if len(matches) else 0
            geometry.append({'querySource': records[qi]['source'], 'referenceSource': records[ri]['source'],
                             'boundary': records[qi]['boundary'], 'sameCatalogLocality': records[qi]['group'] == records[ri]['group'],
                             'matches': len(matches), 'inliers': inliers, 'inlierRatio': ratio,
                             'overlapSupported': inliers >= 8 and ratio >= .2,
                             'matcherMs': matcher_ms, 'ransacMs': (time.perf_counter() - ransac_start) * 1000})
    summary = []
    for boundary in ('same_video_temporal_control', 'independent_source_locality'):
        for geography in ('global', 'country'):
            subset = [r for r in retrieval if r['boundary'] == boundary and r['geography'] == geography]
            summary.append({'boundary': boundary, 'geography': geography, 'queries': len(subset),
                            'sourceGroups': len({groups.get(r['source'], r['source']) for r in subset}),
                            **{f'recallAt{k}Count': sum(r['correctRank'] is not None and r['correctRank'] <= k for r in subset) for k in (1, 3, 5)}})
    timing = lambda xs: {f'p{q}': float(np.percentile(xs, q)) for q in (50, 75, 90, 95)} if xs else {}
    result = {'boundary': plan['boundary'], 'device': str(device), 'gpu': torch.cuda.get_device_name() if device.type == 'cuda' else None,
              'torch': torch.__version__, 'eigenCheckpointSha256': digest(checkpoint), 'planSha256': digest(plan_path),
              'frameCount': len(records), 'referenceFrames': len(reference_indices), 'descriptorBytes': int(descriptors.nbytes),
              'cudaPeakAllocatedBytes': torch.cuda.max_memory_allocated() if device.type == 'cuda' else None,
              'embeddingTimingsMsIncludingFirstColdInference': timing(embedding_ms), 'featureExtractionTimingsMs': timing(extraction_ms),
              'matcherTimingsMs': timing([r['matcherMs'] for r in geometry]), 'summary': summary,
              'retrieval': retrieval, 'geometry': geometry, 'paidUsd': 0,
              'limitations': ['Previously exposed source catalog; zero unseen recognition holdout.',
                             'Two independent source locality groups only; La Jolla exact-location label quarantined.',
                             'Same-video controls measure repeat evidence matching, not generalization.',
                             'Country is a supplied source-catalog prior; coverage is tiny and some countries have only one candidate.',
                             'Homography correspondence is visual overlap, never proof of exact place identity.']}
    with output.open('x', encoding='utf8') as f:
        json.dump(result, f, indent=2)
    print(json.dumps({'output': str(output), 'summary': summary, 'geometryPairs': len(geometry), 'paidUsd': 0}))


if __name__ == '__main__':
    main()
