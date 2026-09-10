import { useEffect, useState } from 'react'
import { X, Save, Loader2, Search, Flame } from 'lucide-react'
import { playTap, playDone, playError } from '../lib/sounds'

const EXIT_MS = 220

/**
 * Edit stored scene metadata for a clip.
 * "Match clip" opens ThePornDB matcher from here.
 */
export default function ClipEditModal({ libraryId, clip, onClose, onSaved, onMatch }) {
  const scene = clip?.scene || {}
  const [visible, setVisible] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const closedRef = useState({ current: false })[0]

  const [form, setForm] = useState({
    title: scene.title || '',
    date: scene.date || '',
    studio: scene.studio || '',
    performers: Array.isArray(scene.performers) ? scene.performers.join(', ') : '',
    tags: Array.isArray(scene.tags) ? scene.tags.join(', ') : '',
    poster: scene.poster || '',
    url: scene.url || '',
    filename: clip?.name || (clip?.path || '').split(/[/\\]/).pop() || '',
    heat: clip?.heat || 3,
  })

  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(id)
  }, [])

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') requestClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function update(k, v) {
    setForm((f) => ({ ...f, [k]: v }))
  }

  function requestClose() {
    if (closedRef.current) return
    closedRef.current = true
    setLeaving(true)
    setVisible(false)
    window.setTimeout(() => onClose?.(), EXIT_MS)
  }

  async function save() {
    playTap()
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/libraries/${libraryId}/clip/scene`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: clip.path,
          scene: {
            title: form.title,
            date: form.date,
            studio: form.studio,
            performers: form.performers,
            tags: form.tags,
            poster: form.poster,
            url: form.url,
            tpdb_id: scene.tpdb_id,
            kind: scene.kind,
          },
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || res.statusText)
      let finalClip = data.clip || data
      if (form.heat != null) {
        const hr = await fetch(`/api/libraries/${libraryId}/clip`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: finalClip.path || clip.path, heat: form.heat }),
        })
        if (hr.ok) {
          const hd = await hr.json().catch(() => ({}))
          finalClip = { ...finalClip, ...(hd.clip || hd), heat: form.heat }
        }
      }
      const desired = (form.filename || '').trim()
      const currentName = clip.name || (clip.path || '').split(/[/\\]/).pop()
      if (desired && desired !== currentName) {
        const rr = await fetch(`/api/libraries/${libraryId}/clip/rename`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: finalClip.path || clip.path, filename: desired }),
        })
        const rd = await rr.json().catch(() => ({}))
        if (!rr.ok) throw new Error(rd.detail || rr.statusText)
        finalClip = rd.clip || rd
      }
      playDone()
      onSaved?.(finalClip)
      requestClose()
    } catch (e) {
      playError()
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const open = visible && !leaving

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-md transition-opacity"
        style={{ opacity: open ? 1 : 0, transitionDuration: `${EXIT_MS}ms` }}
        onClick={requestClose}
      />
      <div
        className="relative z-10 w-full max-w-lg rounded-lg border border-border bg-card shadow-2xl overflow-hidden transition-[opacity,transform]"
        style={{
          opacity: open ? 1 : 0,
          transform: open ? 'scale(1)' : 'scale(0.96)',
          transitionDuration: `${EXIT_MS}ms`,
        }}
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
          <div className="min-w-0">
            <p className="text-sm font-medium">Edit clip metadata</p>
            <p className="text-[11px] text-muted-foreground font-mono truncate">{clip?.name || clip?.path}</p>
          </div>
          <button type="button" onClick={requestClose} className="p-1.5 rounded-md hover:bg-secondary" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="p-4 space-y-3 max-h-[70vh] overflow-y-auto">
          {(form.poster || clip?.path) && (
            <img
              src={form.poster || `/api/libraries/thumbnail?path=${encodeURIComponent(clip.path)}`}
              alt=""
              className="w-full max-h-40 object-contain rounded-md bg-black"
              onError={(e) => {
                e.currentTarget.src = `/api/libraries/thumbnail?path=${encodeURIComponent(clip.path)}`
              }}
            />
          )}
          <Field label="Title" value={form.title} onChange={(v) => update('title', v)} />
          <div>
            <p className="text-xs text-muted-foreground mb-1">Heat</p>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => update('heat', h)}
                  className="p-1.5 rounded-md hover:bg-secondary"
                  title={`Heat ${h}`}
                >
                  <Flame
                    size={20}
                    className={form.heat >= h ? 'text-orange-500 fill-orange-500' : 'text-muted-foreground'}
                  />
                </button>
              ))}
            </div>
          </div>
          <Field
            label="Filename"
            value={form.filename}
            onChange={(v) => update('filename', v)}
            hint="Renames the file on disk when you Save"
          />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date" value={form.date} onChange={(v) => update('date', v)} placeholder="YYYY-MM-DD" />
            <Field label="Studio" value={form.studio} onChange={(v) => update('studio', v)} />
          </div>
          <Field label="Performers" value={form.performers} onChange={(v) => update('performers', v)} hint="Comma-separated" />
          <Field label="Tags" value={form.tags} onChange={(v) => update('tags', v)} hint="Comma-separated" />
          <Field label="Cover URL" value={form.poster} onChange={(v) => update('poster', v)} hint="ThePornDB poster URL used on the grid" />
          <Field label="TPDB URL" value={form.url} onChange={(v) => update('url', v)} />
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-t border-border">
          <button
            type="button"
            onClick={() => {
              playTap()
              onMatch?.(clip)
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm bg-secondary hover:bg-accent"
          >
            <Search size={14} />
            Match clip
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={requestClose} className="px-3 py-2 rounded-md text-sm hover:bg-secondary">
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, value, onChange, placeholder, hint }) {
  return (
    <div>
      <label className="block text-xs text-muted-foreground mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-1 focus:ring-ring"
      />
      {hint && <p className="text-[10px] text-muted-foreground mt-1">{hint}</p>}
    </div>
  )
}
