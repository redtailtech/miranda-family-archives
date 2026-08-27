import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { albumToDTO } from '@/lib/albums'
import { createAlbumWithAudit } from '@/lib/audit'

export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const user = await prisma.user.findUnique({ where: { clerkId: userId } })
  if (!user) return NextResponse.json({ error: 'no user record' }, { status: 403 })

  const albums = await prisma.album.findMany({
    orderBy: { createdAt: 'desc' },
    include: { items: { include: { mediaItem: true } } },
  })
  return NextResponse.json({ albums: await Promise.all(albums.map((a) => albumToDTO(a))) })
}

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const user = await prisma.user.findUnique({ where: { clerkId: userId } })
  if (!user) return NextResponse.json({ error: 'no user record' }, { status: 403 })

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })
  const description =
    body.description === undefined ? undefined : body.description === null ? null : String(body.description)

  const { id } = await createAlbumWithAudit(user.id, { name, description })
  return NextResponse.json({ id })
}
