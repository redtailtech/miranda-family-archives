import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { albumItemsChangeWithAudit } from '@/lib/audit'

async function requireUser() {
  const { userId } = await auth()
  if (!userId) return { error: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) }
  const user = await prisma.user.findUnique({ where: { clerkId: userId } })
  if (!user) return { error: NextResponse.json({ error: 'no user record' }, { status: 403 }) }
  return { user }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireUser()
  if (error) return error
  const { id } = await params
  const { mediaId } = await req.json()
  const album = await prisma.album.findUnique({ where: { id }, include: { items: true } })
  if (!album) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const media = await prisma.mediaItem.findFirst({ where: { id: mediaId, deletedAt: null } })
  if (!media) return NextResponse.json({ error: 'media not found' }, { status: 404 })
  if (album.items.some((i) => i.mediaItemId === mediaId))
    return NextResponse.json({ error: 'already in album' }, { status: 409 })
  const maxPos = album.items.reduce((m, i) => Math.max(m, i.position), -1)
  await prisma.albumItem.create({ data: { albumId: id, mediaItemId: mediaId, position: maxPos + 1 } })
  await albumItemsChangeWithAudit(id, user!.id, { added: [mediaId] }, album.items.length, album.items.length + 1)
  return NextResponse.json({ ok: true })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireUser()
  if (error) return error
  const { id } = await params
  const { orderedMediaIds } = await req.json()
  const items = await prisma.albumItem.findMany({ where: { albumId: id } })
  if (items.length === 0) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const current = new Set(items.map((i) => i.mediaItemId))
  if (
    !Array.isArray(orderedMediaIds) ||
    orderedMediaIds.length !== items.length ||
    !orderedMediaIds.every((m: unknown) => typeof m === 'string' && current.has(m))
  )
    return NextResponse.json({ error: 'orderedMediaIds must be a permutation of album items' }, { status: 400 })
  await prisma.$transaction(
    orderedMediaIds.map((mediaItemId: string, position: number) =>
      prisma.albumItem.update({
        where: { albumId_mediaItemId: { albumId: id, mediaItemId } },
        data: { position },
      })
    )
  )
  await albumItemsChangeWithAudit(id, user!.id, { reordered: true }, items.length, items.length)
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireUser()
  if (error) return error
  const { id } = await params
  const mediaId = req.nextUrl.searchParams.get('mediaId')
  if (!mediaId) return NextResponse.json({ error: 'mediaId required' }, { status: 400 })
  const before = await prisma.albumItem.count({ where: { albumId: id } })
  const del = await prisma.albumItem.deleteMany({ where: { albumId: id, mediaItemId: mediaId } })
  if (del.count === 0) return NextResponse.json({ error: 'not in album' }, { status: 404 })
  const album = await prisma.album.findUnique({ where: { id } })
  if (album?.coverMediaId === mediaId)
    await prisma.album.update({ where: { id }, data: { coverMediaId: null } })
  await albumItemsChangeWithAudit(id, user!.id, { removed: [mediaId] }, before, before - 1)
  return NextResponse.json({ ok: true })
}
