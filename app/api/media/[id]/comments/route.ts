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

const MAX_COMMENT_LENGTH = 2000

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireUser()
  if (error) return error
  const { id } = await params
  const item = await prisma.mediaItem.findFirst({ where: { id, deletedAt: null } })
  if (!item) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const comments = await prisma.comment.findMany({
    where: { mediaItemId: id },
    orderBy: { createdAt: 'asc' },
    include: { user: true },
  })
  return NextResponse.json({
    comments: comments.map((c) => ({
      id: c.id,
      body: c.body,
      user: { id: c.user.id, name: c.user.name || c.user.email },
      createdAt: c.createdAt.toISOString(),
      canDelete: c.userId === user!.id || user!.role === 'ADMIN',
    })),
  })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireUser()
  if (error) return error
  const { id } = await params
  const item = await prisma.mediaItem.findFirst({ where: { id, deletedAt: null } })
  if (!item) return NextResponse.json({ error: 'not found' }, { status: 404 })

  let body: unknown
  try {
    ;({ body } = await req.json())
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }
  if (typeof body !== 'string') return NextResponse.json({ error: 'body must be a string' }, { status: 400 })
  const trimmed = body.trim()
  if (trimmed.length === 0) return NextResponse.json({ error: 'body must not be empty' }, { status: 400 })
  if (trimmed.length > MAX_COMMENT_LENGTH)
    return NextResponse.json({ error: `body must be ${MAX_COMMENT_LENGTH} characters or fewer` }, { status: 400 })

  const comment = await prisma.comment.create({
    data: { mediaItemId: id, userId: user!.id, body: trimmed },
    include: { user: true },
  })
  return NextResponse.json({
    comment: {
      id: comment.id,
      body: comment.body,
      user: { id: comment.user.id, name: comment.user.name || comment.user.email },
      createdAt: comment.createdAt.toISOString(),
      canDelete: true,
    },
  })
}
