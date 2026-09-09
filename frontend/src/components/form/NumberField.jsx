export default function NumberField({ label, value, onChange, step = 1, min, max }) {
  return (
    <div>
      <label className="block text-sm text-muted-foreground mb-1.5">{label}</label>
      <input
        type="number"
        value={value}
        step={step}
        {...(min != null ? { min } : {})}
        {...(max != null ? { max } : {})}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-1 focus:ring-ring"
      />
    </div>
  )
}
