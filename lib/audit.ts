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
  if (day != null && month == null) return false
  if (month != null && year == null) return false
  if (year != null && (year < 1000 || year > 3000)) return false
  if (month != null && (month < 1 || month > 12)) return false
  if (day != null && (day < 1 || day > 31)) return false
  return true
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
