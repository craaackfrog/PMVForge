import { useEffect, useRef, useState, useCallback } from 'react'
import { Play, Pause, SkipBack } from 'lucide-react'
import { mediaUrl } from './edl'

/**
 * Realtime preview: song on <audio>, clips on dual <video> (preload next, swap on beat).
 * No ffmpeg — Chromium seeks source files to src_in / src_out.
 */
export default function SourcePreview({
  clips = [],
  beats = [],
  songPath = '',
  songVolume = 1,
  className = '',
}) {
  const songRef = useRef(null)
  const v0 = useRef(null)
  const v1 = useRef(null)
  const activeRef = useRef(0)
  const idxRef = useRef(0)
  const rafRef = useRef(null)
  const [playing, setPlaying] = useState(false)
  const [clock, setClock] = useState(0)
  const [error, setError] = useState(null)

  const duration = beats.length ? beats[beats.length - 1] : 0

  const loadSegment = useCallback((videoEl, clip) => {
    if (!videoEl || !clip?.path) return
    const url = mediaUrl(clip.path)
    if (videoEl.dataset.path !== clip.path) {
      videoEl.src = url
      videoEl.dataset.path = clip.path
    }
    const start = Number(clip.src_in) || 0
    const trySeek = () => {
      try {
        videoEl.currentTime = start
      } catch {
        /* ignore */
      }
    }
    if (videoEl.readyState >= 1) trySeek()
    else videoEl.onloadedmetadata = trySeek
    videoEl.volume = Math.max(0, Math.min(1, Number(clip.volume) ?? 1))
  }, [])

  // Prime first + next
  useEffect(() => {
    if (!clips.length) return
    loadSegment(v0.current, clips[0])
    if (clips[1]) loadSegment(v1.current, clips[1])
    activeRef.current = 0
    idxRef.current = 0
  }, [clips, loadSegment])

  useEffect(() => {
    if (songRef.current) {
      songRef.current.volume = Math.max(0, Math.min(1, songVolume))
    }
  }, [songVolume])

  useEffect(() => {
    if (!songPath || !songRef.current) return
    songRef.current.src = mediaUrl(songPath)
  }, [songPath])

  const stopRaf = () => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }

  const tick = useCallback(() => {
    const song = songRef.current
    if (!song) return
    const t = song.currentTime || 0
    setClock(t)

    // Which beat segment are we in?
    let i = idxRef.current
    while (i + 1 < beats.length && t >= beats[i + 1]) i += 1
    while (i > 0 && t < beats[i]) i -= 1

    if (i !== idxRef.current && clips[i]) {
      const prevActive = activeRef.current
      const nextActive = prevActive === 0 ? 1 : 0
      const show = nextActive === 0 ? v0.current : v1.current
      const hide = prevActive === 0 ? v0.current : v1.current
      loadSegment(show, clips[i])
      if (show) {
        show.style.opacity = '1'
        const p = show.play()
        if (p && p.catch) p.catch(() => {})
      }
      if (hide) {
        hide.pause()
        hide.style.opacity = '0'
      }
      activeRef.current = nextActive
      idxRef.current = i
      // Preload next
      const preloadEl = hide
      if (clips[i + 1] && preloadEl) loadSegment(preloadEl, clips[i + 1])
    } else {
      // Keep active video in sync with song within segment
      const active = activeRef.current === 0 ? v0.current : v1.current
      const clip = clips[i]
      if (active && clip && !active.seeking) {
        const local = (Number(clip.src_in) || 0) + (t - (beats[i] || 0))
        if (Math.abs((active.currentTime || 0) - local) > 0.35) {
          try {
            active.currentTime = local
          } catch {
            /* ignore */
          }
        }
      }
    }

    if (t >= duration - 0.05) {
      setPlaying(false)
      song.pause()
      stopRaf()
      return
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [beats, clips, duration, loadSegment])

  async function togglePlay() {
    setError(null)
    const song = songRef.current
    if (!song || !clips.length) {
      setError('Need song + timeline clips to preview')
      return
    }
    if (playing) {
      song.pause()
      v0.current?.pause()
      v1.current?.pause()
      setPlaying(false)
      stopRaf()
      return
    }
    try {
      // Start at current segment
      let i = 0
      const t = song.currentTime || 0
      while (i + 1 < beats.length && t >= beats[i + 1]) i += 1
      idxRef.current = i
      loadSegment(v0.current, clips[i])
      if (v0.current) {
        v0.current.style.opacity = '1'
        await v0.current.play().catch(() => {})
      }
      if (v1.current) v1.current.style.opacity = '0'
      activeRef.current = 0
      await song.play()
      setPlaying(true)
      stopRaf()
      rafRef.current = requestAnimationFrame(tick)
    } catch (e) {
      setError(e.message || 'Playback failed — codec may be unsupported in Chromium')
      setPlaying(false)
    }
  }

  function restart() {
    stopRaf()
    setPlaying(false)
    const song = songRef.current
    if (song) {
      song.pause()
      song.currentTime = 0
    }
    v0.current?.pause()
    v1.current?.pause()
    idxRef.current = 0
    setClock(0)
    if (clips[0]) loadSegment(v0.current, clips[0])
  }

  useEffect(() => () => stopRaf(), [])

  return (
    <div className={className}>
      <div className="relative aspect-video bg-black rounded-lg overflow-hidden border border-border">
        <video
          ref={v0}
          className="absolute inset-0 w-full h-full object-contain transition-opacity duration-75"
          playsInline
          muted={false}
          style={{ opacity: 1 }}
        />
        <video
          ref={v1}
          className="absolute inset-0 w-full h-full object-contain transition-opacity duration-75"
          playsInline
          muted={false}
          style={{ opacity: 0 }}
        />
        {!clips.length && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            Build a timeline to preview
          </div>
        )}
      </div>
      <audio ref={songRef} preload="auto" />
      <div className="flex items-center gap-3 mt-2">
        <button
          type="button"
          onClick={restart}
          className="p-2 rounded-md bg-secondary hover:bg-accent"
          title="Restart"
        >
          <SkipBack size={16} />
        </button>
        <button
          type="button"
          onClick={togglePlay}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm"
        >
          {playing ? <Pause size={14} /> : <Play size={14} />}
          {playing ? 'Pause' : 'Preview'}
        </button>
        <span className="text-xs text-muted-foreground font-mono">
          {clock.toFixed(2)}s / {duration.toFixed(2)}s · seg {Math.min(idxRef.current + 1, clips.length || 1)}/{clips.length || 0}
        </span>
      </div>
      {error && <p className="text-xs text-destructive mt-1">{error}</p>}
      <p className="text-[11px] text-muted-foreground mt-1">
        Source preview — no encode. Chromium must support the clip codecs; ugly files may need a proxy later.
      </p>
    </div>
  )
}
