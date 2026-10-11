/** Add a metadata-stripped video to already neutral evidence, without changing canonical data. */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const sha = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const fail = (message) => { throw new Error(message); };
const inside = (root, relative) => {
  const resolved = path.resolve(root, relative);
  if (!resolved.startsWith(path.resolve(root) + path.sep) || fs.lstatSync(resolved).isSymbolicLink() || !fs.statSync(resolved).isFile()) fail('unsafe_neutral_source_path');
  const real = fs.realpathSync(resolved);
  if (!real.startsWith(fs.realpathSync(root) + path.sep)) fail('unsafe_neutral_source_path');
  return real;
};

export function materializeMedia({ inputFile, sourceVideo, sourceSha256, outRoot, ffmpeg = 'ffmpeg', ffprobe = 'ffprobe' }) {
  const inputBytes = fs.readFileSync(inputFile), input = JSON.parse(inputBytes.toString('utf8'));
  if (input.schema_version !== 1 || !/^i_[a-f0-9]{24}$/.test(input.input_id) || input.cache_policy !== 'disabled' || !['full', 'description_hidden', 'location_hidden', 'visual_audio'].includes(input.view)) fail('raw_media_not_allowed_for_view');
  if (input.media?.source_video || !Array.isArray(input.media?.frames) || !input.media.frames.every((f) => /^frames\/\d{3,}\.jpg$/.test(f))) fail('invalid_neutral_parent');
  if (!/^[a-f0-9]{64}$/.test(sourceSha256) || sha(sourceVideo) !== sourceSha256) fail('source_video_hash_mismatch');
  const parentHash = createHash('sha256').update(inputBytes).digest('hex');
  const key = createHash('sha256').update(`${parentHash}\0${sourceSha256}\0neutral-video-v1`).digest('hex').slice(0, 24);
  outRoot = path.resolve(outRoot);
  fs.mkdirSync(outRoot, { recursive: true });
  const directory = path.join(outRoot, key);
  fs.mkdirSync(directory); // Immutable evidence generation.
  try {
    fs.mkdirSync(path.join(directory, 'source'));
    const neutralVideo = path.join(directory, 'source/video.mp4');
    const start = performance.now();
    const child = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-i', path.resolve(sourceVideo), '-map', '0:v:0', '-map', '0:a:0?', '-map_metadata', '-1', '-map_metadata:s', '-1', '-map_chapters', '-1', '-c', 'copy', '-movflags', '+faststart', neutralVideo], { stdio: 'ignore', windowsHide: true, timeout: 120_000 });
    if (child.status !== 0) fail('neutral_video_remux_failed');
    const probeResult = spawnSync(ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', neutralVideo], { encoding: 'utf8', windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024 });
    if (probeResult.status !== 0) fail('neutral_video_probe_failed');
    const probe = JSON.parse(probeResult.stdout);
    const allowedTags = new Set(['major_brand', 'minor_version', 'compatible_brands', 'encoder', 'language', 'handler_name', 'vendor_id']);
    for (const group of [probe.format, ...(probe.streams ?? [])]) for (const tag of Object.keys(group.tags ?? {})) if (!allowedTags.has(tag)) fail('neutral_video_contains_unexpected_metadata');
    if ((probe.streams ?? []).some((s) => !['video', 'audio'].includes(s.codec_type))) fail('neutral_video_extra_stream');
    const duration = Number(probe.format?.duration);
    if (!Number.isFinite(duration) || duration <= 0 || Math.abs(duration - input.media.duration_seconds) > .15) fail('neutral_video_duration_mismatch');
    if (input.media.frames.length) fs.mkdirSync(path.join(directory, 'frames'));
    const frameHashes = [];
    for (const relative of input.media.frames) {
      const source = inside(path.dirname(inputFile), relative), destination = path.join(directory, relative);
      try { fs.linkSync(source, destination); } catch { fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL); }
      const hash = sha(source);
      if (sha(destination) !== hash) fail('neutral_frame_copy_mismatch');
      frameHashes.push(hash);
    }
    const videoHash = sha(neutralVideo);
    input.media = { ...input.media, source_video: { path: 'source/video.mp4', sha256: videoHash }, audio_allowed: true };
    const resultFile = path.join(directory, 'input.json');
    fs.writeFileSync(resultFile, JSON.stringify(input, null, 2) + '\n', { flag: 'wx' });
    const receipt = { version: 1, method: 'neutral-video-v1', created_at: new Date().toISOString(), input_id: input.input_id, view: input.view, parent_input_sha256: parentHash, source_video_sha256: sourceSha256, neutral_video_sha256: videoHash, input_sha256: sha(resultFile), frame_sha256: frameHashes, elapsed_ms: performance.now() - start, has_audio: probe.streams.some((s) => s.codec_type === 'audio'), duration_seconds: duration, source_identities_in_input: false, canonical_manifest_modified: false };
    const receiptFile = path.join(outRoot, `${key}.receipt.json`);
    fs.writeFileSync(receiptFile, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
    return { input: resultFile, receipt: receiptFile, ...receipt };
  } catch (error) {
    const resolved = path.resolve(directory);
    if (!resolved.startsWith(outRoot + path.sep)) fail('unsafe_cleanup_path');
    fs.rmSync(resolved, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const opts = {};
    for (let i = 2; i < process.argv.length; i += 2) {
      const key = process.argv[i];
      if (!['--input', '--video', '--video-sha256', '--out', '--ffmpeg', '--ffprobe'].includes(key) || !process.argv[i + 1]) fail('invalid_media_materialization_arguments');
      opts[key.slice(2)] = process.argv[i + 1];
    }
    console.log(JSON.stringify(materializeMedia({ inputFile: opts.input, sourceVideo: opts.video, sourceSha256: opts['video-sha256'], outRoot: opts.out, ffmpeg: opts.ffmpeg, ffprobe: opts.ffprobe })));
  } catch (error) { console.error(error instanceof Error && /^[a-z0-9_]+$/.test(error.message) ? error.message : 'media_materialization_failed'); process.exitCode = 1; }
}
