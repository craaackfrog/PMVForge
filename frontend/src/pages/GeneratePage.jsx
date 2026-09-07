import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePersistentState } from '../hooks/usePersistentState'
import {
  Film,
  Loader2,
  CheckCircle2,
  XCircle,
  Monitor,
  Smartphone,
  Eye,
  FolderOpen,
  Files,
  Download,
  FileAudio,
  Music2,
  Heart,
  Library,
  Tag,
} from 'lucide-react'
import VideoModal from '../components/VideoModal'
import { playClick, playTap, playStart, playDone, playError } from '../lib/sounds'

const DEFAULTS = {
  clip_dist: 0.4,
  aspect: '16:9',
  quality: 'hd',
  zoom_to_fill: false,
  face_center: false,
  clip_order: 'random',
  fps: 30,
  bitrate: '',
  threads: 4,
  cuda: false,
  debug: false,
  num_vids: 0,
  recurse: false,
  effects: {
    enabled: false,
    soft_pulse: true,
    soft_pulse_strength: 0.12,
    flash: false,
    flash_strength: 0.55,
    flash_max_per_sec: 8,
    zoom_punch: true,
    zoom_punch_amount: 1.06,
    rgb_split: false,
    rgb_split_px: 4,
    pink_glow: false,
    pink_glow_strength: 0.35,
    pink_glow_saturation: 1.15,
    tonemap: 'none',
    lut_path: '',
  },
}

const QUALITY_LABELS = { hd: 'HD', fhd: 'Full HD', '4k': '4K' }
const RES_HINT = {
  '16:9': { hd: '1280×720', fhd: '1920×1080', '4k': '3840×2160' },
  '9:16': { hd: '720×1280', fhd: '1080×1920', '4k': '2160×3840' },
}

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

function chipClass(active) {
  return active
    ? 'inline-flex items-center gap-2 px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium'
    : 'inline-flex items-center gap-2 px-3 py-2 rounded-md bg-secondary text-sm hover:bg-accent transition-colors'
}

export default function GeneratePage() {
  const navigate = useNavigate()
  const [draft, setDraft] = usePersistentState('pmvforge:generate', {
    form: { ...DEFAULTS },
    beatPath: '',
    songPath: '',
    clipMode: 'all', // all | pick | library
    videoFolder: '',
    videoPaths: [],
    outputFolder: '',
    libraryId: '',
    libraryTags: [],
    libraryTagMode: 'any',
    libraryMinHeat: 1,
  })
  const form = draft.form || DEFAULTS
  const beatPath = draft.beatPath || ''
  const songPath = draft.songPath || ''
  const clipMode = draft.clipMode || 'all'
  const videoFolder = draft.videoFolder || ''
  const videoPaths = draft.videoPaths || []
  const outputFolder = draft.outputFolder || ''
  const libraryId = draft.libraryId || ''
  const libraryTags = draft.libraryTags || []
  const libraryTagMode = draft.libraryTagMode || 'any'
  const libraryMinHeat = draft.libraryMinHeat ?? 1






  const updateEffect = (key, value) => {
    setForm((f) => ({
      ...f,
      effects: { ...(f.effects || {}), [key]: value },
    }))
    playClick()
  }

  const setForm = (updater) =>
    setDraft((d) => ({
      ...d,
      form: typeof updater === 'function' ? updater(d.form || DEFAULTS) : updater,
    }))
  const setBeatPath = (v) => setDraft((d) => ({ ...d, beatPath: v }))
  const setSongPath = (v) => setDraft((d) => ({ ...d, songPath: v }))
  const setClipMode = (v) => setDraft((d) => ({ ...d, clipMode: v }))
  const setVideoFolder = (v) => setDraft((d) => ({ ...d, videoFolder: v }))
  const setVideoPaths = (v) => setDraft((d) => ({ ...d, videoPaths: v }))
  const setOutputFolder = (v) => setDraft((d) => ({ ...d, outputFolder: v }))

  // Apply Settings defaults once when form still looks like hard-coded DEFAULTS
  useEffect(() => {
    let cancelled = false
    fetch('/api/system/settings')
      .then((r) => r.json())
      .then((data) => {
        if (cancelled || !data.settings) return
        const s = data.settings
        setDraft((d) => {
          const f = { ...(d.form || {}) }
          // only fill keys that still match package DEFAULTS to avoid clobbering user session
          if (s.default_cuda != null) f.cuda = !!s.default_cuda
          if (s.default_fps) f.fps = s.default_fps
          if (s.default_threads) f.threads = s.default_threads
          if (s.default_batch_size) f.batch_size = s.default_batch_size
          if (s.default_clip_dist != null) f.clip_dist = s.default_clip_dist
          if (s.default_volume != null) f.volume = s.default_volume
          if (s.default_aspect) f.aspect = s.default_aspect
          if (s.default_quality) f.quality = s.default_quality
          if (s.default_clip_order) f.clip_order = s.default_clip_order
          if (s.default_zoom_to_fill != null) f.zoom_to_fill = !!s.default_zoom_to_fill
          const next = { ...d, form: f }
          if (s.default_output_folder && !d.outputFolder) {
            next.outputFolder = s.default_output_folder
          }
          return next
        })
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const setLibraryId = (v) => setDraft((d) => ({ ...d, libraryId: v }))
  const setLibraryTags = (v) => setDraft((d) => ({ ...d, libraryTags: v }))
  const setLibraryTagMode = (v) => setDraft((d) => ({ ...d, libraryTagMode: v }))
  const setLibraryMinHeat = (v) => setDraft((d) => ({ ...d, libraryMinHeat: v }))

  const [libraries, setLibraries] = useState([])
  const [libTagVocab, setLibTagVocab] = useState([])
  const [libPreviewCount, setLibPreviewCount] = useState(null)

  useEffect(() => {
    fetch('/api/libraries')
      .then((r) => r.json())
      .then((data) => {
        setLibraries(data.libraries || [])
        setLibTagVocab(data.all_tags || [])
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (clipMode !== 'library' || !libraryId) {
      setLibPreviewCount(null)
      return
    }
    fetch(`/api/libraries/${libraryId}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tags: libraryTags,
        tag_mode: libraryTagMode,
        min_heat: libraryMinHeat,
        max_heat: 5,
        limit: 0,
      }),
    })
      .then((r) => r.json())
      .then((data) => setLibPreviewCount(data.total ?? (data.clips || []).length))
      .catch(() => setLibPreviewCount(null))
  }, [clipMode, libraryId, libraryTags, libraryTagMode, libraryMinHeat])

  const [jobId, setJobId] = useState(null)
  const [status, setStatus] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [picking, setPicking] = useState(null)
  const [error, setError] = useState(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const pollRef = useRef(null)
  const prevStatusRef = useRef(null)

  function update(key, value, { silent } = {}) {
    if (!silent) playClick()
    setForm((prev) => {
      const next = { ...prev, [key]: value }
      if (key === 'aspect' && value === '9:16') {
        if (!prev.zoom_to_fill) next.zoom_to_fill = true
        if (!prev.face_center) next.face_center = true
      }
      return next
    })
  }

  async function browseBeat() {
    setPicking('beat')
    try {
      const data = await nativePick('/system/pick-file', { kind: 'beat', title: 'Select beatmap' })
      if (!data.cancelled && data.path) { setBeatPath(data.path); playClick() }
    } catch (e) { setError(e.message); playError() }
    finally { setPicking(null) }
  }

  async function browseSong() {
    setPicking('song')
    try {
      const data = await nativePick('/system/pick-file', { kind: 'audio', title: 'Select song' })
      if (!data.cancelled && data.path) { setSongPath(data.path); playClick() }
    } catch (e) { setError(e.message); playError() }
    finally { setPicking(null) }
  }

  async function browseVideoFolder() {
    setPicking('vfolder')
    try {
      const data = await nativePick('/system/pick-folder', { title: 'Select clips folder' })
      if (!data.cancelled && data.path) { setVideoFolder(data.path); setVideoPaths([]); playClick() }
    } catch (e) { setError(e.message); playError() }
    finally { setPicking(null) }
  }

  async function browseClips() {
    setPicking('clips')
    try {
      const data = await nativePick('/system/pick-files', { kind: 'video', title: 'Select video clips' })
      if (!data.cancelled && data.paths?.length) { setVideoPaths(data.paths); setVideoFolder(''); playClick() }
    } catch (e) { setError(e.message); playError() }
    finally { setPicking(null) }
  }

  async function browseOutput() {
    setPicking('out')
    try {
      const data = await nativePick('/system/pick-folder', { title: 'Select output folder' })
      if (!data.cancelled && data.path) { setOutputFolder(data.path); playClick() }
    } catch (e) { setError(e.message); playError() }
    finally { setPicking(null) }
  }

  async function startJob() {
    const hasClips =
      (clipMode === 'all' && videoFolder) ||
      (clipMode === 'pick' && videoPaths.length > 0) ||
      (clipMode === 'library' && libraryId)
    if (!beatPath || !hasClips) return
    setError(null)
    setSubmitting(true)
    setStatus(null)
    setJobId(null)
    setPreviewOpen(false)
    playStart()
    try {
      let video_paths = clipMode === 'pick' ? videoPaths : []
      let video_folder = clipMode === 'all' ? videoFolder : ''

      if (clipMode === 'library') {
        const q = await fetch(`/api/libraries/${libraryId}/query`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tags: libraryTags,
            tag_mode: libraryTagMode,
            min_heat: libraryMinHeat,
            max_heat: 5,
            limit: form.num_vids || 0,
          }),
        })
        if (!q.ok) throw new Error('Library query failed')
        const data = await q.json()
        video_paths = data.paths || (data.clips || []).map((c) => c.path)
        if (!video_paths.length) throw new Error('No clips matched library filters')
        video_folder = ''
      }

      const payload = {
        beat_input: beatPath,
        video_folder,
        video_paths,
        output_folder: outputFolder || '',
        song_path: songPath || null,
        ...form,
        bitrate: form.bitrate || null,
      }
      const res = await fetch('/api/generate/start-paths', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        const detail = err.detail
        throw new Error(typeof detail === 'string' ? detail : res.statusText)
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
      fetch(`/api/generate/status/${jobId}`)
        .then((r) => r.json())
        .then((data) => {
          setStatus(data)
          if (data.status === 'finished' || data.status === 'error') clearInterval(pollRef.current)
        })
        .catch(() => {})
    }
    poll()
    pollRef.current = setInterval(poll, 1500)
    return () => clearInterval(pollRef.current)
  }, [jobId])

  useEffect(() => {
    if (!status) return
    const prev = prevStatusRef.current
    prevStatusRef.current = status.status
    if (prev === status.status) return
    if (status.status === 'finished' && status.result?.success) playDone()
    else if (status.status === 'error') playError()
  }, [status])

  const isRunning = status && (status.status === 'queued' || status.status === 'running')
  const resHint = RES_HINT[form.aspect]?.[form.quality] || ''
  const videoUrl =
    status?.status === 'finished' && status?.result?.output_video && jobId
      ? `/api/generate/video/${jobId}`
      : null
  const canStart =
    beatPath &&
    ((clipMode === 'all' && videoFolder) ||
      (clipMode === 'pick' && videoPaths.length > 0) ||
      (clipMode === 'library' && libraryId))

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-serif text-3xl tracking-tight">Generate PMV</h1>
        <p className="text-muted-foreground mt-1">
          Paths stay on disk — native pickers, no uploading.
        </p>
      </header>

<section className="rounded-lg border border-border bg-card p-6 space-y-5">
        <h2 className="font-serif text-lg">Inputs</h2>
        <PathRow label="Beatmap" value={beatPath} placeholder="Select a .osu / .funscript / .txt…" onBrowse={browseBeat} onClear={() => setBeatPath('')} busy={picking === 'beat'} icon={Music2} />
        <PathRow label="Song override (optional)" value={songPath} placeholder="Only if audio isn’t next to the beatmap…" onBrowse={browseSong} onClear={() => setSongPath('')} busy={picking === 'song'} icon={FileAudio} />

        <div>
          <label className="block text-sm text-muted-foreground mb-2">Source clips</label>
          <div className="flex flex-wrap gap-2 mb-3">
            <button type="button" onClick={() => { playClick(); setClipMode('all') }} className={chipClass(clipMode === 'all')}>
              <FolderOpen size={16} /> All clips
            </button>
            <button type="button" onClick={() => { playClick(); setClipMode('pick') }} className={chipClass(clipMode === 'pick')}>
              <Files size={16} /> Pick clips
            </button>
            <button type="button" onClick={() => { playClick(); setClipMode('library') }} className={chipClass(clipMode === 'library')}>
              <Library size={16} /> Library
            </button>
          </div>
          {clipMode === 'all' ? (
            <PathRow value={videoFolder} placeholder="Select a folder of clips…" onBrowse={browseVideoFolder} onClear={() => setVideoFolder('')} busy={picking === 'vfolder'} icon={FolderOpen} />
          ) : clipMode === 'pick' ? (
            <div className="space-y-2">
              <PathRow value={videoPaths.length ? `${videoPaths.length} clip${videoPaths.length === 1 ? '' : 's'} selected` : ''} placeholder="Select individual clips…" onBrowse={browseClips} onClear={() => setVideoPaths([])} busy={picking === 'clips'} icon={Files} />
              {videoPaths.length > 0 && (
                <div className="max-h-28 overflow-auto rounded-md bg-secondary/40 px-3 py-2 text-xs text-muted-foreground space-y-0.5 font-mono">
                  {videoPaths.slice(0, 40).map((p) => (<div key={p} className="truncate">{p}</div>))}
                  {videoPaths.length > 40 && <div>…and {videoPaths.length - 40} more</div>}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3 rounded-md border border-border bg-secondary/20 p-3">
              <div>
                <label className="text-xs text-muted-foreground">Library</label>
                <select
                  value={libraryId}
                  onChange={(e) => { playClick(); setLibraryId(e.target.value) }}
                  className="mt-1 w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm"
                >
                  <option value="">Select library…</option>
                  {libraries.map((lib) => (
                    <option key={lib.id} value={lib.id}>
                      {lib.name} ({lib.clip_count} clips)
                    </option>
                  ))}
                </select>
                {libraries.length === 0 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    No libraries yet — create one under Libraries.
                  </p>
                )}
              </div>
              {libraryId && (
                <>
                  <div className="flex flex-wrap gap-1.5">
                    {libTagVocab.slice(0, 24).map((tag) => {
                      const on = libraryTags.includes(tag)
                      return (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => {
                            playClick()
                            setLibraryTags(
                              on ? libraryTags.filter((t) => t !== tag) : [...libraryTags, tag]
                            )
                          }}
                          className={
                            on
                              ? 'px-2 py-0.5 rounded-full text-xs bg-primary text-primary-foreground'
                              : 'px-2 py-0.5 rounded-full text-xs bg-secondary hover:bg-accent'
                          }
                        >
                          {tag}
                        </button>
                      )
                    })}
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span>Match</span>
                    {['any', 'all'].map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => { playClick(); setLibraryTagMode(m) }}
                        className={
                          libraryTagMode === m
                            ? 'px-2 py-0.5 rounded bg-primary text-primary-foreground'
                            : 'px-2 py-0.5 rounded bg-secondary'
                        }
                      >
                        {m}
                      </button>
                    ))}
                    <span className="ml-2">Min heat</span>
                    {[1, 2, 3, 4, 5].map((h) => (
                      <button
                        key={h}
                        type="button"
                        onClick={() => { playClick(); setLibraryMinHeat(h) }}
                        className={
                          libraryMinHeat === h
                            ? 'w-6 h-6 rounded bg-orange-500 text-white text-[10px]'
                            : 'w-6 h-6 rounded bg-secondary text-[10px]'
                        }
                      >
                        {h}
                      </button>
                    ))}
                    {libPreviewCount != null && (
                      <span className="ml-auto text-foreground">
                        {libPreviewCount} clip{libPreviewCount === 1 ? '' : 's'} match
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <PathRow label="Output folder (optional)" value={outputFolder} placeholder="Leave empty → C:\\temp-pmv\\outputs\\…" onBrowse={browseOutput} onClear={() => setOutputFolder('')} busy={picking === 'out'} icon={FolderOpen} />
      </section>

      <section className="rounded-lg border border-border bg-card p-6 space-y-4">
        <h2 className="font-serif text-lg">Format</h2>
        <div className="flex flex-wrap items-start gap-8">
          <div>
            <label className="block text-sm text-muted-foreground mb-2">Aspect ratio</label>
            <div className="flex gap-2">
              <button type="button" onClick={() => update('aspect', '16:9')} className={chipClass(form.aspect === '16:9')}><Monitor size={16} /> 16:9</button>
              <button type="button" onClick={() => update('aspect', '9:16')} className={chipClass(form.aspect === '9:16')}><Smartphone size={16} /> 9:16</button>
            </div>
          </div>
          <div>
            <label className="block text-sm text-muted-foreground mb-2">Resolution</label>
            <div className="flex flex-wrap gap-2">
              {['hd', 'fhd', '4k'].map((q) => (
                <button key={q} type="button" onClick={() => update('quality', q)} className={chipClass(form.quality === q)}>
                  {QUALITY_LABELS[q]}
                  <span className="ml-1.5 opacity-70 text-xs">{RES_HINT[form.aspect]?.[q]}</span>
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-2">Output will be {resHint} @ {form.fps} fps</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-6">
          <Toggle label="Zoom to fill (center crop)" hint="Scale up and crop so the frame is always full — recommended for 9:16" checked={form.zoom_to_fill} onChange={(v) => update('zoom_to_fill', v)} />
          <Toggle label="Face center (OpenCV)" hint="Detect a face in each clip and bias the 9:16 crop toward it." checked={form.face_center} onChange={(v) => { update('face_center', v); if (v && !form.zoom_to_fill) update('zoom_to_fill', true, { silent: true }) }} />
        </div>

      
        <div>
          <label className="block text-sm text-muted-foreground mb-2">Clip order</label>
          <div className="flex flex-wrap gap-2">
            {[
              { id: 'random', label: 'Random', hint: 'Classic jumpy cuts' },
              { id: 'forward', label: 'Chronological', hint: 'Always advance within each file' },
              { id: 'sticky', label: 'Sticky', hint: 'Stay on one scene, play forward' },
            ].map((o) => (
              <button
                key={o.id}
                type="button"
                title={o.hint}
                onClick={() => update('clip_order', o.id)}
                className={chipClass(form.clip_order === o.id)}
              >
                {o.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Sticky / Chronological avoid mixing the end of a scene with its beginning.
          </p>
        </div>
</section>

      
      <section className="rounded-lg border border-border bg-card p-5 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-serif text-lg">Beat effects</h2>
          <Toggle
            label="Enable post-pass"
            checked={!!form.effects?.enabled}
            onChange={(v) => updateEffect('enabled', v)}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Applied after the PMV is built, timed to beatmap hits. Flash/strobe can trigger photosensitive reactions — leave it off unless you know you want it.
        </p>
        {form.effects?.enabled && (
          <div className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-3">
              <Toggle label="Soft pulse" checked={!!form.effects.soft_pulse} onChange={(v) => updateEffect('soft_pulse', v)} hint="Gentle brightness on each beat" />
              <Toggle label="Zoom punch (sharpen)" checked={!!form.effects.zoom_punch} onChange={(v) => updateEffect('zoom_punch', v)} />
              <Toggle label="RGB split" checked={!!form.effects.rgb_split} onChange={(v) => updateEffect('rgb_split', v)} />
              <Toggle
                label="Flash / strobe"
                checked={!!form.effects.flash}
                onChange={(v) => updateEffect('flash', v)}
                hint="⚠ Photosensitivity risk — capped rate"
              />
              <Toggle label="Pink diffuse glow" checked={!!form.effects.pink_glow} onChange={(v) => updateEffect('pink_glow', v)} hint="Persistent magenta lift + soft vignette" />
            </div>
            {form.effects.pink_glow && (
              <div className="grid sm:grid-cols-2 gap-3">
                <NumberField label="Glow strength" value={form.effects.pink_glow_strength} step={0.05} min={0} max={1} onChange={(v) => updateEffect('pink_glow_strength', v)} />
                <NumberField label="Glow saturation" value={form.effects.pink_glow_saturation} step={0.05} min={0.5} max={2} onChange={(v) => updateEffect('pink_glow_saturation', v)} />
              </div>
            )}
            {form.effects.flash && (
              <div className="grid sm:grid-cols-2 gap-3">
                <NumberField label="Flash strength" value={form.effects.flash_strength} step={0.05} min={0.1} max={1} onChange={(v) => updateEffect('flash_strength', v)} />
                <NumberField label="Max flashes / sec" value={form.effects.flash_max_per_sec} step={1} min={1} max={12} onChange={(v) => updateEffect('flash_max_per_sec', v)} />
              </div>
            )}
            <div>
              <label className="block text-sm text-muted-foreground mb-1.5">Tonemap look</label>
              <div className="flex flex-wrap gap-2">
                {['none', 'hable', 'reinhard', 'mobius'].map((tm) => (
                  <button
                    key={tm}
                    type="button"
                    onClick={() => updateEffect('tonemap', tm)}
                    className={chipClass(form.effects.tonemap === tm)}
                  >
                    {tm}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm text-muted-foreground mb-1.5">LUT file (.cube)</label>
              <div className="flex gap-2">
                <span className="flex-1 text-sm font-mono truncate text-muted-foreground px-3 py-2 rounded-md border border-dashed border-border">
                  {form.effects.lut_path || 'None'}
                </span>
                <button
                  type="button"
                  className="px-3 py-2 rounded-md bg-secondary text-sm hover:bg-accent"
                  onClick={async () => {
                    try {
                      const d = await nativePick('/system/pick-file', { kind: 'any', title: 'Select LUT (.cube)' })
                      if (!d.cancelled && d.path) updateEffect('lut_path', d.path)
                    } catch (e) {
                      setError(e.message)
                    }
                  }}
                >
                  Browse
                </button>
                {form.effects.lut_path && (
                  <button type="button" className="px-2 py-2 text-sm text-muted-foreground" onClick={() => updateEffect('lut_path', '')}>
                    Clear
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </section>

<section className="rounded-lg border border-border bg-card p-6 space-y-5">
        <h2 className="font-serif text-lg">Options</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <NumberField label="Clip distance (s)" value={form.clip_dist} step={0.05} min={0.1} onChange={(v) => update('clip_dist', v, { silent: true })} />
          <NumberField label="FPS" value={form.fps} step={1} min={15} max={60} onChange={(v) => update('fps', v, { silent: true })} />
          <TextField label="Bitrate override" value={form.bitrate} onChange={(v) => update('bitrate', v, { silent: true })} hint="Leave empty for auto" />
          <NumberField label="Threads" value={form.threads} step={1} min={1} max={32} onChange={(v) => update('threads', v, { silent: true })} />
          <NumberField label="Max videos (0 = all)" value={form.num_vids} step={1} min={0} onChange={(v) => update('num_vids', v, { silent: true })} />
        </div>
        <div className="flex flex-wrap gap-6 pt-2">
          {clipMode === 'all' && <Toggle label="Search recursive" checked={form.recurse} onChange={(v) => update('recurse', v)} />}
          <Toggle label="GPU (CUDA / NVENC)" checked={form.cuda} onChange={(v) => update('cuda', v)} />
          <Toggle label="Debug" checked={form.debug} onChange={(v) => update('debug', v)} />
        </div>
      </section>

      <div className="flex items-center gap-4">
        <button onClick={() => { playTap(); startJob() }} disabled={submitting || isRunning || !canStart}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 hover:opacity-90 transition-opacity">
          {submitting || isRunning ? (<><Loader2 size={16} className="animate-spin" />{isRunning ? 'Generating…' : 'Starting…'}</>) : (<><Film size={16} />Generate PMV</>)}
        </button>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      {status && (
        <section className="rounded-lg border border-border bg-card p-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              {status.status === 'finished' && <CheckCircle2 className="text-green-500" size={20} />}
              {status.status === 'error' && <XCircle className="text-destructive" size={20} />}
              {(status.status === 'queued' || status.status === 'running') && <Loader2 className="animate-spin text-muted-foreground" size={20} />}
              <div>
                <h2 className="font-serif text-lg capitalize">{status.status}</h2>
                <p className="text-sm text-muted-foreground">{status.message}</p>
                {status.status === 'finished' && (status.elapsed_seconds || status.result?.elapsed_seconds) && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Generated in {(status.elapsed_seconds || status.result.elapsed_seconds).toFixed(1)}s
                  </p>
                )}
              </div>
            </div>
            {videoUrl && (
              <div className="flex gap-2">
                <button type="button" onClick={() => { playTap(); setPreviewOpen(true) }} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-secondary text-sm hover:bg-accent transition-colors">
                  <Eye size={14} /> View
                </button>
                <a href={`/api/generate/download/${jobId}`} onClick={() => playTap()} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-secondary text-sm hover:bg-accent transition-colors">
                  <Download size={14} /> Download
                </a>
                <button
                  type="button"
                  onClick={async () => {
                    playTap()
                    try {
                      const video = status?.result?.output_video
                      const beats = status?.result?.beat_input
                      const original = status?.result?.beat_input
                      if (!video || !beats) throw new Error('Missing video or beats path')
                      const res = await fetch('/api/cockhero/from-pmv', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          video_path: video,
                          beats_path: beats,
                          original_beats_path: original || null,
                          label: video.split(/[/\\]/).pop()?.replace(/\.mp4$/i, '') || 'pmv',
                        }),
                      })
                      if (!res.ok) {
                        const err = await res.json().catch(() => ({}))
                        throw new Error(err.detail || res.statusText)
                      }
                      const data = await res.json()
                      navigate(`/cockhero?session=${data.session_id}`)
                    } catch (e) {
                      playError()
                      setError(e.message)
                    }
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-pink-500 hover:bg-pink-400 text-white text-sm font-medium transition-colors"
                >
                  <Heart size={14} /> Create Cock Hero
                </button>
              </div>
            )}
          </div>
          {(status.status === 'running' || status.status === 'queued') && (
            <div className="w-full h-2 rounded-full bg-secondary overflow-hidden">
              <div className="h-full bg-primary/80 transition-all duration-500" style={{ width: `${Math.round((status.progress || 0) * 100)}%` }} />
            </div>
          )}
          {status.result?.output_video && (
            <div className="text-sm space-y-1 pt-2">
              <p className="text-muted-foreground">Output</p>
              <p className="font-mono text-xs break-all">{status.result.output_video}</p>
            </div>
          )}
          {status.result?.logs?.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground">Logs</summary>
              <pre className="mt-2 max-h-48 overflow-auto rounded bg-secondary/60 p-3 text-muted-foreground">{status.result.logs.join('\n')}</pre>
            </details>
          )}
        </section>
      )}

      {previewOpen && videoUrl && (
        <VideoModal src={videoUrl} title={status?.result?.output_video?.split(/[/\\]/).pop()} onClose={() => setPreviewOpen(false)} />
      )}
    </div>
  )
}

function PathRow({ label, value, placeholder, onBrowse, onClear, busy, icon: Icon }) {
  return (
    <div>
      {label && <label className="block text-sm text-muted-foreground mb-1.5">{label}</label>}
      <div className="flex gap-2">
        <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-md border border-dashed border-border bg-secondary/40 min-h-[44px] overflow-hidden">
          {Icon && <Icon size={16} className="text-muted-foreground shrink-0" />}
          <span className={value ? 'text-sm font-mono truncate' : 'text-sm text-muted-foreground truncate'} title={value || undefined}>
            {value || placeholder}
          </span>
        </div>
        <button type="button" onClick={onBrowse} disabled={!!busy} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-secondary text-sm hover:bg-accent transition-colors disabled:opacity-50 shrink-0">
          {busy ? <Loader2 size={14} className="animate-spin" /> : 'Browse'}
        </button>
        {value && (
          <button type="button" onClick={onClear} className="px-2 py-2 rounded-md text-sm text-muted-foreground hover:bg-secondary transition-colors shrink-0">Clear</button>
        )}
      </div>
    </div>
  )
}

function TextField({ label, value, onChange, hint }) {
  return (
    <div>
      <label className="block text-sm text-muted-foreground mb-1.5">{label}</label>
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
      {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
    </div>
  )
}

function NumberField({ label, value, onChange, step = 1, min, max }) {
  return (
    <div>
      <label className="block text-sm text-muted-foreground mb-1.5">{label}</label>
      <input type="number" value={value} step={step} min={min} max={max} onChange={(e) => onChange(parseFloat(e.target.value) || 0)} className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
    </div>
  )
}

function Toggle({ label, checked, onChange, hint }) {
  return (
    <label className="inline-flex flex-col gap-0.5 text-sm cursor-pointer select-none">
      <span className="inline-flex items-center gap-2">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="rounded border-border" />
        {label}
      </span>
      {hint && <span className="text-xs text-muted-foreground pl-6">{hint}</span>}
    </label>
  )
}
