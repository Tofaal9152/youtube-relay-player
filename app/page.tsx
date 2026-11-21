'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import dynamic from 'next/dynamic';
import type { RelayPlayerHandle } from './components/relay-player';
import { Activity, Check, ChevronDown, CircleHelp, Clapperboard, Flame, Link2, LoaderCircle, MonitorPlay, Play, Radio, Server, Settings2, ShieldCheck, X } from 'lucide-react';

const RelayPlayer = dynamic(() => import('./components/relay-player'), {
  ssr: false,
  loading: () => <div className="buffering-overlay" role="status"><LoaderCircle className="spin" size={34} /><span>Loading player…</span></div>,
});

type Quality = { id: string; height: number; bandwidth: number };
type Session = { id: string; title: string; creator: string; source: 'demo' | 'youtube'; duration: number; expiresAt: number; manifestUrl: string; statsUrl: string; qualities: Quality[] };
type Relay = { ok: boolean; hostname?: string; error?: string };

const clock = (seconds: number) => {
  if (!Number.isFinite(seconds)) return '0:00';
  const s = Math.max(0, Math.floor(seconds));
  return s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const megabytes = (bytes: number) => `${(bytes / 1000000).toFixed(bytes > 100000000 ? 0 : 1)} MB`;

export default function Home() {
  const [url, setUrl] = useState('');
  const [relay, setRelay] = useState<Relay | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState<'youtube' | 'demo' | null>(null);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [quality, setQuality] = useState('auto');
  const [actualQuality, setActualQuality] = useState(0);
  const [bytes, setBytes] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);
  const [tab, setTab] = useState('player');
  const [siteHost, setSiteHost] = useState('Your browser');
  const playerRef = useRef<RelayPlayerHandle | null>(null);
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let active = true;
    setSiteHost(window.location.host);
    const check = () => fetch('/api/relay').then((r) => r.json()).then((data) => { if (active) setRelay(data); }).catch(() => { if (active) setRelay({ ok: false }); });
    check();
    const timer = setInterval(check, 30000);
    return () => { active = false; clearInterval(timer); requestRef.current?.abort(); };
  }, []);

  useEffect(() => {
    if (!session) return;
    const controller = new AbortController();
    const poll = () => fetch(session.statsUrl, { signal: controller.signal }).then((r) => r.ok ? r.json() : null).then((s) => { if (s) setBytes(s.bytes); }).catch(() => {});
    const timer = setInterval(poll, 5000);
    poll();
    return () => { controller.abort(); clearInterval(timer); };
  }, [session]);

  async function load(source: 'youtube' | 'demo') {
    if (loading) return;
    requestRef.current?.abort();
    const controller = new AbortController(); requestRef.current = controller;
    setLoading(source); setError(null);
    try {
      const response = await fetch('/api/relay', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(source === 'demo' ? { source } : { url: url.trim() }), signal: controller.signal });
      const data = await response.json();
      if (!response.ok) { setError({ message: data.error || 'Could not load this video.', code: data.code }); return; }
      setQuality('auto'); setActualQuality(0); setBytes(0);
      setSession(data); setTab('player');
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) setError({ message: 'The request failed. Check the relay connection and try again.' });
    } finally { if (requestRef.current === controller) setLoading(null); }
  }

  function chooseQuality(id: string) {
    if (playerRef.current?.selectQuality(id)) setQuality(id);
  }

  function submit(e: FormEvent) { e.preventDefault(); load('youtube'); }
  const selectedQuality = quality === 'auto' ? `Auto${actualQuality ? ` · ${actualQuality}p` : ''}` : `${session?.qualities.find((q) => q.id === quality)?.height || ''}p`;

  return <div className="app-shell">
    <aside className="rail" aria-label="Main navigation">
      <a className="brand-mark" href="/" aria-label="Nightfury home"><Flame size={28} fill="currentColor" strokeWidth={1.5} /></a>
      <div className="rail-links">
        <button className={`rail-button ${tab === 'player' ? 'active' : ''}`} title="Player" aria-label="Player" onClick={() => setTab('player')}><MonitorPlay size={22} /></button>
        <button className={`rail-button ${tab === 'connection' ? 'active' : ''}`} title="Connection" aria-label="Connection details" onClick={() => setTab('connection')}><Radio size={22} /></button>
      </div>
      <button className="rail-button rail-help" title="How it works" aria-label="How it works" onClick={() => setHelpOpen(true)}><CircleHelp size={22} /></button>
      <div className="rail-avatar" title="Nightfury workspace">N</div>
    </aside>

    <div className="workspace">
      <header className="topbar">
        <a href="/" className="wordmark">NIGHTFURY<span>STREAM</span></a>
        <div className="topbar-right"><span className="local-label"><span className="local-dot" />Video workspace</span><span className="version">v1.0</span></div>
      </header>

      <main>
        <div className="page-heading"><div><div className="eyebrow">A LITTLE LESS NOISE. A LOT MORE VIDEO.</div><h1>Your screen. <span>Your player.</span></h1><p>A clean player for the videos you want to watch.</p></div><button className={`connection-badge ${relay?.ok ? 'connected' : relay ? 'offline' : ''}`} onClick={() => setTab(tab === 'connection' ? 'player' : 'connection')}><span className="status-dot" />{relay?.ok ? 'Relay connected' : relay ? 'Relay offline' : 'Connecting relay'}<ChevronDown size={14} /></button></div>

        {tab === 'connection' ? <section className="connection-page card">
          <div className="section-icon"><Server size={24} /></div><h2>Your relay connection</h2><p>The interface runs in your browser. Video data travels through your relay.</p>
          <div className="connection-row"><span>Frontend</span><strong>{siteHost}</strong></div>
          <div className="connection-row"><span>Backend</span><strong>{relay?.hostname || 'Not connected'}</strong></div>
          <div className="connection-row"><span>Status</span><strong className={relay?.ok ? 'green-text' : 'amber-text'}>{relay?.ok ? 'Connected' : relay?.error || 'Checking…'}</strong></div>
          <div className="connection-row"><span>Video storage</span><strong>On demand · no permanent files</strong></div>
          <div className="connection-row"><span>Stream visibility</span><strong>Relay URLs only</strong></div>
          <p className="connection-note">YouTube may require sign-in on datacenter IP addresses. The test clip checks the relay independently of YouTube.</p>
          <button className="secondary-button" onClick={() => setTab('player')}>Back to player</button>
        </section> : null}<div className="content-grid" style={tab !== 'player' ? { display: 'none' } : undefined}>
          <section className="player-column" aria-label="Video player">
            <div className="player-frame">
              <div className={`video-stage ${session ? 'has-video' : ''}`}>
                {session && <RelayPlayer key={session.id} apiRef={playerRef} src={session.manifestUrl} title={session.title} onQualityChange={setQuality} onResolutionChange={setActualQuality} />}
                {!session && <div className="empty-scene"><div className="scene-glow" /><div className="scene-orbit orbit-one" /><div className="scene-orbit orbit-two" /><div className="scene-orbit orbit-three" /><div className="empty-center"><span className="scene-label">THE GOOD PART STARTS HERE</span><button className="hero-play" aria-label="Focus video link input" onClick={() => document.getElementById('video-url')?.focus()}><Play size={30} fill="currentColor" /></button><h2>Make room for a good watch.</h2><p>Add a video to start your session.</p></div><div className="scene-footer"><ShieldCheck size={14} /><span>Your player. No distractions.</span></div><span className="scene-brand">NIGHTFURY</span></div>}
                {session && <div className="video-top-badge"><span className="status-dot" />{session.source === 'demo' ? 'RELAY TEST CLIP' : 'VIA NIGHTFURY'}</div>}
              </div>
            </div>

            <div className="now-playing"><div><div className="eyebrow">{session ? 'NOW PLAYING' : 'YOUR NEXT WATCH'}</div><h2>{session?.title || 'Something worth your full attention.'}</h2><p>{session ? `${session.creator} · ${session.source === 'demo' ? 'Public streaming sample' : 'On-demand playback'}` : 'Load a link or take the player for a spin with a test clip.'}</p></div><div className="mode-pill"><ShieldCheck size={14} />Server relay</div></div>

            <div className="metrics-grid"><div className="metric"><span className="metric-label"><MonitorPlay size={15} />QUALITY</span><strong>{session ? selectedQuality : '—'}</strong><span>{actualQuality ? `Playing at ${actualQuality}p` : 'Adapts to your connection'}</span></div><div className="metric"><span className="metric-label"><Activity size={15} />DATA TRANSFERRED</span><strong>{session ? megabytes(bytes) : '—'}</strong><span>Sent by your relay</span></div><div className="metric"><span className="metric-label"><Clapperboard size={15} />DURATION</span><strong>{session ? clock(session.duration) : '—'}</strong><span>{session ? 'Full video length' : 'Waiting for a video'}</span></div></div>

            <div className="route-strip"><span className="route-caption">THE SHORT VERSION</span><div><span><Link2 size={14} />Video source</span><i /><span className="route-vps"><Server size={14} />Your relay</span><i /><span><MonitorPlay size={14} />Your browser</span></div><ShieldCheck size={17} className="route-shield" /></div>
          </section>

          <aside className="source-column">
            <section className="card add-video"><div className="section-icon"><Link2 size={20} /></div><h2>Add a video</h2><p>One link. A better viewing experience.</p><form onSubmit={submit}><label htmlFor="video-url">YouTube video link</label><div className="url-input"><Link2 size={17} /><input id="video-url" type="url" placeholder="https://youtube.com/watch?v=…" value={url} onChange={(e) => setUrl(e.target.value)} autoComplete="off" spellCheck={false} required /></div><button className="primary-button" disabled={!!loading || !url.trim()} type="submit">{loading === 'youtube' ? <><LoaderCircle className="spin" size={18} />Loading video…</> : <><Play size={17} fill="currentColor" />Load video</>}</button></form><div className="under-button"><ShieldCheck size={13} /><span>Streamed on demand. No permanent storage.</span></div>
              {error && <div className={`error-message ${error.code === 'YOUTUBE_BOT_CHECK' ? 'bot-check' : ''}`} role="alert"><div><CircleHelp size={17} /><strong>{error.code === 'YOUTUBE_BOT_CHECK' ? 'YouTube needs verification' : 'Could not load video'}</strong><button aria-label="Dismiss error" onClick={() => setError(null)}><X size={14} /></button></div><p>{error.message}</p>{error.code === 'YOUTUBE_BOT_CHECK' && <button className="inline-button" onClick={() => load('demo')} disabled={!!loading}>Try the relay test clip</button>}</div>}
              <div className="divider"><span>OR TAKE A TEST DRIVE</span></div><button className="demo-button" disabled={!!loading} onClick={() => load('demo')}><span className="demo-art"><span /><Play size={15} fill="currentColor" /></span><span className="demo-label"><strong>{loading === 'demo' ? 'Loading test clip…' : 'Play a test clip'}</strong><span>3 min · up to 1080p</span></span>{loading === 'demo' ? <LoaderCircle className="spin" size={18} /> : <Play size={17} />}</button><p className="demo-disclaimer">A public DASH sample, separate from YouTube.</p>
            </section>

            <section className="card quality-card"><div className="card-heading"><h3>Make it your own</h3><Settings2 size={17} /></div><p>Choose a quality, or let Auto find the fit.</p><div className="quality-pills"><button className={quality === 'auto' ? 'selected' : ''} disabled={!session} onClick={() => chooseQuality('auto')}>{quality === 'auto' && <Check size={12} />}Auto</button>{(session?.qualities || [{ id: 'preview360', height: 360 }, { id: 'preview720', height: 720 }, { id: 'preview1080', height: 1080 }]).map((q) => <button disabled={!session} className={quality === q.id ? 'selected' : ''} key={q.id} onClick={() => chooseQuality(q.id)}>{q.height}p</button>)}</div><div className="quality-note"><span className="tiny-spark">✦</span><span>{session ? 'Quality changes keep your place in the video.' : 'Available qualities appear when you load a video.'}</span></div></section>

            <div className="quiet-note"><Server size={18} /><div><strong>Small server. Smart streaming.</strong><p>Your VPS relays the video. Your computer handles the player.</p></div></div>
          </aside>
        </div>
        <footer><span>Built for a little more focus.</span><button onClick={() => setHelpOpen(true)}>How it works<CircleHelp size={13} /></button></footer>
      </main>
    </div>

    {helpOpen && <div className="modal-backdrop" onClick={() => setHelpOpen(false)}><section className="help-modal card" role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={(e) => e.stopPropagation()}><button className="modal-close" aria-label="Close help" onClick={() => setHelpOpen(false)}><X size={20} /></button><div className="section-icon"><Flame size={23} /></div><h2 id="help-title">A quieter way to watch.</h2><p>Paste a public YouTube link and load it. Nightfury asks your VPS for a temporary playback session, then streams the video through that server.</p><p>Pick Auto or a specific quality. Play, pause, seek, change speed, or go fullscreen. The test clip uses a public DASH sample to check your connection without YouTube.</p><p>Original media addresses stay on the VPS. Relay addresses remain visible to your browser, and this does not prevent recording or downloading.</p><button className="primary-button" onClick={() => setHelpOpen(false)}>Got it</button></section></div>}
  </div>;
}
