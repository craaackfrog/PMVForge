import { Toggle, NumberField } from '../form'

export default function EffectsSection({ form, updateEffect }) {
  const fx = form.effects || {}
  return (
    <section className="rounded-lg border border-border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-serif text-lg">Beat effects</h2>
        <Toggle
          label="Enable post-pass"
          checked={!!fx.enabled}
          onChange={(v) => updateEffect('enabled', v)}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Applied after the PMV is built, timed to beatmap hits. Flash/strobe can trigger photosensitive reactions — leave it off unless you know you want it.
      </p>
      {fx.enabled && (
        <div className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <Toggle label="Soft pulse" checked={!!fx.soft_pulse} onChange={(v) => updateEffect('soft_pulse', v)} hint="Gentle brightness on each beat" />
            <Toggle label="Zoom punch" checked={!!fx.zoom_punch} onChange={(v) => updateEffect('zoom_punch', v)} hint="Brief center zoom on each beat" />
            {fx.zoom_punch && (
              <NumberField label="Zoom amount" value={fx.zoom_punch_amount ?? 1.06} step={0.01} min={1.01} max={1.2} onChange={(v) => updateEffect('zoom_punch_amount', v)} />
            )}
            <Toggle label="RGB split" checked={!!fx.rgb_split} onChange={(v) => updateEffect('rgb_split', v)} />
            <Toggle
              label="Flash / strobe"
              checked={!!fx.flash}
              onChange={(v) => updateEffect('flash', v)}
              hint="⚠ Photosensitivity risk — capped rate"
            />
            <Toggle label="Pink diffuse glow" checked={!!fx.pink_glow} onChange={(v) => updateEffect('pink_glow', v)} hint="Persistent magenta lift + soft vignette" />
          </div>
          {fx.pink_glow && (
            <div className="grid sm:grid-cols-2 gap-3">
              <NumberField label="Glow strength" value={fx.pink_glow_strength} step={0.05} min={0} max={1} onChange={(v) => updateEffect('pink_glow_strength', v)} />
              <NumberField label="Glow saturation" value={fx.pink_glow_saturation} step={0.05} min={0.5} max={2} onChange={(v) => updateEffect('pink_glow_saturation', v)} />
            </div>
          )}
          {fx.flash && (
            <div className="grid sm:grid-cols-2 gap-3">
              <NumberField label="Flash strength" value={fx.flash_strength} step={0.05} min={0.1} max={1} onChange={(v) => updateEffect('flash_strength', v)} />
              <NumberField label="Max flashes / sec" value={fx.flash_max_per_sec} step={1} min={1} max={12} onChange={(v) => updateEffect('flash_max_per_sec', v)} />
            </div>
          )}
        </div>
      )}
    </section>
  )
}
