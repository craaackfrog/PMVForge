import { useState, useEffect, useCallback } from 'react'
import {
  Library,
  FolderPlus,
  RefreshCw,
  Trash2,
  Loader2,
  Tag,
  Flame,
  CheckSquare,
  Square,
  X,
  Plus,
  HelpCircle,
  ArrowDownAZ,
  ArrowUpAZ,
  Filter,
  SlidersHorizontal,
} from 'lucide-react'
import { playClick, playTap, playDone, playError } from '../lib/sounds'
import VideoModal from '../components/VideoModal'
import SceneMatchModal from '../components/SceneMatchModal'
import PerformerCard from '../components/PerformerCard'
import ClipCard from '../components/ClipCard'
import ClipEditModal from '../components/ClipEditModal'
import { nativePick } from '../lib/nativePick'
import { cn } from '../lib/utils'


function mediaUrl(path) {
  return `/api/libraries/media?path=${encodeURIComponent(path)}`
}

function thumbUrl(path) {
  return `/api/libraries/thumbnail?path=${encodeURIComponent(path)}`
}

export default function LibrariesPage() {
  const [libraries, setLibraries] = useState([])
  const [allTags, setAllTags] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [clips, setClips] = useState([])
  const [filterTags, setFilterTags] = useState([])
  const [tagMode, setTagMode] = useState('any')
  const [minHeat, setMinHeat] = useState(1)
  const [selected, setSelected] = useState(new Set())
  const [loading, setLoading] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState(null)
  const [bulkTag, setBulkTag] = useState('')
  const [bulkHeat, setBulkHeat] = useState(3)
  const [newTag, setNewTag] = useState('')
  const [previewPath, setPreviewPath] = useState(null)
  const [matchClip, setMatchClip] = useState(null)
  const [renameClip, setRenameClip] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  const [showHelp, setShowHelp] = useState(false)
  const [folderSort, setFolderSort] = useState('az') // az | za
  const [filterOpen, setFilterOpen] = useState(false)
  const [folderFilterOpen, setFolderFilterOpen] = useState(false)
  const [unmatchedOnly, setUnmatchedOnly] = useState(false)
  const [editClip, setEditClip] = useState(null)
  const [folderQuery, setFolderQuery] = useState('')
  const [folderEthnicity, setFolderEthnicity] = useState('')
  const [folderCountry, setFolderCountry] = useState('')
  const [folderMinRating, setFolderMinRating] = useState('')

  const active = libraries.find((l) => l.id === activeId)

  const refreshList = useCallback(async () => {
    const res = await fetch('/api/libraries')
    const data = await res.json()
    setLibraries(data.libraries || [])
    setAllTags([...(data.all_tags || [])].sort((a, b) => a.localeCompare(b)))
  }, [])

  const loadClips = useCallback(async () => {
    if (!activeId) {
      setClips([])
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`/api/libraries/${activeId}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tags: filterTags,
          tag_mode: tagMode,
          min_heat: minHeat,
          max_heat: 5,
          limit: 0,
        }),
      })
      const data = await res.json()
      setClips(data.clips || [])
      setSelected(new Set())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [activeId, filterTags, tagMode, minHeat])

  useEffect(() => {
    refreshList().catch((e) => setError(e.message))
  }, [refreshList])

  useEffect(() => {
    loadClips()
  }, [loadClips])

  async function addLibrary() {
    playTap()
    try {
      const pick = await nativePick('/system/pick-folder', { title: 'Select clips folder' })
      if (pick.cancelled || !pick.path) return
      setLoading(true)
      const res = await fetch('/api/libraries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: pick.path.split(/[/\\]/).filter(Boolean).pop() || 'Library',
          root_path: pick.path,
          recurse: true,
          scan: true,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || res.statusText)
      }
      const lib = await res.json()
      await refreshList()
      setActiveId(lib.id)
      playDone()
    } catch (e) {
      playError()
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function rescan() {
    if (!activeId) return
    playTap()
    setScanning(true)
    try {
      const res = await fetch(`/api/libraries/${activeId}/scan`, { method: 'POST' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || 'Scan failed')
      await refreshList()
      await loadClips()
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
    if (!confirm('Remove this library from PMVForge? Files on disk are not deleted.')) return
    playClick()
    await fetch(`/api/libraries/${activeId}`, { method: 'DELETE' })
    setActiveId(null)
    await refreshList()
  }

  function toggleFilterTag(tag) {
    playClick()
    setFilterTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    )
  }

  function toggleSelect(path) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  function selectAll() {
    playClick()
    if (selected.size === clips.length) setSelected(new Set())
    else setSelected(new Set(clips.map((c) => c.path)))
  }

  async function setClipHeat(path, heat) {
    playClick()
    await fetch(`/api/libraries/${activeId}/clip`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, heat }),
    })
    setClips((prev) => prev.map((c) => (c.path === path ? { ...c, heat } : c)))
  }

  async function toggleClipTag(path, tag, has) {
    playClick()
    const clip = clips.find((c) => c.path === path)
    if (!clip) return
    const tags = has
      ? (clip.tags || []).filter((t) => t !== tag)
      : [...(clip.tags || []), tag]
    await fetch(`/api/libraries/${activeId}/clip`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, tags }),
    })
    setClips((prev) => prev.map((c) => (c.path === path ? { ...c, tags } : c)))
  }

  async function applyBulk() {
    if (!activeId || selected.size === 0) return
    playTap()
    const body = { paths: [...selected] }
    if (bulkTag.trim()) body.add_tags = [bulkTag.trim().toLowerCase()]
    body.heat = bulkHeat
    const res = await fetch(`/api/libraries/${activeId}/clips/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      playError()
      return
    }
    playDone()
    setBulkTag('')
    await loadClips()
    await refreshList()
  }

  async function createTag() {
    const tag = newTag.trim().toLowerCase()
    if (!tag) return
    playTap()
    const res = await fetch('/api/libraries/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag, library_id: null }),
    })
    if (!res.ok) {
      playError()
      setError((await res.json().catch(() => ({}))).detail || 'Could not add tag')
      return
    }
    const data = await res.json().catch(() => ({}))
    if (Array.isArray(data.tags)) {
      setAllTags([...data.tags].sort((a, b) => a.localeCompare(b)))
    }
    setNewTag('')
    playDone()
    await refreshList()
  }

  async function deleteTag(tag) {
    if (!confirm(`Delete tag "${tag}" and strip it from clips?`)) return
    playClick()
    // Always delete from the global vocabulary so the Tags panel updates immediately
    const qs = new URLSearchParams()
    qs.set('strip_from_clips', 'true')
    const res = await fetch(`/api/libraries/tags/${encodeURIComponent(tag)}?${qs}`, { method: 'DELETE' })
    if (!res.ok) {
      playError()
      setError((await res.json().catch(() => ({}))).detail || 'Could not delete tag')
      return
    }
    const data = await res.json().catch(() => ({}))
    if (Array.isArray(data.tags)) {
      setAllTags([...data.tags].sort((a, b) => a.localeCompare(b)))
    } else {
      setAllTags((prev) => prev.filter((t) => t !== tag))
    }
    setFilterTags((prev) => prev.filter((t) => t !== tag))
    await refreshList()
    if (activeId) await loadClips()
  }

  // Single sorted vocabulary for the whole UI (global tags store)
  const vocab = [...allTags].sort((a, b) => a.localeCompare(b))
  const visibleClips = unmatchedOnly
    ? clips.filter((c) => !(c.scene?.tpdb_id || c.scene?.title))
    : clips

  const ethnicityOptions = [...new Set(
    libraries.map((l) => (l.performer?.ethnicity || '').trim()).filter(Boolean)
  )].sort((a, b) => a.localeCompare(b))
  const countryOptions = [...new Set(
    libraries.map((l) => {
      const p = l.performer || {}
      return (p.flag_country || p.country || p.birthplace || '').trim()
    }).filter(Boolean)
  )].sort((a, b) => a.localeCompare(b))

  const sortedLibraries = [...libraries]
    .filter((lib) => {
      const q = folderQuery.trim().toLowerCase()
      if (q) {
        const name = (lib.name || '').toLowerCase()
        const pname = (lib.performer?.name || '').toLowerCase()
        if (!name.includes(q) && !pname.includes(q)) return false
      }
      const perf = lib.performer || {}
      if (folderEthnicity && (perf.ethnicity || '') !== folderEthnicity) return false
      if (folderCountry) {
        const c = `${perf.flag_country || ''} ${perf.country || ''} ${perf.birthplace || ''}`.toLowerCase()
        if (!c.includes(folderCountry.toLowerCase())) return false
      }
      if (folderMinRating !== '' && folderMinRating != null) {
        const r = Number(perf.rating)
        if (Number.isNaN(r) || r < Number(folderMinRating)) return false
      }
      return true
    })
    .sort((a, b) => {
      const cmp = (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' })
      return folderSort === 'za' ? -cmp : cmp
    })


  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl tracking-tight">Clip Libraries</h1>
          <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
            Point at a clips folder, then tag and rate each file. In Generate, pick{' '}
            <strong className="text-foreground">Library</strong> mode to pull by tag + heat.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowHelp((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-secondary text-sm hover:bg-accent"
          >
            <HelpCircle size={15} />
            How to tag
          </button>
          <button
            type="button"
            onClick={addLibrary}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
          >
            <FolderPlus size={16} />
            Add folder
          </button>
        </div>
      </header>

      {showHelp && (
        <div className="rounded-lg border border-border bg-card p-4 text-sm space-y-2 text-muted-foreground">
          <p className="text-foreground font-medium">How tagging works</p>
          <ol className="list-decimal list-inside space-y-1">
            <li>
              <strong className="text-foreground">Add folder</strong> indexes paths only (no upload).
            </li>
            <li>
              Under each clip, click a <strong className="text-foreground">tag chip</strong> to toggle it on/off.
              Lit = applied; muted = not on this clip.
            </li>
            <li>
              Use <strong className="text-foreground">1–5 heat</strong> to rank intensity. Generate prefers higher heat.
            </li>
            <li>
              Select many clips → type a tag / set heat → <strong className="text-foreground">Apply</strong>.
            </li>
            <li>
              Manage vocabulary in the right <strong className="text-foreground">Tags</strong> panel.
            </li>
            <li>
              <strong className="text-foreground">Play</strong> opens a preview modal.
            </li>
          </ol>
        </div>
      )}

      {error && (
        <p className="text-sm text-destructive">
          {typeof error === 'string' ? error : JSON.stringify(error)}{' '}
          <button type="button" className="underline" onClick={() => setError(null)}>
            dismiss
          </button>
        </p>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[250px_minmax(0,1fr)_250px] gap-4 items-start">
        <aside className="rounded-lg border border-border bg-card p-3 space-y-1.5 flex flex-col max-h-[min(78vh,900px)] relative">
          <div className="flex items-center gap-1 px-1 mb-1 shrink-0">
            <p className="text-xs uppercase tracking-wide text-muted-foreground flex-1">Folders</p>
            <button
              type="button"
              title="Folder filters"
              onClick={() => {
                playClick()
                setFolderFilterOpen((v) => !v)
              }}
              className={cn(
                'p-1.5 rounded-md transition-colors',
                folderFilterOpen || folderQuery || folderEthnicity || folderCountry || folderMinRating !== ''
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
              )}
            >
              <Filter size={14} />
            </button>
            <button
              type="button"
              title={folderSort === 'az' ? 'Sort Z–A' : 'Sort A–Z'}
              onClick={() => {
                playClick()
                setFolderSort((s) => (s === 'az' ? 'za' : 'az'))
              }}
              className="p-1.5 rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
            >
              {folderSort === 'az' ? <ArrowDownAZ size={14} /> : <ArrowUpAZ size={14} />}
            </button>
            <button
              type="button"
              title="Rescan library"
              onClick={rescan}
              disabled={!activeId || scanning}
              className="p-1.5 rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-30 transition-colors"
            >
              {scanning ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            </button>
            <button
              type="button"
              title="Remove library"
              onClick={removeLibrary}
              disabled={!activeId}
              className="p-1.5 rounded-md text-muted-foreground hover:bg-secondary hover:text-destructive disabled:opacity-30 transition-colors"
            >
              <Trash2 size={14} />
            </button>
          </div>
          {folderFilterOpen && (
            <div className="absolute left-2 right-2 top-10 z-20 rounded-lg border border-border bg-card p-3 shadow-xl space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Folder filters</p>
                <button type="button" className="p-1 rounded hover:bg-secondary" onClick={() => setFolderFilterOpen(false)}>
                  <X size={12} />
                </button>
              </div>
              <input
                type="search"
                value={folderQuery}
                onChange={(e) => setFolderQuery(e.target.value)}
                placeholder="Search folders…"
                className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <select
                value={folderEthnicity}
                onChange={(e) => setFolderEthnicity(e.target.value)}
                className="w-full px-2 py-1 rounded-md bg-secondary border border-border text-[11px]"
              >
                <option value="">All ethnicities</option>
                {ethnicityOptions.map((e) => (
                  <option key={e} value={e}>{e}</option>
                ))}
              </select>
              <select
                value={folderCountry}
                onChange={(e) => setFolderCountry(e.target.value)}
                className="w-full px-2 py-1 rounded-md bg-secondary border border-border text-[11px]"
              >
                <option value="">All countries</option>
                {countryOptions.map((e) => (
                  <option key={e} value={e}>{e}</option>
                ))}
              </select>
              <select
                value={folderMinRating}
                onChange={(e) => setFolderMinRating(e.target.value)}
                className="w-full px-2 py-1 rounded-md bg-secondary border border-border text-[11px]"
              >
                <option value="">Any rating</option>
                {[9, 8, 7, 6, 5].map((r) => (
                  <option key={r} value={r}>{r}+ rating</option>
                ))}
              </select>
              {(folderQuery || folderEthnicity || folderCountry || folderMinRating !== '') && (
                <button
                  type="button"
                  className="text-[10px] text-muted-foreground hover:text-foreground underline"
                  onClick={() => {
                    setFolderQuery('')
                    setFolderEthnicity('')
                    setFolderCountry('')
                    setFolderMinRating('')
                  }}
                >
                  Clear folder filters
                </button>
              )}
            </div>
          )}
          <div className="flex-1 min-h-0 overflow-y-auto space-y-1 pr-0.5">
          {libraries.length === 0 && (
            <p className="text-sm text-muted-foreground px-1 py-3">No libraries yet. Hit Add folder.</p>
          )}
          {sortedLibraries.length === 0 && libraries.length > 0 && (
            <p className="text-xs text-muted-foreground px-1 py-2">No folders match filters.</p>
          )}
          {sortedLibraries.map((lib) => (
            <button
              key={lib.id}
              type="button"
              onClick={() => {
                playClick()
                setActiveId(lib.id)
              }}
              className={
                activeId === lib.id
                  ? 'w-full text-left px-3 py-2.5 rounded-md text-sm bg-accent text-accent-foreground'
                  : 'w-full text-left px-3 py-2.5 rounded-md text-sm text-muted-foreground hover:bg-secondary hover:text-foreground'
              }
            >
              <div className="flex items-center gap-2 font-medium text-foreground">
                <Library size={14} className="shrink-0" />
                <span className="truncate">{lib.name}</span>
              </div>
              <div className="text-xs mt-0.5 opacity-70 pl-5">
                {lib.clip_count} clips
                {lib.performer?.ethnicity ? ` · ${lib.performer.ethnicity}` : ''}
                {lib.performer?.rating != null && lib.performer.rating !== '' ? ` · ★${Number(lib.performer.rating).toFixed(1)}` : ''}
              </div>
            </button>
          ))}
          </div>
        </aside>

        <section className="min-w-0 space-y-3">
          {!activeId ? (
            <div className="rounded-lg border border-dashed border-border bg-card/50 p-12 text-center text-sm text-muted-foreground">
              Select or add a library to browse clips
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 relative">
                <button
                  type="button"
                  onClick={() => {
                    playClick()
                    setFilterOpen((v) => !v)
                  }}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm border border-border',
                    filterOpen || filterTags.length || minHeat > 1 || unmatchedOnly
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-secondary hover:bg-accent',
                  )}
                >
                  <SlidersHorizontal size={14} />
                  Filters
                  {(filterTags.length > 0 || minHeat > 1 || unmatchedOnly) && (
                    <span className="text-[10px] opacity-80">
                      ({filterTags.length + (minHeat > 1 ? 1 : 0) + (unmatchedOnly ? 1 : 0)})
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={selectAll}
                  className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  {selected.size === visibleClips.length && visibleClips.length > 0 ? (
                    <CheckSquare size={14} />
                  ) : (
                    <Square size={14} />
                  )}
                  Select all
                </button>
                <span className="text-xs text-muted-foreground ml-auto">
                  {loading ? 'Loading…' : `${visibleClips.length} clips`}
                </span>

                {filterOpen && (
                  <div className="absolute left-0 top-full mt-2 z-20 w-full max-w-md rounded-lg border border-border bg-card p-3 shadow-xl space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Clip filters</p>
                      <button type="button" className="p-1 rounded hover:bg-secondary" onClick={() => setFilterOpen(false)}>
                        <X size={14} />
                      </button>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-muted-foreground">Tag mode</span>
                      {['any', 'all'].map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => {
                            playClick()
                            setTagMode(m)
                          }}
                          className={
                            tagMode === m
                              ? 'px-2 py-0.5 rounded text-xs bg-primary text-primary-foreground'
                              : 'px-2 py-0.5 rounded text-xs bg-secondary hover:bg-accent'
                          }
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1.5">Tags</p>
                      <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
                        {vocab.map((tag) => (
                          <button
                            key={tag}
                            type="button"
                            onClick={() => toggleFilterTag(tag)}
                            className={
                              filterTags.includes(tag)
                                ? 'px-2 py-0.5 rounded-full text-xs bg-primary text-primary-foreground'
                                : 'px-2 py-0.5 rounded-full text-xs bg-secondary hover:bg-accent'
                            }
                          >
                            {tag}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs text-muted-foreground mr-1">Min heat</span>
                      {[1, 2, 3, 4, 5].map((h) => (
                        <button
                          key={h}
                          type="button"
                          onClick={() => {
                            playClick()
                            setMinHeat(h)
                          }}
                          className="p-1 rounded hover:bg-secondary"
                          title={`Min heat ${h}`}
                        >
                          <Flame
                            size={16}
                            className={minHeat >= h ? 'text-orange-500 fill-orange-500' : 'text-muted-foreground'}
                          />
                        </button>
                      ))}
                    </div>
                    <label className="flex items-center gap-2 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={unmatchedOnly}
                        onChange={(e) => {
                          playClick()
                          setUnmatchedOnly(e.target.checked)
                        }}
                      />
                      Unmatched only (no ThePornDB scene)
                    </label>
                  </div>
                )}
              </div>

              {selected.size > 0 && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-pink-500/30 bg-pink-500/5 px-3 py-2">
                  <span className="text-sm font-medium">{selected.size} selected</span>
                  <input
                    type="text"
                    value={bulkTag}
                    onChange={(e) => setBulkTag(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && applyBulk()}
                    placeholder="Add tag to selected…"
                    className="px-2 py-1 rounded-md bg-secondary border border-border text-sm w-40"
                  />
                  <div className="flex items-center gap-0.5" title="Set heat">
                    {[1, 2, 3, 4, 5].map((h) => (
                      <button
                        key={h}
                        type="button"
                        onClick={() => setBulkHeat(h)}
                        className="p-0.5 rounded hover:bg-secondary"
                      >
                        <Flame
                          size={16}
                          className={bulkHeat >= h ? 'text-orange-500 fill-orange-500' : 'text-muted-foreground'}
                        />
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={applyBulk}
                    className="px-3 py-1 rounded-md bg-pink-500 text-white text-sm font-medium hover:bg-pink-400"
                  >
                    Apply
                  </button>
                </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3 max-h-[min(68vh,820px)] overflow-y-auto pr-1">
                {visibleClips.map((clip) => (
                  <ClipCard
                    key={clip.path}
                    clip={clip}
                    selected={selected.has(clip.path)}
                    onToggleSelect={toggleSelect}
                    onPlay={setPreviewPath}
                    onEdit={setEditClip}
                  />
                ))}
              </div>
              {!loading && visibleClips.length === 0 && (
                <p className="p-8 text-sm text-muted-foreground text-center rounded-lg border border-dashed border-border">
                  No clips match filters. Clear filters or rescan.
                </p>
              )}

            </>
          )}
        </section>

        <aside className="space-y-3">
          {activeId && <PerformerCard libraryId={activeId} />}
          <details className="rounded-lg border border-border bg-card group/tags">
            <summary className="cursor-pointer select-none list-none px-4 py-3 flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-2 font-serif text-base">
                <Tag size={15} />
                Tags
              </span>
              <span className="text-muted-foreground text-sm transition-transform group-open/tags:rotate-180">▾</span>
            </summary>
            <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
              <p className="text-xs text-muted-foreground leading-relaxed">
                Create custom tags here. Click a chip under any clip to apply it.
              </p>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && createTag()}
                  placeholder="New tag…"
                  className="flex-1 min-w-0 px-2 py-1.5 rounded-md bg-secondary border border-border text-sm"
                />
                <button
                  type="button"
                  onClick={createTag}
                  disabled={!newTag.trim()}
                  className="px-2.5 rounded-md bg-primary text-primary-foreground disabled:opacity-40"
                >
                  <Plus size={16} />
                </button>
              </div>
              <ul className="space-y-1 max-h-[40vh] overflow-y-auto">
                {vocab.map((tag) => (
                  <li
                    key={tag}
                    className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md hover:bg-secondary/60 text-sm group"
                  >
                    <span className="truncate">{tag}</span>
                    <button
                      type="button"
                      title="Delete tag"
                      onClick={() => deleteTag(tag)}
                      className="opacity-40 group-hover:opacity-100 p-1 rounded text-muted-foreground hover:text-destructive"
                    >
                      <X size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </details>
        </aside>
      </div>

      {previewPath && (
        <VideoModal
          src={mediaUrl(previewPath)}
          title={previewPath.split(/[/\\]/).pop()}
          onClose={() => setPreviewPath(null)}
        />
      )}
      {editClip && (
        <ClipEditModal
          libraryId={activeId}
          clip={editClip}
          onClose={() => setEditClip(null)}
          onSaved={async () => {
            setEditClip(null)
            await loadClips()
          }}
          onMatch={(c) => {
            setEditClip(null)
            setMatchClip(c)
          }}
        />
      )}
      {matchClip && (
        <SceneMatchModal
          libraryId={activeId}
          libraryName={active?.name}
          clip={matchClip}
          onClose={() => setMatchClip(null)}
          onApplied={async () => {
            setMatchClip(null)
            await loadClips()
            await refreshList()
          }}
        />
      )}
      {renameClip && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setRenameClip(null)} />
          <div className="relative z-10 w-full max-w-lg rounded-lg border border-border bg-card p-4 space-y-3 shadow-xl">
            <p className="text-sm font-medium">Rename file</p>
            <input
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm font-mono"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button type="button" className="px-3 py-1.5 text-sm rounded-md hover:bg-secondary" onClick={() => setRenameClip(null)}>Cancel</button>
              <button
                type="button"
                className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground"
                onClick={async () => {
                  try {
                    const res = await fetch(`/api/libraries/${activeId}/clip/rename`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ path: renameClip.path, filename: renameValue }),
                    })
                    const data = await res.json().catch(() => ({}))
                    if (!res.ok) throw new Error(data.detail || res.statusText)
                    setRenameClip(null)
                    await loadClips()
                  } catch (e) {
                    setError(e.message)
                  }
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

