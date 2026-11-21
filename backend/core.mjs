import { timingSafeEqual } from 'node:crypto';

export class PublicError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

export function checkPublicVideo(data) {
  if (data.is_private || (data.availability && !['public', 'unlisted'].includes(data.availability))) {
    throw new PublicError(403, 'PRIVATE_VIDEO', 'Only public or unlisted videos are supported. Account-only videos cannot be shared through this relay.');
  }
}

export function youtubeId(input) {
  if (typeof input !== 'string' || input.length > 2048) throw new PublicError(400, 'INVALID_URL', 'Paste a valid public YouTube video link.');
  let u;
  try { u = new URL(input); } catch { throw new PublicError(400, 'INVALID_URL', 'Paste a complete YouTube video link, including https://.'); }
  const host = u.hostname.toLowerCase();
  if (u.protocol !== 'https:' || u.username || u.password || u.port) throw new PublicError(400, 'INVALID_URL', 'Only HTTPS YouTube video links are supported.');
  let id;
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
  else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(host)) {
    id = u.pathname === '/watch' ? u.searchParams.get('v') : /^\/(?:shorts|embed|live)\/([\w-]{11})\/?$/.exec(u.pathname)?.[1];
  }
  if (!id || !/^[\w-]{11}$/.test(id)) throw new PublicError(400, 'INVALID_URL', 'Use a YouTube video link, rather than a channel or playlist.');
  return id;
}

export function authorized(actual, expected) {
  const a = Buffer.from(actual || '');
  const b = Buffer.from(`Bearer ${expected}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function safeUpstream(value, demo = false) {
  const u = new URL(value);
  const allowed = demo ? u.hostname === 'dash.akamaized.net' : /(^|\.)googlevideo\.com$/.test(u.hostname);
  if (u.protocol !== 'https:' || !allowed || u.username || u.password || u.port) throw new PublicError(502, 'INVALID_UPSTREAM', 'The source returned an unsupported media address.');
  return u;
}

export function checkRange(value) {
  if (!value) return undefined;
  if (!/^bytes=(?:\d+-\d*|-\d+)$/.test(value)) throw new PublicError(416, 'INVALID_RANGE', 'A single valid byte range is required.');
  const [start, end] = value.slice(6).split('-');
  if (start && (!Number.isSafeInteger(Number(start)) || (end && Number(end) < Number(start)))) throw new PublicError(416, 'INVALID_RANGE', 'Invalid byte range.');
  if (end && (!Number.isSafeInteger(Number(end)) || (!start && Number(end) < 1))) throw new PublicError(416, 'INVALID_RANGE', 'Invalid byte range.');
  return value;
}

// YouTube's fragmented MP4 files contain ftyp + moov (initialization), then sidx.
// DASH uses those byte offsets to seek without downloading the entire video.
export function mp4Ranges(buffer) {
  let offset = 0;
  let moovEnd = -1;
  while (offset + 8 <= buffer.length) {
    let size = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    if (size === 1) {
      if (offset + 16 > buffer.length) break;
      const bigSize = buffer.readBigUInt64BE(offset + 8);
      if (bigSize > BigInt(Number.MAX_SAFE_INTEGER)) break;
      size = Number(bigSize);
    }
    if (size < 8) break;
    if (type === 'moov') moovEnd = offset + size - 1;
    if (type === 'sidx' && moovEnd >= 0) return { initialization: `0-${moovEnd}`, index: `${offset}-${offset + size - 1}` };
    offset += size;
  }
  throw new PublicError(422, 'UNSUPPORTED_FORMAT', 'This video does not provide a compatible seekable MP4 stream. Try another video.');
}

export const xml = (value) => String(value).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));

export const demoTracks = [
  { id: 'v4_257', height: 180, width: 320, bandwidth: 200000 },
  { id: 'v8_257', height: 288, width: 512, bandwidth: 480000 },
  { id: 'v9_257', height: 360, width: 640, bandwidth: 750000 },
  { id: 'v1_257', height: 432, width: 768, bandwidth: 1200000 },
  { id: 'v2_257', height: 576, width: 1024, bandwidth: 1850000 },
  { id: 'v3_257', height: 720, width: 1280, bandwidth: 2850000 },
  { id: 'v7_257', height: 1080, width: 1920, bandwidth: 5300000 },
].map((t) => ({ ...t, kind: 'video', codec: 'avc1.4D401E' })).concat([{ id: 'v4_258', kind: 'audio', bandwidth: 130800, codec: 'mp4a.40.2' }]);

export function manifest(session, publicUrl) {
  const base = `${publicUrl}/s/${session.id}`;
  const groups = ['video', 'audio'].map((kind) => {
    const tracks = session.tracks.filter((t) => t.kind === kind);
    const template = session.source === 'demo' ? `<SegmentTemplate timescale="90000" initialization="${xml(base)}/demo/$RepresentationID$-Header.m4s" media="${xml(base)}/demo/$RepresentationID$-270146-i-$Number$.m4s" startNumber="1" duration="179704"/>` : '';
    return `<AdaptationSet id="${kind === 'video' ? 0 : 1}" contentType="${kind}" mimeType="${kind}/mp4" segmentAlignment="true" startWithSAP="1">${template}${tracks.map((t) => `<Representation id="${xml(t.id)}" bandwidth="${t.bandwidth}" codecs="${xml(t.codec)}"${kind === 'video' ? ` width="${t.width}" height="${t.height}" frameRate="${t.fps || '30000/1001'}"` : ' audioSamplingRate="48000"'}>${kind === 'audio' ? '<AudioChannelConfiguration schemeIdUri="urn:mpeg:dash:23003:3:audio_channel_configuration:2011" value="2"/>' : ''}${session.source === 'youtube' ? `<BaseURL>${xml(base)}/media/${xml(t.id)}</BaseURL><SegmentBase indexRange="${xml(t.ranges.index)}" indexRangeExact="true"><Initialization range="${xml(t.ranges.initialization)}"/></SegmentBase>` : ''}</Representation>`).join('')}</AdaptationSet>`;
  }).join('');
  return `<?xml version="1.0" encoding="utf-8"?><MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" profiles="urn:mpeg:dash:profile:isoff-on-demand:2011" minBufferTime="PT2S" mediaPresentationDuration="PT${session.duration.toFixed(3)}S"><Period id="0" start="PT0S">${groups}</Period></MPD>`;
}
