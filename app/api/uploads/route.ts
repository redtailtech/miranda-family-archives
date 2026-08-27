import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { createMultipart } from '@/lib/s3'
import { mediaTypeForMime, originalKey, MAX_UPLOAD_BYTES } from '@/lib/media'

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const user = await prisma.user.findUnique({ where: { clerkId: userId } })
  if (!user) return NextResponse.json({ error: 'no user record' }, { status: 403 })

  const { filename, size, type, backOfId } = await req.json()
  const mediaType = mediaTypeForMime(type)
  if (!mediaType) return NextResponse.json({ error: `unsupported file type: ${type}` }, { status: 400 })
  if (!filename || typeof size !== 'number' || size <= 0 || size > MAX_UPLOAD_BYTES)
    return NextResponse.json({ error: 'invalid filename or size (max 2GB)' }, { status: 400 })

  if (backOfId) {
    if (typeof backOfId !== 'string') return NextResponse.json({ error: 'invalid backOfId' }, { status: 400 })
    if (mediaType !== 'PHOTO')
      return NextResponse.json({ error: 'the back of a photo must be a photo' }, { status: 400 })
    const front = await prisma.mediaItem.findFirst({
      where: { id: backOfId, deletedAt: null },
      include: { backItem: { select: { id: true, deletedAt: true } } },
    })
    if (!front) return NextResponse.json({ error: 'photo not found' }, { status: 404 })
    if (front.type !== 'PHOTO')
      return NextResponse.json({ error: 'only photos can have a back' }, { status: 400 })
    if (front.backOfId)
      return NextResponse.json({ error: 'that photo is itself the back of another photo' }, { status: 409 })
    if (front.backItem && front.backItem.deletedAt === null)
      return NextResponse.json({ error: 'that photo already has a back' }, { status: 409 })
    if (front.backItem && front.backItem.deletedAt !== null)
      return NextResponse.json(
        { error: 'that photo already has a back in Deleted items — an admin can restore it first' },
        { status: 409 }
      )
  }

  // The checks above (front live, slot free) and this create aren't
  // atomic — two uploads can race to claim the same front's back slot. The
  // backOfId column is unique, so a concurrent winner surfaces here as a
  // P2002 rather than corrupting the "exactly one back" invariant.
  let item
  try {
    item = await prisma.mediaItem.create({
      data: {
        type: mediaType,
        status: 'UPLOADING',
        originalKey: '', // set below once we have the id
        originalFilename: filename,
        originalSize: BigInt(size),
        mimeType: type,
        uploadedById: user.id,
        ...(backOfId ? { backOfId } : {}),
      },
    })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')
      return NextResponse.json({ error: 'that photo already has a back' }, { status: 409 })
    throw err
  }
  const key = originalKey(item.id, filename)
  await prisma.mediaItem.update({ where: { id: item.id }, data: { originalKey: key } })
  const { uploadId } = await createMultipart(key, type)
  return NextResponse.json({ mediaId: item.id, key, uploadId })
}
