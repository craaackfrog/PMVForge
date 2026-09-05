import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'

/**
 * Full-screen modal video player with blurred backdrop.
 */
export default function VideoModal({ src, title, onClose }) {
  const videoRef = useRef(null)

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    // try autoplay (muted first if needed)
    const v = videoRef.current
    if (v) {
      v.play().catch(() => {})
    }
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!src) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8"
      id='videoModal'
      role="dialog"
      aria-modal="true"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-md"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative z-10 w-full max-w-5xl rounded-lg border border-border bg-card shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
          <p className="text-sm font-medium truncate">
            {title || 'Preview'}
          </p>
          <button
            type="button"
            onClick={onClose}
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
