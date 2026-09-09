import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'

/** Last pointer position — used as transform origin when opening. */
let lastPointer = { x: null, y: null }
if (typeof window !== 'undefined') {
  const track = (e) => {
    lastPointer = { x: e.clientX, y: e.clientY }
  }
  window.addEventListener('pointerdown', track, true)
}

const EXIT_MS = 220

/**
 * Full-screen modal video player.
 * Zooms in from the click position; fades out on close.
 */
export default function VideoModal({ src, title, onClose, origin }) {
  const videoRef = useRef(null)
  const [visible, setVisible] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const closedRef = useRef(false)

  const ox = origin?.x ?? lastPointer.x
  const oy = origin?.y ?? lastPointer.y
  const originCss =
    ox != null && oy != null && typeof window !== 'undefined'
      ? `${(ox / window.innerWidth) * 100}% ${(oy / window.innerHeight) * 100}%`
      : '50% 50%'

  useEffect(() => {
    // next frame → trigger enter transition
    const id = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(id)
  }, [])

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') requestClose()
    }
    window.addEventListener('keydown', onKey)
    const v = videoRef.current
    if (v) {
      v.play().catch(() => {})
    }
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function requestClose() {
    if (closedRef.current) return
    closedRef.current = true
    setLeaving(true)
    setVisible(false)
    window.setTimeout(() => {
      onClose?.()
    }, EXIT_MS)
  }

  if (!src) return null

  const open = visible && !leaving

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8"
      id="videoModal"
      role="dialog"
      aria-modal="true"
    >
      {/* Backdrop — fade only */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-md transition-opacity ease-out"
        style={{
          opacity: open ? 1 : 0,
          transitionDuration: `${EXIT_MS}ms`,
        }}
        onClick={requestClose}
      />

      {/* Panel — zoom from click + fade */}
      <div
        className="relative z-10 w-full max-w-5xl rounded-lg border border-border bg-card shadow-2xl overflow-hidden transition-[opacity,transform] ease-out"
        style={{
          transformOrigin: originCss,
          opacity: open ? 1 : 0,
          transform: open ? 'scale(1)' : 'scale(0.72)',
          transitionDuration: `${EXIT_MS}ms`,
        }}
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
          <p className="text-sm font-medium truncate">
            {title || 'Preview'}
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

        <div className="bg-black flex items-center justify-center max-h-[80vh]">
          <video
            ref={videoRef}
            src={src}
            controls
            playsInline
            className="w-full max-h-[80vh] object-contain"
          />
        </div>
      </div>
    </div>
  )
}
