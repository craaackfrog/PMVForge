import { useEffect, useState } from 'react'
import { X, Loader2, Search, Check, Link2 } from 'lucide-react'
import { playTap, playDone, playError, playClick } from '../lib/sounds'

const EXIT_MS = 220

/**
 * Large modal: match a library clip to a ThePornDB scene/movie,
 * rename (Stash pattern), push tags, hard-link to co-performer libraries.
 */
export default function SceneMatchModal({ libraryId, libraryName, clip, onClose, onApplied }) {
  const [visible, setVisible] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const closedRef = useState({ current: false })[0]

  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [selected, setSelected] = useState(null)
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState(null)
  const [linkNames, setLinkNames] = useState([])
  const [createMissing, setCreateMissing] = useState(true)

  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(id)
  }, [])

  useEffect(() => {
    // auto-search from filename on open
    if (clip?.path) search(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip?.path, libraryId])

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') requestClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function requestClose() {
    if (closedRef.current) return
    closedRef.current = true
    setLeaving(true)
    setVisible(false)
    window.setTimeout(() => onClose?.(), EXIT_MS)
  }

  async function search(fromFile = false) {
    playTap()
    setLoading(true)
    setError(null)
    setSelected(null)
    try {
      const body = {
        path: fromFile || !query.trim() ? clip.path : undefined,
        query: query.trim() || undefined,
        use_parse: true,
        page: 1,
      }
      const res = await fetch(`/api/libraries/${libraryId}/scene/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || res.statusText)
      setResults(data.results || [])
      if (data.seed_query) setQuery(data.seed_query)
      if (!(data.results || []).length) setError('No matches — try different keywords.')
    } catch (e) {
      playError()
      setError(e.message)
      setResults([])
    } finally {
      setLoading(false)
    }
  }

  function pick(scene) {
    playClick()
    setSelected(scene)
    const females = (scene.performers_female || scene.performers || [])
      .map((p) => p.name)
      .filter(Boolean)
    const others = females.filter(
      (n) => n.toLowerCase() !== (libraryName || '').toLowerCase(),
    )
    setLinkNames(others)
  }

  function toggleLink(name) {
    setLinkNames((prev) =>
      prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name],
    )
  }

  async function apply() {
    if (!selected) return
    playTap()
    setApplying(true)
    setError(null)
    try {
      const res = await fetch(`/api/libraries/${libraryId}/scene/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: clip.path,
          scene: selected,
          rename: true,
          push_tags: true,
          link_performers: linkNames,
          create_missing_libraries: createMissing,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || res.statusText)
      playDone()
      onApplied?.(data)
      requestClose()
    } catch (e) {
      playError()
      setError(e.message)
    } finally {
      setApplying(false)
    }
  }

  const open = visible && !leaving
  const females = selected
    ? (selected.performers_female || selected.performers || []).filter((p) => p.name)
    : []

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-6" role="dialog" aria-modal="true">
      <div
        className="absolute inset-0 bg-black/75 backdrop-blur-md transition-opacity"
        style={{ opacity: open ? 1 : 0, transitionDuration: `${EXIT_MS}ms` }}
        onClick={requestClose}
      />
      <div
        className="relative z-10 w-full max-w-6xl max-h-[92vh] rounded-lg border border-border bg-card shadow-2xl overflow-hidden flex flex-col transition-[opacity,transform]"
        style={{
          opacity: open ? 1 : 0,
          transform: open ? 'scale(1)' : 'scale(0.97)',
          transitionDuration: `${EXIT_MS}ms`,
        }}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-3 border-b border-border shrink-0">
          <div className="min-w-0">
            <p className="text-sm font-medium">Match scene — ThePornDB</p>
            <p className="text-xs text-muted-foreground font-mono truncate" title={clip?.path}>
              {clip?.name || clip?.path}
            </p>
          </div>
          <button type="button" onClick={requestClose} className="p-1.5 rounded-md hover:bg-secondary" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[1fr_1.1fr] divide-y lg:divide-y-0 lg:divide-x divide-border overflow-hidden">
          {/* Search + results */}
          <div className="flex flex-col min-h-0 min-w-0">
            <div className="p-3 border-b border-border flex gap-2 shrink-0">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && search(false)}
                placeholder="Keywords / studio / title…"
                className="flex-1 min-w-0 px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <button
                type="button"
                onClick={() => search(false)}
                disabled={loading}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50"
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                Search
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {loading && (
                <p className="text-sm text-muted-foreground p-4 flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin" /> Searching…
                </p>
              )}
              {!loading && results.map((r) => {
                const active = selected?.id === r.id
                return (
                  <button
                    key={`${r.kind}-${r.id}`}
                    type="button"
                    onClick={() => pick(r)}
                    className={
                      active
                        ? 'w-full text-left flex gap-3 p-2 rounded-md bg-primary/15 border border-primary/40'
                        : 'w-full text-left flex gap-3 p-2 rounded-md hover:bg-secondary border border-transparent'
                    }
                  >
                    <div className="w-16 h-12 rounded bg-secondary shrink-0 overflow-hidden">
                      {r.poster ? (
                        <img src={r.poster} alt="" className="w-full h-full object-cover" />
                      ) : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{r.title || 'Untitled'}</p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {[r.studio, r.date, r.kind].filter(Boolean).join(' · ')}
                      </p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {(r.performers_female || r.performers || []).map((p) => p.name).join(', ')}
                      </p>
                    </div>
                    {active && <Check size={16} className="text-primary shrink-0 mt-1" />}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Detail + apply */}
          <div className="flex flex-col min-h-0 overflow-y-auto p-4 space-y-4">
            {!selected ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Select a result to preview details.</p>
            ) : (
              <>
                {selected.poster && (
                  <img src={selected.poster} alt="" className="w-full max-h-48 object-contain rounded-md bg-black" />
                )}
                <div>
                  <h3 className="font-serif text-xl leading-tight">{selected.title}</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    {[selected.studio, selected.date, selected.kind].filter(Boolean).join(' · ')}
                  </p>
                </div>
                {selected.description && (
                  <p className="text-xs text-muted-foreground leading-relaxed line-clamp-6">{selected.description}</p>
                )}
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5">Cast (women)</p>
                  <div className="flex flex-wrap gap-1.5">
                    {females.map((p) => (
                      <span key={p.name} className="px-2 py-0.5 rounded text-xs bg-secondary">
                        {p.name}
                      </span>
                    ))}
                    {!females.length && <span className="text-xs text-muted-foreground">None listed</span>}
                  </div>
                </div>
                {!!(selected.tags || []).length && (
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5">Tags → clip</p>
                    <div className="flex flex-wrap gap-1">
                      {selected.tags.slice(0, 40).map((t) => (
                        <span key={t} className="px-1.5 py-0.5 rounded text-[10px] bg-secondary/80 text-muted-foreground">
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="rounded-md border border-border p-3 space-y-2">
                  <p className="text-xs font-medium flex items-center gap-1.5">
                    <Link2 size={14} /> Hard-link into libraries
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Same NTFS volume required. Missing libraries become sibling folders of the current library root.
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {females
                      .filter((p) => p.name.toLowerCase() !== (libraryName || '').toLowerCase())
                      .map((p) => {
                        const on = linkNames.includes(p.name)
                        return (
                          <button
                            key={p.name}
                            type="button"
                            onClick={() => toggleLink(p.name)}
                            className={
                              on
                                ? 'px-2 py-0.5 rounded text-xs bg-primary text-primary-foreground'
                                : 'px-2 py-0.5 rounded text-xs bg-secondary text-muted-foreground'
                            }
                          >
                            {p.name}
                          </button>
                        )
                      })}
                  </div>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      checked={createMissing}
                      onChange={(e) => setCreateMissing(e.target.checked)}
                    />
                    Create missing actress libraries as siblings
                  </label>
                </div>

                <p className="text-[11px] text-muted-foreground">
                  Apply will always rename on disk (Stash pattern) and push scene tags.
                </p>
              </>
            )}
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-border shrink-0">
          <button type="button" onClick={requestClose} className="px-3 py-2 rounded-md text-sm hover:bg-secondary">
            Cancel
          </button>
          <button
            type="button"
            onClick={apply}
            disabled={!selected || applying}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
          >
            {applying ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            Apply match
          </button>
        </div>
      </div>
    </div>
  )
}
