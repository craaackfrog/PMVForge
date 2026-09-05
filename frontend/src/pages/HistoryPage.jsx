export default function HistoryPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-serif text-3xl tracking-tight">History</h1>
        <p className="text-muted-foreground mt-1">
          Recent projects and exports.
        </p>
      </header>

      <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
        <p className="text-sm">History list will appear here once you start generating.</p>
      </div>
    </div>
  )
}
