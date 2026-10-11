"""Evaluation-only local ASR from neutral source media. Never opens gold labels.

Requires already installed openai-whisper, torch and webrtcvad. Model download is
forbidden: --checkpoint must name an existing local checkpoint. Output is immutable.
"""
import argparse
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import subprocess
import tempfile
import time
import wave
from datetime import datetime, timezone


def digest(file):
    h = hashlib.sha256()
    with open(file, 'rb') as stream:
        for chunk in iter(lambda: stream.read(4 * 1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def now():
    return datetime.now(timezone.utc).isoformat()


def write_once(file, value):
    with Path(file).open('x', encoding='utf-8', newline='\n') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write('\n')


def analyze_pcm(file):
    import webrtcvad
    with wave.open(str(file), 'rb') as wav:
        if (wav.getnchannels(), wav.getsampwidth(), wav.getframerate()) != (1, 2, 16000):
            raise ValueError('noncanonical_pcm')
        samples = wav.readframes(wav.getnframes())
        duration = wav.getnframes() / 16000
    vad = webrtcvad.Vad(2)
    step = 960  # 30ms of signed16, mono16kHz; no timeline compaction.
    decisions = [vad.is_speech(samples[i:i + step], 16000) for i in range(0, len(samples) - step + 1, step)]
    voiced = sum(decisions) * .03
    energy = sum(int.from_bytes(samples[i:i + 2], 'little', signed=True) ** 2 for i in range(0, len(samples), 2))
    rms = math.sqrt(energy / max(1, len(samples) / 2))
    return {'duration_seconds': duration, 'vad_engine': 'webrtcvad', 'vad_version': importlib.metadata.version('webrtcvad'), 'vad_mode': 2,
            'frame_ms': 30, 'voiced_seconds': voiced, 'voiced_fraction': voiced / duration if duration else 0,
            'rms_dbfs': 20 * math.log10(max(rms, 1e-9) / 32768),
            'limitation': 'VAD estimates speech-like sound; music can trigger it. It is not a label or a reliable music classifier.'}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--inputs', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--checkpoint', required=True)
    parser.add_argument('--model', required=True)
    parser.add_argument('--device', choices=['cpu', 'cuda'], default='cuda')
    parser.add_argument('--language', default=None)
    parser.add_argument('--vad-gate', action='store_true')
    parser.add_argument('--ffmpeg', default='ffmpeg')
    parser.add_argument('--ffprobe', default='ffprobe')
    args = parser.parse_args()
    checkpoint = Path(args.checkpoint).resolve(strict=True)
    if not checkpoint.is_file():
        raise ValueError('existing_checkpoint_required')
    checkpoint_hash = digest(checkpoint)
    inputs = json.loads(Path(args.inputs).read_text(encoding='utf-8'))
    if not isinstance(inputs, list) or not inputs:
        raise ValueError('neutral_inputs_required')
    output = Path(args.out).resolve()
    output.mkdir(parents=True, exist_ok=False)
    version = subprocess.run([args.ffmpeg, '-version'], check=True, capture_output=True, text=True).stdout.split('\n')[0]
    import torch
    import whisper
    if args.device == 'cuda' and not torch.cuda.is_available():
        raise ValueError('requested_cuda_unavailable')
    config = {'language': args.language, 'task': 'transcribe', 'fp16': args.device == 'cuda', 'temperature': 0,
              'beam_size': 5, 'best_of': None, 'condition_on_previous_text': False, 'word_timestamps': False,
              'initial_prompt': None, 'audio_preprocessing': 'vad_non_speech_gate_no_time_compaction' if args.vad_gate else 'none'}
    hardware = {'device': args.device, 'device_name': torch.cuda.get_device_name(0) if args.device == 'cuda' else 'local CPU', 'runtime_version': str(torch.__version__)}
    write_once(output / 'run.json', {'version': 1, 'started_at': now(), 'implementation': 'openai-whisper', 'model': args.model,
                                   'checkpoint_sha256': checkpoint_hash, 'configuration': config, 'hardware': hardware,
                                   'inputs_file_sha256': digest(args.inputs), 'input_count': len(inputs), 'model_downloads': 0, 'paid_requests': 0})
    loaded = None
    results = []
    for file in inputs:
        input_file = Path(file).resolve(strict=True)
        data = json.loads(input_file.read_text(encoding='utf-8'))
        if input_file.name != 'input.json' or data.get('view') not in ['full', 'description_hidden', 'location_hidden', 'visual_audio'] or data.get('cache_policy') != 'disabled':
            raise ValueError('invalid_neutral_audio_view')
        media = data.get('media', {})
        source = media.get('source_video', {})
        if media.get('audio_allowed') is not True or source.get('path') != 'source/video.mp4':
            raise ValueError('neutral_audio_permission_missing')
        video = input_file.parent / source['path']
        if video.is_symlink() or input_file.parent not in video.resolve(strict=True).parents or digest(video) != source.get('sha256'):
            raise ValueError('neutral_audio_source_hash_mismatch')
        target = output / data['input_id']
        if not data['input_id'].startswith('i_') or len(data['input_id']) != 26 or any(c not in '0123456789abcdef' for c in data['input_id'][2:]):
            raise ValueError('invalid_neutral_input_id')
        target.mkdir()
        probe = json.loads(subprocess.run([args.ffprobe, '-v', 'error', '-show_streams', '-of', 'json', str(video)], check=True, capture_output=True, text=True).stdout)
        if not any(s.get('codec_type') == 'audio' for s in probe.get('streams', [])):
            receipt = {'input_sha256': digest(input_file), 'source_video_sha256': source['sha256'], 'status': 'no_audio', 'sidecar': None, 'paid_requests': 0}
            write_once(target / 'receipt.json', receipt)
            results.append(receipt)
            print(json.dumps({'completed': len(results), 'total': len(inputs), 'status': 'no_audio'}), flush=True)
            continue
        audio = target / 'audio.wav'
        prep_start = time.perf_counter()
        subprocess.run([args.ffmpeg, '-y', '-i', str(video), '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', str(audio)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=120)
        analysis = analyze_pcm(audio)
        prep_ms = (time.perf_counter() - prep_start) * 1000
        write_once(target / 'audio-analysis.json', analysis)
        started_at = now()
        started = time.perf_counter()
        gated = args.vad_gate and (analysis['voiced_seconds'] < .3 or analysis['rms_dbfs'] < -55)
        cold_load_ms = 0
        if gated:
            result = {'segments': [], 'language': args.language}
        else:
            if loaded is None:
                load_start = time.perf_counter()
                # Passing an existing path uses that file directly and cannot download weights.
                loaded = whisper.load_model(str(checkpoint), device=args.device)
                cold_load_ms = (time.perf_counter() - load_start) * 1000
            result = loaded.transcribe(str(audio), language=args.language, task='transcribe', fp16=config['fp16'], temperature=0,
                                      beam_size=5, condition_on_previous_text=False, word_timestamps=False, initial_prompt=None, verbose=False)
        elapsed = (time.perf_counter() - started) * 1000
        segments = [{'start_seconds': max(0, float(s['start'])), 'end_seconds': min(analysis['duration_seconds'], float(s['end'])), 'text': ' '.join(s['text'].split())} for s in result.get('segments', []) if s.get('text', '').strip()]
        segments = [s for s in segments if s['end_seconds'] >= s['start_seconds']]
        sidecar = {'schema_version': 1, 'purpose': 'gold_evaluation_local_asr', 'source_video_sha256': source['sha256'],
                   'audio': {'sha256': digest(audio), 'format': 'pcm_s16le_wav', 'sample_rate_hz': 16000, 'channels': 1, 'duration_seconds': analysis['duration_seconds'], 'extractor': {'name': 'ffmpeg', 'version': version}},
                   'engine': {'implementation': 'openai-whisper', 'version': importlib.metadata.version('openai-whisper'), 'model': args.model, 'checkpoint_sha256': checkpoint_hash},
                   'inference': {'started_at': started_at, 'completed_at': now(), 'elapsed_ms': elapsed, 'hardware': hardware, 'configuration': config},
                   'result': {'status': 'ok' if segments else 'no_speech', 'language': result.get('language'), 'text': ' '.join(s['text'] for s in segments), 'segments': segments}}
        transcript = target / 'transcript.local.json'
        write_once(transcript, sidecar)
        receipt = {'input_sha256': digest(input_file), 'source_video_sha256': source['sha256'], 'sidecar': str(transcript), 'sidecar_sha256': digest(transcript),
                   'audio_analysis_sha256': digest(target / 'audio-analysis.json'), 'audio_preparation_ms': prep_ms, 'cold_model_load_ms': cold_load_ms,
                   'status': sidecar['result']['status'], 'paid_requests': 0, 'cost_usd': 0, 'cost_scope': 'provider tariff only; local hardware/energy not priced'}
        write_once(target / 'receipt.json', receipt)
        results.append(receipt)
        print(json.dumps({'completed': len(results), 'total': len(inputs), 'status': receipt['status'], 'inference_ms': elapsed}), flush=True)
    write_once(output / 'completion.json', {'completed_at': now(), 'cases': len(results), 'results': results, 'paid_requests': 0})


if __name__ == '__main__':
    main()
