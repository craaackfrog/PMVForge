export default function Toggle({ label, checked, onChange, hint }) {
  return (
    <label className="inline-flex flex-col gap-0.5 text-sm cursor-pointer select-none">
      <span className="inline-flex items-center gap-2">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="rounded border-border" />
        {label}
      </span>
      {hint && <span className="text-xs text-muted-foreground pl-6">{hint}</span>}
    </label>
  )
}
