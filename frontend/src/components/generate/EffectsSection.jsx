import { Toggle, NumberField, ColorField } from '../form'

function EffectPanel({ title, enabled, onToggle, children, hint }) {
  return (
    <details className="rounded-md border border-border bg-secondary/20 group/fx" open={!!enabled}>
      <summary className="cursor-pointer select-none list-none px-3 py-2.5 flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{title}</span>
        <span className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
          <Toggle label="" checked={!!enabled} onChange={onToggle} />
          <span className="text-muted-foreground text-xs transition-transform group-open/fx:rotate-180">▾</span>
        </span>
      </summary>
      <div className="px-3 pb-3 space-y-3 border-t border-border pt-3">
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        {children}
      </div>
    </details>
  )
}

export default function EffectsSection({ form, updateEffect, previewSlot }) {
  const fx = form.effects || {}
  return (
    <details className="rounded-lg border border-border bg-card group" open>
      <summary className="cursor-pointer select-none list-none px-5 py-4 flex items-center justify-between gap-3">
        <span className="font-serif text-lg">Beat effects</span>
        <span className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
          <Toggle
            label="Enable post-pass"
            checked={!!fx.enabled}
            onChange={(v) => updateEffect('enabled', v)}
          />
          <span className="text-muted-foreground text-sm group-open:rotate-180 transition-transform">▾</span>
        </span>
      </summary>
      <div className="px-5 pb-5 space-y-4 border-t border-border pt-4">
        <p className="text-xs text-muted-foreground">
          Applied after the PMV is built. Flash/strobe can trigger photosensitive reactions — leave it off unless you know you want it.
        </p>
        {fx.enabled && (
          <div className="space-y-5">
            <div className="space-y-2">
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Static</h3>
              <EffectPanel
                title="Diffuse glow"
                enabled={!!fx.diffuse_glow}
                onToggle={(v) => updateEffect('diffuse_glow', v)}
                hint="Color tint with brightness / contrast (not a literal bloom)."
              >
                <div className="grid sm:grid-cols-2 gap-3">
                  <ColorField label="Color" value={fx.diffuse_glow_color || '#ff4da6'} onChange={(v) => updateEffect('diffuse_glow_color', v)} />
                  <NumberField label="Strength" value={fx.diffuse_glow_strength ?? 0.35} step={0.05} onChange={(v) => updateEffect('diffuse_glow_strength', v)} />
                  <NumberField label="Saturation" value={fx.diffuse_glow_saturation ?? 1.15} step={0.05} onChange={(v) => updateEffect('diffuse_glow_saturation', v)} />
                  <NumberField label="Brightness" value={fx.diffuse_glow_brightness ?? 0.04} step={0.01} onChange={(v) => updateEffect('diffuse_glow_brightness', v)} />
                  <NumberField label="Contrast" value={fx.diffuse_glow_contrast ?? 1.0} step={0.05} onChange={(v) => updateEffect('diffuse_glow_contrast', v)} />
                </div>
              </EffectPanel>

              <EffectPanel
                title="Vignette"
                enabled={!!fx.vignette}
                onToggle={(v) => updateEffect('vignette', v)}
                hint="Darken or tint the edges."
              >
                <div className="grid sm:grid-cols-2 gap-3">
                  <NumberField label="Intensity" value={fx.vignette_intensity ?? 0.5} step={0.05} onChange={(v) => updateEffect('vignette_intensity', v)} />
                  <ColorField label="Color" value={fx.vignette_color || '#000000'} onChange={(v) => updateEffect('vignette_color', v)} />
                </div>
              </EffectPanel>

              <EffectPanel
                title="Chromatic aberration"
                enabled={!!fx.chromatic_aberration}
                onToggle={(v) => updateEffect('chromatic_aberration', v)}
                hint="Radial RGB fringing from the center (stronger toward the borders)."
              >
                <NumberField label="Amount (px at edge)" value={fx.chromatic_aberration_amount ?? 1.5} step={0.25} onChange={(v) => updateEffect('chromatic_aberration_amount', v)} />
              </EffectPanel>

              <EffectPanel
                title="Camera sway"
                enabled={!!fx.camera_sway}
                onToggle={(v) => updateEffect('camera_sway', v)}
                hint="Subtle handheld-style motion."
              >
                <div className="grid sm:grid-cols-2 gap-3">
                  <NumberField label="Amount (px)" value={fx.camera_sway_amount ?? 6} step={0.5} onChange={(v) => updateEffect('camera_sway_amount', v)} />
                  <NumberField label="Speed" value={fx.camera_sway_speed ?? 0.7} step={0.05} onChange={(v) => updateEffect('camera_sway_speed', v)} />
                </div>
              </EffectPanel>
            </div>

            <div className="space-y-2">
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Timed</h3>
              <EffectPanel
                title="Soft pulse"
                enabled={!!fx.soft_pulse}
                onToggle={(v) => updateEffect('soft_pulse', v)}
                hint="Brightness lift on each beat."
              >
                <NumberField label="Strength" value={fx.soft_pulse_strength ?? 0.7} step={0.05} onChange={(v) => updateEffect('soft_pulse_strength', v)} />
              </EffectPanel>

              <EffectPanel
                title="Zoom punch"
                enabled={!!fx.zoom_punch}
                onToggle={(v) => updateEffect('zoom_punch', v)}
                hint="Brief center zoom on each beat."
              >
                <NumberField label="Zoom amount" value={fx.zoom_punch_amount ?? 1.06} step={0.01} onChange={(v) => updateEffect('zoom_punch_amount', v)} />
              </EffectPanel>

              <EffectPanel
                title="RGB split"
                enabled={!!fx.rgb_split}
                onToggle={(v) => updateEffect('rgb_split', v)}
                hint="Horizontal channel separation."
              >
                <div className="grid sm:grid-cols-2 gap-3">
                  <NumberField label="Intensity (px)" value={fx.rgb_split_px ?? 8} step={1} onChange={(v) => updateEffect('rgb_split_px', v)} />
                  <Toggle label="Static (always on)" checked={!!fx.rgb_split_static} onChange={(v) => updateEffect('rgb_split_static', v)} hint="When off, only triggers on beats" />
                </div>
              </EffectPanel>

              <EffectPanel
                title="Flash / strobe"
                enabled={!!fx.flash}
                onToggle={(v) => updateEffect('flash', v)}
                hint="⚠ Photosensitivity risk"
              >
                <div className="grid sm:grid-cols-2 gap-3">
                  <NumberField label="Flash strength" value={fx.flash_strength ?? 0.55} step={0.05} onChange={(v) => updateEffect('flash_strength', v)} />
                  <NumberField label="Max flashes / sec" value={fx.flash_max_per_sec ?? 8} step={1} onChange={(v) => updateEffect('flash_max_per_sec', v)} />
                </div>
              </EffectPanel>
            </div>

            {previewSlot}
          </div>
        )}
      </div>
    </details>
  )
}
