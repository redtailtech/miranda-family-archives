import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { mediaItemToDTO } from '@/lib/media'

const MEDIA_TYPES = ['PHOTO', 'DOCUMENT'] as const

/**
 * Build the Prisma `where` clause for the media listing endpoint from raw
 * (untrusted) search params. Invalid/unrecognized filter values are ignored
 * rather than rejected — filters are a UX affordance, not validated input.
 *
 * `favoriteOnly` with no `viewerUserId` is handled by the caller (returns an
 * empty page) rather than here, since it changes the response shape, not just
 * the where clause.
 */
export function buildMediaWhere(
  params: {
    q?: string | null
    type?: string | null
    decade?: string | null
    albumId?: string | null
    favorite?: string | null
    personId?: string | null
    backs?: string | null
  },
  viewerUserId: string | undefined
): Prisma.MediaItemWhereInput {
  const favoriteOnly = params.favorite === '1'

  const q = params.q?.trim() || null
  const type = params.type && (MEDIA_TYPES as readonly string[]).includes(params.type) ? params.type : null

  let decadeStart: number | null = null
  if (params.decade) {
    const n = Number(params.decade)
    if (Number.isInteger(n) && n > 0) decadeStart = n
  }

  const albumId = params.albumId?.trim() || null
  const personId = params.personId?.trim() || null

  return {
    deletedAt: null,
    ...(favoriteOnly && viewerUserId ? { favorites: { some: { userId: viewerUserId } } } : {}),
    ...(q
      ? {
          OR: [
            { title: { contains: q, mode: 'insensitive' } },
            { description: { contains: q, mode: 'insensitive' } },
            { location: { contains: q, mode: 'insensitive' } },
            { originalFilename: { contains: q, mode: 'insensitive' } },
          ],
        }
      : {}),
    ...(type ? { type: type as 'PHOTO' | 'DOCUMENT' } : {}),
    ...(decadeStart !== null ? { dateYear: { gte: decadeStart, lte: decadeStart + 9 } } : {}),
    ...(albumId ? { albumItems: { some: { albumId } } } : {}),
    ...(personId ? { people: { some: { personId } } } : {}),
    ...(params.backs === '1' ? { backOfId: { not: null } } : { backOfId: null }),
  }
}

export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const viewer = await prisma.user.findUnique({ where: { clerkId: userId } })
  const viewerUserId = viewer?.id

  const cursor = req.nextUrl.searchParams.get('cursor')
  const rawLimit = Number(req.nextUrl.searchParams.get('limit') ?? 50)
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(1, Math.trunc(rawLimit)), 100) : 50
  const favoriteOnly = req.nextUrl.searchParams.get('favorite') === '1'

  // Carried fix from Task 4 review: if favorite=1 but the viewer has no User
  // row yet (Clerk-webhook sync race), return an empty page instead of
  // silently dropping the filter and showing the full feed.
  if (favoriteOnly && !viewerUserId) {
    return NextResponse.json({ items: [], nextCursor: null })
  }

  const where = buildMediaWhere(
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
  )

  const items = await prisma.mediaItem.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: {
      uploadedBy: true,
      _count: { select: { hearts: true } },
      hearts: viewerUserId ? { where: { userId: viewerUserId } } : false,
    },
  })
  const hasMore = items.length > limit
  const page = hasMore ? items.slice(0, limit) : items
  return NextResponse.json({
    items: await Promise.all(page.map((i) => mediaItemToDTO(i, { viewerUserId }))),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  })
}
