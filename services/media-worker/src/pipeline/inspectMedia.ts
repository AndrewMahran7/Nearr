// services/media-worker/src/pipeline/inspectMedia.ts
//
// ffprobe-first validation. Determines whether a usable video stream exists,
// plus audio presence, duration, codecs, dimensions, frame rate, container, and
// rotation. Invalid / unsupported media is rejected safely.

import type { WorkerConfig } from '../config/env.js';
import type { MediaProbe } from '../types/media.js';
import { MediaError } from '../types/media.js';
import { execBinary } from '../util/exec.js';

type FfStream = {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  duration?: string;
  tags?: { rotate?: string };
  side_data_list?: { rotation?: number }[];
};

function parseFrameRate(r?: string): number | null {
  if (!r) return null;
  const [n, d] = r.split('/').map(Number);
  if (!n || !d) return null;
  return d === 0 ? null : n / d;
}

export async function inspectMedia(
  cfg: WorkerConfig,
  filePath: string,
  signal: AbortSignal,
): Promise<MediaProbe> {
  const res = await execBinary(
    cfg.ffprobePath,
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath],
    { timeoutMs: 20_000, signal },
  );
  if (res.code !== 0 || !res.stdout.trim()) {
    throw new MediaError('invalid_media', 'ffprobe_failed');
  }

  let parsed: { streams?: FfStream[]; format?: { duration?: string; format_name?: string } };
  try {
    parsed = JSON.parse(res.stdout);
  } catch {
    throw new MediaError('invalid_media', 'ffprobe_json_parse_failed');
  }

  const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
  const video = streams.find((s) => s.codec_type === 'video');
  const audio = streams.find((s) => s.codec_type === 'audio');

  if (!video) throw new MediaError('missing_video', 'no_video_stream');

  const durationStr = video.duration ?? parsed.format?.duration ?? '0';
  const durationSeconds = Number(durationStr) || 0;
  if (durationSeconds <= 0) throw new MediaError('invalid_media', 'zero_duration');
  if (durationSeconds > cfg.maxDurationSeconds) {
    throw new MediaError('duration_too_long', `${Math.round(durationSeconds)}s`);
  }

  let rotation: number | null = null;
  const sd = video.side_data_list?.find((x) => typeof x.rotation === 'number');
  if (sd && typeof sd.rotation === 'number') rotation = sd.rotation;
  else if (video.tags?.rotate) rotation = Number(video.tags.rotate) || null;

  return {
    hasVideo: true,
    hasAudio: !!audio,
    durationSeconds,
    container: parsed.format?.format_name ?? null,
    videoCodec: video.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
    width: video.width ?? null,
    height: video.height ?? null,
    frameRate: parseFrameRate(video.r_frame_rate),
    rotation,
  };
}
