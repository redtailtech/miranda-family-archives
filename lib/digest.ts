import { prisma } from '@/lib/db'
import { signGetUrl } from '@/lib/s3'
import { EDITABLE_MEDIA_FIELDS, EDITABLE_PERSON_FIELDS } from '@/lib/audit'

// Thumbnails in digest emails must survive the longest realistic gap between
// send and open (someone reading a few days late) — 6 days.
const THUMB_EXPIRES_IN = 518400

// Fields whose UPDATE-diff keys count as a digest-worthy edit. `people` isn't
// one of the form-editable MediaItem fields (it's tagging, via
// setMediaPeopleWithAudit) but it IS something the family wants to hear
// about, so it's added on top of EDITABLE_MEDIA_FIELDS.
const MEDIA_DIGEST_FIELDS: readonly string[] = [...EDITABLE_MEDIA_FIELDS, 'people']
// Person relationship changes (parents/spouses) and avatarKey are
// deliberately NOT digest-worthy — only EDITABLE_PERSON_FIELDS counts.
const PERSON_DIGEST_FIELDS: readonly string[] = [...EDITABLE_PERSON_FIELDS]

// Plain-word labels, reusing the vocabulary from components/history-list.tsx's
// LABELS map (there rendered mid-sentence as "the title"; here as a standalone
// list item, so without the leading "the").
const MEDIA_FIELD_LABELS: Record<string, string> = {
  title: 'title',
  description: 'description',
  location: 'location',
  dateYear: 'year',
  dateMonth: 'month',
  dateDay: 'day',
  dateIsApproximate: 'approximate-date flag',
  people: 'people tagged',
}

const PERSON_FIELD_LABELS: Record<string, string> = {
  displayName: 'name',
  maidenName: 'maiden name',
  gender: 'gender',
  birthYear: 'birth year',
  deathYear: 'death year',
  birthplace: 'birthplace',
  notes: 'notes',
}

export type DigestEvents = {
  newMedia: { id: string; title: string | null; filename: string; type: string; thumbUrl: string | null; byName: string }[]
  newPeople: { id: string; name: string; byName: string }[]
  editedMedia: { id: string; title: string | null; filename: string; fields: string[]; byName: string }[]
  editedPeople: { id: string; name: string; fields: string[]; byName: string }[]
}

type EntityType = 'media_item' | 'person'

type AuditRowWithUser = {
  entityType: string
  entityId: string
  action: 'CREATE' | 'UPDATE' | 'DELETE'
  changes: unknown
  createdAt: Date
  user: { name: string; email: string }
}

type Group = { entityType: EntityType; entityId: string; rows: AuditRowWithUser[] }

/**
 * Collects the digest-worthy activity since `since`, deduped one entry per
 * entity: an entity CREATEd in the window appears only in the new-* list
 * (never also in edited-*), and the byName on every entry is whoever most
 * recently touched that entity in the window ("newest actor wins").
 */
export async function collectDigestEvents(since: Date): Promise<DigestEvents> {
  const rows = await prisma.auditLog.findMany({
    where: { createdAt: { gte: since }, entityType: { in: ['media_item', 'person'] } },
    orderBy: { createdAt: 'asc' },
    include: { user: { select: { name: true, email: true } } },
  })

  const groups = new Map<string, Group>()
  for (const row of rows) {
    const key = `${row.entityType}:${row.entityId}`
    let group = groups.get(key)
    if (!group) {
      group = { entityType: row.entityType as EntityType, entityId: row.entityId, rows: [] }
      groups.set(key, group)
    }
    group.rows.push(row)
  }

  const mediaIds: string[] = []
  const personIds: string[] = []
  for (const group of groups.values()) {
    if (group.entityType === 'media_item') mediaIds.push(group.entityId)
    else personIds.push(group.entityId)
  }

  const [liveMedia, livePeople] = await Promise.all([
    mediaIds.length
      ? prisma.mediaItem.findMany({ where: { id: { in: mediaIds }, deletedAt: null, status: 'READY' } })
      : Promise.resolve([]),
    personIds.length
      ? prisma.person.findMany({ where: { id: { in: personIds }, deletedAt: null } })
      : Promise.resolve([]),
  ])
  const mediaById = new Map(liveMedia.map((m) => [m.id, m]))
  const personById = new Map(livePeople.map((p) => [p.id, p]))

  const events: DigestEvents = { newMedia: [], newPeople: [], editedMedia: [], editedPeople: [] }

  for (const group of groups.values()) {
    const hasCreate = group.rows.some((r) => r.action === 'CREATE')
    const newestRow = group.rows[group.rows.length - 1]
    const byName = newestRow.user.name || newestRow.user.email

    if (group.entityType === 'media_item') {
      const media = mediaById.get(group.entityId)
      if (!media) continue // deleted since, or never made it past PROCESSING

      if (hasCreate) {
        events.newMedia.push({
          id: media.id,
          title: media.title,
          filename: media.originalFilename,
          type: media.type,
          thumbUrl: media.thumbKey ? await signGetUrl(media.thumbKey, { expiresIn: THUMB_EXPIRES_IN }) : null,
          byName,
        })
      } else {
        const fields = digestFieldsForGroup(group, MEDIA_DIGEST_FIELDS, MEDIA_FIELD_LABELS)
        if (fields.length === 0) continue
        events.editedMedia.push({
          id: media.id,
          title: media.title,
          filename: media.originalFilename,
          fields,
          byName,
        })
      }
    } else {
      const person = personById.get(group.entityId)
      if (!person) continue

      if (hasCreate) {
        events.newPeople.push({ id: person.id, name: person.displayName, byName })
      } else {
        const fields = digestFieldsForGroup(group, PERSON_DIGEST_FIELDS, PERSON_FIELD_LABELS)
        if (fields.length === 0) continue
        events.editedPeople.push({ id: person.id, name: person.displayName, fields, byName })
      }
    }
  }

  return events
}

/** Union of digest-worthy field labels across every UPDATE row in the group, sorted. */
function digestFieldsForGroup(group: Group, allowList: readonly string[], labels: Record<string, string>): string[] {
  const fieldSet = new Set<string>()
  for (const row of group.rows) {
    if (row.action !== 'UPDATE') continue
    const changes = row.changes as Record<string, unknown>
    for (const key of Object.keys(changes)) {
      if (allowList.includes(key)) fieldSet.add(labels[key] ?? key)
    }
  }
  return [...fieldSet].sort()
}

export async function digestRecipients(): Promise<{ email: string; name: string }[]> {
  const users = await prisma.user.findMany({
    where: { digestEnabled: true },
    select: { email: true, name: true },
  })
  return users.map((u) => ({ email: u.email, name: u.name || u.email }))
}
