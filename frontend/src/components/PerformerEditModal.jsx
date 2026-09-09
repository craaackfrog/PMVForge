import { useEffect, useState } from 'react'
import { X, Save, Loader2, Trash2 } from 'lucide-react'
import { playTap, playDone, playError } from '../lib/sounds'

const EXIT_MS = 220

/**
 * Manual performer bio editor — writes library-root info.json override.
 */
export default function PerformerEditModal({ libraryId, profile, onClose, onSaved }) {
  const [visible, setVisible] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const closedRef = useState({ current: false })[0]

  const extras = profile?.extras || {}
  const [form, setForm] = useState({
    name: profile?.name || '',
    bio: profile?.bio || '',
    aliases: Array.isArray(profile?.aliases) ? profile.aliases.join(', ') : '',
    ethnicity: extras.ethnicity || '',
    birthplace: extras.birthplace || '',
    birthday: extras.birthday || '',
    rating: profile?.rating ?? '',
    age: profile?.age ?? '',
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

  function update(key, value) {
    setForm((f) => ({ ...f, [key]: value }))
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
      const body = {
        name: form.name,
        bio: form.bio,
        aliases: form.aliases,
        rating: form.rating === '' ? null : form.rating,
        age: form.age === '' ? null : form.age,
        extras: {
          ethnicity: form.ethnicity,
          birthplace: form.birthplace,
          birthday: form.birthday,
        },
        tpdb_id: profile?.tpdb_id,
      }
      const res = await fetch(`/api/libraries/${libraryId}/performer/override`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || res.statusText)
      playDone()
      onSaved?.(data)
      requestClose()
    } catch (e) {
      playError()
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function removeOverride() {
    if (!confirm('Delete info.json override and fall back to ThePornDB/cache?')) return
    playTap()
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/libraries/${libraryId}/performer/override`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || res.statusText)
      playDone()
      onSaved?.(data)
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
          <div>
            <p className="text-sm font-medium">Edit performer override</p>
            <p className="text-[11px] text-muted-foreground">Saved as info.json in the library folder</p>
          </div>
          <button type="button" onClick={requestClose} className="p-1.5 rounded-md hover:bg-secondary" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="p-4 space-y-3 max-h-[70vh] overflow-y-auto">
          <Field label="Name" value={form.name} onChange={(v) => update('name', v)} />
          <Field label="Ethnicity / race" value={form.ethnicity} onChange={(v) => update('ethnicity', v)} />
          <Field
            label="Birthplace"
            value={form.birthplace}
            onChange={(v) => update('birthplace', v)}
            hint='Use "City, Country" — flag is taken from the last segment (e.g. "Kyiv, Ukraine").'
          />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Birthday" value={form.birthday} onChange={(v) => update('birthday', v)} placeholder="YYYY-MM-DD" />
            <Field label="Age" value={form.age} onChange={(v) => update('age', v)} placeholder="optional" />
          </div>
          <Field label="Rating" value={form.rating} onChange={(v) => update('rating', v)} placeholder="0–10" />
          <Field label="Aliases" value={form.aliases} onChange={(v) => update('aliases', v)} hint="Comma-separated" />
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Bio</label>
            <textarea
              value={form.bio}
              onChange={(e) => update('bio', e.target.value)}
              rows={4}
              className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-1 focus:ring-ring resize-y min-h-[80px]"
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-t border-border">
          <button
            type="button"
            onClick={removeOverride}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm text-destructive hover:bg-secondary disabled:opacity-50"
          >
            <Trash2 size={14} />
            Clear override
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={requestClose} className="px-3 py-2 rounded-md text-sm hover:bg-secondary">
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              Save info.json
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
