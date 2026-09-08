import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  History, Film, Heart, Trash2, RefreshCw, Loader2, Eye, ExternalLink, XCircle, CheckCircle2,
} from 'lucide-react'
import VideoModal from '../components/VideoModal'
import { playClick, playTap, playDone, playError } from '../lib/sounds'

export default function HistoryPage() {
  const navigate = useNavigate()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [previewSrc, setPreviewSrc] = useState(null)
  const [previewTitle, setPreviewTitle] = useState('')
  const [clearing, setClearing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/projects/history?limit=50')
      if (!res.ok) throw new Error('Failed to load history')
      const data = await res.json()
      setItems(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function clearAll() {
    if (!confirm('Clear all history entries? Output files on disk are kept.')) return
    playTap()
    setClearing(true)
    try {
      const res = await fetch('/api/projects/history', { method: 'DELETE' })
      if (!res.ok) throw new Error('Clear failed')
      setItems([])
      playDone()
    } catch (e) {
      playError()
      setError(e.message)
    } finally {
      setClearing(false)
    }
  }

  async function openCockHero(item) {
    playTap()
    const video = item.output
    const beats = item.beat_input || item.meta?.beat_input
    if (!video) { playError(); setError('No output video path on this entry'); return }
    if (!beats) { playError(); setError('No beatmap path stored — open Cock Hero and pick files manually'); return }
    try {
      const res = await fetch('/api/cockhero/from-pmv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          video_path: video,
          beats_path: beats,
          original_beats_path: beats,
          label: item.title || 'pmv',
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || res.statusText)
      }
      const data = await res.json()
      navigate(`/cockhero?session=${data.session_id}`)
    } catch (e) {
      playError()
      setError(e.message)
    }
  }

  function formatTime(ts) {
    if (!ts) return ''
    try { return new Date(ts).toLocaleString() } catch { return ts }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl tracking-tight">History</h1>
          <p className="text-muted-foreground mt-1">Recent PMV jobs and exports from this machine.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => { playClick(); load() }} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-secondary text-sm hover:bg-accent">
            <RefreshCw size={14} /> Refresh
          </button>
          <button type="button" onClick={clearAll} disabled={clearing || items.length === 0} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-secondary text-sm text-destructive hover:bg-accent disabled:opacity-40">
            {clearing ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Clear
          </button>
        </div>
      </header>
      {error && (
        <p className="text-sm text-destructive">{error}{' '}<button type="button" className="underline" onClick={() => setError(null)}>dismiss</button></p>
      )}
      {loading ? (
        <div className="rounded-lg border border-border bg-card p-8 flex items-center justify-center gap-2 text-muted-foreground">
          <Loader2 size={16} className="animate-spin" /><span className="text-sm">Loading history…</span>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
          <History size={28} className="mx-auto mb-3 opacity-40" />
          <p className="text-sm">No history yet. Generate a PMV and it will show up here.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((item, i) => {
            const ok = item.success !== false
            const type = item.type || 'pmv'
            return (
              <li key={`${item.timestamp || i}-${item.output || item.title || i}`} className="rounded-lg border border-border bg-card p-4 flex flex-wrap gap-4 items-start">
                <div className="p-2 rounded-md bg-secondary shrink-0">
                  {type === 'cockhero' ? <Heart size={18} className="text-pink-400" /> : <Film size={18} />}
                </div>
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-serif text-lg truncate">{item.title || 'Untitled'}</h2>
                    {ok ? <CheckCircle2 size={14} className="text-green-500 shrink-0" /> : <XCircle size={14} className="text-destructive shrink-0" />}
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">{type}</span>
                  </div>
                  {item.timestamp && <p className="text-xs text-muted-foreground">{formatTime(item.timestamp)}</p>}
                  {item.output && <p className="font-mono text-xs text-muted-foreground break-all" title={item.output}>{item.output}</p>}
                </div>
                <div className="flex flex-wrap gap-2 shrink-0">
                  {ok && item.output && item.job_id && (
                    <button type="button" onClick={() => { playTap(); setPreviewSrc(`/api/generate/video/${item.job_id}`); setPreviewTitle(item.title || 'PMV') }} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-secondary text-sm hover:bg-accent">
                      <Eye size={14} /> View
                    </button>
                  )}
                  {ok && item.output && (
                    <button type="button" onClick={() => openCockHero(item)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-pink-500/15 text-pink-400 text-sm hover:bg-pink-500/25">
                      <Heart size={14} /> Cock Hero
                    </button>
                  )}
                  {type === 'pmv' && (
                    <button type="button" onClick={() => { playClick(); navigate('/generate') }} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-secondary text-sm hover:bg-accent">
                      <ExternalLink size={14} /> Generate
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {previewSrc && <VideoModal src={previewSrc} title={previewTitle} onClose={() => setPreviewSrc(null)} />}
    </div>
  )
}
