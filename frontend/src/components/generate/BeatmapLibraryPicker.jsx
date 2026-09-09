import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  Music2,
  Loader2,
  ChevronDown,
  ChevronRight,
  FileText,
  FileAudio,
  Check,
} from 'lucide-react'
import { playClick, playTap } from '../../lib/sounds'
import { cn } from '../../lib/utils'

function formatSize(n) {
  if (n == null) return ''
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)}MB`
  if (n >= 1024) return `${(n / 1024).toFixed(1)}KB`
  return `${n}B`
}

/**
 * Song-library beatmap picker for PMV Creator.
 * Selecting a difficulty sets beatPath (+ song audio when available).
 */
export default function BeatmapLibraryPicker({
  beatPath,
  songPath,
  onSelectBeatmap, // (osuPath, audioPath|null) => void
}) {
  const [libraries, setLibraries] = useState([])
  const [libId, setLibId] = useState('')
  const [detail, setDetail] = useState(null)
  const [loadingList, setLoadingList] = useState(true)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState({})
  const [error, setError] = useState(null)

  const loadList = useCallback(async () => {
    setLoadingList(true)
    setError(null)
    try {
      const res = await fetch('/api/song-libraries')
      if (!res.ok) throw new Error('Failed to load song libraries')
      const data = await res.json()
      const libs = data.libraries || []
      setLibraries(libs)
      if (!libId && libs.length === 1) setLibId(libs[0].id)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoadingList(false)
    }
  }, [libId])

  useEffect(() => {
    loadList()
  }, [loadList])

  useEffect(() => {
    if (!libId) {
      setDetail(null)
      return
    }
    let cancelled = false
    ;(async () => {
      setLoadingDetail(true)
      setError(null)
      try {
        const res = await fetch(`/api/song-libraries/${libId}`)
        if (!res.ok) throw new Error('Failed to load library')
        const data = await res.json()
        if (cancelled) return
        setDetail(data)
        const next = {}
        for (const s of data.song_list || []) next[s.path] = false
        // auto-expand the song that owns the current beatPath
        if (beatPath) {
          for (const s of data.song_list || []) {
            if ((s.osu_files || []).some((f) => f.path === beatPath)) {
              next[s.path] = true
            }
          }
        }
        setExpanded(next)
      } catch (e) {
        if (!cancelled) setError(e.message)
      } finally {
        if (!cancelled) setLoadingDetail(false)
      }
    })()
    return () => { cancelled = true }
  }, [libId, beatPath])

  const songs = useMemo(() => {
    const list = detail?.song_list || []
    if (!query.trim()) return list
    const q = query.trim().toLowerCase()
    return list.filter((s) => {
      if ((s.name || '').toLowerCase().includes(q)) return true
      return (s.osu_files || []).some((f) =>
        (f.name || '').toLowerCase().includes(q)
        || (f.version || '').toLowerCase().includes(q)
      )
    })
  }, [detail, query])

  function pickOsu(song, osu) {
    playTap()
    const audio = (song.audio_files && song.audio_files[0]?.path) || null
    onSelectBeatmap(osu.path, audio)
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="block text-sm text-muted-foreground">Beatmap</label>
        <Link to="/songs" className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline">
          Manage Song Libraries
        </Link>
      </div>

      {loadingList ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
          <Loader2 size={14} className="animate-spin" /> Loading libraries…
        </div>
      ) : libraries.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-secondary/20 p-4 text-sm text-muted-foreground space-y-2">
          <p>No song libraries yet.</p>
          <Link to="/songs" className="text-foreground underline underline-offset-2">
            Add a Song Library
          </Link>
          <span> first — each subfolder should be an extracted osu! set.</span>
        </div>
      ) : (
        <>
          <select
            value={libId}
            onChange={(e) => { playClick(); setLibId(e.target.value) }}
            className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm"
          >
            <option value="">Select song library…</option>
            {libraries.map((lib) => (
              <option key={lib.id} value={lib.id}>
                {lib.name} ({lib.song_count} songs)
              </option>
            ))}
          </select>

          {libId && (
            <>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter songs or difficulties…"
                className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />

              {loadingDetail ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-3">
                  <Loader2 size={14} className="animate-spin" /> Loading songs…
                </div>
              ) : (
                <div className="rounded-md border border-border bg-secondary/15 max-h-72 overflow-auto divide-y divide-border">
                  {songs.length === 0 ? (
                    <p className="p-4 text-sm text-muted-foreground text-center">
                      {query ? 'No matches.' : 'No songs in this library.'}
                    </p>
                  ) : (
                    songs.map((song) => {
                      const open = !!expanded[song.path]
                      const selectedHere = (song.osu_files || []).some((f) => f.path === beatPath)
                      return (
                        <div key={song.path} className={cn(selectedHere && 'bg-primary/5')}>
                          <button
                            type="button"
                            onClick={() => {
                              playClick()
                              setExpanded((prev) => ({ ...prev, [song.path]: !open }))
                            }}
                            className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-secondary/50 transition-colors"
                          >
                            {open
                              ? <ChevronDown size={14} className="text-muted-foreground shrink-0" />
                              : <ChevronRight size={14} className="text-muted-foreground shrink-0" />}
                            <Music2 size={14} className="text-muted-foreground shrink-0" />
                            <span className="text-sm font-medium truncate flex-1">{song.name}</span>
                            <span className="text-[11px] text-muted-foreground shrink-0">
                              {(song.osu_files || []).length} maps
                            </span>
                          </button>
                          {open && (
                            <ul className="pb-2 px-3 pl-9 space-y-0.5">
                              {(song.osu_files || []).map((f) => {
                                const active = f.path === beatPath
                                return (
                                  <li key={f.path}>
                                    <button
                                      type="button"
                                      onClick={() => pickOsu(song, f)}
                                      className={cn(
                                        'w-full flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors',
                                        active
                                          ? 'bg-primary text-primary-foreground'
                                          : 'hover:bg-secondary text-muted-foreground hover:text-foreground'
                                      )}
                                      title={f.path}
                                    >
                                      {active ? <Check size={14} className="shrink-0" /> : <FileText size={14} className="shrink-0 opacity-70" />}
                                      <span className="font-mono text-xs truncate flex-1">
                                        {f.version ? `[${f.version}]` : f.name}
                                      </span>
                                      <span className={cn('text-[11px] shrink-0', active ? 'opacity-90' : 'opacity-70')}>
                                        {f.size_label || formatSize(f.size)}
                                      </span>
                                    </button>
                                  </li>
                                )
                              })}
                              {(song.audio_files || []).map((a) => (
                                <li key={a.path} className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground">
                                  <FileAudio size={12} className="shrink-0 opacity-70" />
                                  <span className="font-mono truncate">{a.name}</span>
                                  {songPath === a.path && (
                                    <span className="text-[10px] uppercase tracking-wide opacity-80">linked</span>
                                  )}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )
                    })
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}

      {beatPath && (
        <p className="text-xs text-muted-foreground font-mono truncate" title={beatPath}>
          Selected: {beatPath.split(/[/\\]/).pop()}
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
