import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

async function requireUser() {
  const { userId } = await auth()
  if (!userId) return { error: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) }
  const user = await prisma.user.findUnique({ where: { clerkId: userId } })
  if (!user) return { error: NextResponse.json({ error: 'no user record' }, { status: 403 }) }
  return { user }
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireUser()
  if (error) return error
  const { id } = await params
  const item = await prisma.mediaItem.findFirst({ where: { id, deletedAt: null } })
  if (!item) return NextResponse.json({ error: 'not found' }, { status: 404 })

  await prisma.$transaction(async (tx) => {
    const existing = await tx.heart.findUnique({
      where: { userId_mediaItemId: { userId: user!.id, mediaItemId: id } },
    })
    if (!existing) {
      await tx.heart.create({ data: { userId: user!.id, mediaItemId: id } })
      await tx.favorite.upsert({
        where: { userId_mediaItemId: { userId: user!.id, mediaItemId: id } },
        create: { userId: user!.id, mediaItemId: id },
        update: {},
      })
    }
  })
  const heartCount = await prisma.heart.count({ where: { mediaItemId: id } })
  return NextResponse.json({ ok: true, heartCount })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireUser()
  if (error) return error
  const { id } = await params
  const item = await prisma.mediaItem.findFirst({ where: { id, deletedAt: null } })
  if (!item) return NextResponse.json({ error: 'not found' }, { status: 404 })

  await prisma.$transaction(async (tx) => {
    await tx.heart.deleteMany({ where: { userId: user!.id, mediaItemId: id } })
    await tx.favorite.deleteMany({ where: { userId: user!.id, mediaItemId: id } })
  })
  const heartCount = await prisma.heart.count({ where: { mediaItemId: id } })
  return NextResponse.json({ ok: true, heartCount })
}
