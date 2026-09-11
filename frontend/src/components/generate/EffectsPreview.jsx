import { useState } from 'react'
import { Loader2, Eye } from 'lucide-react'
import VideoModal from '../VideoModal'
import { playTap, playError } from '../../lib/sounds'

export default function EffectsPreview({
  effects,
  clipPath,
  videoPaths = [],
  videoFolder = '',
  libraryId = '',
  libraryTags = [],
  libraryTagMode = 'any',
  libraryMinHeat = 1,
  cuda = false,
  bitrate = '',
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [src, setSrc] = useState(null)

  async function resolveClipPath() {
    if (clipPath) return clipPath
    if (videoPaths?.length) {
      return videoPaths[Math.floor(Math.random() * videoPaths.length)]
    }
    if (libraryId) {
      const res = await fetch(`/api/libraries/${libraryId}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tags: libraryTags || [],
          tag_mode: libraryTagMode || 'any',
          min_heat: libraryMinHeat || 1,
          max_heat: 5,
          limit: 20,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || res.statusText)
      const paths = data.paths || (data.clips || []).map((c) => c.path).filter(Boolean)
      if (!paths.length) throw new Error('Library query returned no clips for preview')
      return paths[Math.floor(Math.random() * paths.length)]
    }
    if (videoFolder) {
      const res = await fetch('/api/generate/sample-clip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder: videoFolder, recurse: true }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || res.statusText)
      if (!data.path) throw new Error('No sample clip found in folder')
      return data.path
    }
    throw new Error('Pick clips, a folder, or a library so preview has a source')
  }

  async function run() {
    playTap()
    setError(null)
    setBusy(true)
    try {
      const path = await resolveClipPath()
      const res = await fetch('/api/generate/effects-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clip_path: path,
          effects: { ...effects, enabled: true },
          duration: 4,
          cuda: !!cuda,
          bitrate: bitrate || null,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || res.statusText)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      setSrc(url)
    } catch (e) {
      playError()
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pt-2 border-t border-border space-y-2">
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-secondary text-sm hover:bg-accent disabled:opacity-50"
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
        Preview effects
      </button>
      <p className="text-xs text-muted-foreground">
        Renders a short sample from one of your clips with the current effect mix.
      </p>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {src && (
        <VideoModal src={src} title="Effects preview" onClose={() => { URL.revokeObjectURL(src); setSrc(null) }} />
      )}
    </div>
  )
}
