import { prisma } from '@/lib/db'
import type { Prisma } from '@prisma/client'

export const EDITABLE_MEDIA_FIELDS = [
  'title',
  'description',
  'location',
  'dateYear',
  'dateMonth',
  'dateDay',
  'dateIsApproximate',
] as const

export type EditableMediaField = (typeof EDITABLE_MEDIA_FIELDS)[number]
export type EditableMediaInput = Partial<Record<EditableMediaField, string | number | boolean | null>>

function fieldDiff(
  current: Record<string, unknown>,
  input: EditableMediaInput
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {}
  for (const field of EDITABLE_MEDIA_FIELDS) {
    if (!(field in input)) continue
    const to = input[field] ?? null
    const from = current[field] ?? null
    if (from !== to) changes[field] = { from, to }
  }
  return changes
}

/** Validate the flexible-date invariant: day needs month, month needs year. */
export function validDateParts(year: number | null, month: number | null, day: number | null): boolean {
  if (year != null && !Number.isInteger(year)) return false
  if (month != null && !Number.isInteger(month)) return false
  if (day != null && !Number.isInteger(day)) return false
  if (day != null && month == null) return false
  if (month != null && year == null) return false
  if (year != null && (year < 1000 || year > 3000)) return false
  if (month != null && (month < 1 || month > 12)) return false
  if (day != null && (day < 1 || day > 31)) return false
  return true
}

/**
 * Validate the runtime type of a single editable field's incoming value.
 * Returns true when `value` is an acceptable type for `field`, false otherwise.
 * (Semantic date-combination rules are handled separately by `validDateParts`.)
 */
export function validFieldValue(field: EditableMediaField, value: unknown): boolean {
  switch (field) {
    case 'title':
    case 'description':
    case 'location':
      return value === null || typeof value === 'string'
    case 'dateYear':
    case 'dateMonth':
    case 'dateDay':
      return value === null || (typeof value === 'number' && Number.isInteger(value))
    case 'dateIsApproximate':
      return typeof value === 'boolean'
  }
}

export async function updateMediaWithAudit(
  mediaId: string,
  actorUserId: string,
  input: EditableMediaInput
): Promise<{ changed: string[] }> {
  const item = await prisma.mediaItem.findFirst({ where: { id: mediaId, deletedAt: null } })
  if (!item) throw Object.assign(new Error('not found'), { status: 404 })

  const changes = fieldDiff(item as unknown as Record<string, unknown>, input)
  if (Object.keys(changes).length === 0) return { changed: [] }

  const data = Object.fromEntries(
    Object.entries(changes).map(([field, { to }]) => [field, to])
  ) as Prisma.MediaItemUpdateInput

  await prisma.$transaction([
    prisma.mediaItem.update({ where: { id: mediaId }, data }),
    prisma.auditLog.create({
      data: {
        userId: actorUserId,
        entityType: 'media_item',
        entityId: mediaId,
        action: 'UPDATE',
        changes: changes as Prisma.InputJsonValue,
      },
    }),
  ])
  return { changed: Object.keys(changes) }
}

export async function softDeleteMediaWithAudit(mediaId: string, actorUserId: string): Promise<void> {
  const now = new Date()
  const result = await prisma.mediaItem.updateMany({
    where: { id: mediaId, deletedAt: null },
    data: { deletedAt: now },
  })
  if (result.count !== 1) throw Object.assign(new Error('not found'), { status: 404 })
  await prisma.auditLog.create({
    data: {
      userId: actorUserId,
      entityType: 'media_item',
      entityId: mediaId,
      action: 'DELETE',
      changes: { deletedAt: { from: null, to: now.toISOString() } },
    },
  })
}

export async function restoreMediaWithAudit(mediaId: string, actorUserId: string): Promise<void> {
  const item = await prisma.mediaItem.findFirst({ where: { id: mediaId, NOT: { deletedAt: null } } })
  if (!item) throw Object.assign(new Error('not deleted'), { status: 400 })
  await prisma.$transaction([
    prisma.mediaItem.update({ where: { id: mediaId }, data: { deletedAt: null } }),
    prisma.auditLog.create({
      data: {
        userId: actorUserId,
        entityType: 'media_item',
        entityId: mediaId,
        action: 'UPDATE',
        changes: { deletedAt: { from: item.deletedAt!.toISOString(), to: null } },
      },
    }),
  ])
}

export async function createAlbumWithAudit(
  actorUserId: string,
  data: { name: string; description?: string | null }
): Promise<{ id: string }> {
  const album = await prisma.$transaction(async (tx) => {
    const created = await tx.album.create({
      data: { name: data.name, description: data.description ?? null },
    })
    await tx.auditLog.create({
      data: {
        userId: actorUserId,
        entityType: 'album',
        entityId: created.id,
        action: 'CREATE',
        changes: { name: { from: null, to: data.name } },
      },
    })
    return created
  })
  return { id: album.id }
}

const EDITABLE_ALBUM_FIELDS = ['name', 'description', 'coverMediaId'] as const

export async function updateAlbumWithAudit(
  albumId: string,
  actorUserId: string,
  input: Partial<{ name: string; description: string | null; coverMediaId: string | null }>
): Promise<{ changed: string[] }> {
  const album = await prisma.album.findUnique({ where: { id: albumId } })
  if (!album) throw Object.assign(new Error('not found'), { status: 404 })
  const changes: Record<string, { from: unknown; to: unknown }> = {}
  for (const field of EDITABLE_ALBUM_FIELDS) {
    if (!(field in input)) continue
    const to = input[field] ?? null
    const from = (album as Record<string, unknown>)[field] ?? null
    if (from !== to) changes[field] = { from, to }
  }
  if (Object.keys(changes).length === 0) return { changed: [] }
  const data = Object.fromEntries(Object.entries(changes).map(([f, { to }]) => [f, to]))
  await prisma.$transaction([
    prisma.album.update({ where: { id: albumId }, data }),
    prisma.auditLog.create({
      data: {
        userId: actorUserId,
        entityType: 'album',
        entityId: albumId,
        action: 'UPDATE',
        changes: changes as Prisma.InputJsonValue,
      },
    }),
  ])
  return { changed: Object.keys(changes) }
}

export async function deleteAlbumWithAudit(albumId: string, actorUserId: string): Promise<void> {
  const album = await prisma.album.findUnique({ where: { id: albumId } })
  if (!album) throw Object.assign(new Error('not found'), { status: 404 })
  await prisma.$transaction([
    prisma.albumItem.deleteMany({ where: { albumId } }),
    prisma.album.delete({ where: { id: albumId } }),
    prisma.auditLog.create({
      data: {
        userId: actorUserId,
        entityType: 'album',
        entityId: albumId,
        action: 'DELETE',
        changes: { name: { from: album.name, to: null } },
      },
    }),
  ])
}

export async function albumItemsChangeWithAudit(
  albumId: string,
  actorUserId: string,
  change: { added?: string[]; removed?: string[]; reordered?: boolean },
  countBefore: number,
  countAfter: number
): Promise<void> {
  await prisma.auditLog.create({
    data: {
      userId: actorUserId,
      entityType: 'album',
      entityId: albumId,
      action: 'UPDATE',
      changes: {
        items: { from: countBefore, to: countAfter },
        ...(change.added ? { added: change.added } : {}),
        ...(change.removed ? { removed: change.removed } : {}),
        ...(change.reordered ? { reordered: true } : {}),
      } as Prisma.InputJsonValue,
    },
  })
}
