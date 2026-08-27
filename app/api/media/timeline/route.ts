import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { mediaItemToDTO, type MediaItemDTO } from '@/lib/media'

/**
 * Whole-archive timeline view: READY, non-deleted items grouped by decade and
 * year (nulls → "undated"), decades desc, years desc within decade, items by
 * createdAt desc within year. Ignores search/type/decade/album filters — it's
 * a browsing view of everything, not a filtered query.
 *
 * No pagination: single `findMany` over the whole archive, grouped in JS.
 * Fine at family scale (low thousands of items); revisit (e.g. paginate by
 * decade, or move grouping into SQL) if the archive outgrows an in-memory
 * findMany.
 */
export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const viewer = await prisma.user.findUnique({ where: { clerkId: userId } })
  const viewerUserId = viewer?.id

  const items = await prisma.mediaItem.findMany({
    where: { status: 'READY', deletedAt: null },
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
