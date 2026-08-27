import { PutObjectCommand } from '@aws-sdk/client-s3'
import sharp from 'sharp'
import { prisma } from '@/lib/db'
import { s3, BUCKET } from '@/lib/s3'
import { derivedKey } from '@/lib/media'
import { updatePersonAvatarWithAudit } from '@/lib/audit'

export const MAX_AVATAR_BYTES = 5 * 1024 * 1024

export function avatarKeyFor(personId: string): string {
  return `avatars/${personId}.jpg`
}

/**
 * Resizes `buffer` to a 400x400 "cover" JPEG, uploads it to
 * `avatars/{personId}.jpg`, and sets it as the person's avatarKey (audited
 * as a person UPDATE). Factored out of the POST handler so module-level
 * verification can exercise the sharp+put+audit path via a direct call,
 * without constructing a FormData/NextRequest.
 */
export async function setPersonAvatarFromUpload(
  personId: string,
  actorUserId: string,
  buffer: Buffer,
  mimeType: string
): Promise<{ avatarKey: string }> {
  if (buffer.length > MAX_AVATAR_BYTES)
    throw Object.assign(new Error('file too large (max 5MB)'), { status: 400 })
  if (!mimeType.startsWith('image/'))
    throw Object.assign(new Error('file must be an image'), { status: 400 })

  const person = await prisma.person.findFirst({ where: { id: personId, deletedAt: null } })
  if (!person) throw Object.assign(new Error('not found'), { status: 404 })

  const jpeg = await sharp(buffer)
    .rotate() // honor EXIF orientation
    .resize({ width: 400, height: 400, fit: 'cover' })
    .jpeg({ quality: 82 })
    .toBuffer()

  const key = avatarKeyFor(personId)
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: jpeg, ContentType: 'image/jpeg' }))
  await updatePersonAvatarWithAudit(personId, actorUserId, key)
  return { avatarKey: key }
}

/**
 * Sets a person's avatar to the thumb derivative of a photo they're tagged
 * in ("pick from their photos"). Requires a MediaPerson tag row for
 * (mediaId, personId) and the media to be READY and not deleted.
 */
export async function setPersonAvatarFromMedia(
  personId: string,
  mediaId: string,
  actorUserId: string
): Promise<{ avatarKey: string }> {
  const [person, tag, media] = await Promise.all([
    prisma.person.findFirst({ where: { id: personId, deletedAt: null } }),
    prisma.mediaPerson.findUnique({
      where: { mediaItemId_personId: { mediaItemId: mediaId, personId } },
    }),
    prisma.mediaItem.findFirst({ where: { id: mediaId, deletedAt: null } }),
  ])
  if (!person) throw Object.assign(new Error('not found'), { status: 404 })
  if (!tag) throw Object.assign(new Error('person is not tagged in that photo'), { status: 400 })
  if (!media || media.status !== 'READY')
    throw Object.assign(new Error('photo is not ready yet'), { status: 400 })

  const key = derivedKey(mediaId, 'thumb')
  await updatePersonAvatarWithAudit(personId, actorUserId, key)
  return { avatarKey: key }
}

/** Clears a person's avatar back to the gender silhouette. */
export async function clearPersonAvatar(personId: string, actorUserId: string): Promise<void> {
  await updatePersonAvatarWithAudit(personId, actorUserId, null)
}
