import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { createMultipart } from '@/lib/s3'
import { mediaTypeForMime, originalKey, MAX_UPLOAD_BYTES } from '@/lib/media'

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const user = await prisma.user.findUnique({ where: { clerkId: userId } })
  if (!user) return NextResponse.json({ error: 'no user record' }, { status: 403 })

  const { filename, size, type } = await req.json()
  const mediaType = mediaTypeForMime(type)
  if (!mediaType) return NextResponse.json({ error: `unsupported file type: ${type}` }, { status: 400 })
  if (!filename || typeof size !== 'number' || size <= 0 || size > MAX_UPLOAD_BYTES)
    return NextResponse.json({ error: 'invalid filename or size (max 2GB)' }, { status: 400 })

  const item = await prisma.mediaItem.create({
    data: {
      type: mediaType,
      status: 'UPLOADING',
      originalKey: '', // set below once we have the id
      originalFilename: filename,
      originalSize: BigInt(size),
      mimeType: type,
      uploadedById: user.id,
    },
  })
  const key = originalKey(item.id, filename)
  await prisma.mediaItem.update({ where: { id: item.id }, data: { originalKey: key } })
  const { uploadId } = await createMultipart(key, type)
  return NextResponse.json({ mediaId: item.id, key, uploadId })
}
