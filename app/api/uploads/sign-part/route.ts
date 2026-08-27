import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { signPartUrl } from '@/lib/s3'

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const user = await prisma.user.findUnique({ where: { clerkId: userId } })
  if (!user) return NextResponse.json({ error: 'no user record' }, { status: 403 })

  const { key, uploadId, partNumber } = await req.json()
  if (!key?.startsWith('originals/') || !uploadId || !Number.isInteger(partNumber))
    return NextResponse.json({ error: 'bad request' }, { status: 400 })

  const mediaId = key.split('/')[1]
  const item = await prisma.mediaItem.findUnique({ where: { id: mediaId } })
  if (!item || item.status !== 'UPLOADING' || item.originalKey !== key)
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (item.uploadedById !== user.id && user.role !== 'ADMIN')
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  return NextResponse.json({ url: await signPartUrl(key, uploadId, partNumber) })
}
