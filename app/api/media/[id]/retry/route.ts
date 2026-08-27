import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { enqueueProcessMedia } from '@/lib/queue'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const user = await prisma.user.findUnique({ where: { clerkId: userId } })
  if (!user) return NextResponse.json({ error: 'no user record' }, { status: 403 })
  const { id } = await params
  const item = await prisma.mediaItem.findFirst({ where: { id, deletedAt: null } })
  if (!item) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (user.role !== 'ADMIN' && item.uploadedById !== user.id)
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const updated = await prisma.mediaItem.updateMany({
    where: { id, deletedAt: null, status: 'FAILED' },
    data: { status: 'PROCESSING', error: null },
  })
  if (updated.count !== 1) return NextResponse.json({ error: 'not failed' }, { status: 400 })
  await enqueueProcessMedia(id)
  return NextResponse.json({ ok: true })
}
