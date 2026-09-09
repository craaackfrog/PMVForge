import { useEffect, useState } from 'react'
import { X, ChevronLeft, ChevronRight } from 'lucide-react'

/** Last pointer position — transform origin when opening. */
let lastPointer = { x: null, y: null }
if (typeof window !== 'undefined') {
  window.addEventListener(
    'pointerdown',
    (e) => {
      lastPointer = { x: e.clientX, y: e.clientY }
    },
    true,
  )
}

const EXIT_MS = 220

/**
 * Lightbox for performer gallery — same motion language as VideoModal.
 */
export default function ImageModal({ images, index = 0, title, onClose }) {
  const [visible, setVisible] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [idx, setIdx] = useState(index)
  const closedRef = useState({ current: false })[0]

  const ox = lastPointer.x
  const oy = lastPointer.y
  const originCss =
    ox != null && oy != null && typeof window !== 'undefined'
      ? `${(ox / window.innerWidth) * 100}% ${(oy / window.innerHeight) * 100}%`
      : '50% 50%'

  const list = (images || []).filter(Boolean)

  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(id)
  }, [])

  useEffect(() => {
    setIdx(Math.max(0, Math.min(index, list.length - 1)))
  }, [index, list.length])

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') requestClose()
      if (e.key === 'ArrowLeft') setIdx((i) => (i - 1 + list.length) % list.length)
      if (e.key === 'ArrowRight') setIdx((i) => (i + 1) % list.length)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [list.length])

  function requestClose() {
    if (closedRef.current) return
    closedRef.current = true
    setLeaving(true)
    setVisible(false)
    window.setTimeout(() => onClose?.(), EXIT_MS)
  }

  if (!list.length) return null
  const open = visible && !leaving
  const src = list[idx]

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-md transition-opacity ease-out"
        style={{ opacity: open ? 1 : 0, transitionDuration: `${EXIT_MS}ms` }}
        onClick={requestClose}
      />
      <div
        className="relative z-10 w-full max-w-4xl rounded-lg border border-border bg-card shadow-2xl overflow-hidden transition-[opacity,transform] ease-out"
        style={{
          transformOrigin: originCss,
          opacity: open ? 1 : 0,
          transform: open ? 'scale(1)' : 'scale(0.72)',
          transitionDuration: `${EXIT_MS}ms`,
        }}
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
          <p className="text-sm font-medium truncate">
            {title || 'Gallery'}
            {list.length > 1 ? ` · ${idx + 1}/${list.length}` : ''}
          </p>
          <button
            type="button"
            onClick={requestClose}
            className="p-1.5 rounded-md hover:bg-secondary transition-colors"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <div className="relative bg-black flex items-center justify-center min-h-[40vh] max-h-[80vh]">
          <img src={src} alt="" className="max-w-full max-h-[80vh] object-contain" />
          {list.length > 1 && (
            <>
              <button
                type="button"
                onClick={() => setIdx((i) => (i - 1 + list.length) % list.length)}
                className="absolute left-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/50 text-white hover:bg-black/70"
                aria-label="Previous"
              >
                <ChevronLeft size={20} />
              </button>
              <button
                type="button"
                onClick={() => setIdx((i) => (i + 1) % list.length)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/50 text-white hover:bg-black/70"
                aria-label="Next"
              >
                <ChevronRight size={20} />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
