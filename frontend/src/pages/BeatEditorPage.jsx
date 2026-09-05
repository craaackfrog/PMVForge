import { useState } from 'react'
import { Upload, Download, Loader2 } from 'lucide-react'
import WaveformEditor from '../components/WaveformEditor'

function parseOsuMeta(text) {
  const meta = {}
  let section = ''
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('[') && line.endsWith(']')) {
      section = line.slice(1, -1)
      continue
    }
    if (section === 'Metadata' && line.includes(':')) {
      const i = line.indexOf(':')
      meta[line.slice(0, i).trim()] = line.slice(i + 1).trim()
    }
  }
  const artist = meta.Artist || meta.ArtistUnicode || 'Unknown'
  const title = meta.Title || meta.TitleUnicode || 'Untitled'
  const creator = meta.Creator || 'Unknown'
  return {
    artist,
    title,
    creator,
    version: meta.Version || '',
    display_name: `${artist} - ${title} (${creator})`,
  }
}

function errorDetail(err) {
  if (!err) return 'Request failed'
  if (typeof err === 'string') return err
  if (Array.isArray(err)) return err.map((e) => e.msg || JSON.stringify(e)).join(', ')
  return err.detail || String(err)
}

export default function BeatEditorPage() {
  const [audioFile, setAudioFile] = useState(null)
  const [osuFile, setOsuFile] = useState(null)
  const [previewMeta, setPreviewMeta] = useState(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [beats, setBeats] = useState([])
  const [error, setError] = useState(null)

  function setOsuFromFile(f) {
    if (!f) {
      setOsuFile(null)
      setPreviewMeta(null)
      return
    }
    setOsuFile(f)
    const reader = new FileReader()
    reader.onload = () => {
      try {
        setPreviewMeta(parseOsuMeta(String(reader.result || '')))
      } catch {
        setPreviewMeta(null)
      }
    }
    reader.readAsText(f)
  }

  async function handleLoad() {
    if (!audioFile || !osuFile) return
    setLoading(true)
    setError(null)
    setResult(null)
    setBeats([])

    const form = new FormData()
    form.append('audio', audioFile)
    form.append('osu', osuFile)

    try {
      const res = await fetch('/api/beats/load-osu', {
        method: 'POST',
        body: form,
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(errorDetail(err.detail) || res.statusText)
      }
      const data = await res.json()
      setResult(data)
      setBeats(data.beats || [])
      setPreviewMeta({
        artist: data.artist,
        title: data.title,
        creator: data.creator,
        version: data.version,
        display_name: data.display_name,
      })
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleExport() {
    if (!result) return
    if (!beats.length) {
      alert('Add at least one beat before exporting.')
      return
    }

    const form = new FormData()
    form.append('job_id', result.job_id)
    form.append('beats', JSON.stringify(beats))
    form.append('filename', `${result.display_name}.osu`)

    const res = await fetch('/api/beats/export-osu', {
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
    a.download = `${result.display_name}.osu`
    a.click()
    URL.revokeObjectURL(url)
  }

  function dropAudio(e) {
    e.preventDefault()
    const f = e.dataTransfer.files?.[0]
    if (f && (f.type.startsWith('audio/') || /\.(mp3|wav|ogg|flac|m4a)$/i.test(f.name))) {
      setAudioFile(f)
    }
  }

  function dropOsu(e) {
    e.preventDefault()
    const f = e.dataTransfer.files?.[0]
    if (f && /\.osu$/i.test(f.name)) {
      setOsuFromFile(f)
    }
  }

  const heading = result?.display_name || previewMeta?.display_name

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-serif text-3xl tracking-tight">Beat Editor</h1>
        <p className="text-muted-foreground mt-1">
          Load an existing .osu beatmap with its audio, edit the beats, then export.
        </p>
      </header>

      <section className="rounded-lg border border-border bg-card p-6 space-y-5">
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-muted-foreground mb-1.5">
              Audio file
            </label>
            <label
              className="flex items-center gap-3 px-4 py-3 rounded-md border border-dashed border-border bg-secondary/40 cursor-pointer hover:bg-secondary/70 transition-colors min-h-[56px]"
              onDragOver={(e) => e.preventDefault()}
              onDrop={dropAudio}
            >
              <Upload size={18} className="text-muted-foreground shrink-0" />
              <span className="text-sm truncate">
                {audioFile ? audioFile.name : 'Choose or drop audio…'}
              </span>
              <input
                type="file"
                accept="audio/*,.mp3,.wav,.ogg,.flac,.m4a"
                className="hidden"
                onChange={(e) => setAudioFile(e.target.files?.[0] || null)}
              />
            </label>
          </div>

          <div>
            <label className="block text-sm text-muted-foreground mb-1.5">
              Beatmap (.osu)
            </label>
            <label
              className="flex items-center gap-3 px-4 py-3 rounded-md border border-dashed border-border bg-secondary/40 cursor-pointer hover:bg-secondary/70 transition-colors min-h-[56px]"
              onDragOver={(e) => e.preventDefault()}
              onDrop={dropOsu}
            >
              <Upload size={18} className="text-muted-foreground shrink-0" />
              <span className="text-sm truncate">
                {osuFile ? osuFile.name : 'Choose or drop .osu…'}
              </span>
              <input
                type="file"
                accept=".osu,text/plain"
                className="hidden"
                onChange={(e) => setOsuFromFile(e.target.files?.[0] || null)}
              />
            </label>
          </div>
        </div>

        {previewMeta && (
          <div className="rounded-md bg-secondary/50 px-4 py-3">
            <p className="font-serif text-xl tracking-tight">
              {previewMeta.display_name}
            </p>
            {previewMeta.version && (
              <p className="text-xs text-muted-foreground mt-1">
                Difficulty: {previewMeta.version}
              </p>
            )}
          </div>
        )}

        <button
          onClick={handleLoad}
          disabled={!audioFile || !osuFile || loading}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 hover:opacity-90 transition-opacity"
        >
          {loading ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Loading…
            </>
          ) : (
            'Load beatmap'
          )}
        </button>

        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}
      </section>

      {result && (
        <section className="rounded-lg border border-border bg-card p-6 space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-serif text-2xl tracking-tight">
                {heading}
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                {result.version ? `${result.version} · ` : ''}
                ≈ {result.tempo} BPM · {result.duration}s · {beats.length} beats
              </p>
            </div>

            <button
              onClick={handleExport}
              disabled={!beats.length}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-secondary text-sm hover:bg-accent transition-colors disabled:opacity-40"
            >
              <Download size={14} /> Export .osu
            </button>
          </div>

          <WaveformEditor
            waveform={result.waveform}
            beats={beats}
            duration={result.duration}
            tempo={result.tempo}
            audioFile={audioFile}
            onChange={setBeats}
          />
        </section>
      )}
    </div>
  )
}
