import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { albumItemsChangeWithAudit } from '@/lib/audit'
import { requireUser } from '@/lib/require-user'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireUser()
  if (error) return error
  const { id } = await params
  let mediaId: string
  try {
    ;({ mediaId } = await req.json())
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }
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
  let orderedMediaIds: unknown
  try {
    ;({ orderedMediaIds } = await req.json())
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }
  const items = await prisma.albumItem.findMany({
    where: { albumId: id },
    orderBy: { position: 'asc' },
    include: { mediaItem: { select: { deletedAt: true } } },
  })
  if (items.length === 0) return NextResponse.json({ error: 'not found' }, { status: 404 })
  // Clients only ever see live (non-soft-deleted) media, so the reorder
  // permutation must be validated against the live subset — otherwise an
  // album with any soft-deleted member can never pass validation again.
  // Soft-deleted rows keep their relative order, appended after the live ones.
  const liveItems = items.filter((i) => i.mediaItem.deletedAt === null)
  const deadItems = items.filter((i) => i.mediaItem.deletedAt !== null)
  const liveIds = new Set(liveItems.map((i) => i.mediaItemId))
  if (
    !Array.isArray(orderedMediaIds) ||
    orderedMediaIds.length !== liveItems.length ||
    new Set(orderedMediaIds).size !== liveItems.length ||
    !orderedMediaIds.every((m: unknown) => typeof m === 'string' && liveIds.has(m))
  )
    return NextResponse.json({ error: 'orderedMediaIds must be a permutation of album items' }, { status: 400 })
  await prisma.$transaction([
    ...orderedMediaIds.map((mediaItemId: string, position: number) =>
      prisma.albumItem.update({
        where: { albumId_mediaItemId: { albumId: id, mediaItemId } },
        data: { position },
      })
    ),
    ...deadItems.map((item, index) =>
      prisma.albumItem.update({
        where: { albumId_mediaItemId: { albumId: id, mediaItemId: item.mediaItemId } },
        data: { position: orderedMediaIds.length + index },
      })
    ),
  ])
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
