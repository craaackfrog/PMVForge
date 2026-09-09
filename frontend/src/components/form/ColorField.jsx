export default function ColorField({ label, value, onChange }) {
  const v = value || '#ffffff'
  return (
    <div>
      <label className="block text-sm text-muted-foreground mb-1.5">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={v}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-12 cursor-pointer rounded border border-border bg-secondary p-0.5"
        />
        <input
          type="text"
          value={v}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 px-3 py-2 rounded-md bg-secondary border border-border text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
    </div>
  )
}
