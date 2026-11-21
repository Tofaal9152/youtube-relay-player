import { test } from 'node:test';
import assert from 'node:assert/strict';
import { youtubeId, authorized, safeUpstream, checkRange, mp4Ranges, manifest, demoTracks, checkPublicVideo } from '../core.mjs';

test('account cookies cannot publish private or membership-only videos', () => {
  for (const availability of ['private', 'premium_only', 'subscriber_only', 'needs_auth']) assert.throws(() => checkPublicVideo({ availability }), { code: 'PRIVATE_VIDEO' });
  assert.throws(() => checkPublicVideo({ is_private: true }), { code: 'PRIVATE_VIDEO' });
  for (const availability of ['public', 'unlisted', undefined]) assert.doesNotThrow(() => checkPublicVideo({ availability }));
});

test('only canonical HTTPS YouTube video links reach the extractor', () => {
  for (const url of ['https://youtu.be/jNQXAC9IVRw?t=2', 'https://www.youtube.com/watch?v=jNQXAC9IVRw&list=foo', 'https://m.youtube.com/shorts/jNQXAC9IVRw']) assert.equal(youtubeId(url), 'jNQXAC9IVRw');
  for (const url of ['http://localhost/test', 'https://youtube.com.evil.test/watch?v=jNQXAC9IVRw', 'https://user:pass@youtube.com/watch?v=jNQXAC9IVRw', 'https://youtube.com:444/watch?v=jNQXAC9IVRw', 'https://youtube.com/playlist?list=abc', 'https://youtube.com/watch?v=x;whoami', null]) assert.throws(() => youtubeId(url));
});

test('relay addresses cannot be arbitrary internal services or deceptive hostnames', () => {
  assert.equal(safeUpstream('https://rr1---sn-abcd.googlevideo.com/videoplayback').hostname, 'rr1---sn-abcd.googlevideo.com');
  assert.equal(safeUpstream('https://dash.akamaized.net/envivio/clip', true).hostname, 'dash.akamaized.net');
  for (const url of ['http://googlevideo.com/x', 'https://googlevideo.com.evil.test/x', 'https://127.0.0.1/x', 'https://googlevideo.com:444/x', 'https://user@googlevideo.com/x']) assert.throws(() => safeUpstream(url));
});

test('range requests support seeking and reject malformed/multipart ranges', () => {
  for (const range of ['bytes=0-999', 'bytes=100-', 'bytes=-100']) assert.equal(checkRange(range), range);
  for (const range of ['bytes=20-10', 'bytes=0-1,2-3', 'bytes=-', 'bytes=-0', 'bytes=0-9007199254740992']) assert.throws(() => checkRange(range));
});

test('fragmented MP4 offsets include initialization and the complete sidx box', () => {
  const box = (type, size) => { const b = Buffer.alloc(size); b.writeUInt32BE(size); b.write(type, 4); return b; };
  const bytes = Buffer.concat([box('ftyp', 24), box('moov', 72), box('sidx', 48), box('moof', 16)]);
  assert.deepEqual(mp4Ranges(bytes), { initialization: '0-95', index: '96-143' });
  assert.throws(() => mp4Ranges(Buffer.concat([box('ftyp', 24), box('mdat', 80)])));
});

test('DASH manifests expose only relay addresses, never source URLs', () => {
  const s = { id: 'test-session', source: 'youtube', duration: 20, tracks: [{ id: '137', kind: 'video', bandwidth: 1000000, width: 1920, height: 1080, codec: 'avc1.640028', url: 'https://secret.googlevideo.com/video', ranges: { initialization: '0-95', index: '96-143' } }] };
  const result = manifest(s, 'https://relay.example/api');
  assert.match(result, /https:\/\/relay.example\/api\/s\/test-session\/media\/137/);
  assert.doesNotMatch(result, /googlevideo|youtube/);
  assert.match(result, /indexRange="96-143"/);
  const demo = manifest({ ...s, source: 'demo', tracks: demoTracks }, 'https://relay.example/api');
  assert.match(demo, /\$RepresentationID\$/);
  assert.doesNotMatch(demo, /akamaized/);
});

test('control API requires the exact private key', () => {
  assert.equal(authorized('Bearer expected', 'expected'), true);
  assert.equal(authorized('Bearer wrong', 'expected'), false);
  assert.equal(authorized(undefined, 'expected'), false);
});
