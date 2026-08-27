import type { Gender, Person } from '@prisma/client'
import { prisma } from '@/lib/db'
import { signGetUrl } from '@/lib/s3'

export type PersonLite = {
  id: string
  displayName: string
  gender: Gender
  birthYear: number | null
  deathYear: number | null
  avatarUrl: string | null
}

export type PersonDTO = PersonLite & {
  maidenName: string | null
  birthplace: string | null
  notes: string | null
  tagCount: number
  parents: PersonLite[]
  children: PersonLite[]
  spouses: PersonLite[]
  siblings: PersonLite[]
  createdAt: string
}

export async function personToLite(p: Person): Promise<PersonLite> {
  return {
    id: p.id,
    displayName: p.displayName,
    gender: p.gender,
    birthYear: p.birthYear,
    deathYear: p.deathYear,
    avatarUrl: p.avatarKey ? await signGetUrl(p.avatarKey) : null,
  }
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const item of items) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    out.push(item)
  }
  return out
}

/** Loads a person plus their full relationship graph (parents, children, spouses, derived siblings). */
export async function personToDTO(personId: string): Promise<PersonDTO | null> {
  const person = await prisma.person.findFirst({
    where: { id: personId, deletedAt: null },
    include: {
      parents: { include: { parent: true } },
      children: { include: { child: true } },
      spousesA: { include: { personB: true } },
      spousesB: { include: { personA: true } },
      _count: {
        select: { mediaTags: { where: { mediaItem: { deletedAt: null } } } },
      },
    },
  })
  if (!person) return null

  const parents = dedupeById(person.parents.map((r) => r.parent).filter((p) => p.deletedAt === null))
  const children = dedupeById(person.children.map((r) => r.child).filter((p) => p.deletedAt === null))
  const spouses = dedupeById(
    [...person.spousesA.map((r) => r.personB), ...person.spousesB.map((r) => r.personA)].filter(
      (p) => p.deletedAt === null
    )
  )

  // siblings: anyone sharing at least one parent, excluding self and deleted people
  const parentIds = parents.map((p) => p.id)
  const siblingRows = parentIds.length
    ? await prisma.parentChild.findMany({
        where: { parentId: { in: parentIds }, NOT: { childId: personId } },
        include: { child: true },
      })
    : []
  const siblings = dedupeById(siblingRows.map((r) => r.child).filter((c) => c.deletedAt === null))

  const [personLite, parentsLite, childrenLite, spousesLite, siblingsLite] = await Promise.all([
    personToLite(person),
    Promise.all(parents.map(personToLite)),
    Promise.all(children.map(personToLite)),
    Promise.all(spouses.map(personToLite)),
    Promise.all(siblings.map(personToLite)),
  ])

  return {
    ...personLite,
    maidenName: person.maidenName,
    birthplace: person.birthplace,
    notes: person.notes,
    tagCount: person._count.mediaTags,
    parents: parentsLite,
    children: childrenLite,
    spouses: spousesLite,
    siblings: siblingsLite,
    createdAt: person.createdAt.toISOString(),
  }
}
