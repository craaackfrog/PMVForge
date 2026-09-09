import { Loader2 } from 'lucide-react'

export default function PathRow({ label, value, placeholder, onBrowse, onClear, busy, icon: Icon }) {
  return (
    <div>
      {label && <label className="block text-sm text-muted-foreground mb-1.5">{label}</label>}
      <div className="flex gap-2">
        <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-md border border-dashed border-border bg-secondary/40 min-h-[44px] overflow-hidden">
          {Icon && <Icon size={16} className="text-muted-foreground shrink-0" />}
          <span className={value ? 'text-sm font-mono truncate' : 'text-sm text-muted-foreground truncate'} title={value || undefined}>
            {value || placeholder}
          </span>
        </div>
        <button type="button" onClick={onBrowse} disabled={!!busy} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-secondary text-sm hover:bg-accent transition-colors disabled:opacity-50 shrink-0">
          {busy ? <Loader2 size={14} className="animate-spin" /> : 'Browse'}
        </button>
        {value && (
          <button type="button" onClick={onClear} className="px-2 py-2 rounded-md text-sm text-muted-foreground hover:bg-secondary transition-colors shrink-0">Clear</button>
        )}
      </div>
    </div>
  )
}
