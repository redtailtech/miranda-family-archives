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

  await completeMultipart(key, uploadId, parts)

  await prisma.$transaction([
    prisma.mediaItem.update({ where: { id: mediaId }, data: { status: 'PROCESSING' } }),
    prisma.auditLog.create({
      data: {
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
