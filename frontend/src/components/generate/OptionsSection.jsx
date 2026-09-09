import { NumberField, TextField, Toggle } from '../form'

export default function OptionsSection({ form, update, clipMode }) {
  return (
    <details className="rounded-lg border border-border bg-card group" open>
      <summary className="cursor-pointer select-none list-none px-6 py-4 font-serif text-lg flex items-center justify-between gap-2">
        <span>Options</span>
        <span className="text-muted-foreground text-sm font-sans group-open:rotate-180 transition-transform">▾</span>
      </summary>
      <div className="px-6 pb-6 space-y-4 border-t border-border pt-4">
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <NumberField label="Clip distance (s)" value={form.clip_dist} step={0.05} min={0.1} onChange={(v) => update('clip_dist', v, { silent: true })} />
        <NumberField label="FPS" value={form.fps} step={1} min={15} max={60} onChange={(v) => update('fps', v, { silent: true })} />
        <TextField label="Bitrate override" value={form.bitrate} onChange={(v) => update('bitrate', v, { silent: true })} hint="Leave empty for auto" />
        <NumberField label="Threads" value={form.threads} step={1} min={1} max={32} onChange={(v) => update('threads', v, { silent: true })} />
        <NumberField label="Max videos (0 = all)" value={form.num_vids} step={1} min={0} onChange={(v) => update('num_vids', v, { silent: true })} />
      </div>
      <div className="flex flex-wrap gap-6 pt-2">
        {clipMode === 'all' && <Toggle label="Search recursive" checked={form.recurse} onChange={(v) => update('recurse', v)} />}
        <Toggle label="GPU (CUDA / NVENC)" checked={form.cuda} onChange={(v) => update('cuda', v)} />
        <Toggle label="Debug" checked={form.debug} onChange={(v) => update('debug', v)} />
      </div>
    </div>
    </details>
  )
}
