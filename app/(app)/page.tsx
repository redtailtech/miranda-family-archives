import { prisma } from '@/lib/db'
import { LibraryFilters, LibrarySearch } from '@/components/library-controls'
import { MediaGrid } from '@/components/media-grid'
import { TimelineView } from '@/components/timeline-view'

type SearchParams = Record<string, string | string[] | undefined>

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const sp = await searchParams
  const q = first(sp.q)
  const type = first(sp.type)
  const backs = first(sp.backs)
  const decade = first(sp.decade)
  const albumId = first(sp.albumId)
  const personId = first(sp.personId)
  const view = first(sp.view)

  const [yearRows, albums, people] = await Promise.all([
    prisma.mediaItem.findMany({
      where: { deletedAt: null, dateYear: { not: null } },
      distinct: ['dateYear'],
      select: { dateYear: true },
    }),
    prisma.album.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.person.findMany({
      where: { deletedAt: null },
      select: { id: true, displayName: true },
      orderBy: { displayName: 'asc' },
    }),
  ])

  const decades = Array.from(
    new Set(yearRows.map((r) => Math.floor((r.dateYear as number) / 10) * 10))
  ).sort((a, b) => a - b)

  // Pass the same filter params straight through to MediaGrid — the API
  // route is responsible for validating/ignoring anything malformed, so the
  // page doesn't need to duplicate that logic.
  const queryParams = new URLSearchParams()
  if (q) queryParams.set('q', q)
  if (type) queryParams.set('type', type)
  if (backs) queryParams.set('backs', backs)
  if (decade) queryParams.set('decade', decade)
  if (albumId) queryParams.set('albumId', albumId)
  if (personId) queryParams.set('personId', personId)
  const query = queryParams.toString()

  return (
    <div>
      <h1 className="mb-6 text-3xl font-bold">Library</h1>
      <div className="lg:flex lg:gap-8">
        <aside className="mb-6 lg:mb-0 lg:w-64 lg:shrink-0">
          <LibraryFilters decades={decades} albums={albums} people={people} />
        </aside>
        <div className="min-w-0 flex-1">
          <LibrarySearch />
          {view === 'timeline' ? <TimelineView /> : <MediaGrid query={query} />}
        </div>
      </div>
    </div>
  )
}
