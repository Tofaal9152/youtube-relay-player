import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const allowedOrigins = new Set((process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000').split(',').map((origin) => origin.trim()).filter(Boolean));
const recentRequests = new Map<string, { count: number; expires: number }>();

function configuration() {
  const url = process.env.RELAY_URL;
  const key = process.env.RELAY_API_KEY;
  if (!url || !key) throw new Error('The relay connection is not configured. Add RELAY_URL and RELAY_API_KEY to .env.local.');
  return { url: url.replace(/\/$/, ''), key };
}

export async function GET() {
  try {
    const { url } = configuration();
    const response = await fetch(`${url}/health`, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('The relay server is not responding.');
    const data = await response.json();
    return NextResponse.json({ ...data, hostname: new URL(process.env.PUBLIC_RELAY_URL || url).hostname });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Cannot reach the relay.' }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  // The relay credential stays server-side for both localhost and the hosted app.
  const origin = request.headers.get('origin');
  if (origin && !allowedOrigins.has(origin)) return NextResponse.json({ error: 'Request origin is not allowed.' }, { status: 403 });
  if (Number(request.headers.get('content-length') || 0) > 4096) return NextResponse.json({ error: 'The request is too large.' }, { status: 413 });
  let input;
  try { input = await request.json(); } catch { return NextResponse.json({ error: 'Send a valid video link.' }, { status: 400 }); }
  if (input.source !== 'demo' && (typeof input.url !== 'string' || input.url.length > 2048)) return NextResponse.json({ error: 'Paste a valid YouTube video link.' }, { status: 400 });
  const now = Date.now();
  for (const [id, entry] of recentRequests) if (entry.expires < now) recentRequests.delete(id);
  // Nginx overwrites X-Real-IP; the Node listener is bound to loopback only.
  const client = request.headers.get('x-real-ip') || 'local';
  const entry = recentRequests.get(client);
  if (entry && entry.count >= 6) return NextResponse.json({ error: 'Too many videos loaded. Please wait a minute and try again.' }, { status: 429, headers: { 'Retry-After': String(Math.max(1, Math.ceil((entry.expires - now) / 1000))) } });
  if (recentRequests.size >= 1000 && !entry) return NextResponse.json({ error: 'The player is busy. Try again shortly.' }, { status: 429 });
  recentRequests.set(client, { count: (entry?.count || 0) + 1, expires: entry?.expires || now + 60000 });
  try {
    const { url, key } = configuration();
    const response = await fetch(`${url}/v1/sessions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(input.source === 'demo' ? { source: 'demo' } : { url: input.url }),
      cache: 'no-store', signal: AbortSignal.timeout(85000),
    });
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error && error.message.includes('configured') ? error.message : 'Could not reach the relay server. Check the connection and try again.', code: 'RELAY_UNAVAILABLE' }, { status: 503 });
  }
}
