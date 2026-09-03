'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ChevronDown } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

type Album = { id: string; name: string }
type PersonChip = { id: string; displayName: string; photoCount: number }

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

/** The search input, shown above the photo grid in the main column. Applies
 * in timeline view too — the timeline is filterable like the grid. */
export function LibrarySearch() {
  const router = useRouter()
  const searchParams = useSearchParams()

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

/** A compact dropdown pill: shows the current selection and opens a menu of
 * choices. Visually a `Chip` with a chevron, so it reads as openable. */
function FilterPill({ active, label, children }: { active: boolean; label: string; children: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={`flex min-h-11 items-center gap-1 rounded-full px-4 py-2 text-lg transition-colors ${
            active
              ? 'bg-ink font-medium text-paper'
              : 'border border-ink/25 bg-surface text-ink-soft hover:bg-wash hover:text-ink'
          }`}
        >
          {label}
          <ChevronDown size={18} aria-hidden className="shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56 max-w-[90vw]">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The row of filter pills shown under the search bar: Show, Decade, Album,
 * Viewing (each a dropdown), plus the Grid/Timeline view toggle. The same row
 * renders in both grid and timeline mode — the timeline is filterable too. */
export function LibraryFilterPills({
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

  const showValue = backs === '1' ? 'backs' : type === 'PHOTO' ? 'photos' : type === 'DOCUMENT' ? 'documents' : 'everything'
  const showLabel = {
    everything: 'Everything',
    photos: 'Photos',
    documents: 'Documents',
    backs: 'Photo backs',
  }[showValue]

  function onShowChange(value: string) {
    if (value === 'photos') set({ type: 'PHOTO', backs: null })
    else if (value === 'documents') set({ type: 'DOCUMENT', backs: null })
    else if (value === 'backs') set({ backs: '1', type: null })
    else set({ type: null, backs: null })
  }

  const decadeLabel = decade ? `${decade}s` : 'Any'
  const albumLabel = albumId ? (albums.find((a) => a.id === albumId)?.name ?? 'All') : 'All'
  const personLabel = personId ? (people.find((p) => p.id === personId)?.displayName ?? 'Everyone') : 'Everyone'

  return (
    <div className="mb-6 flex flex-wrap items-center gap-2">
      <FilterPill active={showValue !== 'everything'} label={`Show: ${showLabel}`}>
        <DropdownMenuRadioGroup value={showValue} onValueChange={onShowChange}>
          <DropdownMenuRadioItem value="everything">Everything</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="photos">Photos</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="documents">Documents</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="backs">Photo backs</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </FilterPill>

      {decades.length > 0 && (
        <FilterPill active={!!decade} label={`Decade: ${decadeLabel}`}>
          <DropdownMenuRadioGroup
            value={decade ?? 'any'}
            onValueChange={(value) => set({ decade: value === 'any' ? null : value })}
          >
            <DropdownMenuRadioItem value="any">Any</DropdownMenuRadioItem>
            {decades.map((d) => (
              <DropdownMenuRadioItem key={d} value={String(d)}>
                {d}s
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </FilterPill>
      )}

      {albums.length > 0 && (
        <FilterPill active={!!albumId} label={`Album: ${albumLabel}`}>
          <DropdownMenuRadioGroup
            value={albumId ?? 'all'}
            onValueChange={(value) => set({ albumId: value === 'all' ? null : value })}
          >
            <div className="max-h-80 overflow-y-auto">
              <DropdownMenuRadioItem value="all">All</DropdownMenuRadioItem>
              {albums.map((a) => (
                <DropdownMenuRadioItem key={a.id} value={a.id}>
                  {a.name}
                </DropdownMenuRadioItem>
              ))}
            </div>
          </DropdownMenuRadioGroup>
        </FilterPill>
      )}

      {people.length > 0 && (
        <FilterPill active={!!personId} label={`Viewing: ${personLabel}`}>
          <DropdownMenuRadioGroup
            value={personId ?? 'everyone'}
            onValueChange={(value) => set({ personId: value === 'everyone' ? null : value })}
          >
            <div className="max-h-80 overflow-y-auto">
              <DropdownMenuRadioItem value="everyone">Everyone</DropdownMenuRadioItem>
              {people.map((p) => (
                <DropdownMenuRadioItem key={p.id} value={p.id}>
                  <span className="flex w-full items-center gap-4 whitespace-nowrap">
                    <span className="flex-1">{p.displayName}</span>
                    <span className="text-base text-ink-soft">{p.photoCount}</span>
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </div>
          </DropdownMenuRadioGroup>
        </FilterPill>
      )}

      <div className="flex gap-2" role="group" aria-label="View">
        <Chip active={view !== 'timeline'} onClick={() => set({ view: null })}>
          Grid
        </Chip>
        <Chip active={view === 'timeline'} onClick={() => set({ view: 'timeline' })}>
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
