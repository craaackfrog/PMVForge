import { useState, useEffect, useCallback } from 'react'
import {
  Music2,
  FolderPlus,
  RefreshCw,
  Trash2,
  Loader2,
  Play,
  FileAudio,
  FileText,
  ChevronDown,
  ChevronRight,
} from 'lucide-react'
import { playClick, playTap, playDone, playError } from '../lib/sounds'
import { nativePick } from '../lib/nativePick'
import { cn } from '../lib/utils'

function mediaUrl(path) {
  return `/api/song-libraries/media?path=${encodeURIComponent(path)}`
}

function formatSize(n) {
  if (n == null) return ''
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)}MB`
  if (n >= 1024) return `${(n / 1024).toFixed(1)}KB`
  return `${n}B`
}

export default function SongLibrariesPage() {
  const [libraries, setLibraries] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [active, setActive] = useState(null)
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState(null)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState({})
  const [previewAudio, setPreviewAudio] = useState(null)

  const loadList = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/song-libraries')
      if (!res.ok) throw new Error('Failed to load song libraries')
      const data = await res.json()
      setLibraries(data.libraries || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadActive = useCallback(async (id) => {
    if (!id) {
      setActive(null)
      return
    }
    try {
      const res = await fetch(`/api/song-libraries/${id}`)
      if (!res.ok) throw new Error('Failed to load library')
      const data = await res.json()
      setActive(data)
      const next = {}
      for (const s of data.song_list || []) next[s.path] = true
      setExpanded(next)
    } catch (e) {
      setError(e.message)
    }
  }, [])

  useEffect(() => { loadList() }, [loadList])
  useEffect(() => { loadActive(activeId) }, [activeId, loadActive])

  async function addLibrary() {
    playTap()
    setAdding(true)
    setError(null)
    try {
      const pick = await nativePick('/system/pick-folder', { title: 'Select songs folder' })
      if (pick.cancelled || !pick.path) return
      const res = await fetch('/api/song-libraries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '', root_path: pick.path, scan: true }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || res.statusText)
      }
      const lib = await res.json()
      await loadList()
      setActiveId(lib.id)
      playDone()
    } catch (e) {
      playError()
      setError(e.message)
    } finally {
      setAdding(false)
    }
  }

  async function rescan() {
    if (!activeId) return
    playTap()
    setScanning(true)
    setError(null)
    try {
      const res = await fetch(`/api/song-libraries/${activeId}/scan`, { method: 'POST' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || res.statusText)
      }
      setActive(await res.json())
      await loadList()
      playDone()
    } catch (e) {
      playError()
      setError(e.message)
    } finally {
      setScanning(false)
    }
  }

  async function removeLibrary() {
    if (!activeId) return
    if (!confirm('Remove this song library from the index? Files on disk are kept.')) return
    playTap()
    try {
      const res = await fetch(`/api/song-libraries/${activeId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Delete failed')
      setActiveId(null)
      setActive(null)
      await loadList()
      playDone()
    } catch (e) {
      playError()
      setError(e.message)
    }
  }

  const songs = (active?.song_list || []).filter((s) => {
    if (!query.trim()) return true
    const q = query.trim().toLowerCase()
    if ((s.name || '').toLowerCase().includes(q)) return true
    return (s.osu_files || []).some((f) => (f.name || '').toLowerCase().includes(q))
      || (s.audio_files || []).some((f) => (f.name || '').toLowerCase().includes(q))
  })

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl tracking-tight">Song Libraries</h1>
          <p className="text-muted-foreground mt-1">
            Index extracted osu! sets — each subfolder is one song with audio + beatmaps.
            Beatmaps are sorted by file size (more hits ≈ larger file).
          </p>
        </div>
        <button
          type="button"
          onClick={addLibrary}
          disabled={adding}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {adding ? <Loader2 size={14} className="animate-spin" /> : <FolderPlus size={14} />}
          Add folder
        </button>
      </header>

      {error && (
        <p className="text-sm text-destructive">
          {error}{' '}
          <button type="button" className="underline" onClick={() => setError(null)}>dismiss</button>
        </p>
      )}

      <div className="grid lg:grid-cols-[240px_1fr] gap-4 items-start">
        <aside className="rounded-lg border border-border bg-card p-2 space-y-1">
          {loading && (
            <div className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground">
              <Loader2 size={14} className="animate-spin" /> Loading…
            </div>
          )}
          {!loading && libraries.length === 0 && (
            <p className="text-sm text-muted-foreground px-1 py-3">No libraries yet. Hit Add folder.</p>
          )}
          {libraries.map((lib) => (
            <button
              key={lib.id}
              type="button"
              onClick={() => { playClick(); setActiveId(lib.id) }}
              className={
                activeId === lib.id
                  ? 'w-full text-left px-3 py-2.5 rounded-md text-sm bg-accent text-accent-foreground'
                  : 'w-full text-left px-3 py-2.5 rounded-md text-sm text-muted-foreground hover:bg-secondary hover:text-foreground'
              }
            >
              <div className="flex items-center gap-2 font-medium text-foreground">
                <Music2 size={14} className="shrink-0" />
                <span className="truncate">{lib.name}</span>
              </div>
              <div className="text-xs mt-0.5 opacity-70 pl-5">
                {lib.song_count} song{lib.song_count === 1 ? '' : 's'}
              </div>
            </button>
          ))}
        </aside>

        <section className="min-w-0 space-y-3">
          {!activeId ? (
            <div className="rounded-lg border border-dashed border-border bg-card/50 p-12 text-center text-sm text-muted-foreground">
              Select or add a library to browse songs
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex-1 min-w-0">
                  <h2 className="font-serif text-lg truncate">{active?.name}</h2>
                  <p className="text-xs text-muted-foreground font-mono truncate" title={active?.root_path}>
                    {active?.root_path}
                  </p>
                </div>
                <button type="button" onClick={rescan} disabled={scanning}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-secondary text-sm hover:bg-accent disabled:opacity-50">
                  {scanning ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                  Rescan
                </button>
                <button type="button" onClick={removeLibrary}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-secondary text-sm text-destructive hover:bg-accent">
                  <Trash2 size={14} />
                  Remove
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <input type="search" value={query} onChange={(e) => setQuery(e.target.value)}
                  placeholder="Filter songs…"
                  className="flex-1 min-w-[160px] px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
                <span className="text-xs text-muted-foreground">
                  {songs.length} shown{active?.song_count != null ? ` / ${active.song_count}` : ''}
                </span>
              </div>

              <div className="rounded-lg border border-border bg-card divide-y divide-border overflow-hidden">
                {songs.length === 0 ? (
                  <p className="p-8 text-center text-sm text-muted-foreground">
                    {query ? 'No songs match this filter.' : 'No songs found — rescan or check folder layout.'}
                  </p>
                ) : (
                  songs.map((song) => {
                    const open = expanded[song.path] !== false
                    return (
                      <div key={song.path}>
                        <button type="button"
                          onClick={() => { playClick(); setExpanded((prev) => ({ ...prev, [song.path]: !open })) }}
                          className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-secondary/40 transition-colors">
                          {open ? <ChevronDown size={16} className="text-muted-foreground shrink-0" /> : <ChevronRight size={16} className="text-muted-foreground shrink-0" />}
                          <Music2 size={16} className="text-muted-foreground shrink-0" />
                          <span className="font-medium text-sm truncate flex-1">{song.name}</span>
                          <span className="text-xs text-muted-foreground shrink-0">
                            {(song.osu_files || []).length} osu · {(song.audio_files || []).length} audio
                          </span>
                        </button>
                        {open && (
                          <ul className="pb-3 px-4 pl-12 space-y-1">
                            {(song.osu_files || []).map((f) => (
                              <li key={f.path} className="flex items-center gap-2 text-sm text-muted-foreground py-0.5" title={f.path}>
                                <FileText size={14} className="shrink-0 opacity-70" />
                                <span className="font-mono text-xs truncate text-foreground">{f.name}</span>
                                <span className="text-[11px] opacity-70 shrink-0">{f.size_label || formatSize(f.size)}</span>
                              </li>
                            ))}
                            {(song.audio_files || []).map((f) => (
                              <li key={f.path} className="flex items-center gap-2 text-sm text-muted-foreground py-0.5" title={f.path}>
                                <FileAudio size={14} className="shrink-0 opacity-70" />
                                <span className="font-mono text-xs truncate text-foreground flex-1">{f.name}</span>
                                <span className="text-[11px] opacity-70 shrink-0">{f.size_label || formatSize(f.size)}</span>
                                <button type="button"
                                  onClick={() => { playTap(); setPreviewAudio(previewAudio === f.path ? null : f.path) }}
                                  className={cn(
                                    'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs shrink-0',
                                    previewAudio === f.path ? 'bg-primary text-primary-foreground' : 'bg-secondary hover:bg-accent'
                                  )}>
                                  <Play size={12} />
                                  Preview
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )
                  })
                )}
              </div>

              {previewAudio && (
                <div className="rounded-lg border border-border bg-card p-3 flex flex-wrap items-center gap-3">
                  <FileAudio size={16} className="text-muted-foreground" />
                  <span className="text-xs font-mono truncate flex-1">{previewAudio.split(/[/\\]/).pop()}</span>
                  <audio key={previewAudio} src={mediaUrl(previewAudio)} controls autoPlay className="h-8 max-w-full" />
                  <button type="button" onClick={() => setPreviewAudio(null)} className="text-xs text-muted-foreground hover:text-foreground">
                    Close
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  )
}
