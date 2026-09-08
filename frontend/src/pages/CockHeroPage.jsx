import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { usePersistentState } from '../hooks/usePersistentState'
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Eye,
  Download,
  Heart,
  Volume2,
  VolumeX,
} from 'lucide-react'
import VideoModal from '../components/VideoModal'
import { playClick, playTap, playStart, playDone, playError } from '../lib/sounds'

async function nativePick(endpoint, params = {}) {
  const qs = new URLSearchParams(params).toString()
  const url = qs ? `/api${endpoint}?${qs}` : `/api${endpoint}`
  const res = await fetch(url, { method: 'POST' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || res.statusText)
  }
  return res.json()
}

const DEFAULTS = {
  circle_color: '#ff4da6',
  bar_height_pct: 10,
  margin_bottom_pct: 4,
  hit_zone_x_pct: 50,
  circle_radius_pct: 1.8,
  bar_opacity: 0.55,
  lookahead: 3,
  beat_mode: 'full',
  thin_dist: 0.4,
  sound_enabled: true,
  sound_preset: 'tick',
  sound_volume: 0.7,
  cuda: false,
}

export default function CockHeroPage() {
  const [params] = useSearchParams()
  const sessionFromUrl = params.get('session')

  const [savedSession, setSavedSession] = usePersistentState('pmvforge:cockhero-session', '')
  const [sessionId, setSessionId] = useState(sessionFromUrl || savedSession || '')
  const [session, setSession] = useState(null)
  const [form, setForm] = usePersistentState('pmvforge:cockhero-form', { ...DEFAULTS })
  const [previewUrl, setPreviewUrl] = useState(null)
  const [previewBusy, setPreviewBusy] = useState(false)
  const [jobId, setJobId] = useState(null)
  const [status, setStatus] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [manualVideo, setManualVideo] = useState('')
  const [manualBeats, setManualBeats] = useState('')
  const [manualBusy, setManualBusy] = useState(false)

  const pollRef = useRef(null)
  const debounceRef = useRef(null)

  function update(key, value, { silent } = {}) {
    if (!silent) playClick()
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  

  useEffect(() => {
    if (sessionFromUrl) {
      setSessionId(sessionFromUrl)
      setSavedSession(sessionFromUrl)
    }
  }, [sessionFromUrl])

  useEffect(() => {
    if (sessionId) setSavedSession(sessionId)
  }, [sessionId])

  // load session
  useEffect(() => {
    if (!sessionId) return
    fetch(`/api/cockhero/session/${sessionId}`)
      .then((r) => {
        if (!r.ok) throw new Error('Session not found')
        return r.json()
      })
      .then((data) => {
        setSession(data)
        setError(null)
      })
      .catch((e) => setError(e.message))
  }, [sessionId])

  // live preview (debounced)
  const refreshPreview = useCallback(() => {
    if (!sessionId) return
    setPreviewBusy(true)
    fetch('/api/cockhero/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: sessionId,
        circle_color: form.circle_color,
        bar_height_pct: form.bar_height_pct,
        margin_bottom_pct: form.margin_bottom_pct,
        hit_zone_x_pct: form.hit_zone_x_pct,
        circle_radius_pct: form.circle_radius_pct,
        bar_opacity: form.bar_opacity,
      }),
    })
      .then(async (r) => {
        if (!r.ok) {
          const err = await r.json().catch(() => ({}))
          throw new Error(err.detail || `Preview failed (${r.status})`)
        }
        return r.blob()
      })
      .then((blob) => {
        setPreviewUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev)
          return URL.createObjectURL(blob)
        })
        setError(null)
      })
      .catch((e) => {
        setError(e.message || 'Preview failed')
      })
      .finally(() => setPreviewBusy(false))
  }, [sessionId, form.circle_color, form.bar_height_pct, form.margin_bottom_pct, form.hit_zone_x_pct, form.circle_radius_pct, form.bar_opacity])

  useEffect(() => {
    if (!sessionId) return
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(refreshPreview, 280)
    return () => clearTimeout(debounceRef.current)
  }, [refreshPreview, sessionId])

  async function startRender() {
    if (!sessionId) return
    setError(null)
    setSubmitting(true)
    setStatus(null)
    setJobId(null)
    playStart()
    try {
      const res = await fetch('/api/cockhero/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, ...form }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || res.statusText)
      }
      const data = await res.json()
      setJobId(data.job_id)
      setStatus(data)
    } catch (e) {
      playError()
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  useEffect(() => {
    if (!jobId) return
    function poll() {
      fetch(`/api/cockhero/status/${jobId}`)
        .then((r) => r.json())
        .then((data) => {
          setStatus(data)
          if (data.status === 'finished' || data.status === 'error') {
            clearInterval(pollRef.current)
            if (data.status === 'finished' && data.result?.success) playDone()
            else if (data.status === 'error') playError()
          }
        })
        .catch(() => {})
    }
    poll()
    pollRef.current = setInterval(poll, 1500)
    return () => clearInterval(pollRef.current)
  }, [jobId])

  const isRunning = status && (status.status === 'queued' || status.status === 'running')
  const videoUrl =
    status?.status === 'finished' && status?.result?.output_video && jobId
      ? `/api/cockhero/video/${jobId}`
      : null

  async function startFromFiles() {
    if (!manualVideo || !manualBeats) return
    setManualBusy(true)
    setError(null)
    playStart()
    try {
      const res = await fetch('/api/cockhero/from-files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          video_path: manualVideo,
          beats_path: manualBeats,
          original_beats_path: manualBeats,
          label: manualVideo.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, '') || 'pmv',
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || res.statusText)
      }
      const data = await res.json()
      setSessionId(data.session_id)
      setSavedSession(data.session_id)
      playDone()
    } catch (e) {
      playError()
      setError(e.message)
    } finally {
      setManualBusy(false)
    }
  }

  if (!sessionId) {
    return (
      <div className="space-y-6">
        <header>
          <h1 className="font-serif text-3xl tracking-tight">Cock Hero</h1>
          <p className="text-muted-foreground mt-1">
            Burn a beatbar onto any PMV. Import files below, or use Create Cock Hero after Generate.
          </p>
        </header>

        <section className="rounded-lg border border-border bg-card p-6 space-y-4">
          <h2 className="font-serif text-lg">Start from existing files</h2>
          <p className="text-sm text-muted-foreground">
            Pick a finished PMV video and its beatmap (.osu / .txt).
          </p>
          <div className="flex gap-2 items-center">
            <span className="text-sm text-muted-foreground w-20 shrink-0">Video</span>
            <span className="flex-1 text-sm font-mono truncate text-muted-foreground">
              {manualVideo || '—'}
            </span>
            <button
              type="button"
              className="px-3 py-1.5 rounded-md bg-secondary text-sm hover:bg-accent"
              onClick={async () => {
                try {
                  const d = await nativePick('/system/pick-file', { kind: 'any', title: 'Select PMV video' })
                  if (!d.cancelled && d.path) { setManualVideo(d.path); playClick() }
                } catch (e) { setError(e.message) }
              }}
            >
              Browse
            </button>
          </div>
          <div className="flex gap-2 items-center">
            <span className="text-sm text-muted-foreground w-20 shrink-0">Beats</span>
            <span className="flex-1 text-sm font-mono truncate text-muted-foreground">
              {manualBeats || '—'}
            </span>
            <button
              type="button"
              className="px-3 py-1.5 rounded-md bg-secondary text-sm hover:bg-accent"
              onClick={async () => {
                try {
                  const d = await nativePick('/system/pick-file', { kind: 'beat', title: 'Select beatmap' })
                  if (!d.cancelled && d.path) { setManualBeats(d.path); playClick() }
                } catch (e) { setError(e.message) }
              }}
            >
              Browse
            </button>
          </div>
          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              disabled={!manualVideo || !manualBeats || manualBusy}
              onClick={startFromFiles}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-pink-500 hover:bg-pink-400 text-white text-sm font-medium disabled:opacity-50"
            >
              {manualBusy ? <Loader2 size={16} className="animate-spin" /> : <Heart size={16} />}
              Open in Cock Hero
            </button>
            <Link to="/generate" className="text-sm text-muted-foreground hover:text-foreground">
              or generate a new PMV →
            </Link>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </section>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-serif text-3xl tracking-tight">Cock Hero</h1>
        <p className="text-muted-foreground mt-1">
          {session?.label || 'Beatbar session'}
          {session?.duration ? ` · ${session.duration.toFixed(1)}s` : ''}
        </p>
      </header>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Preview */}
        <section className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-serif text-lg">Preview</h2>
            {previewBusy && <Loader2 size={14} className="animate-spin text-muted-foreground" />}
          </div>
          <div className="relative aspect-video bg-black rounded-md overflow-hidden flex items-center justify-center">
            {previewUrl ? (
              <img src={previewUrl} alt="Beatbar preview" className="max-w-full max-h-full object-contain" />
            ) : (
              <span className="text-xs text-muted-foreground">Loading frame…</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            First-frame mock of bar, hit zone & approaching notes. Not the final encode.
          </p>
        </section>

        {/* Settings */}
        <section className="rounded-lg border border-border bg-card p-6 space-y-5">
          <h2 className="font-serif text-lg">Beatbar</h2>

          <div>
            <label className="block text-sm text-muted-foreground mb-1.5">Circle color</label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={form.circle_color}
                onChange={(e) => update('circle_color', e.target.value, { silent: true })}
                className="h-9 w-12 rounded cursor-pointer bg-transparent border border-border"
              />
              <input
                type="text"
                value={form.circle_color}
                onChange={(e) => update('circle_color', e.target.value, { silent: true })}
                className="flex-1 px-3 py-2 rounded-md bg-secondary border border-border text-sm font-mono"
              />
            </div>
          </div>

          <Slider
            label={`Bar height · ${form.bar_height_pct}%`}
            min={4}
            max={25}
            step={0.5}
            value={form.bar_height_pct}
            onChange={(v) => update('bar_height_pct', v, { silent: true })}
          />
          <Slider
            label={`Bottom margin · ${form.margin_bottom_pct}%`}
            min={0}
            max={20}
            step={0.5}
            value={form.margin_bottom_pct}
            onChange={(v) => update('margin_bottom_pct', v, { silent: true })}
          />
          <Slider
            label={`Hit zone X · ${form.hit_zone_x_pct}%`}
            min={20}
            max={80}
            step={1}
            value={form.hit_zone_x_pct}
            onChange={(v) => update('hit_zone_x_pct', v, { silent: true })}
          />
          <Slider
            label={`Circle size · ${form.circle_radius_pct}%`}
            min={0.8}
            max={4}
            step={0.1}
            value={form.circle_radius_pct}
            onChange={(v) => update('circle_radius_pct', v, { silent: true })}
          />
          <Slider
            label={`Bar opacity · ${Math.round(form.bar_opacity * 100)}%`}
            min={0.15}
            max={0.9}
            step={0.05}
            value={form.bar_opacity}
            onChange={(v) => update('bar_opacity', v, { silent: true })}
          />
          <Slider
            label={`Lookahead · ${form.lookahead}s`}
            min={1}
            max={8}
            step={0.25}
            value={form.lookahead}
            onChange={(v) => update('lookahead', v, { silent: true })}
          />
        </section>
      </div>

      {/* Beats + sound */}
      <section className="rounded-lg border border-border bg-card p-6 space-y-5">
        <h2 className="font-serif text-lg">Beats & sound</h2>

        <div>
          <label className="block text-sm text-muted-foreground mb-2">Beat source</label>
          <div className="flex flex-wrap gap-2">
            <Chip
              active={form.beat_mode === 'full'}
              onClick={() => update('beat_mode', 'full')}
              label={`Full map${session ? ` (${session.beat_count_full})` : ''}`}
            />
            <Chip
              active={form.beat_mode === 'thinned'}
              onClick={() => update('beat_mode', 'thinned')}
              label={`Thinned${session ? ` (~${session.beat_count_thinned})` : ''}`}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Full uses original beatmap timings. Thinned matches the spacing used for PMV clips.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={() => update('sound_enabled', !form.sound_enabled)}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-secondary text-sm hover:bg-accent transition-colors"
          >
            {form.sound_enabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
            {form.sound_enabled ? 'Click track on' : 'Visual only'}
          </button>
          {form.sound_enabled && (
            <>
              {['tick', 'wood', 'kick'].map((p) => (
                <Chip
                  key={p}
                  active={form.sound_preset === p}
                  onClick={() => update('sound_preset', p)}
                  label={p}
                />
              ))}
              <div className="flex items-center gap-2 min-w-[160px]">
                <span className="text-xs text-muted-foreground">Vol</span>
                <input
                  type="range"
                  min={0.1}
                  max={1}
                  step={0.05}
                  value={form.sound_volume}
                  onChange={(e) => update('sound_volume', parseFloat(e.target.value), { silent: true })}
                  className="flex-1"
                />
              </div>
            </>
          )}
        </div>
      </section>

      <div className="flex items-center gap-4">
        <button
          onClick={() => {
            playTap()
            startRender()
          }}
          disabled={submitting || isRunning}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md bg-pink-500 hover:bg-pink-400 text-white text-sm font-medium disabled:opacity-50 transition-colors"
        >
          {submitting || isRunning ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Rendering…
            </>
          ) : (
            <>
              <Heart size={16} />
              Render Cock Hero
            </>
          )}
        </button>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      {status && (
        <section className="rounded-lg border border-border bg-card p-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              {status.status === 'finished' && <CheckCircle2 className="text-green-500" size={20} />}
              {status.status === 'error' && <XCircle className="text-destructive" size={20} />}
              {(status.status === 'queued' || status.status === 'running') && (
                <Loader2 className="animate-spin text-muted-foreground" size={20} />
              )}
              <div>
                <h2 className="font-serif text-lg capitalize">{status.status}</h2>
                <p className="text-sm text-muted-foreground">{status.message}</p>
                {(status.elapsed_seconds || status.result?.elapsed_seconds) && status.status === 'finished' && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Generated in {(status.elapsed_seconds || status.result.elapsed_seconds).toFixed(1)}s
                  </p>
                )}
              </div>
            </div>
            {videoUrl && (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    playTap()
                    setPreviewOpen(true)
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-secondary text-sm hover:bg-accent transition-colors"
                >
                  <Eye size={14} /> View
                </button>
                <a
                  href={`/api/cockhero/download/${jobId}`}
                  onClick={() => playTap()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-secondary text-sm hover:bg-accent transition-colors"
                >
                  <Download size={14} /> Download
                </a>
              </div>
            )}
          </div>
          {(status.status === 'running' || status.status === 'queued') && (
            <div className="w-full h-2 rounded-full bg-secondary overflow-hidden">
              <div
                className="h-full bg-pink-500/80 transition-all duration-500"
                style={{ width: `${Math.round((status.progress || 0) * 100)}%` }}
              />
            </div>
          )}
          {status.result?.output_video && (
            <p className="font-mono text-xs break-all text-muted-foreground">
              {status.result.output_video}
            </p>
          )}
        </section>
      )}

      {previewOpen && videoUrl && (
        <VideoModal
          src={videoUrl}
          title={status?.result?.output_video?.split(/[/\\]/).pop()}
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </div>
  )
}

function Slider({ label, min, max, step, value, onChange }) {
  return (
    <div>
      <label className="block text-sm text-muted-foreground mb-1.5">{label}</label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full"
      />
    </div>
  )
}

function Chip({ active, onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? 'px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium capitalize'
          : 'px-3 py-1.5 rounded-md bg-secondary text-sm hover:bg-accent transition-colors capitalize'
      }
    >
      {label}
    </button>
  )
}
