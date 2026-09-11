import { useState } from 'react'
import { GripVertical, Volume2, Trash2 } from 'lucide-react'
import { moveClip, resliceAfterReorder, setClipVolume } from './edl'
import { playClick } from '../../lib/sounds'

/**
 * EDL timeline list — drag to reorder, per-clip moan volume.
 * Backend re-slices only on Render; reorder here updates src_out to fit beat gaps.
 */
export default function TimelinePanel({
  clips = [],
  beats = [],
  onChange,
  songVolume = 1,
  onSongVolume,
  className = '',
}) {
  const [dragFrom, setDragFrom] = useState(null)

  function onDragStart(i) {
    setDragFrom(i)
  }

  function onDragOver(e, i) {
    e.preventDefault()
  }

  function onDrop(i) {
    if (dragFrom == null || dragFrom === i) {
      setDragFrom(null)
      return
    }
    playClick()
    const reordered = moveClip(clips, dragFrom, i)
    onChange(resliceAfterReorder(reordered, beats))
    setDragFrom(null)
  }

  function volume(i, v) {
    onChange(setClipVolume(clips, i, v))
  }

  function remove(i) {
    playClick()
    const next = clips.filter((_, idx) => idx !== i)
    // Removing a row leaves a beat gap — reindex against remaining beats head
    onChange(resliceAfterReorder(next, beats.slice(0, next.length + 1)))
  }

  if (!clips.length) {
    return (
      <div className={`rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground ${className}`}>
        No timeline yet. Set inputs, then <strong className="text-foreground">Build timeline</strong>.
      </div>
    )
  }

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-serif text-lg">Timeline</h3>
          <p className="text-xs text-muted-foreground">
            {clips.length} segments · drag to reorder · volumes apply to moans on Render
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Volume2 size={14} />
          Song
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={songVolume}
            onChange={(e) => onSongVolume?.(Number(e.target.value))}
            className="w-28"
          />
          <span className="font-mono w-8">{Number(songVolume).toFixed(2)}</span>
        </label>
      </div>

      <ul className="max-h-80 overflow-y-auto divide-y divide-border rounded-lg border border-border bg-card">
        {clips.map((c, i) => (
          <li
            key={c.id || `${c.path}-${i}`}
            draggable
            onDragStart={() => onDragStart(i)}
            onDragOver={(e) => onDragOver(e, i)}
            onDrop={() => onDrop(i)}
            className={`flex items-center gap-2 px-2 py-2 text-sm hover:bg-secondary/40 ${
              dragFrom === i ? 'opacity-50' : ''
            }`}
          >
            <GripVertical size={14} className="text-muted-foreground shrink-0 cursor-grab" />
            <span className="font-mono text-[11px] text-muted-foreground w-8 shrink-0">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium" title={c.path}>
                {c.name || (c.path || '').split(/[/\\]/).pop()}
              </div>
              <div className="text-[11px] text-muted-foreground font-mono">
                src {Number(c.src_in).toFixed(2)}→{Number(c.src_out).toFixed(2)}s · beat{' '}
                {Number(c.beat_in).toFixed(2)}→{Number(c.beat_out).toFixed(2)}s
              </div>
            </div>
            <label className="flex items-center gap-1 shrink-0" title="Clip / moan volume">
              <Volume2 size={12} className="text-muted-foreground" />
              <input
                type="range"
                min={0}
                max={2}
                step={0.05}
                value={c.volume ?? 1}
                onChange={(e) => volume(i, e.target.value)}
                className="w-20"
              />
              <span className="font-mono text-[11px] w-7">{Number(c.volume ?? 1).toFixed(1)}</span>
            </label>
            <button
              type="button"
              onClick={() => remove(i)}
              className="p-1 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive"
              title="Remove segment"
            >
              <Trash2 size={14} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
