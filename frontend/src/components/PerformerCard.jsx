import { useEffect, useState, useMemo } from 'react'
import { Loader2, RefreshCw, User, Star, ChevronLeft, ChevronRight } from 'lucide-react'
import { playTap, playError, playClick } from '../lib/sounds'
import ImageModal from './ImageModal'
import PerformerEditModal from './PerformerEditModal'

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
  const [editOpen, setEditOpen] = useState(false)
  const eggRef = useState({ count: 0, timer: null })[0]

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

  function onEggClick(e) {
    // Only count clicks on blank padding / text chrome — not interactive controls
    const tag = (e.target.tagName || '').toLowerCase()
    if (tag === 'button' || tag === 'img' || tag === 'a' || tag === 'input' || tag === 'textarea') return
    if (e.target.closest('button')) return
    eggRef.count += 1
    if (eggRef.timer) window.clearTimeout(eggRef.timer)
    eggRef.timer = window.setTimeout(() => { eggRef.count = 0 }, 2500)
    if (eggRef.count >= 5) {
      eggRef.count = 0
      playTap()
      setEditOpen(true)
    }
  }

  const extras = profile?.extras || {}
  const race = extras.ethnicity || null
  const place = extras.birthplace || extras.country || extras.nationality || null
  const flag = flagFor(extras.country || extras.nationality || extras.birthplace)
  const rating = profile?.rating != null && profile.rating !== '' ? Number(profile.rating) : null

  const current = gallery.length ? gallery[slide % gallery.length] : null

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden" onClick={onEggClick}>
      <div className="relative w-full aspect-[2/3] bg-secondary/40 overflow-hidden">
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 size={22} className="animate-spin text-muted-foreground" />
          </div>
        ) : current ? (
          <>
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
            {gallery.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    playTap()
                    setSlide((s) => (s - 1 + gallery.length) % gallery.length)
                  }}
                  className="absolute left-1.5 top-1/2 -translate-y-1/2 z-10 p-1.5 rounded-full bg-black/50 text-white hover:bg-black/70"
                  aria-label="Previous photo"
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    playTap()
                    setSlide((s) => (s + 1) % gallery.length)
                  }}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 z-10 p-1.5 rounded-full bg-black/50 text-white hover:bg-black/70"
                  aria-label="Next photo"
                >
                  <ChevronRight size={16} />
                </button>
              </>
            )}
          </>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <User size={40} className="text-muted-foreground opacity-40" />
          </div>
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
              {flag && <span aria-hidden>{flag}</span>}
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
      {editOpen && (
        <PerformerEditModal
          libraryId={libraryId}
          profile={profile}
          onClose={() => setEditOpen(false)}
          onSaved={(data) => setProfile(data)}
        />
      )}
    </div>
  )
}
