import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { completeMultipart } from '@/lib/s3'
import { enqueueProcessMedia } from '@/lib/queue'

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const user = await prisma.user.findUnique({ where: { clerkId: userId } })
  if (!user) return NextResponse.json({ error: 'no user record' }, { status: 403 })

  const { mediaId, key, uploadId, parts } = await req.json()
  const item = await prisma.mediaItem.findUnique({ where: { id: mediaId } })
  if (!item || item.originalKey !== key)
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (item.uploadedById !== user.id && user.role !== 'ADMIN')
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  if (item.status !== 'UPLOADING')
    return NextResponse.json({ error: 'not uploading' }, { status: 409 })

  if (
    !Array.isArray(parts) ||
    parts.length === 0 ||
    !parts.every(
      (p) =>
        p &&
        typeof p.ETag === 'string' &&
        typeof p.PartNumber === 'number' &&
        Number.isInteger(p.PartNumber)
    )
  )
    return NextResponse.json({ error: 'invalid parts' }, { status: 400 })

  await completeMultipart(key, uploadId, parts)

  await prisma.$transaction([
    prisma.mediaItem.update({ where: { id: mediaId }, data: { status: 'PROCESSING' } }),
    prisma.auditLog.create({
      data: item.backOfId
        ? {
            userId: user.id,
            entityType: 'media_item',
            entityId: item.backOfId,
            action: 'UPDATE',
            changes: { back: { from: null, to: item.originalFilename } },
          }
        : {
            userId: user.id,
            entityType: 'media_item',
            entityId: mediaId,
            action: 'CREATE',
            changes: { filename: { from: null, to: item.originalFilename } },
          },
    }),
  ])
  await enqueueProcessMedia(mediaId)
  return NextResponse.json({ ok: true })
}
