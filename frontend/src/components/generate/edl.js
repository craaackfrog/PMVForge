/**
 * EDL helpers — UI owns the edit decision list.
 * beats[i] → beats[i+1] is the knife; clips[i] fills that gap.
 */

export function emptyEdl() {
  return {
    beats: [],
    clips: [],
    songPath: '',
    songVolume: 1,
    duration: 0,
  }
}

/** After drag-reorder, re-slice src windows so each row still fills its beat gap. */
export function resliceAfterReorder(clips, beats) {
  if (!clips?.length || !beats?.length) return clips || []
  const next = clips.map((c, i) => {
    const beatIn = beats[i] ?? c.beat_in ?? 0
    const beatOut = beats[i + 1] ?? c.beat_out ?? beatIn + (c.duration || 0.4)
    const need = Math.max(0.04, beatOut - beatIn)
    const srcIn = Number(c.src_in) || 0
    // Keep the same source in-point when possible; only adjust out to match beat gap.
    return {
      ...c,
      order: i,
      id: c.id || `seg-${i}`,
      beat_in: round4(beatIn),
      beat_out: round4(beatOut),
      duration: round4(need),
      src_in: round4(srcIn),
      src_out: round4(srcIn + need),
    }
  })
  return next
}

export function moveClip(clips, fromIndex, toIndex) {
  if (fromIndex === toIndex) return clips
  const arr = [...clips]
  const [item] = arr.splice(fromIndex, 1)
  arr.splice(toIndex, 0, item)
  return arr
}

export function setClipVolume(clips, index, volume) {
  const v = Math.max(0, Math.min(2, Number(volume) || 0))
  return clips.map((c, i) => (i === index ? { ...c, volume: v } : c))
}

export function mediaUrl(path) {
  if (!path) return ''
  return `/api/generate/media?path=${encodeURIComponent(path)}`
}

function round4(n) {
  return Math.round(Number(n) * 10000) / 10000
}
