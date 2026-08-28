import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireUser } from '@/lib/require-user'
import { personToLite } from '@/lib/people'
import {
  createPersonWithAudit,
  validPersonInput,
  EDITABLE_PERSON_FIELDS,
  type NewPersonInput,
} from '@/lib/audit'

export async function GET(req: NextRequest) {
  const { error } = await requireUser()
  if (error) return error

  const full = new URL(req.url).searchParams.get('full') === '1'

  if (full) {
    const [people, parentLinks, spouseLinks] = await Promise.all([
      prisma.person.findMany({ where: { deletedAt: null }, orderBy: { displayName: 'asc' } }),
      prisma.parentChild.findMany({
        where: { child: { deletedAt: null }, parent: { deletedAt: null } },
      }),
      prisma.spouse.findMany({
        where: { personA: { deletedAt: null }, personB: { deletedAt: null } },
      }),
    ])
    const peopleLite = await Promise.all(people.map(personToLite))
    return NextResponse.json({
      people: peopleLite,
      parentLinks: parentLinks.map((l) => ({ childId: l.childId, parentId: l.parentId })),
      spouseLinks: spouseLinks.map((l) => ({ personAId: l.personAId, personBId: l.personBId, former: l.former })),
    })
  }

  const people = await prisma.person.findMany({
    where: { deletedAt: null },
    orderBy: { displayName: 'asc' },
    include: {
      _count: { select: { mediaTags: { where: { mediaItem: { deletedAt: null } } } } },
    },
  })
  const dtos = await Promise.all(
    people.map(async (p) => ({ ...(await personToLite(p)), tagCount: p._count.mediaTags }))
  )
  return NextResponse.json({ people: dtos })
}

export async function POST(req: NextRequest) {
  const { user, error } = await requireUser()
  if (error) return error

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }

  const unknown = Object.keys(body).filter((k) => !(EDITABLE_PERSON_FIELDS as readonly string[]).includes(k))
  if (unknown.length > 0)
    return NextResponse.json({ error: `unknown fields: ${unknown.join(', ')}` }, { status: 400 })

  if (!('displayName' in body))
    return NextResponse.json({ error: 'displayName is required' }, { status: 400 })

  const err = validPersonInput(body)
  if (err) return NextResponse.json({ error: err }, { status: 400 })

  const data: NewPersonInput = {
    displayName: body.displayName as string,
    maidenName: 'maidenName' in body ? (body.maidenName as string | null) : undefined,
    gender: 'gender' in body ? (body.gender as NewPersonInput['gender']) : undefined,
    birthYear: 'birthYear' in body ? (body.birthYear as number | null) : undefined,
    deathYear: 'deathYear' in body ? (body.deathYear as number | null) : undefined,
    birthplace: 'birthplace' in body ? (body.birthplace as string | null) : undefined,
    notes: 'notes' in body ? (body.notes as string | null) : undefined,
  }

  const { id } = await createPersonWithAudit(user!.id, data)
  return NextResponse.json({ id })
}
