import { Link } from 'react-router-dom'
import { APP_NAME, APP_DESCRIPTION } from '../lib/config'
import { Music2, Film, Pencil, Heart, Library, ArrowRight } from 'lucide-react'

export default function HomePage() {
  return (
    <div className="space-y-12">
      <header className="space-y-3">
        <h1 className="font-serif text-4xl tracking-tight">
          Welcome to {APP_NAME}
        </h1>
        <p className="text-muted-foreground max-w-xl text-lg leading-relaxed">
          {APP_DESCRIPTION}
        </p>
      </header>

      <div className="grid sm:grid-cols-2 gap-5">
        <Link
          to="/beats"
          className="group block rounded-lg border border-border bg-card p-6 hover:border-ring transition-colors"
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-md bg-secondary">
              <Music2 size={20} />
            </div>
            <h2 className="font-serif text-xl">Beat Creator</h2>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Detect beats from any song, fine-tune them on a waveform,
            and export ready-to-use .osu / .txt files.
          </p>
          <span className="inline-flex items-center gap-1 text-sm text-foreground group-hover:gap-2 transition-all">
            Open <ArrowRight size={14} />
          </span>
        </Link>

        <Link
          to="/editor"
          className="group block rounded-lg border border-border bg-card p-6 hover:border-ring transition-colors"
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-md bg-secondary">
              <Pencil size={20} />
            </div>
            <h2 className="font-serif text-xl">Beat Editor</h2>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Open an existing .osu with its audio, preview Artist – Title (Creator),
            edit beats on the waveform, and export a new .osu.
          </p>
          <span className="inline-flex items-center gap-1 text-sm text-foreground group-hover:gap-2 transition-all">
            Open <ArrowRight size={14} />
          </span>
        </Link>

        <Link
          to="/generate"
          className="group block rounded-lg border border-border bg-card p-6 hover:border-ring transition-colors"
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-md bg-secondary">
              <Film size={20} />
            </div>
            <h2 className="font-serif text-xl">Generate PMV</h2>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Turn a beatmap + a folder of clips into a full PMV with
            aspect/resolution options and clip order modes.
          </p>
          <span className="inline-flex items-center gap-1 text-sm text-foreground group-hover:gap-2 transition-all">
            Open <ArrowRight size={14} />
          </span>
        </Link>


        <Link
          to="/libraries"
          className="group block rounded-lg border border-border bg-card p-6 hover:border-ring transition-colors"
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-md bg-secondary">
              <Library size={20} />
            </div>
            <h2 className="font-serif text-xl">Clip Clip Libraries</h2>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Organize clip folders with tags and heat rankings so Generate can pull the right shots.
          </p>
          <span className="inline-flex items-center gap-1 text-sm text-foreground group-hover:gap-2 transition-all">
            Open <ArrowRight size={14} />
          </span>
        </Link>

        <Link
          to="/cockhero"
          className="group block rounded-lg border border-border bg-card p-6 hover:border-ring transition-colors"
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-md bg-pink-500/15 text-pink-400">
              <Heart size={20} />
            </div>
            <h2 className="font-serif text-xl">Cock Hero</h2>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Add a Guitar Hero–style beatbar and optional click track to any
            finished PMV. Import an existing video + beatmap anytime.
          </p>
          <span className="inline-flex items-center gap-1 text-sm text-foreground group-hover:gap-2 transition-all">
            Open <ArrowRight size={14} />
          </span>
        </Link>
      </div>
    </div>
  )
}
