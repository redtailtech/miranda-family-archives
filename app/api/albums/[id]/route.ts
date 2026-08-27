import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { albumToDTO } from '@/lib/albums'
import { mediaItemToDTO } from '@/lib/media'
import { updateAlbumWithAudit, deleteAlbumWithAudit } from '@/lib/audit'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const user = await prisma.user.findUnique({ where: { clerkId: userId } })
  if (!user) return NextResponse.json({ error: 'no user record' }, { status: 403 })

  const { id } = await params
  const album = await prisma.album.findUnique({
    where: { id },
    include: { items: { include: { mediaItem: { include: { uploadedBy: true } } } } },
  })
  if (!album) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const liveItems = album.items
    .filter((i) => i.mediaItem.deletedAt === null)
    .sort((a, b) => a.position - b.position)

  return NextResponse.json({
    album: await albumToDTO(album),
    items: await Promise.all(liveItems.map((i) => mediaItemToDTO(i.mediaItem))),
  })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const user = await prisma.user.findUnique({ where: { clerkId: userId } })
  if (!user) return NextResponse.json({ error: 'no user record' }, { status: 403 })

  const { id } = await params
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }

  const input: Partial<{ name: string; description: string | null; coverMediaId: string | null }> = {}

  if ('name' in body) {
    if (typeof body.name !== 'string' || body.name.trim() === '')
      return NextResponse.json({ error: 'name must be a non-empty string' }, { status: 400 })
    input.name = body.name.trim()
  }

  if ('description' in body) {
    if (body.description !== null && typeof body.description !== 'string')
      return NextResponse.json({ error: 'description must be a string or null' }, { status: 400 })
    input.description = body.description
  }

  if ('coverMediaId' in body) {
    if (body.coverMediaId !== null && typeof body.coverMediaId !== 'string')
      return NextResponse.json({ error: 'coverMediaId must be a string or null' }, { status: 400 })
    if (body.coverMediaId !== null) {
      const member = await prisma.albumItem.findUnique({
        where: { albumId_mediaItemId: { albumId: id, mediaItemId: body.coverMediaId } },
      })
      if (!member)
        return NextResponse.json({ error: 'coverMediaId must be an item in the album' }, { status: 400 })
    }
    input.coverMediaId = body.coverMediaId
  }

  try {
    const { changed } = await updateAlbumWithAudit(id, user.id, input)
    return NextResponse.json({ ok: true, changed })
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500
    return NextResponse.json({ error: 'not found' }, { status })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const user = await prisma.user.findUnique({ where: { clerkId: userId } })
  if (!user) return NextResponse.json({ error: 'no user record' }, { status: 403 })

  const { id } = await params
  try {
    await deleteAlbumWithAudit(id, user.id)
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500
    return NextResponse.json({ error: 'not found' }, { status })
  }
  return NextResponse.json({ ok: true })
}
