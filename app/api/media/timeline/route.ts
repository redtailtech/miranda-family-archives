import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { mediaItemToDTO, type MediaItemDTO } from '@/lib/media'
import { buildMediaWhere } from '@/app/api/media/route'

/**
 * Whole-archive timeline view: READY, non-deleted items grouped by decade and
 * year (nulls → "undated"), decades desc, years desc within decade, items by
 * createdAt desc within year. Accepts the same filter params as the list
 * route (`q`, `type`, `backs`, `decade`, `albumId`, `personId`, `favorite`)
 * via the shared `buildMediaWhere`, with `status: 'READY'` merged on top —
 * timeline only ever shows processed items.
 *
 * No pagination: single `findMany` over the (filtered) archive, grouped in
 * JS. Fine at family scale (low thousands of items); revisit (e.g. paginate
 * by decade, or move grouping into SQL) if the archive outgrows an
 * in-memory findMany.
 */
export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const viewer = await prisma.user.findUnique({ where: { clerkId: userId } })
  const viewerUserId = viewer?.id

  const favoriteOnly = req.nextUrl.searchParams.get('favorite') === '1'

  // Mirrors the list route's guard: if favorite=1 but the viewer has no User
  // row yet (Clerk-webhook sync race), return an empty timeline instead of
  // silently dropping the filter and showing the full archive.
  if (favoriteOnly && !viewerUserId) {
    return NextResponse.json({ decades: [], undated: [] })
  }

  const where = {
    ...buildMediaWhere(
      {
        q: req.nextUrl.searchParams.get('q'),
        type: req.nextUrl.searchParams.get('type'),
        decade: req.nextUrl.searchParams.get('decade'),
        albumId: req.nextUrl.searchParams.get('albumId'),
        favorite: req.nextUrl.searchParams.get('favorite'),
        personId: req.nextUrl.searchParams.get('personId'),
        backs: req.nextUrl.searchParams.get('backs'),
      },
      viewerUserId
    ),
    status: 'READY' as const,
  }

  const items = await prisma.mediaItem.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      uploadedBy: true,
      _count: { select: { hearts: true } },
      hearts: viewerUserId ? { where: { userId: viewerUserId } } : false,
    },
  })

  const dtos = await Promise.all(items.map((i) => mediaItemToDTO(i, { viewerUserId })))

  const undated: MediaItemDTO[] = []
  const decadeMap = new Map<number, Map<number, MediaItemDTO[]>>()

  for (let i = 0; i < items.length; i++) {
    const year = items[i].dateYear
    const dto = dtos[i]
    if (year === null || year === undefined) {
      undated.push(dto)
      continue
    }
    const decade = Math.floor(year / 10) * 10
    if (!decadeMap.has(decade)) decadeMap.set(decade, new Map())
    const yearMap = decadeMap.get(decade)!
    if (!yearMap.has(year)) yearMap.set(year, [])
    yearMap.get(year)!.push(dto)
  }

  const decades = Array.from(decadeMap.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([decade, yearMap]) => ({
      decade,
      years: Array.from(yearMap.entries())
        .sort((a, b) => b[0] - a[0])
        .map(([year, yearItems]) => ({ year, items: yearItems })),
    }))

  return NextResponse.json({ decades, undated })
}
