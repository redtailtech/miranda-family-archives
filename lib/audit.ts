import { prisma } from '@/lib/db'
import { Prisma } from '@prisma/client'
import type { Gender } from '@prisma/client'

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

// ---------------------------------------------------------------------------
// People & relationships
// ---------------------------------------------------------------------------

export const EDITABLE_PERSON_FIELDS = [
  'displayName',
  'maidenName',
  'gender',
  'birthYear',
  'deathYear',
  'birthplace',
  'notes',
] as const

export type EditablePersonField = (typeof EDITABLE_PERSON_FIELDS)[number]
export type EditablePersonInput = Partial<Record<EditablePersonField, unknown>>

export type NewPersonInput = {
  displayName: string
  maidenName?: string | null
  gender?: Gender
  birthYear?: number | null
  deathYear?: number | null
  birthplace?: string | null
  notes?: string | null
}

const PERSON_GENDERS = ['MALE', 'FEMALE', 'UNSPECIFIED']

/**
 * Validate the runtime type/shape of a (possibly partial) person input.
 * Returns an error message string, or null when valid. Mirrors the typing
 * rigor of `validFieldValue`: objects/arrays are rejected for every field.
 */
export function validPersonInput(input: EditablePersonInput): string | null {
  if ('displayName' in input) {
    if (typeof input.displayName !== 'string' || input.displayName.trim() === '')
      return 'displayName must be a non-empty string'
  }
  for (const field of ['maidenName', 'birthplace', 'notes'] as const) {
    if (field in input && input[field] !== null && typeof input[field] !== 'string')
      return `${field} must be a string or null`
  }
  if ('gender' in input) {
    if (typeof input.gender !== 'string' || !PERSON_GENDERS.includes(input.gender))
      return 'gender must be one of MALE, FEMALE, UNSPECIFIED'
  }
  for (const field of ['birthYear', 'deathYear'] as const) {
    if (field in input) {
      const value = input[field]
      if (value !== null && (typeof value !== 'number' || !Number.isInteger(value) || value < 1000 || value > 3000))
        return `${field} must be null or a 4-digit year`
    }
  }
  if ('birthYear' in input && 'deathYear' in input) {
    const birthYear = input.birthYear as number | null
    const deathYear = input.deathYear as number | null
    if (birthYear != null && deathYear != null && deathYear < birthYear)
      return 'deathYear must be greater than or equal to birthYear'
  }
  return null
}

function personFieldDiff(
  current: Record<string, unknown>,
  input: EditablePersonInput
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {}
  for (const field of EDITABLE_PERSON_FIELDS) {
    if (!(field in input)) continue
    const to = input[field] ?? null
    const from = current[field] ?? null
    if (from !== to) changes[field] = { from, to }
  }
  return changes
}

export async function createPersonWithAudit(
  actorUserId: string,
  data: NewPersonInput
): Promise<{ id: string }> {
  const person = await prisma.$transaction(async (tx) => {
    const created = await tx.person.create({
      data: {
        displayName: data.displayName,
        maidenName: data.maidenName ?? null,
        gender: data.gender ?? undefined,
        birthYear: data.birthYear ?? null,
        deathYear: data.deathYear ?? null,
        birthplace: data.birthplace ?? null,
        notes: data.notes ?? null,
      },
    })
    await tx.auditLog.create({
      data: {
        userId: actorUserId,
        entityType: 'person',
        entityId: created.id,
        action: 'CREATE',
        changes: { displayName: { from: null, to: data.displayName } },
      },
    })
    return created
  })
  return { id: person.id }
}

export async function updatePersonWithAudit(
  personId: string,
  actorUserId: string,
  input: EditablePersonInput
): Promise<{ changed: string[] }> {
  const person = await prisma.person.findFirst({ where: { id: personId, deletedAt: null } })
  if (!person) throw Object.assign(new Error('not found'), { status: 404 })

  const changes = personFieldDiff(person as unknown as Record<string, unknown>, input)
  if (Object.keys(changes).length === 0) return { changed: [] }

  const data = Object.fromEntries(
    Object.entries(changes).map(([field, { to }]) => [field, to])
  ) as Prisma.PersonUpdateInput

  await prisma.$transaction([
    prisma.person.update({ where: { id: personId }, data }),
    prisma.auditLog.create({
      data: {
        userId: actorUserId,
        entityType: 'person',
        entityId: personId,
        action: 'UPDATE',
        changes: changes as Prisma.InputJsonValue,
      },
    }),
  ])
  return { changed: Object.keys(changes) }
}

/**
 * Sets (or clears) a person's avatarKey, audited as a person UPDATE
 * `{avatarKey: {from, to}}` — mirrors updatePersonWithAudit's fetch-diff-txn
 * shape rather than reusing it directly, since avatarKey isn't one of the
 * form-editable EDITABLE_PERSON_FIELDS and callers pass an already-computed
 * key (or null) rather than a raw field-input object.
 */
export async function updatePersonAvatarWithAudit(
  personId: string,
  actorUserId: string,
  avatarKey: string | null
): Promise<void> {
  const person = await prisma.person.findFirst({ where: { id: personId, deletedAt: null } })
  if (!person) throw Object.assign(new Error('not found'), { status: 404 })
  if (person.avatarKey === avatarKey) return

  await prisma.$transaction([
    prisma.person.update({ where: { id: personId }, data: { avatarKey } }),
    prisma.auditLog.create({
      data: {
        userId: actorUserId,
        entityType: 'person',
        entityId: personId,
        action: 'UPDATE',
        changes: { avatarKey: { from: person.avatarKey, to: avatarKey } } as Prisma.InputJsonValue,
      },
    }),
  ])
}

export async function softDeletePersonWithAudit(personId: string, actorUserId: string): Promise<void> {
  const now = new Date()
  const result = await prisma.person.updateMany({
    where: { id: personId, deletedAt: null },
    data: { deletedAt: now },
  })
  if (result.count !== 1) throw Object.assign(new Error('not found'), { status: 404 })
  await prisma.auditLog.create({
    data: {
      userId: actorUserId,
      entityType: 'person',
      entityId: personId,
      action: 'DELETE',
      changes: { deletedAt: { from: null, to: now.toISOString() } },
    },
  })
}

export async function restorePersonWithAudit(personId: string, actorUserId: string): Promise<void> {
  const person = await prisma.person.findFirst({ where: { id: personId, NOT: { deletedAt: null } } })
  if (!person) throw Object.assign(new Error('not deleted'), { status: 400 })
  await prisma.$transaction([
    prisma.person.update({ where: { id: personId }, data: { deletedAt: null } }),
    prisma.auditLog.create({
      data: {
        userId: actorUserId,
        entityType: 'person',
        entityId: personId,
        action: 'UPDATE',
        changes: { deletedAt: { from: person.deletedAt!.toISOString(), to: null } },
      },
    }),
  ])
}

/**
 * True if `parentId` has `childId` anywhere in their ancestor chain — used to
 * block cycles. Accepts an optional Prisma client so it can be re-run inside
 * an in-progress transaction (see `addParentWithAudit`) to close the TOCTOU
 * window between the pre-check and the actual `parentChild.create`.
 */
async function wouldCreateCycle(
  childId: string,
  parentId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma
): Promise<boolean> {
  const seen = new Set<string>()
  let frontier = [parentId]
  while (frontier.length > 0) {
    if (frontier.includes(childId)) return true
    const rows = await client.parentChild.findMany({
      where: { childId: { in: frontier } },
      select: { parentId: true },
    })
    frontier = rows.map((r) => r.parentId).filter((id) => !seen.has(id))
    frontier.forEach((id) => seen.add(id))
  }
  return false
}

async function currentParentNames(tx: Prisma.TransactionClient, childId: string): Promise<string[]> {
  const rows = await tx.parentChild.findMany({ where: { childId }, include: { parent: true } })
  return rows.map((r) => r.parent.displayName).sort()
}

async function currentSpouseNames(tx: Prisma.TransactionClient, personId: string): Promise<string[]> {
  const [asA, asB] = await Promise.all([
    tx.spouse.findMany({ where: { personAId: personId }, include: { personB: true } }),
    tx.spouse.findMany({ where: { personBId: personId }, include: { personA: true } }),
  ])
  return [...asA.map((r) => r.personB.displayName), ...asB.map((r) => r.personA.displayName)].sort()
}

export async function addParentWithAudit(childId: string, parentId: string, actorUserId: string): Promise<void> {
  if (childId === parentId) throw Object.assign(new Error('a person cannot be their own parent'), { status: 400 })
  const [child, parent] = await Promise.all([
    prisma.person.findFirst({ where: { id: childId, deletedAt: null } }),
    prisma.person.findFirst({ where: { id: parentId, deletedAt: null } }),
  ])
  if (!child || !parent) throw Object.assign(new Error('person not found'), { status: 404 })
  const existing = await prisma.parentChild.findUnique({ where: { childId_parentId: { childId, parentId } } })
  if (existing) throw Object.assign(new Error('that parent relationship already exists'), { status: 400 })
  // Fast common-path check outside the transaction; re-checked below inside
  // the transaction (after the row is created) to close the TOCTOU window
  // where two concurrent adds (A→B, B→A) could both pass this pre-check.
  if (await wouldCreateCycle(childId, parentId))
    throw Object.assign(new Error('that would make someone their own ancestor'), { status: 400 })

  // Serializable isolation is required (not just re-checking post-insert)
  // because under the default Read Committed level two concurrent
  // transactions' in-transaction rechecks can each run before the other's
  // commit, so neither sees the other's new row and both pass. Postgres
  // aborts one side of a genuine conflict under Serializable with a
  // serialization failure (Prisma error code P2034); retry that side once
  // the other has committed — the pre-check/recheck will then correctly see
  // the now-committed reverse edge and reject with the tagged cycle error.
  const MAX_ATTEMPTS = 3
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await prisma.$transaction(
        async (tx) => {
          const beforeNames = await currentParentNames(tx, childId)
          await tx.parentChild.create({ data: { childId, parentId } })
          if (await wouldCreateCycle(childId, parentId, tx))
            throw Object.assign(new Error('that would make someone their own ancestor'), { status: 400 })
          const afterNames = await currentParentNames(tx, childId)
          await tx.auditLog.create({
            data: {
              userId: actorUserId,
              entityType: 'person',
              entityId: childId,
              action: 'UPDATE',
              changes: { parents: { from: beforeNames, to: afterNames } } as Prisma.InputJsonValue,
            },
          })
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      )
      return
    } catch (err) {
      const isSerializationConflict = err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034'
      if (isSerializationConflict && attempt < MAX_ATTEMPTS) continue
      throw err
    }
  }
}

export async function removeParentWithAudit(childId: string, parentId: string, actorUserId: string): Promise<void> {
  const existing = await prisma.parentChild.findUnique({ where: { childId_parentId: { childId, parentId } } })
  if (!existing) throw Object.assign(new Error('that parent relationship does not exist'), { status: 404 })

  await prisma.$transaction(async (tx) => {
    const beforeNames = await currentParentNames(tx, childId)
    await tx.parentChild.delete({ where: { childId_parentId: { childId, parentId } } })
    const afterNames = await currentParentNames(tx, childId)
    await tx.auditLog.create({
      data: {
        userId: actorUserId,
        entityType: 'person',
        entityId: childId,
        action: 'UPDATE',
        changes: { parents: { from: beforeNames, to: afterNames } } as Prisma.InputJsonValue,
      },
    })
  })
}

export async function addSpouseWithAudit(
  personAId: string,
  personBId: string,
  actorUserId: string
): Promise<void> {
  if (personAId === personBId)
    throw Object.assign(new Error('a person cannot be their own spouse'), { status: 400 })
  const [a, b] = await Promise.all([
    prisma.person.findFirst({ where: { id: personAId, deletedAt: null } }),
    prisma.person.findFirst({ where: { id: personBId, deletedAt: null } }),
  ])
  if (!a || !b) throw Object.assign(new Error('person not found'), { status: 404 })
  const existing = await prisma.spouse.findFirst({
    where: {
      OR: [
        { personAId, personBId },
        { personAId: personBId, personBId: personAId },
      ],
    },
  })
  if (existing) throw Object.assign(new Error('that spouse relationship already exists'), { status: 400 })

  await prisma.$transaction(async (tx) => {
    const beforeNames = await currentSpouseNames(tx, personAId)
    await tx.spouse.create({ data: { personAId, personBId } })
    const afterNames = await currentSpouseNames(tx, personAId)
    await tx.auditLog.create({
      data: {
        userId: actorUserId,
        entityType: 'person',
        entityId: personAId,
        action: 'UPDATE',
        changes: { spouses: { from: beforeNames, to: afterNames } } as Prisma.InputJsonValue,
      },
    })
  })
}

export async function removeSpouseWithAudit(
  personAId: string,
  personBId: string,
  actorUserId: string
): Promise<void> {
  const forward = await prisma.spouse.findUnique({
    where: { personAId_personBId: { personAId, personBId } },
  })
  const backward = forward
    ? null
    : await prisma.spouse.findUnique({
        where: { personAId_personBId: { personAId: personBId, personBId: personAId } },
      })
  if (!forward && !backward)
    throw Object.assign(new Error('that spouse relationship does not exist'), { status: 404 })

  await prisma.$transaction(async (tx) => {
    const beforeNames = await currentSpouseNames(tx, personAId)
    if (forward) {
      await tx.spouse.delete({ where: { personAId_personBId: { personAId, personBId } } })
    } else {
      await tx.spouse.delete({ where: { personAId_personBId: { personAId: personBId, personBId: personAId } } })
    }
    const afterNames = await currentSpouseNames(tx, personAId)
    await tx.auditLog.create({
      data: {
        userId: actorUserId,
        entityType: 'person',
        entityId: personAId,
        action: 'UPDATE',
        changes: { spouses: { from: beforeNames, to: afterNames } } as Prisma.InputJsonValue,
      },
    })
  })
}

async function currentMediaTagNames(tx: Prisma.TransactionClient, mediaId: string): Promise<string[]> {
  const rows = await tx.mediaPerson.findMany({
    where: { mediaItemId: mediaId, person: { deletedAt: null } },
    include: { person: true },
  })
  return rows.map((r) => r.person.displayName).sort()
}

/**
 * Tags or untags a single person on a media item. Exactly one of
 * `addPersonId`/`removePersonId` must be set. Duplicate add and missing
 * remove are rejected as thrown `{status}` errors (409/404 respectively) —
 * same status-tagged-throw convention as the rest of this file, mapped to a
 * response by `safeErrorResponse`. The MediaPerson mutation and its audit
 * row (on the MEDIA item, `entityType: 'media_item'`) are written in one
 * transaction, mirroring `addParentWithAudit`'s before/after-names shape.
 */
export async function setMediaPeopleWithAudit(
  mediaId: string,
  actorUserId: string,
  change: { addPersonId?: string; removePersonId?: string }
): Promise<void> {
  const { addPersonId, removePersonId } = change
  if ((addPersonId && removePersonId) || (!addPersonId && !removePersonId))
    throw Object.assign(new Error('exactly one of addPersonId or removePersonId is required'), { status: 400 })
  const personId = addPersonId ?? removePersonId!

  const media = await prisma.mediaItem.findFirst({
    where: { id: mediaId, deletedAt: null, status: { in: ['READY', 'PROCESSING'] } },
  })
  if (!media) throw Object.assign(new Error('media not found'), { status: 404 })

  const person = await prisma.person.findFirst({ where: { id: personId, deletedAt: null } })
  if (!person) throw Object.assign(new Error('person not found'), { status: 404 })

  const existing = await prisma.mediaPerson.findUnique({
    where: { mediaItemId_personId: { mediaItemId: mediaId, personId } },
  })
  if (addPersonId && existing)
    throw Object.assign(new Error('that person is already tagged in this photo'), { status: 409 })
  if (removePersonId && !existing)
    throw Object.assign(new Error('that person is not tagged in this photo'), { status: 404 })

  await prisma.$transaction(async (tx) => {
    const beforeNames = await currentMediaTagNames(tx, mediaId)
    if (addPersonId) {
      await tx.mediaPerson.create({ data: { mediaItemId: mediaId, personId } })
    } else {
      await tx.mediaPerson.delete({ where: { mediaItemId_personId: { mediaItemId: mediaId, personId } } })
    }
    const afterNames = await currentMediaTagNames(tx, mediaId)
    await tx.auditLog.create({
      data: {
        userId: actorUserId,
        entityType: 'media_item',
        entityId: mediaId,
        action: 'UPDATE',
        changes: { people: { from: beforeNames, to: afterNames } } as Prisma.InputJsonValue,
      },
    })
  })
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
