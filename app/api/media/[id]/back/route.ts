import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { requireUser } from '@/lib/require-user'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireUser()
  if (error) return error
  const { id } = await params

  let backItemId: unknown
  try {
    ;({ backItemId } = await req.json())
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }
  if (typeof backItemId !== 'string' || !backItemId)
    return NextResponse.json({ error: 'backItemId is required' }, { status: 400 })
  if (backItemId === id) return NextResponse.json({ error: 'a photo cannot be its own back' }, { status: 400 })

  const front = await prisma.mediaItem.findFirst({
    where: { id, deletedAt: null },
    include: { backItem: { select: { id: true, deletedAt: true } } },
  })
  if (!front) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (front.type !== 'PHOTO')
    return NextResponse.json({ error: 'only photos can have a back' }, { status: 400 })
  if (front.backOfId)
    return NextResponse.json({ error: 'that photo is itself the back of another photo' }, { status: 409 })
  if (front.backItem && front.backItem.deletedAt === null)
    return NextResponse.json({ error: 'that photo already has a back' }, { status: 409 })
  if (front.backItem && front.backItem.deletedAt !== null)
    return NextResponse.json(
      { error: 'that photo already has a back in Deleted items — an admin can restore or remove it' },
      { status: 409 }
    )

  const back = await prisma.mediaItem.findFirst({
    where: { id: backItemId, deletedAt: null },
    include: { backItem: { select: { id: true, deletedAt: true } } },
  })
  if (!back) return NextResponse.json({ error: 'back photo not found' }, { status: 404 })
  if (back.status !== 'READY') return NextResponse.json({ error: 'back photo must be ready' }, { status: 400 })
  if (back.type !== 'PHOTO')
    return NextResponse.json({ error: 'the back of a photo must be a photo' }, { status: 400 })
  if (back.backOfId !== null)
    return NextResponse.json({ error: 'that photo is already a back' }, { status: 409 })
  if (back.backItem && back.backItem.deletedAt === null)
    return NextResponse.json({ error: 'that photo already has a back of its own' }, { status: 409 })

  try {
    await prisma.$transaction([
      prisma.mediaItem.update({ where: { id: backItemId }, data: { backOfId: id } }),
      prisma.auditLog.create({
        data: {
          userId: user!.id,
          entityType: 'media_item',
          entityId: id,
          action: 'UPDATE',
          changes: { back: { from: null, to: back.originalFilename } },
        },
      }),
      prisma.auditLog.create({
        data: {
          userId: user!.id,
          entityType: 'media_item',
          entityId: backItemId,
          action: 'UPDATE',
          changes: { backOf: { from: null, to: front.originalFilename } },
        },
      }),
    ])
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')
      return NextResponse.json({ error: 'that photo already has a back' }, { status: 409 })
    throw err
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireUser()
  if (error) return error
  const { id } = await params

  const back = await prisma.mediaItem.findFirst({ where: { backOfId: id, deletedAt: null } })
  if (!back) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const front = await prisma.mediaItem.findUnique({ where: { id }, select: { originalFilename: true } })

  await prisma.$transaction([
    prisma.mediaItem.update({ where: { id: back.id }, data: { backOfId: null } }),
    prisma.auditLog.create({
      data: {
        userId: user!.id,
        entityType: 'media_item',
        entityId: id,
        action: 'UPDATE',
        changes: { back: { from: back.originalFilename, to: null } },
      },
    }),
    prisma.auditLog.create({
      data: {
        userId: user!.id,
        entityType: 'media_item',
        entityId: back.id,
        action: 'UPDATE',
        changes: { backOf: { from: front?.originalFilename ?? null, to: null } },
      },
    }),
  ])

  return NextResponse.json({ ok: true })
}
