import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { PublicError, authorized, youtubeId, safeUpstream, checkRange, mp4Ranges, demoTracks, manifest, checkPublicVideo } from './core.mjs';

const exec = promisify(execFile);
const port = Number(process.env.PORT || 4100);
const host = process.env.HOST || '127.0.0.1';
const publicUrl = (process.env.PUBLIC_URL || `http://${host}:${port}`).replace(/\/$/, '');
const apiKey = process.env.API_KEY;
const origins = new Set((process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000').split(',').map((origin) => origin.trim()).filter(Boolean));
const ytdlp = process.env.YTDLP_PATH || fileURLToPath(new URL('./bin/yt-dlp', import.meta.url));
const sessions = new Map();
const resolutions = new Map();
let extracting = false;
let activeStreams = 0;
const maxStreams = 10;
const DEMO_ORIGIN = 'https://dash.akamaized.net/envivio/EnvivioDash3/';
if (!apiKey || apiKey.length < 32) throw new Error('Set a strong API_KEY of at least 32 characters.');

const json = (res, status, data) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
};
const clean = () => {
  for (const [key, value] of sessions) if (value.expiresAt < Date.now()) sessions.delete(key);
  for (const [key, value] of resolutions) if (value.expiresAt < Date.now()) resolutions.delete(key);
};
setInterval(clean, 60000).unref();

async function body(req) {
  let value = '';
  for await (const chunk of req) {
    value += chunk;
    if (value.length > 4096) throw new PublicError(413, 'TOO_LARGE', 'The request is too large.');
  }
  try { return JSON.parse(value); } catch { throw new PublicError(400, 'INVALID_JSON', 'Send a valid JSON request.'); }
}

async function fetchSource(url, headers = {}, signal, method = 'GET', demo = false) {
  let current = safeUpstream(url, demo);
  for (let i = 0; i < 4; i++) {
    const response = await fetch(current, { headers, method, redirect: 'manual', signal });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (!location) throw new PublicError(502, 'UPSTREAM_ERROR', 'The video source returned an invalid redirect.');
      current = safeUpstream(new URL(location, current).href, demo);
      continue;
    }
    return response;
  }
  throw new PublicError(502, 'UPSTREAM_ERROR', 'The video source redirected too many times.');
}

async function probeTrack(track) {
  const response = await fetchSource(track.url, { ...track.headers, Range: 'bytes=0-131071' }, AbortSignal.timeout(20000));
  if (response.status !== 206) {
    await response.body?.cancel();
    throw new PublicError(422, 'SOURCE_UNAVAILABLE', 'YouTube refused the media request from this server. Try again later or use a different video.');
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (size < 131072) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value)); size += value.byteLength;
    }
  } finally { await reader.cancel(); }
  return { ...track, ranges: mp4Ranges(Buffer.concat(chunks).subarray(0, 131072)) };
}

async function extractVideo(id) {
  clean();
  if (resolutions.has(id)) return resolutions.get(id);
  if (extracting) throw new PublicError(429, 'BUSY', 'Another video is loading. Please try again in a few seconds.');
  extracting = true;
  try {
    const args = ['--ignore-config', '--no-cache-dir', '--no-playlist', '--skip-download', '--dump-single-json', '--no-warnings', '--socket-timeout', '15', '--retries', '1', '--extractor-retries', '1', '--js-runtimes', 'node'];
    if (process.env.YOUTUBE_COOKIES_FILE) args.push('--cookies', process.env.YOUTUBE_COOKIES_FILE);
    args.push('--', `https://www.youtube.com/watch?v=${id}`);
    let result;
    try { result = await exec(ytdlp, args, { timeout: 75000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, PYTHONUNBUFFERED: '1' } }); }
    catch (e) {
      const detail = String(e.stderr || '');
      if (/not a bot|confirm you|sign in/i.test(detail)) throw new PublicError(422, 'YOUTUBE_BOT_CHECK', 'YouTube is asking this VPS to sign in. The player is ready, but this server cannot currently retrieve this YouTube video. Use the relay test clip to test playback.');
      if (/private video|not available|removed|unavailable/i.test(detail)) throw new PublicError(422, 'VIDEO_UNAVAILABLE', 'This video is private, restricted, removed, or unavailable on this server.');
      if (e.code === 'ENOENT') throw new PublicError(503, 'EXTRACTOR_MISSING', 'The video extractor is not installed on the relay server.');
      throw new PublicError(502, 'EXTRACTION_FAILED', 'The server could not load this video. Try another public video or try again later.');
    }
    const data = JSON.parse(result.stdout);
    checkPublicVideo(data);
    if (data.is_live) throw new PublicError(422, 'LIVE_UNSUPPORTED', 'This version supports recorded videos. Live streams are not supported yet.');
    if (!data.duration || data.duration > 14400) throw new PublicError(422, 'DURATION_UNSUPPORTED', 'Use a recorded video shorter than four hours.');
    const formats = (data.formats || []).filter((f) => f.protocol === 'https' && f.url && f.has_drm !== true);
    const selected = new Map();
    for (const f of formats) {
      if (f.ext !== 'mp4' || f.acodec !== 'none' || !String(f.vcodec).startsWith('avc1') || !f.height || f.height > 1080) continue;
      const old = selected.get(f.height);
      if (!old || (f.fps <= 30 && old.fps > 30) || ((f.fps <= 30) === (old.fps <= 30) && (f.tbr || 0) > (old.tbr || 0))) selected.set(f.height, f);
    }
    const audio = formats.filter((f) => f.vcodec === 'none' && String(f.acodec).startsWith('mp4a')).sort((a, b) => (b.abr || 0) - (a.abr || 0))[0];
    if (!selected.size || !audio) throw new PublicError(422, 'UNSUPPORTED_FORMAT', 'This video has no compatible H.264 + AAC streams available from this server.');
    const toTrack = (f, kind) => ({ id: String(f.format_id), kind, height: f.height, width: f.width, fps: f.fps, codec: kind === 'video' ? f.vcodec : f.acodec, bandwidth: Math.max(1, Math.round((f.tbr || f.abr || 128) * 1000)), url: f.url, headers: Object.fromEntries(Object.entries(f.http_headers || data.http_headers || {}).filter(([k]) => ['user-agent', 'referer', 'origin'].includes(k.toLowerCase()))) });
    const tracks = [];
    // Limit probing concurrency to keep the VPS's memory and upstream load small.
    const candidates = [...selected.values()].sort((a, b) => a.height - b.height).map((f) => toTrack(f, 'video'));
    for (const candidate of candidates) {
      try { tracks.push(await probeTrack(candidate)); } catch (e) { if (e.code !== 'UNSUPPORTED_FORMAT') throw e; }
    }
    tracks.push(await probeTrack(toTrack(audio, 'audio')));
    if (!tracks.some((t) => t.kind === 'video')) throw new PublicError(422, 'UNSUPPORTED_FORMAT', 'No seekable video qualities were available.');
    const expiries = tracks.map((t) => Number(new URL(t.url).searchParams.get('expire')) * 1000).filter((x) => x > 0);
    const expiresAt = Math.min(Date.now() + 2 * 3600000, ...expiries.map((x) => x - 120000));
    if (expiresAt < Date.now() + 60000) throw new PublicError(502, 'SOURCE_EXPIRED', 'YouTube returned an expired source. Please load the video again.');
    const video = { title: data.title || 'Untitled video', creator: data.uploader || 'YouTube', duration: data.duration, tracks, source: 'youtube', expiresAt };
    if (resolutions.size >= 20) resolutions.delete(resolutions.keys().next().value);
    resolutions.set(id, video);
    return video;
  } finally { extracting = false; }
}

function sessionFor(id) {
  const session = sessions.get(id);
  if (!session || session.expiresAt < Date.now()) {
    sessions.delete(id);
    throw new PublicError(410, 'SESSION_EXPIRED', 'This playback session has expired. Load the video again.');
  }
  return session;
}

async function relay(req, res, session, url, headers = {}, demo = false) {
  if (activeStreams >= maxStreams) throw new PublicError(429, 'STREAM_LIMIT', 'The relay is busy. Please try again shortly.');
  const range = checkRange(req.headers.range);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);
  const abort = () => controller.abort();
  res.on('close', abort);
  activeStreams++;
  try {
    const upstream = await fetchSource(url, { ...headers, ...(range ? { Range: range } : {}) }, controller.signal, req.method, demo);
    if (![200, 206, 416].includes(upstream.status)) {
      await upstream.body?.cancel();
      if ([401, 403, 410].includes(upstream.status)) throw new PublicError(410, 'SOURCE_EXPIRED', 'The media source expired or was refused. Load the video again.');
      throw new PublicError(502, 'UPSTREAM_ERROR', 'The video source is temporarily unavailable.');
    }
    const responseHeaders = { 'Cache-Control': 'private, no-store', 'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff' };
    for (const name of ['content-type', 'content-length', 'content-range']) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders[name] = value;
    }
    res.writeHead(upstream.status, responseHeaders);
    if (req.method === 'HEAD' || !upstream.body) { res.end(); return; }
    const meter = new Transform({ transform(chunk, _encoding, callback) { session.bytes += chunk.length; callback(null, chunk); } });
    await pipeline(Readable.fromWeb(upstream.body), meter, res, { signal: controller.signal });
  } finally {
    activeStreams--;
    clearTimeout(timeout);
    res.off('close', abort);
  }
}

export const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  const origin = req.headers.origin;
  if (origin && !origins.has(origin)) { json(res, 403, { error: 'This origin is not allowed.', code: 'ORIGIN_DENIED' }); return; }
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
  }
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  try {
    const path = new URL(req.url, 'http://relay.internal').pathname;
    if (path === '/health' && req.method === 'GET') {
      json(res, 200, { ok: true, service: 'nightfury-relay', activeStreams }); return;
    }
    if (path === '/v1/sessions' && req.method === 'POST') {
      if (!authorized(req.headers.authorization, apiKey)) throw new PublicError(401, 'UNAUTHORIZED', 'The frontend is not connected to this relay server.');
      clean();
      if (sessions.size >= 30) throw new PublicError(429, 'SESSION_LIMIT', 'Too many playback sessions are active. Please try again later.');
      const data = await body(req);
      const video = data.source === 'demo' ? { title: 'Adaptive streaming test clip', creator: 'DASH Industry Forum sample', duration: 193.68, source: 'demo', tracks: demoTracks, expiresAt: Date.now() + 2 * 3600000 } : await extractVideo(youtubeId(data.url));
      const session = { ...video, id: randomBytes(24).toString('base64url'), bytes: 0, createdAt: Date.now() };
      sessions.set(session.id, session);
      json(res, 201, { id: session.id, title: session.title, creator: session.creator, source: session.source, duration: session.duration, expiresAt: session.expiresAt, manifestUrl: `${publicUrl}/s/${session.id}/manifest.mpd`, statsUrl: `${publicUrl}/s/${session.id}/stats`, qualities: session.tracks.filter((t) => t.kind === 'video').map((t) => ({ id: t.id, height: t.height, bandwidth: t.bandwidth })) }); return;
    }
    const match = /^\/s\/([\w-]{32})\/(.+)$/.exec(path);
    if (!match || !['GET', 'HEAD'].includes(req.method)) throw new PublicError(404, 'NOT_FOUND', 'Not found.');
    const session = sessionFor(match[1]);
    const resource = match[2];
    if (resource === 'manifest.mpd') {
      res.writeHead(200, { 'Content-Type': 'application/dash+xml', 'Cache-Control': 'private, no-store' });
      res.end(req.method === 'HEAD' ? undefined : manifest(session, publicUrl)); return;
    }
    if (resource === 'stats') { json(res, 200, { bytes: session.bytes, expiresAt: session.expiresAt }); return; }
    if (session.source === 'demo' && resource.startsWith('demo/')) {
      const filename = resource.slice(5);
      const file = /^(v\d+_25[78])-(?:Header|270146-i-(\d+))\.m4s$/.exec(filename);
      if (!file || !session.tracks.some((t) => t.id === file[1]) || (file[2] && (Number(file[2]) < 1 || Number(file[2]) > 100))) throw new PublicError(404, 'NOT_FOUND', 'Unknown media segment.');
      await relay(req, res, session, new URL(filename, DEMO_ORIGIN).href, {}, true); return;
    }
    if (session.source === 'youtube' && resource.startsWith('media/')) {
      const track = session.tracks.find((t) => t.id === resource.slice(6));
      if (!track) throw new PublicError(404, 'NOT_FOUND', 'Unknown media track.');
      await relay(req, res, session, track.url, track.headers); return;
    }
    throw new PublicError(404, 'NOT_FOUND', 'Not found.');
  } catch (error) {
    if (res.headersSent) { if (!res.destroyed) res.destroy(); return; }
    if (error.name === 'AbortError' || error.name === 'TimeoutError') { json(res, 504, { code: 'TIMEOUT', error: 'The video source took too long to respond. Please try again.' }); return; }
    const known = error instanceof PublicError;
    if (!known) console.error('Relay request failed:', error.name, error.code || 'INTERNAL');
    json(res, known ? error.status : 500, { code: known ? error.code : 'INTERNAL_ERROR', error: known ? error.message : 'The relay encountered an unexpected error.' });
  }
});
server.requestTimeout = 90000;
server.headersTimeout = 10000;
server.listen(port, host, () => console.log(`Nightfury relay listening on ${host}:${port}`));
const shutdown = () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 5000).unref(); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
