import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireUser } from '@/lib/require-user'
import { personToDTO } from '@/lib/people'
import {
  updatePersonWithAudit,
  softDeletePersonWithAudit,
  validPersonInput,
  EDITABLE_PERSON_FIELDS,
  type EditablePersonInput,
} from '@/lib/audit'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireUser()
  if (error) return error
  const { id } = await params
  const person = await personToDTO(id)
  if (!person) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({ person })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireUser()
  if (error) return error
  const { id } = await params

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }

  const unknown = Object.keys(body).filter((k) => !(EDITABLE_PERSON_FIELDS as readonly string[]).includes(k))
  if (unknown.length > 0)
    return NextResponse.json({ error: `unknown fields: ${unknown.join(', ')}` }, { status: 400 })

  const current = await prisma.person.findFirst({ where: { id, deletedAt: null } })
  if (!current) return NextResponse.json({ error: 'not found' }, { status: 404 })

  // merge current birth/death year so the cross-field invariant is checked
  // against the effective post-patch values, not just whatever the caller sent.
  const merged: EditablePersonInput = {
    birthYear: current.birthYear,
    deathYear: current.deathYear,
    ...body,
  }
  const err = validPersonInput(merged)
  if (err) return NextResponse.json({ error: err }, { status: 400 })

  const { changed } = await updatePersonWithAudit(id, user!.id, body)
  return NextResponse.json({ ok: true, changed })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireUser()
  if (error) return error
  if (user!.role !== 'ADMIN') return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const { id } = await params
  try {
    await softDeletePersonWithAudit(id, user!.id)
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500
    return NextResponse.json({ error: 'not found' }, { status })
  }
  return NextResponse.json({ ok: true })
}
