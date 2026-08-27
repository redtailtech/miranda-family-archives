import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { abortMultipart } from '@/lib/s3'

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { mediaId, key, uploadId } = await req.json()
  const item = await prisma.mediaItem.findUnique({ where: { id: mediaId } })
  if (item && item.status === 'UPLOADING') {
    if (uploadId && key === item.originalKey) await abortMultipart(key, uploadId).catch(() => {})
    await prisma.mediaItem.delete({ where: { id: mediaId } })
  }
  return NextResponse.json({ ok: true })
}
