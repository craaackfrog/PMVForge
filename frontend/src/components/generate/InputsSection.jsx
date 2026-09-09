import { FolderOpen, Files, Library, FileAudio } from 'lucide-react'
import { PathRow } from '../form'
import { chipClass } from '../form'
import { playClick } from '../../lib/sounds'
import BeatmapLibraryPicker from './BeatmapLibraryPicker'

export default function InputsSection({
  beatPath, songPath, clipMode, videoFolder, videoPaths, outputFolder,
  libraryId, libraryTags, libraryTagMode, libraryMinHeat,
  libraries, libTagVocab, libPreviewCount, picking,
  setBeatPath, setSongPath, setClipMode, setVideoFolder, setVideoPaths,
  setOutputFolder, setLibraryId, setLibraryTags, setLibraryTagMode, setLibraryMinHeat,
  onSelectBeatmap, browseSong, browseVideoFolder, browseClips, browseOutput,
}) {
  return (
    <details className="rounded-lg border border-border bg-card group" open>
      <summary className="cursor-pointer select-none list-none px-6 py-4 font-serif text-lg flex items-center justify-between gap-2">
        <span>Inputs</span>
        <span className="text-muted-foreground text-sm font-sans group-open:rotate-180 transition-transform">▾</span>
      </summary>
      <div className="px-6 pb-6 space-y-4 border-t border-border pt-4">
      <BeatmapLibraryPicker
        beatPath={beatPath}
        songPath={songPath}
        onSelectBeatmap={onSelectBeatmap}
      />
      <PathRow
        label="Song override (optional)"
        value={songPath}
        placeholder="Usually auto-filled from the map’s AudioFilename…"
        onBrowse={browseSong}
        onClear={() => setSongPath('')}
        busy={picking === 'song'}
        icon={FileAudio}
      />

      <div>
        <label className="block text-sm text-muted-foreground mb-2">Source clips</label>
        <div className="flex flex-wrap gap-2 mb-3">
          <button type="button" onClick={() => { playClick(); setClipMode('all') }} className={chipClass(clipMode === 'all')}>
            <FolderOpen size={16} /> All clips
          </button>
          <button type="button" onClick={() => { playClick(); setClipMode('pick') }} className={chipClass(clipMode === 'pick')}>
            <Files size={16} /> Pick clips
          </button>
          <button type="button" onClick={() => { playClick(); setClipMode('library') }} className={chipClass(clipMode === 'library')}>
            <Library size={16} /> Library
          </button>
        </div>
        {clipMode === 'all' ? (
          <PathRow value={videoFolder} placeholder="Select a folder of clips…" onBrowse={browseVideoFolder} onClear={() => setVideoFolder('')} busy={picking === 'vfolder'} icon={FolderOpen} />
        ) : clipMode === 'pick' ? (
          <div className="space-y-2">
            <PathRow value={videoPaths.length ? `${videoPaths.length} clip${videoPaths.length === 1 ? '' : 's'} selected` : ''} placeholder="Select individual clips…" onBrowse={browseClips} onClear={() => setVideoPaths([])} busy={picking === 'clips'} icon={Files} />
            {videoPaths.length > 0 && (
              <div className="max-h-28 overflow-auto rounded-md bg-secondary/40 px-3 py-2 text-xs text-muted-foreground space-y-0.5 font-mono">
                {videoPaths.slice(0, 40).map((p) => (<div key={p} className="truncate">{p}</div>))}
                {videoPaths.length > 40 && <div>…and {videoPaths.length - 40} more</div>}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3 rounded-md border border-border bg-secondary/20 p-3">
            <div>
              <label className="text-xs text-muted-foreground">Clip library</label>
              <select
                value={libraryId}
                onChange={(e) => { playClick(); setLibraryId(e.target.value) }}
                className="mt-1 w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm"
              >
                <option value="">Select library…</option>
                {libraries.map((lib) => (
                  <option key={lib.id} value={lib.id}>
                    {lib.name} ({lib.clip_count} clips)
                  </option>
                ))}
              </select>
              {libraries.length === 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  No libraries yet — create one under Clip Libraries.
                </p>
              )}
            </div>
            {libraryId && (
              <>
                <div className="flex flex-wrap gap-1.5">
                  {libTagVocab.slice(0, 24).map((tag) => {
                    const on = libraryTags.includes(tag)
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => {
                          playClick()
                          setLibraryTags(on ? libraryTags.filter((t) => t !== tag) : [...libraryTags, tag])
                        }}
                        className={
                          on
                            ? 'px-2 py-0.5 rounded-full text-xs bg-primary text-primary-foreground'
                            : 'px-2 py-0.5 rounded-full text-xs bg-secondary hover:bg-accent'
                        }
                      >
                        {tag}
                      </button>
                    )
                  })}
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span>Match</span>
                  {['any', 'all'].map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => { playClick(); setLibraryTagMode(m) }}
                      className={
                        libraryTagMode === m
                          ? 'px-2 py-0.5 rounded bg-primary text-primary-foreground'
                          : 'px-2 py-0.5 rounded bg-secondary'
                      }
                    >
                      {m}
                    </button>
                  ))}
                  <span className="ml-2">Min heat</span>
                  {[1, 2, 3, 4, 5].map((h) => (
                    <button
                      key={h}
                      type="button"
                      onClick={() => { playClick(); setLibraryMinHeat(h) }}
                      className={
                        libraryMinHeat === h
                          ? 'w-6 h-6 rounded bg-orange-500 text-white text-[10px]'
                          : 'w-6 h-6 rounded bg-secondary text-[10px]'
                      }
                    >
                      {h}
                    </button>
                  ))}
                  {libPreviewCount != null && (
                    <span className="ml-auto text-foreground">
                      {libPreviewCount} clip{libPreviewCount === 1 ? '' : 's'} match
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <PathRow label="Output folder (optional)" value={outputFolder} placeholder="Leave empty → temp outputs…" onBrowse={browseOutput} onClear={() => setOutputFolder('')} busy={picking === 'out'} icon={FolderOpen} />
    </div>
    </details>
  )
}
