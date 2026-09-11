import { useRef, useEffect, useState, useCallback } from 'react'
import { cn } from '../lib/utils'
import { Play, Pause, Undo2, Magnet } from 'lucide-react'

/**
 * Interactive waveform + beat editor with:
 * - play/pause preview
 * - scroll-to-zoom
 * - undo
 * - snap-to-beat
 * - separate seek bar (doesn't interfere with beat dragging)
 */
export default function WaveformEditor({
  waveform,
  beats = [],
  duration = 0,
  tempo = 120,
  audioFile = null,
  onChange,
  className,
}) {
  const canvasRef = useRef(null)
  const containerRef = useRef(null)
  const audioRef = useRef(null)
  const rafRef = useRef(null)

  const [width, setWidth] = useState(800)
  const [height] = useState(160)

  // View window (for zoom)
  const [viewStart, setViewStart] = useState(0)   // seconds
  const [viewEnd, setViewEnd] = useState(duration || 1)

  // Interaction
  const [dragIndex, setDragIndex] = useState(null)
  const [hoverIndex, setHoverIndex] = useState(null)
  const [selectedIndex, setSelectedIndex] = useState(null)
  const [localBeats, setLocalBeats] = useState(beats)

  // Undo stack (array of beat arrays)
  const [history, setHistory] = useState([])
  const historyLock = useRef(false)

  // Snap
  const [snap, setSnap] = useState(true)

  // Playback
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [audioUrl, setAudioUrl] = useState(null)

  // Seeking on the progress bar (separate from beat drag)
  const [seeking, setSeeking] = useState(false)
  const progressRef = useRef(null)

  // ── Sync incoming beats ──────────────────────────────────
  useEffect(() => {
    setLocalBeats(beats)
    // Reset history when a brand-new detection arrives
    if (!historyLock.current) {
      setHistory([])
    }
    historyLock.current = false
  }, [beats])

  // ── Duration / view window ───────────────────────────────
  useEffect(() => {
    if (duration > 0) {
      setViewStart(0)
      setViewEnd(duration)
    }
  }, [duration])

  // ── Audio element ────────────────────────────────────────
  useEffect(() => {
    if (audioFile) {
      const url = URL.createObjectURL(audioFile)
      setAudioUrl(url)
      return () => URL.revokeObjectURL(url)
    }
    if (audioSrc) {
      setAudioUrl(audioSrc)
      return
    }
    setAudioUrl(null)
  }, [audioFile, audioSrc])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const onTime = () => setCurrentTime(audio.currentTime)
    const onEnded = () => setPlaying(false)
    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('ended', onEnded)
    return () => {
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('ended', onEnded)
    }
  }, [audioUrl])

  // Smooth playhead while playing
  useEffect(() => {
    if (!playing) {
      cancelAnimationFrame(rafRef.current)
      return
    }
    const tick = () => {
      if (audioRef.current) setCurrentTime(audioRef.current.currentTime)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [playing])

  // ── Resize ───────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setWidth(Math.floor(entry.contentRect.width))
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ── Coordinate helpers ───────────────────────────────────
  const viewDuration = Math.max(0.001, viewEnd - viewStart)

  const timeToX = useCallback(
    (t) => ((t - viewStart) / viewDuration) * width,
    [viewStart, viewDuration, width]
  )

  const xToTime = useCallback(
    (x) => {
      const t = viewStart + (x / width) * viewDuration
      return Math.max(0, Math.min(duration, t))
    },
    [viewStart, viewDuration, width, duration]
  )

  // Snap grid = 1/4 of a beat (16th notes) based on tempo
  const snapInterval = tempo > 0 ? 60 / tempo / 4 : 0.05

  function applySnap(t) {
    if (!snap || snapInterval <= 0) return t
    return Math.round(t / snapInterval) * snapInterval
  }

  // ── History helpers ──────────────────────────────────────
  function pushHistory(prevBeats) {
    setHistory((h) => [...h.slice(-29), prevBeats]) // keep last 30
  }

  function commitBeats(next, recordHistory = true) {
    if (recordHistory) {
      pushHistory(localBeats)
    }
    const sorted = [...next].sort((a, b) => a - b)
    setLocalBeats(sorted)
    historyLock.current = true
    onChange?.(sorted)
  }

  function undo() {
    setHistory((h) => {
      if (h.length === 0) return h
      const prev = h[h.length - 1]
      setLocalBeats(prev)
      historyLock.current = true
      onChange?.(prev)
      setSelectedIndex(null)
      return h.slice(0, -1)
    })
  }

  // ── Drawing ──────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !waveform) return

    const ctx = canvas.getContext('2d')
    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr
    canvas.height = height * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    // Background
    ctx.fillStyle = getCss('--secondary') || '#2a2a2a'
    ctx.fillRect(0, 0, width, height)

    // Center line
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'
    ctx.beginPath()
    ctx.moveTo(0, height / 2)
    ctx.lineTo(width, height / 2)
    ctx.stroke()

    // Waveform (only points inside view)
    const { times, values } = waveform
    if (times?.length && values?.length) {
      // Upper half
      ctx.beginPath()
      ctx.strokeStyle = 'rgba(250,250,250,0.38)'
      ctx.lineWidth = 1.2
      let started = false
      for (let i = 0; i < values.length; i++) {
        const t = times[i] ?? (i / values.length) * duration
        if (t < viewStart - 0.05 || t > viewEnd + 0.05) continue
        const x = timeToX(t)
        const amp = values[i] * (height * 0.42)
        const y = height / 2 - amp
        if (!started) { ctx.moveTo(x, y); started = true }
        else ctx.lineTo(x, y)
      }
      ctx.stroke()

      // Lower half (mirror)
      ctx.beginPath()
      ctx.strokeStyle = 'rgba(250,250,250,0.14)'
      started = false
      for (let i = 0; i < values.length; i++) {
        const t = times[i] ?? (i / values.length) * duration
        if (t < viewStart - 0.05 || t > viewEnd + 0.05) continue
        const x = timeToX(t)
        const amp = values[i] * (height * 0.42)
        const y = height / 2 + amp
        if (!started) { ctx.moveTo(x, y); started = true }
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
    }

    // Beat markers (only those in view)
    localBeats.forEach((t, i) => {
      if (t < viewStart - 0.02 || t > viewEnd + 0.02) return
      const x = timeToX(t)
      const isActive = i === dragIndex || i === hoverIndex || i === selectedIndex

      ctx.beginPath()
      ctx.strokeStyle = isActive ? '#fafafa' : 'rgba(250,250,250,0.55)'
      ctx.lineWidth = isActive ? 2 : 1
      ctx.moveTo(x, 0)
      ctx.lineTo(x, height)
      ctx.stroke()

      // Handle
      ctx.beginPath()
      ctx.fillStyle = isActive ? '#fafafa' : 'rgba(250,250,250,0.75)'
      ctx.arc(x, 10, isActive ? 5 : 3.5, 0, Math.PI * 2)
      ctx.fill()
    })

    // Playhead
    if (currentTime >= viewStart && currentTime <= viewEnd) {
      const px = timeToX(currentTime)
      ctx.beginPath()
      ctx.strokeStyle = '#ff7a84'
      ctx.lineWidth = 1.5
      ctx.moveTo(px, 0)
      ctx.lineTo(px, height)
      ctx.stroke()
    }
  }, [
    waveform, localBeats, width, height, duration,
    viewStart, viewEnd, timeToX, dragIndex, hoverIndex,
    selectedIndex, currentTime,
  ])

  function getCss(varName) {
    return getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
  }

  // ── Pointer interaction (beats only) ─────────────────────
  function findBeatAt(x, threshold = 8) {
    let best = -1
    let bestDist = threshold
    localBeats.forEach((t, i) => {
      if (t < viewStart || t > viewEnd) return
      const dist = Math.abs(timeToX(t) - x)
      if (dist < bestDist) {
        bestDist = dist
        best = i
      }
    })
    return best
  }

  function handlePointerDown(e) {
    // Ignore if this is a right-click or middle-click
    if (e.button !== 0) return

    const rect = canvasRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const idx = findBeatAt(x)

    if (idx >= 0) {
      setDragIndex(idx)
      setSelectedIndex(idx)
      canvasRef.current.setPointerCapture(e.pointerId)
    } else {
      // Add beat
      let t = applySnap(xToTime(x))
      const next = [...localBeats, t]
      commitBeats(next)
      // Select the newly added beat
      const sorted = [...next].sort((a, b) => a - b)
      setSelectedIndex(sorted.indexOf(t))
    }
  }

  function handlePointerMove(e) {
    const rect = canvasRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left

    if (dragIndex === null) {
      setHoverIndex(findBeatAt(x))
      return
    }

    let t = applySnap(xToTime(x))
    setLocalBeats((prev) => {
      const next = [...prev]
      next[dragIndex] = t
      return next
    })
  }

  function handlePointerUp() {
    if (dragIndex !== null) {
      commitBeats(localBeats)
      const sorted = [...localBeats].sort((a, b) => a - b)
      // Re-find selected after sort
      const moved = localBeats[dragIndex]
      const newIdx = sorted.findIndex((t) => Math.abs(t - moved) < 0.0005)
      setSelectedIndex(newIdx >= 0 ? newIdx : null)
    }
    setDragIndex(null)
  }

  // ── Zoom (wheel) ─────────────────────────────────────────
  function handleWheel(e) {
    e.preventDefault()
    const rect = canvasRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const pivot = xToTime(x)

    const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15
    let newDur = viewDuration * factor
    // Limits
    newDur = Math.max(0.5, Math.min(duration, newDur))

    let newStart = pivot - (pivot - viewStart) * (newDur / viewDuration)
    let newEnd = newStart + newDur

    if (newStart < 0) {
      newStart = 0
      newEnd = newDur
    }
    if (newEnd > duration) {
      newEnd = duration
      newStart = Math.max(0, duration - newDur)
    }

    setViewStart(newStart)
    setViewEnd(newEnd)
  }

  // ── Keyboard ─────────────────────────────────────────────
  function handleKeyDown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      e.preventDefault()
      undo()
      return
    }
    if (selectedIndex === null) return
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      const next = localBeats.filter((_, i) => i !== selectedIndex)
      commitBeats(next)
      setSelectedIndex(null)
    }
  }

  // ── Playback controls ────────────────────────────────────
  function togglePlay() {
    const audio = audioRef.current
    if (!audio) return
    if (playing) {
      audio.pause()
      setPlaying(false)
    } else {
      audio.play()
      setPlaying(true)
    }
  }

  // ── Seek bar (independent from beat dragging) ────────────
  function seekFromEvent(e) {
    const el = progressRef.current
    if (!el || !duration) return
    const rect = el.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const t = ratio * duration
    setCurrentTime(t)
    if (audioRef.current) {
      audioRef.current.currentTime = t
    }
  }

  function onSeekPointerDown(e) {
    setSeeking(true)
    seekFromEvent(e)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function onSeekPointerMove(e) {
    if (!seeking) return
    seekFromEvent(e)
  }

  function onSeekPointerUp() {
    setSeeking(false)
  }

  function formatTime(s) {
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  const zoomPercent = duration > 0 ? Math.round((duration / viewDuration) * 100) : 100

  return (
    <div className={cn('space-y-3', className)}>
      {/* Hidden audio element */}
      {audioUrl && (
        <audio ref={audioRef} src={audioUrl} preload="auto" />
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={togglePlay}
          disabled={!audioUrl}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-secondary text-sm hover:bg-accent transition-colors disabled:opacity-40"
          title="Play / Pause"
        >
          {playing ? <Pause size={14} /> : <Play size={14} />}
          {playing ? 'Pause' : 'Play'}
        </button>

        <button
          type="button"
          onClick={undo}
          disabled={history.length === 0}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-secondary text-sm hover:bg-accent transition-colors disabled:opacity-40"
          title="Undo (Ctrl+Z)"
        >
          <Undo2 size={14} />
          Undo
        </button>

        <button
          type="button"
          onClick={() => setSnap((s) => !s)}
          className={cn(
            'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors',
            snap
              ? 'bg-primary text-primary-foreground'
              : 'bg-secondary hover:bg-accent'
          )}
          title="Snap to beat grid"
        >
          <Magnet size={14} />
          Snap
        </button>

        <div className="ml-auto text-xs text-muted-foreground tabular-nums">
          {formatTime(currentTime)} / {formatTime(duration)}
          {zoomPercent > 100 && (
            <span className="ml-3 opacity-70">Zoom {zoomPercent}%</span>
          )}
        </div>
      </div>

      {/* Waveform canvas */}
      <div
        ref={containerRef}
        className="relative w-full rounded-md overflow-hidden border border-border bg-secondary/40 focus:outline-none focus:ring-1 focus:ring-ring"
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        <canvas
          ref={canvasRef}
          style={{
            margin: 0,
            width: '100%',
            height,
            display: 'block',
            cursor: dragIndex !== null ? 'grabbing' : 'crosshair',
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={() => {
            setHoverIndex(null)
            if (dragIndex !== null) handlePointerUp()
          }}
          onWheel={handleWheel}
        />
      </div>

      {/* Seek bar – separate from beat interaction */}
      <div
        ref={progressRef}
        className="relative h-3 rounded-full bg-secondary cursor-pointer group"
        onPointerDown={onSeekPointerDown}
        onPointerMove={onSeekPointerMove}
        onPointerUp={onSeekPointerUp}
        title="Seek"
      >
        {/* Buffered / full track already bg-secondary */}
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-primary/70 group-hover:bg-primary/90 transition-colors"
          style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }}
        />
        {/* Thumb */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-primary shadow opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ left: `calc(${duration ? (currentTime / duration) * 100 : 0}% - 6px)` }}
        />
      </div>

      {/* Status line */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {localBeats.length} beats
          {selectedIndex !== null && (
            <> · selected #{selectedIndex + 1} ({localBeats[selectedIndex]?.toFixed(3)}s)</>
          )}
        </span>
        <span>
          Scroll to zoom · Click empty to add · Drag to move · Del to remove
        </span>
      </div>
    </div>
  )
}
