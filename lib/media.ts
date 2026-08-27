import type { MediaItem, MediaPerson, Person, User } from '@prisma/client'
import { prisma } from '@/lib/db'
import { signGetUrl } from '@/lib/s3'
import { personToLite, type PersonLite } from '@/lib/people'

export const ACCEPTED_MIMES = [
  'image/tiff',
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/webp',
  'application/pdf',
]

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024 // 2 GB

export function mediaTypeForMime(mime: string): 'PHOTO' | 'DOCUMENT' | null {
  if (mime === 'application/pdf') return 'DOCUMENT'
  if (ACCEPTED_MIMES.includes(mime)) return 'PHOTO'
  return null
}

export function originalKey(id: string, filename: string) {
  // keep the original filename but strip path separators
  return `originals/${id}/${filename.replace(/[/\\]/g, '_')}`
}

export function derivedKey(id: string, size: 'thumb' | 'web' | 'large') {
  return `derived/${id}/${size}.jpg`
}

export type MediaItemDTO = {
  id: string
  type: string
  status: string
  error: string | null
  title: string | null
  description: string | null
  location: string | null
  originalFilename: string
  originalSize: number
  mimeType: string
  dateYear: number | null
  dateMonth: number | null
  dateDay: number | null
  dateIsApproximate: boolean
  createdAt: string
  uploadedBy: { id: string; name: string } | null
  thumbUrl: string | null
  webUrl?: string | null
  largeUrl?: string | null
  exif?: Record<string, unknown> | null
  inlineUrl?: string | null
  heartCount: number
  heartedByMe: boolean
  people?: PersonLite[]
  duplicateOfId: string | null
  duplicateOf?: { id: string; title: string | null; filename: string; thumbUrl: string | null } | null
  backOfId: string | null
  back?: { id: string; title: string | null; filename: string; thumbUrl: string | null } | null
  backOf?: { id: string; title: string | null; filename: string } | null
}

export type MediaItemWithSocial = MediaItem & {
  uploadedBy?: User | null
  _count?: { hearts: number }
  hearts?: { userId: string }[]
  people?: (MediaPerson & { person: Person })[]
}

export async function mediaItemToDTO(
  item: MediaItemWithSocial,
  opts: { detail?: boolean; viewerUserId?: string } = {}
): Promise<MediaItemDTO> {
  const dto: MediaItemDTO = {
    id: item.id,
    type: item.type,
    status: item.status,
    error: item.error,
    title: item.title,
    description: item.description,
    location: item.location,
    originalFilename: item.originalFilename,
    originalSize: Number(item.originalSize), // BigInt → number (safe far beyond 2GB)
    mimeType: item.mimeType,
    dateYear: item.dateYear,
    dateMonth: item.dateMonth,
    dateDay: item.dateDay,
    dateIsApproximate: item.dateIsApproximate,
    createdAt: item.createdAt.toISOString(),
    uploadedBy: item.uploadedBy ? { id: item.uploadedBy.id, name: item.uploadedBy.name || item.uploadedBy.email } : null,
    thumbUrl: item.thumbKey ? await signGetUrl(item.thumbKey) : null,
    heartCount: item._count?.hearts ?? 0,
    heartedByMe: Array.isArray(item.hearts) && item.hearts.length > 0,
    duplicateOfId: item.duplicateOfId,
    backOfId: item.backOfId,
  }
  if (opts.detail) {
    dto.webUrl = item.webKey ? await signGetUrl(item.webKey) : null
    dto.largeUrl = item.largeKey ? await signGetUrl(item.largeKey) : null
    dto.exif = (item.exif as Record<string, unknown> | null) ?? null
    if (item.type === 'DOCUMENT' && item.status === 'READY')
      dto.inlineUrl = await signGetUrl(item.originalKey, { expiresIn: 3600 })
    if (item.people) {
      const tagged = item.people.filter((mp) => mp.person.deletedAt === null)
      dto.people = await Promise.all(tagged.map((mp) => personToLite(mp.person)))
    }
    if (item.duplicateOfId) {
      const target = await prisma.mediaItem.findFirst({
        where: { id: item.duplicateOfId, deletedAt: null },
        select: { id: true, title: true, originalFilename: true, thumbKey: true },
      })
      dto.duplicateOf = target
        ? {
            id: target.id,
            title: target.title,
            filename: target.originalFilename,
            thumbUrl: target.thumbKey ? await signGetUrl(target.thumbKey) : null,
          }
        : null
    }
    if (item.backOfId) {
      const front = await prisma.mediaItem.findFirst({
        where: { id: item.backOfId, deletedAt: null },
        select: { id: true, title: true, originalFilename: true },
      })
      dto.backOf = front ? { id: front.id, title: front.title, filename: front.originalFilename } : null
    } else {
      const back = await prisma.mediaItem.findFirst({
        where: { backOfId: item.id, deletedAt: null, status: 'READY' },
        select: { id: true, title: true, originalFilename: true, thumbKey: true },
      })
      dto.back = back
        ? { id: back.id, title: back.title, filename: back.originalFilename, thumbUrl: back.thumbKey ? await signGetUrl(back.thumbKey) : null }
        : null
    }
  }
  return dto
}
