import { useEffect, useState, useMemo } from 'react'
import { Loader2, RefreshCw, User, Star } from 'lucide-react'
import { playTap, playError, playClick } from '../lib/sounds'
import ImageModal from './ImageModal'

function imageUrl(path) {
  if (!path) return null
  return `/api/libraries/performer-image?path=${encodeURIComponent(path)}`
}

const COUNTRY_FLAG = {
  'united states': '🇺🇸', usa: '🇺🇸', us: '🇺🇸', america: '🇺🇸',
  canada: '🇨🇦', 'united kingdom': '🇬🇧', uk: '🇬🇧', england: '🇬🇧',
  russia: '🇷🇺', ukraine: '🇺🇦', germany: '🇩🇪', france: '🇫🇷', spain: '🇪🇸',
  italy: '🇮🇹', brazil: '🇧🇷', mexico: '🇲🇽', colombia: '🇨🇴', argentina: '🇦🇷',
  venezuela: '🇻🇪', cuba: '🇨🇺', 'czech republic': '🇨🇿', czechia: '🇨🇿',
  slovakia: '🇸🇰', poland: '🇵🇱', romania: '🇷🇴', hungary: '🇭🇺', australia: '🇦🇺',
  japan: '🇯🇵', china: '🇨🇳', korea: '🇰🇷', 'south korea': '🇰🇷', philippines: '🇵🇭',
  thailand: '🇹🇭', india: '🇮🇳', netherlands: '🇳🇱', sweden: '🇸🇪', norway: '🇳🇴',
  denmark: '🇩🇰', finland: '🇫🇮', portugal: '🇵🇹', greece: '🇬🇷', turkey: '🇹🇷',
  israel: '🇮🇱', 'south africa': '🇿🇦', ireland: '🇮🇪', scotland: '🇬🇧', wales: '🇬🇧',
  austria: '🇦🇹', switzerland: '🇨🇭', belgium: '🇧🇪', latvia: '🇱🇻', lithuania: '🇱🇹',
  estonia: '🇪🇪', bulgaria: '🇧🇬', serbia: '🇷🇸', croatia: '🇭🇷', slovenia: '🇸🇮',
  dominican: '🇩🇴', 'dominican republic': '🇩🇴', 'puerto rico': '🇵🇷',
}

function flagFor(place) {
  if (!place) return ''
  const s = String(place).toLowerCase().trim()
  if (COUNTRY_FLAG[s]) return COUNTRY_FLAG[s]
  const parts = s.split(',').map((x) => x.trim()).filter(Boolean)
  for (let i = parts.length - 1; i >= 0; i--) {
    if (COUNTRY_FLAG[parts[i]]) return COUNTRY_FLAG[parts[i]]
  }
  for (const [k, flag] of Object.entries(COUNTRY_FLAG)) {
    if (s.includes(k)) return flag
  }
  return ''
}

export default function PerformerCard({ libraryId }) {
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [slide, setSlide] = useState(0)
  const [modalOpen, setModalOpen] = useState(false)

  useEffect(() => {
    if (!libraryId) {
      setProfile(null)
      return
    }
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setSlide(0)
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

  const gallery = useMemo(() => {
    const paths = profile?.image_paths?.length
      ? profile.image_paths
      : profile?.image_path
        ? [profile.image_path]
        : []
    return paths.map(imageUrl).filter(Boolean)
  }, [profile])

  async function refresh() {
    if (!libraryId) return
    playTap()
    setRefreshing(true)
    try {
      const res = await fetch(`/api/libraries/${libraryId}/performer/refresh`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || res.statusText)
      setProfile(data)
      setSlide(0)
    } catch (e) {
      playError()
      setProfile((p) => ({ ...(p || {}), error: e.message }))
    } finally {
      setRefreshing(false)
    }
  }

  if (!libraryId) return null

  const extras = profile?.extras || {}
  const race = extras.ethnicity || null
  const place = extras.birthplace || extras.country || extras.nationality || null
  const flag = flagFor(extras.country || extras.nationality || extras.birthplace)
  const rating = profile?.rating != null && profile.rating !== '' ? Number(profile.rating) : null
  const current = gallery.length ? gallery[slide % gallery.length] : null

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="relative w-full aspect-[2/3] bg-secondary/40 overflow-hidden">
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 size={22} className="animate-spin text-muted-foreground" />
          </div>
        ) : current ? (
          <button
            type="button"
            onClick={() => {
              playClick()
              setModalOpen(true)
            }}
            className="absolute inset-0 w-full h-full cursor-zoom-in"
            title="View gallery"
          >
            <img
              src={current}
              alt={profile?.name || ''}
              className="w-full h-full object-cover object-center"
            />
          </button>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <User size={40} className="text-muted-foreground opacity-40" />
          </div>
        )}
      </div>

      {gallery.length > 1 && (
        <div className="flex justify-center gap-1.5 py-2 bg-card">
          {gallery.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Photo ${i + 1}`}
              onClick={(e) => {
                e.stopPropagation()
                playTap()
                setSlide(i)
              }}
              className={
                i === slide % gallery.length
                  ? 'w-2 h-2 rounded-full bg-foreground'
                  : 'w-2 h-2 rounded-full bg-muted-foreground/40 hover:bg-muted-foreground/70'
              }
            />
          ))}
        </div>
      )}

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

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {rating != null && !Number.isNaN(rating) && (
            <span className="inline-flex items-center gap-0.5 text-amber-400/90">
              <Star size={12} className="fill-current" />
              {rating.toFixed(1)}
            </span>
          )}
          {race && <span>{race}</span>}
          {(place || flag) && (
            <span className="inline-flex items-center gap-1">
              {flag && (
                <span className="flag-emoji text-sm leading-none" aria-hidden>
                  {flag}
                </span>
              )}
              {place && <span>{place}</span>}
            </span>
          )}
        </div>

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

      {modalOpen && (
        <ImageModal
          images={gallery}
          index={slide % Math.max(gallery.length, 1)}
          title={profile?.name}
          onClose={() => setModalOpen(false)}
        />
      )}
    </div>
  )
}
