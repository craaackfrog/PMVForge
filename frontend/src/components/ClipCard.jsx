import { Play, Pencil, Check } from 'lucide-react'
import { playClick } from '../lib/sounds'
import { cn } from '../lib/utils'

function thumbUrl(path) {
  return `/api/libraries/thumbnail?path=${encodeURIComponent(path)}`
}

/**
 * Gallery-first clip tile:
 * cover (API poster when matched, else video thumb) → hover blur + Play + Edit
 * title + date under cover (Instrument Serif for title)
 */
export default function ClipCard({
  clip,
  selected,
  onToggleSelect,
  onPlay,
  onEdit,
  className,
}) {
  const scene = clip?.scene || {}
  const matched = !!(scene.tpdb_id || scene.title)
  const poster = (scene.poster || '').trim()
  const coverSrc = poster || thumbUrl(clip.path)
  const title = scene.title || clip.name || (clip.path || '').split(/[/\\]/).pop()
  const date = scene.date || ''

  return (
    <div className={cn('group relative flex flex-col min-w-0', className)}>
      <div className="relative aspect-[2/3] rounded-lg overflow-hidden border border-border bg-secondary/40">
        <img
          src={coverSrc}
          alt=""
          className="absolute inset-0 w-full h-full object-cover transition duration-200 group-hover:scale-[1.02] group-hover:blur-[2px] group-hover:brightness-50"
          loading="lazy"
          onError={(e) => {
            if (poster && !e.currentTarget.dataset.fell) {
              e.currentTarget.dataset.fell = '1'
              e.currentTarget.src = thumbUrl(clip.path)
            } else {
              e.currentTarget.style.opacity = '0'
            }
          }}
        />

        {matched && (
          <span
            title="Matched on ThePornDB"
            className="absolute top-1.5 right-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-white shadow"
          >
            <Check size={14} strokeWidth={3} />
          </span>
        )}

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onToggleSelect?.(clip.path)
          }}
          className={cn(
            'absolute top-1.5 left-1.5 z-10 h-5 w-5 rounded border flex items-center justify-center transition-opacity',
            selected
              ? 'bg-primary border-primary text-primary-foreground opacity-100'
              : 'bg-black/40 border-white/50 text-transparent opacity-0 group-hover:opacity-100',
          )}
          aria-label={selected ? 'Deselect' : 'Select'}
        >
          {selected && <Check size={12} strokeWidth={3} />}
        </button>

        <div className="absolute inset-0 z-[5] flex flex-col items-center justify-center gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            type="button"
            title="Play"
            onClick={(e) => {
              e.stopPropagation()
              playClick()
              onPlay?.(clip.path)
            }}
            className="flex h-14 w-14 items-center justify-center rounded-full bg-black/80 text-white hover:bg-black shadow-lg"
          >
            <Play size={28} className="ml-0.5 fill-current" />
          </button>
          <button
            type="button"
            title="Edit metadata"
            onClick={(e) => {
              e.stopPropagation()
              playClick()
              onEdit?.(clip)
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-black/70 text-white text-xs border border-white/20 hover:bg-black"
          >
            <Pencil size={12} />
            Edit
          </button>
        </div>
      </div>

      <div className="mt-1.5 px-0.5 space-y-0.5 min-w-0">
        <p className="font-serif text-sm leading-snug line-clamp-2 text-foreground" title={title}>
          {title}
        </p>
        {date ? (
          <p className="text-[11px] text-muted-foreground tabular-nums">{date}</p>
        ) : (
          !matched && (
            <p className="text-[11px] text-muted-foreground/70 truncate" title={clip.name}>
              {clip.name || ''}
            </p>
          )
        )}
      </div>
    </div>
  )
}
