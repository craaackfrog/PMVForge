import { useState } from 'react'
import { usePersistentState } from '../hooks/usePersistentState'
import { APP_NAME } from '../lib/config'
import { Upload, Download, Loader2, FolderOpen } from 'lucide-react'
import WaveformEditor from '../components/WaveformEditor'

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

export default function BeatCreatorPage() {
  const [file, setFile] = useState(null) // File objects can't survive reload
  const [audioPath, setAudioPath] = useState('')
  const [picking, setPicking] = useState(false)
  const [meta, setMeta] = usePersistentState('pmvforge:beat-creator', {
    title: '',
    artist: '',
    creator: APP_NAME,
    minGap: 0.30,
  })
  const title = meta.title || ''
  const artist = meta.artist || ''
  const creator = meta.creator || APP_NAME
  const minGap = meta.minGap ?? 0.30
  const setTitle = (v) => setMeta((m) => ({ ...m, title: v }))
  const setArtist = (v) => setMeta((m) => ({ ...m, artist: v }))
  const setCreator = (v) => setMeta((m) => ({ ...m, creator: v }))
  const setMinGap = (v) => setMeta((m) => ({ ...m, minGap: v }))
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [beats, setBeats] = useState([])
  const [error, setError] = useState(null)

  async function browseAudio() {
    setPicking(true)
    setError(null)
    try {
      const data = await nativePick('/system/pick-file', { kind: 'audio', title: 'Select audio' })
      if (!data.cancelled && data.path) {
        setAudioPath(data.path)
        setFile(null)
        if (!title) {
          const name = data.path.split(/[/\\]/).pop() || ''
          setTitle(name.replace(/\.[^/.]+$/, ''))
        }
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setPicking(false)
    }
  }

  async function handleDetect() {
    if (!file && !audioPath) return
    setLoading(true)
    setError(null)
    setResult(null)
    setBeats([])
    try {
      let res
      if (audioPath) {
        const form = new FormData()
        form.append('path', audioPath)
        form.append('min_gap', minGap)
        res = await fetch('/api/beats/detect-path', { method: 'POST', body: form })
      } else {
        const form = new FormData()
        form.append('file', file)
        form.append('min_gap', minGap)
        res = await fetch('/api/beats/detect', { method: 'POST', body: form })
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || res.statusText)
      }
      const data = await res.json()
      setResult(data)
      setBeats(data.beats || [])
      if (!title) {
        const name = (file && file.name) || (audioPath && audioPath.split(/[/\\]/).pop()) || ''
        if (name) setTitle(name.replace(/\.[^/.]+$/, ''))
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleExport(fmt) {
    if (!result || !beats.length) return

    const form = new FormData()
    form.append('job_id', result.job_id)
    form.append('title', title || 'Untitled')
    form.append('artist', artist || 'Unknown')
    form.append('creator', creator || APP_NAME)
    form.append('format', fmt)
    form.append('beats', JSON.stringify(beats))
    const audioName = (file && file.name) || (audioPath && audioPath.split(/[/\\]/).pop()) || ''
    if (audioName) form.append('audio_filename', audioName)

    const res = await fetch('/api/beats/export', {
      method: 'POST',
      body: form,
    })

    if (!res.ok) {
      alert('Export failed')
      return
    }

    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${title || 'beats'}.${fmt === 'osu' ? 'osu' : 'txt'}`
    a.click()
    URL.revokeObjectURL(url)
  }

  function onDrop(e) {
    e.preventDefault()
    const f = e.dataTransfer.files?.[0]
    if (f && (f.type.startsWith('audio/') || /\.(mp3|wav|ogg|flac|m4a)$/i.test(f.name))) {
      setFile(f)
    }
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-serif text-3xl tracking-tight">Beat Creator</h1>
        <p className="text-muted-foreground mt-1">
          Detect beats from audio, edit them on the waveform, then export.
        </p>
      </header>

      {/* Upload + metadata */}
      <section className="rounded-lg border border-border bg-card p-6 space-y-5">
        <div>
          <label className="block text-sm text-muted-foreground mb-1.5">
            Audio file
          </label>
          <div className="flex gap-2">
            <label
              className="flex-1 flex items-center gap-3 px-4 py-3 rounded-md border border-dashed border-border bg-secondary/40 cursor-pointer hover:bg-secondary/70 transition-colors min-h-[48px]"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { setAudioPath(''); onDrop(e) }}
            >
              <Upload size={18} className="text-muted-foreground shrink-0" />
              <span className="text-sm truncate">
                {audioPath ? audioPath : file ? file.name : 'Choose, drop, or browse an audio file…'}
              </span>
              <input type="file" accept="audio/*,.mp3,.wav,.ogg,.flac,.m4a" className="hidden"
                onChange={(e) => { setAudioPath(''); setFile(e.target.files?.[0] || null) }} />
            </label>
            <button type="button" onClick={browseAudio} disabled={picking}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-secondary text-sm hover:bg-accent disabled:opacity-50 shrink-0">
              {picking ? <Loader2 size={14} className="animate-spin" /> : <FolderOpen size={14} />}
              Browse
            </button>
          </div>
        </div>

        <div className="grid sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm text-muted-foreground mb-1.5">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder="Song title"
            />
          </div>
          <div>
            <label className="block text-sm text-muted-foreground mb-1.5">Artist</label>
            <input
              type="text"
              value={artist}
              onChange={(e) => setArtist(e.target.value)}
              className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder="Artist name"
            />
          </div>
          <div>
            <label className="block text-sm text-muted-foreground mb-1.5">Creator</label>
            <input
              type="text"
              value={creator}
              onChange={(e) => setCreator(e.target.value)}
              className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>

        <div className="flex items-end gap-4">
          <div>
            <label className="block text-sm text-muted-foreground mb-1.5">
              Min gap (seconds)
            </label>
            <input
              type="number"
              step="0.05"
              min="0.1"
              max="2"
              value={minGap}
              onChange={(e) => setMinGap(parseFloat(e.target.value) || 0.3)}
              className="w-28 px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          <button
            onClick={handleDetect}
            disabled={(!file && !audioPath) || loading}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 hover:opacity-90 transition-opacity"
          >
            {loading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Detecting…
              </>
            ) : (
              'Detect beats'
            )}
          </button>
        </div>

        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}
      </section>

      {/* Waveform editor + export */}
      {result && (
        <section className="rounded-lg border border-border bg-card p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-serif text-xl">Waveform editor</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                ≈ {result.tempo} BPM · {result.duration}s · {beats.length} beats
              </p>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => handleExport('osu')}
                disabled={!beats.length}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-secondary text-sm hover:bg-accent transition-colors disabled:opacity-40"
              >
                <Download size={14} /> .osu
              </button>
              <button
                onClick={() => handleExport('txt')}
                disabled={!beats.length}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-secondary text-sm hover:bg-accent transition-colors disabled:opacity-40"
              >
                <Download size={14} /> .txt
              </button>
            </div>
          </div>

          <WaveformEditor
            waveform={result.waveform}
            beats={beats}
            duration={result.duration}
            tempo={result.tempo}
            audioFile={file}
            onChange={setBeats}
          />
        </section>
      )}
    </div>
  )
}
