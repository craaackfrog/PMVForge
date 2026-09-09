import { Music2 } from 'lucide-react'

export default function SongLibrariesPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-serif text-3xl tracking-tight">Song Libraries</h1>
        <p className="text-muted-foreground mt-1">
          Catalog songs and link them to beatmaps. Coming soon.
        </p>
      </header>
      <div className="rounded-lg border border-border bg-card p-10 text-center text-muted-foreground space-y-3">
        <Music2 size={32} className="mx-auto opacity-40" />
        <p className="text-sm max-w-md mx-auto">
          Song Libraries will let you index audio folders, attach metadata, and pick tracks
          when creating beatmaps or PMVs — without digging through the filesystem each time.
        </p>
        <p className="text-xs">Stub — not implemented yet.</p>
      </div>
    </div>
  )
}
