import { useState } from 'react'
import { Loader2, Eye } from 'lucide-react'
import VideoModal from '../VideoModal'
import { playTap, playError } from '../../lib/sounds'

export default function EffectsPreview({
  effects,
  clipPath,
  videoPaths = [],
  videoFolder = '',
  cuda = false,
  bitrate = '',
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [src, setSrc] = useState(null)

  async function run() {
    playTap()
    setError(null)
    setBusy(true)
    try {
      let path = clipPath
      if (!path && videoPaths?.length) {
        path = videoPaths[Math.floor(Math.random() * videoPaths.length)]
      }
      if (!path) {
        // ask backend would need a folder pick — require a known path
        throw new Error('Pick at least one clip (or use Pick clips / Library) for a preview source')
      }
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
