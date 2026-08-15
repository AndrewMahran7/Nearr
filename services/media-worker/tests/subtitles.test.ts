import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVttToSegments, normalizeTranscriptSegments, detectSubtitleFormat } from '../src/util/subtitles.js';

test('parseVttToSegments: basic manual-caption cues (real YouTube fixture shape)', () => {
  const vtt = `WEBVTT
Kind: captions
Language: en

00:00:01.200 --> 00:00:03.360
All right, so here we are, in front of the
elephants

00:00:05.318 --> 00:00:07.974
the cool thing about these guys is that they
have really...
`;
  const segs = parseVttToSegments(vtt);
  assert.equal(segs.length, 2);
  assert.equal(segs[0]!.text, 'All right, so here we are, in front of the elephants');
  assert.equal(segs[0]!.startSeconds, 1.2);
  assert.equal(segs[0]!.endSeconds, 3.36);
  assert.equal(segs[1]!.text, 'the cool thing about these guys is that they have really...');
});

test('parseVttToSegments: strips karaoke-style inline timestamp tags', () => {
  const vtt = `WEBVTT

00:00:21.790 --> 00:00:21.800 align:start position:0%
We're<00:00:19.039><c> no</c><00:00:19.359><c> strangers</c><00:00:19.840><c> to</c>
`;
  const segs = parseVttToSegments(vtt);
  assert.equal(segs.length, 1);
  assert.equal(segs[0]!.text, "We're no strangers to");
});

test('parseVttToSegments: collapses sliding-window rolling auto-captions', () => {
  // Each cue overlaps the next by a real word-level window (verified against
  // live YouTube auto-captions, which follow exactly this sliding pattern).
  const vtt = `WEBVTT

00:00:00.000 --> 00:00:04.000
the food here is absolutely incredible and you

00:00:04.000 --> 00:00:08.000
incredible and you have to try the pasta

00:00:08.000 --> 00:00:12.000
have to try the pasta it changed my life
`;
  const segs = normalizeTranscriptSegments(parseVttToSegments(vtt));
  assert.equal(segs.length, 1, 'overlapping rolling cues merge into one continuous line');
  assert.equal(
    segs[0]!.text,
    'the food here is absolutely incredible and you have to try the pasta it changed my life',
  );
});

test('parseVttToSegments: distinct non-overlapping cues are never merged', () => {
  const vtt = `WEBVTT

00:00:00.000 --> 00:00:02.000
Check out this restaurant

00:00:05.000 --> 00:00:07.000
The tacos here are incredible
`;
  const segs = parseVttToSegments(vtt);
  assert.equal(segs.length, 2, 'unrelated sentences must not be merged just because they are adjacent cues');
});

test('parseVttToSegments: empty/malformed input never throws, returns []', () => {
  assert.deepEqual(parseVttToSegments(''), []);
  assert.deepEqual(parseVttToSegments('not a subtitle file at all'), []);
  assert.deepEqual(parseVttToSegments('#EXTM3U\n#EXT-X-VERSION:3\n'), [], 'an HLS manifest wrongly fed here parses to zero segments, not garbage');
});

test('normalizeTranscriptSegments: collapses whitespace and drops empties', () => {
  const out = normalizeTranscriptSegments([
    { startSeconds: 0, endSeconds: 1, text: '  hello   world  ' },
    { startSeconds: 1, endSeconds: 2, text: '   ' },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.text, 'hello world');
});

test('detectSubtitleFormat: recognizes WEBVTT header and numbered SRT', () => {
  assert.equal(detectSubtitleFormat('WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nhi'), 'vtt');
  assert.equal(detectSubtitleFormat('1\n00:00:00,000 --> 00:00:01,000\nhi'), 'srt');
  assert.equal(detectSubtitleFormat('#EXTM3U\n...'), 'unknown');
});
