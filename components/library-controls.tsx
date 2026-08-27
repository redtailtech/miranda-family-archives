'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

type Album = { id: string; name: string }
type PersonChip = { id: string; displayName: string }

export function LibraryControls({
  decades,
  albums,
  people,
}: {
  decades: number[]
  albums: Album[]
  people: PersonChip[]
}) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const type = searchParams.get('type')
  const decade = searchParams.get('decade')
  const albumId = searchParams.get('albumId')
  const personId = searchParams.get('personId')
  const view = searchParams.get('view')

  const [q, setQ] = useState(searchParams.get('q') ?? '')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function updateParams(next: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(next)) {
      if (value === null || value === '') params.delete(key)
      else params.set(key, value)
    }
    const qs = params.toString()
    router.replace(qs ? `/?${qs}` : '/')
  }

  // Debounce the search input: only push it into the URL (and thus trigger a
  // MediaGrid refetch) 300ms after the user stops typing.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      const current = searchParams.get('q') ?? ''
      if (q !== current) updateParams({ q: q || null })
    }, 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  // The timeline is its own chronological view of everything — search and the
  // filter chips don't apply there, so only the view toggle is shown.
  const isTimeline = view === 'timeline'

  return (
    <div className="mb-6 space-y-3">
      {!isTimeline && (
        <>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search titles, descriptions, locations…"
            aria-label="Search library"
            className="w-full rounded-xl border border-ink/25 bg-surface px-4 py-3 text-lg placeholder:text-ink-soft/70"
          />

          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by type">
            <Chip active={!type} onClick={() => updateParams({ type: null })}>
              All
            </Chip>
            <Chip active={type === 'PHOTO'} onClick={() => updateParams({ type: 'PHOTO' })}>
              Photos
            </Chip>
            <Chip active={type === 'DOCUMENT'} onClick={() => updateParams({ type: 'DOCUMENT' })}>
              Documents
            </Chip>
          </div>

          {decades.length > 0 && (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by decade">
              <Chip active={!decade} onClick={() => updateParams({ decade: null })}>
                All decades
              </Chip>
              {decades.map((d) => (
                <Chip key={d} active={decade === String(d)} onClick={() => updateParams({ decade: String(d) })}>
                  {d}s
                </Chip>
              ))}
            </div>
          )}

          {albums.length > 0 && (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by album">
              <Chip active={!albumId} onClick={() => updateParams({ albumId: null })}>
                All albums
              </Chip>
              {albums.map((a) => (
                <Chip key={a.id} active={albumId === a.id} onClick={() => updateParams({ albumId: a.id })}>
                  {a.name}
                </Chip>
              ))}
            </div>
          )}

          {people.length > 0 && (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by person">
              <Chip active={!personId} onClick={() => updateParams({ personId: null })}>
                Everyone
              </Chip>
              {people.map((p) => (
                <Chip key={p.id} active={personId === p.id} onClick={() => updateParams({ personId: p.id })}>
                  {p.displayName}
                </Chip>
              ))}
            </div>
          )}
        </>
      )}

      <div className="flex gap-2" role="group" aria-label="View">
        <Chip active={view !== 'timeline'} onClick={() => updateParams({ view: null })}>
          Grid
        </Chip>
        <Chip active={view === 'timeline'} onClick={() => updateParams({ view: 'timeline' })}>
          Timeline
        </Chip>
      </div>
    </div>
  )
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`min-h-11 rounded-full px-4 py-2 text-lg transition-colors ${
        active
          ? 'bg-ink font-medium text-paper'
          : 'border border-ink/25 bg-surface text-ink-soft hover:bg-wash hover:text-ink'
      }`}
    >
      {children}
    </button>
  )
}
