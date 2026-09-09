import { useEffect, useState } from 'react'
import { Loader2, RefreshCw, User } from 'lucide-react'
import { playTap, playError } from '../lib/sounds'

function imageUrl(path) {
  if (!path) return null
  return `/api/libraries/performer-image?path=${encodeURIComponent(path)}`
}

export default function PerformerCard({ libraryId }) {
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    if (!libraryId) {
      setProfile(null)
      return
    }
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/libraries/${libraryId}/performer`)
        const data = await res.json().catch(() => ({}))
        if (!cancelled) setProfile(data)
      } catch {
        if (!cancelled) setProfile(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [libraryId])

  async function refresh() {
    if (!libraryId) return
    playTap()
    setRefreshing(true)
    try {
      const res = await fetch(`/api/libraries/${libraryId}/performer/refresh`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || res.statusText)
      setProfile(data)
    } catch (e) {
      playError()
      setProfile((p) => ({ ...(p || {}), error: e.message }))
    } finally {
      setRefreshing(false)
    }
  }

  if (!libraryId) return null

  const img = imageUrl(profile?.image_path)
  const extras = profile?.extras || {}
  const extraBits = [
    extras.ethnicity,
    extras.country || extras.birthplace,
    extras.height,
    extras.measurements || extras.cupsize,
  ].filter(Boolean)

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="aspect-square bg-secondary/40 flex items-center justify-center relative">
        {loading ? (
          <Loader2 size={22} className="animate-spin text-muted-foreground" />
        ) : img ? (
          <img src={img} alt={profile?.name || ''} className="w-full h-full object-cover" />
        ) : (
          <User size={40} className="text-muted-foreground opacity-40" />
        )}
      </div>
      <div className="p-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-serif text-xl truncate">{profile?.name || '—'}</p>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {profile?.override ? 'local override' : profile?.source === 'theporndb' || profile?.source === 'cache' ? 'ThePornDB' : 'no profile'}
              {profile?.cached && !profile?.override ? ' · cached' : ''}
            </p>
          </div>
          <button
            type="button"
            title="Refresh from ThePornDB"
            onClick={refresh}
            disabled={refreshing || loading}
            className="p-1.5 rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-40 shrink-0"
          >
            {refreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          </button>
        </div>
        {extraBits.length > 0 && (
          <p className="text-xs text-muted-foreground leading-snug">{extraBits.join(' · ')}</p>
        )}
        {profile?.bio ? (
          <p className="text-xs text-muted-foreground leading-relaxed line-clamp-4">{profile.bio}</p>
        ) : null}
        {profile?.aliases?.length > 0 && (
          <p className="text-[11px] text-muted-foreground truncate" title={profile.aliases.join(', ')}>
            a.k.a. {profile.aliases.slice(0, 4).join(', ')}
            {profile.aliases.length > 4 ? '…' : ''}
          </p>
        )}
        {profile?.error && (
          <p className="text-[11px] text-destructive leading-snug">{profile.error}</p>
        )}
      </div>
    </div>
  )
}
