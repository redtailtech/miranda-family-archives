'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

type Album = { id: string; name: string }
type PersonChip = { id: string; displayName: string }

function updateParams(
  router: ReturnType<typeof useRouter>,
  searchParams: ReturnType<typeof useSearchParams>,
  next: Record<string, string | null>
) {
  const params = new URLSearchParams(searchParams.toString())
  for (const [key, value] of Object.entries(next)) {
    if (value === null || value === '') params.delete(key)
    else params.set(key, value)
  }
  const qs = params.toString()
  router.replace(qs ? `/?${qs}` : '/')
}

/** The search input, shown above the photo grid in the main column. Hidden in
 * timeline view (as today). */
export function LibrarySearch() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const view = searchParams.get('view')

  const [q, setQ] = useState(searchParams.get('q') ?? '')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Kept in sync every render so the debounced callback below can read the
  // params as of when it *fires*, not the (possibly stale) params snapshot
  // it closed over when it was scheduled. Without this, typing and then
  // clicking a filter chip within the 300ms window would have the delayed
  // q-write rebuild the URL from the pre-click snapshot and silently drop
  // the chip param the click just set.
  const searchParamsRef = useRef(searchParams)
  useEffect(() => {
    searchParamsRef.current = searchParams
  })

  // Debounce the search input: only push it into the URL (and thus trigger a
  // MediaGrid refetch) 300ms after the user stops typing.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      const currentParams = searchParamsRef.current
      const current = currentParams.get('q') ?? ''
      if (q !== current) updateParams(router, currentParams, { q: q || null })
    }, 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  // The timeline is its own chronological view of everything — search doesn't
  // apply there.
  const isTimeline = view === 'timeline'
  if (isTimeline) return null

  return (
    <div className="mb-6">
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search titles, descriptions, locations…"
        aria-label="Search library"
        className="w-full rounded-xl border border-ink/25 bg-surface px-4 py-3 text-lg placeholder:text-ink-soft/70"
      />
    </div>
  )
}

/** The filter sidebar: view toggle plus, when not timeline, the type chips,
 * decades, albums, and people groups. */
export function LibraryFilters({
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
  const backs = searchParams.get('backs')
  const decade = searchParams.get('decade')
  const albumId = searchParams.get('albumId')
  const personId = searchParams.get('personId')
  const view = searchParams.get('view')

  const set = (next: Record<string, string | null>) => updateParams(router, searchParams, next)

  // The timeline is its own chronological view of everything — the filter
  // chips don't apply there, so only the view toggle is shown.
  const isTimeline = view === 'timeline'

  return (
    <div className="mb-6 space-y-5 lg:mb-0">
      {!isTimeline && (
        <>
          <div className="space-y-2">
            <p className="text-base font-semibold text-ink-soft">Show</p>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by type">
              <Chip active={!type} onClick={() => set({ type: null, backs: null })}>
                All
              </Chip>
              <Chip active={type === 'PHOTO'} onClick={() => set({ type: 'PHOTO', backs: null })}>
                Photos
              </Chip>
              <Chip active={type === 'DOCUMENT'} onClick={() => set({ type: 'DOCUMENT', backs: null })}>
                Documents
              </Chip>
              <Chip active={backs === '1'} onClick={() => set({ backs: backs === '1' ? null : '1', type: null })}>
                Photo backs
              </Chip>
            </div>
          </div>

          {decades.length > 0 && (
            <div className="space-y-2">
              <p className="text-base font-semibold text-ink-soft">Decades</p>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by decade">
                <Chip active={!decade} onClick={() => set({ decade: null })}>
                  All decades
                </Chip>
                {decades.map((d) => (
                  <Chip key={d} active={decade === String(d)} onClick={() => set({ decade: String(d) })}>
                    {d}s
                  </Chip>
                ))}
              </div>
            </div>
          )}

          {albums.length > 0 && (
            <div className="space-y-2">
              <p className="text-base font-semibold text-ink-soft">Albums</p>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by album">
                <Chip active={!albumId} onClick={() => set({ albumId: null })}>
                  All albums
                </Chip>
                {albums.map((a) => (
                  <Chip key={a.id} active={albumId === a.id} onClick={() => set({ albumId: a.id })}>
                    {a.name}
                  </Chip>
                ))}
              </div>
            </div>
          )}

          {people.length > 0 && (
            <div className="space-y-2">
              <p className="text-base font-semibold text-ink-soft">People</p>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by person">
                <Chip active={!personId} onClick={() => set({ personId: null })}>
                  Everyone
                </Chip>
                {people.map((p) => (
                  <Chip key={p.id} active={personId === p.id} onClick={() => set({ personId: p.id })}>
                    {p.displayName}
                  </Chip>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <div className="space-y-2">
        <p className="text-base font-semibold text-ink-soft">View</p>
        <div className="flex gap-2" role="group" aria-label="View">
          <Chip active={view !== 'timeline'} onClick={() => set({ view: null })}>
            Grid
          </Chip>
          <Chip active={view === 'timeline'} onClick={() => set({ view: 'timeline' })}>
            Timeline
          </Chip>
        </div>
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
