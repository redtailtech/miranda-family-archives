import type { MediaItem, User } from '@prisma/client'
import { signGetUrl } from '@/lib/s3'

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
}

export async function mediaItemToDTO(
  item: MediaItem & { uploadedBy?: User | null },
  opts: { detail?: boolean } = {}
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
    uploadedBy: item.uploadedBy ? { id: item.uploadedBy.id, name: item.uploadedBy.name } : null,
    thumbUrl: item.thumbKey ? await signGetUrl(item.thumbKey) : null,
  }
  if (opts.detail) {
    dto.webUrl = item.webKey ? await signGetUrl(item.webKey) : null
    dto.largeUrl = item.largeKey ? await signGetUrl(item.largeKey) : null
  }
  return dto
}
