import { Monitor, Smartphone } from 'lucide-react'
import { Toggle } from '../form'
import { chipClass } from '../form'
import { QUALITY_LABELS, RES_HINT } from './defaults'

export default function FormatSection({ form, update, resHint }) {
  return (
    <details className="rounded-lg border border-border bg-card group" open>
      <summary className="cursor-pointer select-none list-none px-6 py-4 font-serif text-lg flex items-center justify-between gap-2">
        <span>Format</span>
        <span className="text-muted-foreground text-sm font-sans group-open:rotate-180 transition-transform">▾</span>
      </summary>
      <div className="px-6 pb-6 space-y-4 border-t border-border pt-4">
      <div className="flex flex-wrap items-start gap-8">
        <div>
          <label className="block text-sm text-muted-foreground mb-2">Aspect ratio</label>
          <div className="flex gap-2">
            <button type="button" onClick={() => update('aspect', '16:9')} className={chipClass(form.aspect === '16:9')}><Monitor size={16} /> 16:9</button>
            <button type="button" onClick={() => update('aspect', '9:16')} className={chipClass(form.aspect === '9:16')}><Smartphone size={16} /> 9:16</button>
          </div>
        </div>
        <div>
          <label className="block text-sm text-muted-foreground mb-2">Resolution</label>
          <div className="flex flex-wrap gap-2">
            {['hd', 'fhd', '4k'].map((q) => (
              <button key={q} type="button" onClick={() => update('quality', q)} className={chipClass(form.quality === q)}>
                {QUALITY_LABELS[q]}
                <span className="ml-1.5 opacity-70 text-xs">{RES_HINT[form.aspect]?.[q]}</span>
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-2">Output will be {resHint} @ {form.fps} fps</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-6">
        <Toggle label="Zoom to fill (center crop)" hint="Scale up and crop so the frame is always full — recommended for 9:16" checked={form.zoom_to_fill} onChange={(v) => update('zoom_to_fill', v)} />
      </div>
      <div>
        <label className="block text-sm text-muted-foreground mb-2">Clip order</label>
        <div className="flex flex-wrap gap-2">
          {[
            { id: 'random', label: 'Random', hint: 'Classic jumpy cuts' },
            { id: 'forward', label: 'Chronological', hint: 'Always advance within each file' },
            { id: 'sticky', label: 'Sticky', hint: 'Stay on one scene, play forward' },
          ].map((o) => (
            <button
              key={o.id}
              type="button"
              title={o.hint}
              onClick={() => update('clip_order', o.id)}
              className={chipClass(form.clip_order === o.id)}
            >
              {o.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Sticky / Chronological avoid mixing the end of a scene with its beginning.
        </p>
      </div>
    </div>
    </details>
  )
}
