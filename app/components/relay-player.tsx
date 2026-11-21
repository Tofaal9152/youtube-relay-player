'use client';

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import Player from 'next-video/player';
import { CircleHelp, LoaderCircle } from 'lucide-react';
import type { MediaPlayerClass } from 'dashjs';

type Renditions = EventTarget & ArrayLike<{ id: string }> & { selectedIndex: number };
type DashMedia = HTMLVideoElement & {
  api?: MediaPlayerClass;
  nativeEl?: HTMLVideoElement;
  videoRenditions?: Renditions;
};

export type RelayPlayerHandle = { selectQuality: (id: string) => boolean };
type Props = {
  src: string;
  title: string;
  apiRef: Ref<RelayPlayerHandle>;
  onQualityChange: (id: string) => void;
  onResolutionChange: (height: number) => void;
};

export default function RelayPlayer({ src, title, apiRef, onQualityChange, onResolutionChange }: Props) {
  const [media, setMedia] = useState<DashMedia | null>(null);
  const [buffering, setBuffering] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const callbacks = useRef({ onQualityChange, onResolutionChange });
  useEffect(() => { callbacks.current = { onQualityChange, onResolutionChange }; }, [onQualityChange, onResolutionChange]);

  useImperativeHandle(apiRef, () => ({
    selectQuality(id) {
      const renditions = media?.videoRenditions;
      if (!renditions?.length) return false;
      const index = id === 'auto' ? -1 : Array.from(renditions).findIndex((r) => r.id === id);
      if (id !== 'auto' && index === -1) return false;
      // Use the same rendition list as next-video's own Settings > Quality menu.
      renditions.selectedIndex = index;
      return true;
    },
  }), [media]);

  useEffect(() => {
    if (!media) return;
    let disposed = false;
    let player: MediaPlayerClass | undefined;
    let detach = () => {};
    const native = media.nativeEl || media;
    const resolution = () => callbacks.current.onResolutionChange(native.videoHeight || 0);
    const ready = () => { setBuffering(false); resolution(); };
    const waiting = () => setBuffering(true);
    const fail = () => { setBuffering(false); setError('Playback could not continue. Load the video again to refresh its streaming session.'); };
    native.addEventListener('loadedmetadata', resolution);
    native.addEventListener('resize', resolution);
    native.addEventListener('canplay', ready);
    native.addEventListener('playing', ready);
    native.addEventListener('waiting', waiting);
    native.addEventListener('error', fail);
    media.volume = 0.8;

    const started = Date.now();
    const attach = async () => {
      if (disposed || !media.api) return;
      clearInterval(timer);
      const dash = await import('dashjs');
      // next-video owns this engine. Do not initialize another dash.js player.
      player = media.api;
      if (disposed) { if (!media.isConnected) player?.reset(); return; }
      player.updateSettings({ debug: { logLevel: dash.Debug.LOG_LEVEL_NONE }, streaming: { buffer: { bufferTimeDefault: 12, bufferTimeAtTopQuality: 15, bufferTimeAtTopQualityLongForm: 15 } } });
      const renditionChanged = () => {
        const list = media.videoRenditions;
        callbacks.current.onQualityChange(list?.[list.selectedIndex]?.id || 'auto');
      };
      media.videoRenditions?.addEventListener('change', renditionChanged);
      player.on(dash.MediaPlayer.events.QUALITY_CHANGE_RENDERED, resolution);
      player.on(dash.MediaPlayer.events.ERROR, fail);
      detach = () => {
        media.videoRenditions?.removeEventListener('change', renditionChanged);
        player?.off(dash.MediaPlayer.events.QUALITY_CHANGE_RENDERED, resolution);
        player?.off(dash.MediaPlayer.events.ERROR, fail);
      };
      resolution();
    };
    // The custom element lazy-loads its DASH engine after React assigns its ref.
    const timer = setInterval(() => {
      if (media.api) attach().catch(fail);
      else if (Date.now() - started > 15000) {
        clearInterval(timer);
        if (!disposed) { setBuffering(false); setError('The streaming player could not initialize. Try a recent Chrome, Edge, Firefox, or Safari version.'); }
      }
    }, 50);
    if (media.api) attach().catch(fail);
    return () => {
      disposed = true;
      clearInterval(timer);
      detach();
      native.removeEventListener('loadedmetadata', resolution);
      native.removeEventListener('resize', resolution);
      native.removeEventListener('canplay', ready);
      native.removeEventListener('playing', ready);
      native.removeEventListener('waiting', waiting);
      native.removeEventListener('error', fail);
      // React Strict Mode can clean up effects while keeping the same element.
      // Reset only a detached element, so the next-video engine stays usable.
      if (!media.isConnected) (player || media.api)?.reset();
    };
  }, [media]);

  function retry() {
    setError('');
    setBuffering(true);
    callbacks.current.onQualityChange('auto');
    callbacks.current.onResolutionChange(0);
    setAttempt((value) => value + 1);
  }

  return <div className="next-video-shell">
    <Player
      key={attempt}
      ref={setMedia}
      src={src}
      aria-label={title}
      playsInline
      controls
      style={{ width: '100%', height: '100%', aspectRatio: '16 / 9', '--media-accent-color': '#b69aff', '--media-primary-color': '#f2ecff', '--media-secondary-color': '#18141f' }}
    />
    {buffering && !error && <div className="buffering-overlay" role="status"><LoaderCircle className="spin" size={34} /><span>Preparing your video…</span></div>}
    {error && <div className="playback-error" role="alert"><CircleHelp size={28} /><p>{error}</p><button onClick={retry}>Retry playback</button></div>}
  </div>;
}
