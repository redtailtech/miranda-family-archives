import { prisma } from '@/lib/db'
import { LibraryFilterPills, LibrarySearch } from '@/components/library-controls'
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

  const [yearRows, albums, peopleRows, tagCounts] = await Promise.all([
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
    // Per-person counts must match what picking that person shows: tags on
    // live, non-back items only (same constraints buildMediaWhere applies).
    prisma.mediaPerson.groupBy({
      by: ['personId'],
      where: { mediaItem: { deletedAt: null, backOfId: null } },
      _count: { _all: true },
    }),
  ])
  const countByPerson = new Map(tagCounts.map((t) => [t.personId, t._count._all]))
  const people = peopleRows.map((p) => ({ ...p, photoCount: countByPerson.get(p.id) ?? 0 }))

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
      <LibrarySearch />
      <LibraryFilterPills decades={decades} albums={albums} people={people} />
      {view === 'timeline' ? <TimelineView query={query} /> : <MediaGrid query={query} />}
    </div>
  )
}
