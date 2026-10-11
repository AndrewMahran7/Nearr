import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { materializeMedia } from './materializeMedia.mjs';

const available = spawnSync('ffmpeg', ['-version'], { windowsHide: true, stdio: 'ignore' }).status === 0;
test('raw evidence derivative strips source identity, preserves timeline and rejects masked views', { skip: !available }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nearr-neutral-media-'));
  try {
    const video = path.join(root, 'answer-bearing-private-video.mp4');
    const generate = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=blue:size=64x64:rate=10:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-metadata', 'title=SECRET_SOURCE_LOCATION', '-metadata', 'comment=PRIVATE_CREATOR_ID', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', video], { windowsHide: true, stdio: 'ignore' });
    assert.equal(generate.status, 0);
    const parent = path.join(root, 'parent'); fs.mkdirSync(path.join(parent, 'frames'), { recursive: true });
    const frame = path.join(parent, 'frames/001.jpg');
    assert.equal(spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', video, '-frames:v', '1', frame], { windowsHide: true, stdio: 'ignore' }).status, 0);
    const input = { schema_version: 1, input_id: 'i_' + '1'.repeat(24), view: 'full', evidence: { caption: null, description: null, hashtags: null, tagged_accounts: null, location_tag: null, source_geography: null, transcript: null }, media: { frames: ['frames/001.jpg'], duration_seconds: 2, frame_timestamps_seconds: [0] }, cache_policy: 'disabled' };
    const file = path.join(parent, 'input.json'); fs.writeFileSync(file, JSON.stringify(input));
    const originalBytes = fs.readFileSync(file), hash = createHash('sha256').update(fs.readFileSync(video)).digest('hex');
    const args = { inputFile: file, sourceVideo: video, sourceSha256: hash, outRoot: path.join(root, 'outputs') };
    const output = materializeMedia(args);
    assert.deepEqual(fs.readFileSync(file), originalBytes);
    assert.equal(output.has_audio, true);
    const derivative = JSON.parse(fs.readFileSync(output.input, 'utf8'));
    assert.equal(derivative.input_id, input.input_id);
    assert.deepEqual(derivative.media.frame_timestamps_seconds, [0]);
    assert.equal(derivative.media.source_video.path, 'source/video.mp4');
    const probed = spawnSync('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', path.join(path.dirname(output.input), 'source/video.mp4')], { encoding: 'utf8', windowsHide: true });
    assert.doesNotMatch(probed.stdout, /SECRET_SOURCE_LOCATION|PRIVATE_CREATOR_ID/);
    assert.throws(() => materializeMedia(args), /EEXIST/);
    fs.writeFileSync(file, JSON.stringify({ ...input, view: 'visual_only' }));
    assert.throws(() => materializeMedia(args), /raw_media_not_allowed_for_view/);
  } finally {
    const resolved = path.resolve(root);
    if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith('nearr-neutral-media-')) throw new Error('unsafe_cleanup');
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});
