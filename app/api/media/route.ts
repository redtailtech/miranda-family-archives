import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { mediaItemToDTO } from '@/lib/media'

export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const cursor = req.nextUrl.searchParams.get('cursor')
  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') ?? 50), 100)

  const items = await prisma.mediaItem.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: { uploadedBy: true },
  })
  const hasMore = items.length > limit
  const page = hasMore ? items.slice(0, limit) : items
  return NextResponse.json({
    items: await Promise.all(page.map((i) => mediaItemToDTO(i))),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  })
}
