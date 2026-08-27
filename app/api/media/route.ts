import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { mediaItemToDTO } from '@/lib/media'

export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const viewer = await prisma.user.findUnique({ where: { clerkId: userId } })
  const viewerUserId = viewer?.id

  const cursor = req.nextUrl.searchParams.get('cursor')
  const rawLimit = Number(req.nextUrl.searchParams.get('limit') ?? 50)
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(1, Math.trunc(rawLimit)), 100) : 50
  const favoriteOnly = req.nextUrl.searchParams.get('favorite') === '1'

  const items = await prisma.mediaItem.findMany({
    where: {
      deletedAt: null,
      ...(favoriteOnly && viewerUserId ? { favorites: { some: { userId: viewerUserId } } } : {}),
    },
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
