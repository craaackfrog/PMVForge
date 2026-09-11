import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePersistentState } from '../hooks/usePersistentState'
import {
  Film,
  Loader2,
  CheckCircle2,
  XCircle,
  Eye,
  Download,
  Heart,
} from 'lucide-react'
import VideoModal from '../components/VideoModal'
import { playClick, playTap, playStart, playDone, playError } from '../lib/sounds'
import { nativePick } from '../lib/nativePick'
import { DEFAULTS, RES_HINT } from '../components/generate/defaults'
import InputsSection from '../components/generate/InputsSection'
import FormatSection from '../components/generate/FormatSection'
import EffectsSection from '../components/generate/EffectsSection'
import EffectsPreview from '../components/generate/EffectsPreview'
import OptionsSection from '../components/generate/OptionsSection'

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
  const onSelectBeatmap = (osuPath, audioPath) => {
    setDraft((d) => ({
      ...d,
      beatPath: osuPath || '',
      // auto-link mapped audio; clear if map has none
      songPath: audioPath || '',
    }))
  }
  const setClipMode = (v) => setDraft((d) => ({ ...d, clipMode: v }))
  const setVideoFolder = (v) => setDraft((d) => ({ ...d, videoFolder: v }))
  const setVideoPaths = (v) => setDraft((d) => ({ ...d, videoPaths: v }))
  const setOutputFolder = (v) => setDraft((d) => ({ ...d, outputFolder: v }))

  // Apply Settings defaults only for keys that still match package DEFAULTS
  useEffect(() => {
    let cancelled = false
    fetch('/api/system/settings')
      .then((r) => r.json())
      .then((data) => {
        if (cancelled || !data.settings) return
        const s = data.settings
        setDraft((d) => {
          const f = { ...(d.form || {}) }
          const still = (key, defVal) => {
            const cur = f[key]
            if (typeof defVal === 'boolean') return cur === defVal
            if (typeof defVal === 'number') return cur === defVal || cur == null
            return cur === defVal || cur == null || cur === ''
          }
          if (s.default_cuda != null && still('cuda', DEFAULTS.cuda)) f.cuda = !!s.default_cuda
          if (s.default_fps && still('fps', DEFAULTS.fps)) f.fps = s.default_fps
          if (s.default_threads && still('threads', DEFAULTS.threads)) f.threads = s.default_threads
          if (s.default_clip_dist != null && still('clip_dist', DEFAULTS.clip_dist)) f.clip_dist = s.default_clip_dist
          if (s.default_aspect && still('aspect', DEFAULTS.aspect)) f.aspect = s.default_aspect
          if (s.default_quality && still('quality', DEFAULTS.quality)) f.quality = s.default_quality
          if (s.default_clip_order && still('clip_order', DEFAULTS.clip_order)) f.clip_order = s.default_clip_order
          if (s.default_zoom_to_fill != null && still('zoom_to_fill', DEFAULTS.zoom_to_fill)) {
            f.zoom_to_fill = !!s.default_zoom_to_fill
          }
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

  async function saveProject() {
    playTap()
    try {
      const res = await fetch('/api/projects/saved', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: beatPath.split(/[/\\]/).pop() || 'Untitled project',
          type: 'generate',
          draft: {
            form, beatPath, songPath, clipMode, videoFolder, videoPaths,
            outputFolder, libraryId, libraryTags, libraryTagMode, libraryMinHeat,
          },
        }),
      })
      if (!res.ok) throw new Error('Save failed')
      playDone()
    } catch (e) {
      playError()
      setError(e.message)
    }
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

  async function cancelJob() {
    if (!jobId) return
    playTap()
    try {
      const res = await fetch(`/api/generate/cancel/${jobId}`, { method: 'POST' })
      if (!res.ok) throw new Error('Cancel failed')
      setStatus(await res.json())
    } catch (e) {
      playError()
      setError(e.message)
    }
  }

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
        <h1 className="font-serif text-3xl tracking-tight">PMV Creator</h1>
        <p className="text-muted-foreground mt-1">
          Paths stay on disk — native pickers, no uploading.
        </p>
      </header>

      <InputsSection
        beatPath={beatPath}
        songPath={songPath}
        clipMode={clipMode}
        videoFolder={videoFolder}
        videoPaths={videoPaths}
        outputFolder={outputFolder}
        libraryId={libraryId}
        libraryTags={libraryTags}
        libraryTagMode={libraryTagMode}
        libraryMinHeat={libraryMinHeat}
        libraries={libraries}
        libTagVocab={libTagVocab}
        libPreviewCount={libPreviewCount}
        picking={picking}
        setBeatPath={setBeatPath}
        setSongPath={setSongPath}
        setClipMode={setClipMode}
        setVideoFolder={setVideoFolder}
        setVideoPaths={setVideoPaths}
        setOutputFolder={setOutputFolder}
        setLibraryId={setLibraryId}
        setLibraryTags={setLibraryTags}
        setLibraryTagMode={setLibraryTagMode}
        setLibraryMinHeat={setLibraryMinHeat}
        onSelectBeatmap={onSelectBeatmap}
        browseBeat={browseBeat}
        browseSong={browseSong}
        browseVideoFolder={browseVideoFolder}
        browseClips={browseClips}
        browseOutput={browseOutput}
      />

      <FormatSection form={form} update={update} resHint={resHint} />
      <EffectsSection
        form={form}
        updateEffect={updateEffect}
        previewSlot={
          <EffectsPreview
            effects={form.effects}
            clipPath={videoPaths[0] || ''}
            videoPaths={videoPaths}
            videoFolder={videoFolder}
            libraryId={libraryId}
            libraryTags={libraryTags}
            libraryTagMode={libraryTagMode}
            libraryMinHeat={libraryMinHeat}
            cuda={form.cuda}
            bitrate={form.bitrate}
          />
        }
      />
      <OptionsSection form={form} update={update} clipMode={clipMode} />

      <div className="flex items-center gap-4">
        <button onClick={() => { playTap(); startJob() }} disabled={submitting || isRunning || !canStart}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 hover:opacity-90 transition-opacity">
          {submitting || isRunning ? (<><Loader2 size={16} className="animate-spin" />{isRunning ? 'Generating…' : 'Starting…'}</>) : (<><Film size={16} />Create PMV</>)}
        </button>
        {/* <button type="button" onClick={saveProject} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-md bg-secondary text-sm hover:bg-accent">
          Save project
        </button> */}
        {isRunning && (
          <button type="button" onClick={cancelJob} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-md bg-secondary text-sm text-destructive hover:bg-accent">
            Cancel
          </button>
        )}
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
