export function chipClass(active) {
  return active
    ? 'inline-flex items-center gap-2 px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium'
    : 'inline-flex items-center gap-2 px-3 py-2 rounded-md bg-secondary text-sm hover:bg-accent transition-colors'
}
