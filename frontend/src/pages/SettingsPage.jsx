import { useState, useEffect, useCallback } from 'react'
import {
  Settings,
  FolderOpen,
  Trash2,
  Loader2,
  Save,
  HardDrive,
  Cpu,
  RefreshCw,
} from 'lucide-react'
import { playClick, playTap, playDone, playError } from '../lib/sounds'
import { APP_NAME, APP_VERSION } from '../lib/config'

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

const empty = {
  temp_dir: '',
  default_output_folder: '',
  default_cuda: false,
  default_fps: 30,
  default_threads: 4,
  default_clip_dist: 0.4,
  default_aspect: '16:9',
  default_quality: 'hd',
  default_clip_order: 'random',
  default_zoom_to_fill: true,
  auto_cleanup_after_job: true,
  cleanup_max_age_hours: 24,
  theporndb_api_token: '',
}

export default function SettingsPage() {
  const [form, setForm] = useState(empty)
  const [usage, setUsage] = useState(null)
  const [activeTemp, setActiveTemp] = useState('')
  const [configDir, setConfigDir] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [cleaning, setCleaning] = useState(false)
  const [msg, setMsg] = useState(null)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/system/settings')
      if (!res.ok) throw new Error('Failed to load settings')
      const data = await res.json()
      setForm({ ...empty, ...(data.settings || {}) })
      setUsage(data.temp_usage || null)
      setActiveTemp(data.temp_dir_active || '')
      setConfigDir(data.config_dir || '')
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  function update(key, value) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function browseTemp() {
    playTap()
    try {
      const d = await nativePick('/system/pick-folder', { title: 'Select temp folder' })
      if (!d.cancelled && d.path) update('temp_dir', d.path)
    } catch (e) {
      setError(e.message)
    }
  }

  async function browseOutput() {
    playTap()
    try {
      const d = await nativePick('/system/pick-folder', { title: 'Select default output folder' })
      if (!d.cancelled && d.path) update('default_output_folder', d.path)
    } catch (e) {
      setError(e.message)
    }
  }

  async function save() {
    playTap()
    setSaving(true)
    setMsg(null)
    setError(null)
    try {
      const res = await fetch('/api/system/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || 'Save failed')
      }
      const data = await res.json()
      setForm({ ...empty, ...(data.settings || {}) })
      setUsage(data.temp_usage || null)
      setActiveTemp(data.temp_dir_active || '')
      playDone()
      setMsg('Settings saved')
    } catch (e) {
      playError()
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function clean(mode) {
    playTap()
    setCleaning(true)
    setMsg(null)
    setError(null)
    try {
      const res = await fetch(
        `/api/system/cleanup?mode=${encodeURIComponent(mode)}&max_age_hours=${form.cleanup_max_age_hours || 24}`,
        { method: 'POST' }
      )
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || 'Cleanup failed')
      const data = await res.json()
      setUsage(data.temp_usage || null)
      playDone()
      setMsg(
        mode === 'aged'
          ? `Removed ${data.removed || 0} aged item(s)`
          : `Cleaned ${data.removed || 0} item(s)`
      )
    } catch (e) {
      playError()
      setError(e.message)
    } finally {
      setCleaning(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-sm">
        <Loader2 size={16} className="animate-spin" /> Loading settings…
      </div>
    )
  }

  return (
    <div className="space-y-8 max-w-3xl">
      <header>
        <h1 className="font-serif text-3xl tracking-tight flex items-center gap-2">
          <Settings size={28} className="opacity-80" />
          Settings
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {APP_NAME} v{APP_VERSION} · defaults apply to new Generate jobs
        </p>
      </header>

      {error && (
        <p className="text-sm text-destructive">
          {error}{' '}
          <button type="button" className="underline" onClick={() => setError(null)}>
            dismiss
          </button>
        </p>
      )}
      {msg && <p className="text-sm text-emerald-400">{msg}</p>}

      {/* Paths */}
      <section className="rounded-lg border border-border bg-card p-5 space-y-4">
        <h2 className="font-serif text-lg flex items-center gap-2">
          <HardDrive size={18} /> Paths
        </h2>
        <PathField
          label="Temp folder"
          hint="Intermediate clips, encode work, uploads. Auto-cleaned after jobs when enabled."
          value={form.temp_dir}
          onChange={(v) => update('temp_dir', v)}
          onBrowse={browseTemp}
        />
        <p className="text-xs text-muted-foreground font-mono">Active: {activeTemp}</p>
        <PathField
          label="Default output folder"
          hint="Pre-filled on Generate when set. Final PMVs should live here, not in temp."
          value={form.default_output_folder}
          onChange={(v) => update('default_output_folder', v)}
          onBrowse={browseOutput}
        />
        <p className="text-xs text-muted-foreground font-mono">Config: {configDir}</p>
      </section>

      {/* Encode defaults */}
      <section className="rounded-lg border border-border bg-card p-5 space-y-4">
        <h2 className="font-serif text-lg flex items-center gap-2">
          <Cpu size={18} /> Encode defaults
        </h2>
        <Toggle
          label="Use GPU (CUDA) by default"
          checked={!!form.default_cuda}
          onChange={(v) => update('default_cuda', v)}
        />
        <div className="grid sm:grid-cols-2 gap-4">
          <Select
            label="Aspect"
            value={form.default_aspect}
            onChange={(v) => update('default_aspect', v)}
            options={[
              ['16:9', '16:9 Landscape'],
              ['9:16', '9:16 Vertical'],
            ]}
          />
          <Select
            label="Quality"
            value={form.default_quality}
            onChange={(v) => update('default_quality', v)}
            options={[
              ['hd', 'HD 720p'],
              ['fhd', 'Full HD 1080p'],
              ['4k', '4K'],
            ]}
          />
          <Select
            label="Clip order"
            value={form.default_clip_order}
            onChange={(v) => update('default_clip_order', v)}
            options={[
              ['random', 'Random'],
              ['forward', 'Chronological'],
              ['sticky', 'Sticky'],
            ]}
          />
          <NumberField
            label="FPS"
            value={form.default_fps}
            onChange={(v) => update('default_fps', v)}
            min={15}
            max={60}
          />
          <NumberField
            label="Threads"
            value={form.default_threads}
            onChange={(v) => update('default_threads', v)}
            min={1}
            max={32}
          />
          <NumberField
            label="Clip distance"
            value={form.default_clip_dist}
            onChange={(v) => update('default_clip_dist', v)}
            step={0.05}
            min={0}
            max={2}
          />
        </div>
        <Toggle
          label="Zoom to fill (vertical) by default"
          checked={!!form.default_zoom_to_fill}
          onChange={(v) => update('default_zoom_to_fill', v)}
        />
      </section>

      {/* Cleanup */}
      <section className="rounded-lg border border-border bg-card p-5 space-y-4">
        <h2 className="font-serif text-lg flex items-center gap-2">
          <Trash2 size={18} /> Temp cleanup
        </h2>
        <Toggle
          label="Auto-clean job intermediates after each finish"
          hint="Deletes per-job clip folders under temp. Final output files are kept."
          checked={!!form.auto_cleanup_after_job}
          onChange={(v) => update('auto_cleanup_after_job', v)}
        />
        <NumberField
          label="Age threshold (hours) for manual aged clean"
          value={form.cleanup_max_age_hours}
          onChange={(v) => update('cleanup_max_age_hours', v)}
          min={1}
          max={720}
        />
        {usage && (
          <div className="rounded-md bg-secondary/40 px-3 py-2 text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Temp usage</span>
              <span className="font-mono">{usage.total_mb ?? 0} MB</span>
            </div>
            {usage.folders &&
              Object.entries(usage.folders).map(([name, info]) => (
                <div key={name} className="flex justify-between text-xs text-muted-foreground">
                  <span>{name}</span>
                  <span className="font-mono">
                    {info.mb} MB · {info.files} files
                  </span>
                </div>
              ))}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={cleaning}
            onClick={() => clean('aged')}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-secondary text-sm hover:bg-accent disabled:opacity-50"
          >
            {cleaning ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            Clean aged
          </button>
          <button
            type="button"
            disabled={cleaning}
            onClick={() => {
              if (confirm('Delete all intermediate job folders now?')) clean('all')
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-secondary text-sm hover:bg-accent disabled:opacity-50"
          >
            Clean all intermediates
          </button>
          <button
            type="button"
            disabled={cleaning}
            onClick={() => {
              if (
                confirm(
                  'Also wipe temp/outputs (PMVs saved without a custom output folder)? Final files in your default output folder are safe.'
                )
              )
                clean('all_with_outputs')
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-secondary text-sm text-destructive hover:bg-accent disabled:opacity-50"
          >
            Clean + temp outputs
          </button>
          <button
            type="button"
            onClick={() => {
              playClick()
              refresh()
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-secondary text-sm hover:bg-accent"
          >
            <RefreshCw size={14} />
            Refresh size
          </button>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-5 space-y-4">
        <h2 className="font-serif text-lg">Metadata</h2>
        <p className="text-xs text-muted-foreground">
          ThePornDB token powers actress photos/info on Clip Libraries.
          Get a free token at theporndb.net → user → API tokens.
          Local override: put <code className="text-foreground">cover.jpg</code> and optional{' '}
          <code className="text-foreground">info.json</code> in the library folder.
        </p>
        <div>
          <label className="block text-sm text-muted-foreground mb-1.5">ThePornDB API token</label>
          <input
            type="password"
            value={form.theporndb_api_token || ''}
            onChange={(e) => update('theporndb_api_token', e.target.value)}
            placeholder="Bearer token…"
            className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring"
            autoComplete="off"
          />
        </div>
      </section>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          Save settings
        </button>
      </div>
    </div>
  )
}

function PathField({ label, value, onChange, onBrowse, hint }) {
  return (
    <div>
      <label className="block text-sm text-muted-foreground mb-1.5">{label}</label>
      <div className="flex gap-2">
        <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-md border border-dashed border-border bg-secondary/40 min-h-[40px] overflow-hidden">
          <FolderOpen size={14} className="text-muted-foreground shrink-0" />
          <input
            type="text"
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
            className="flex-1 min-w-0 bg-transparent text-sm font-mono outline-none"
            placeholder="—"
          />
        </div>
        <button
          type="button"
          onClick={onBrowse}
          className="px-3 py-2 rounded-md bg-secondary text-sm hover:bg-accent shrink-0"
        >
          Browse
        </button>
      </div>
      {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
    </div>
  )
}

function Toggle({ label, checked, onChange, hint }) {
  return (
    <div>
      <label className="flex items-center gap-3 cursor-pointer">
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          onClick={() => {
            playClick()
            onChange(!checked)
          }}
          className={
            checked
              ? 'w-10 h-6 rounded-full bg-primary relative transition-colors'
              : 'w-10 h-6 rounded-full bg-secondary relative transition-colors'
          }
        >
          <span
            className={
              checked
                ? 'absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white translate-x-4 transition-transform'
                : 'absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform'
            }
          />
        </button>
        <span className="text-sm">{label}</span>
      </label>
      {hint && <p className="text-xs text-muted-foreground mt-1 ml-13 pl-[52px]">{hint}</p>}
    </div>
  )
}

function NumberField({ label, value, onChange, step = 1, min, max }) {
  return (
    <div>
      <label className="block text-sm text-muted-foreground mb-1.5">{label}</label>
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        max={max}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-1 focus:ring-ring"
      />
    </div>
  )
}

function Select({ label, value, onChange, options }) {
  return (
    <div>
      <label className="block text-sm text-muted-foreground mb-1.5">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm"
      >
        {options.map(([v, lab]) => (
          <option key={v} value={v}>
            {lab}
          </option>
        ))}
      </select>
    </div>
  )
}


