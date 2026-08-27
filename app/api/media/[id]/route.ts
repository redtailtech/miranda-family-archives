import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { mediaItemToDTO } from '@/lib/media'
import {
  updateMediaWithAudit,
  softDeleteMediaWithAudit,
  validDateParts,
  validFieldValue,
  EDITABLE_MEDIA_FIELDS,
  type EditableMediaField,
} from '@/lib/audit'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  const item = await prisma.mediaItem.findFirst({
    where: { id, deletedAt: null },
    include: { uploadedBy: true },
  })
  if (!item) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json(await mediaItemToDTO(item, { detail: true }))
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const user = await prisma.user.findUnique({ where: { clerkId: userId } })
  if (!user) return NextResponse.json({ error: 'no user record' }, { status: 403 })
  const { id } = await params
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }

  const unknown = Object.keys(body).filter((k) => !(EDITABLE_MEDIA_FIELDS as readonly string[]).includes(k))
  if (unknown.length > 0)
    return NextResponse.json({ error: `unknown fields: ${unknown.join(', ')}` }, { status: 400 })

  for (const key of Object.keys(body)) {
    const field = key as EditableMediaField
    if (!validFieldValue(field, body[field]))
      return NextResponse.json({ error: `invalid value for ${field}` }, { status: 400 })
  }

  const current = await prisma.mediaItem.findFirst({ where: { id, deletedAt: null } })
  if (!current) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const year = ('dateYear' in body ? body.dateYear : current.dateYear) as number | null
  const month = ('dateMonth' in body ? body.dateMonth : current.dateMonth) as number | null
  const day = ('dateDay' in body ? body.dateDay : current.dateDay) as number | null
  if (year != null && (year < 1000 || year > 3000))
    return NextResponse.json({ error: 'year must be a 4-digit year' }, { status: 400 })
  if (!validDateParts(year, month, day))
    return NextResponse.json({ error: 'invalid date: a day needs a month, a month needs a year' }, { status: 400 })

  const { changed } = await updateMediaWithAudit(id, user.id, body)
  return NextResponse.json({ ok: true, changed })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const user = await prisma.user.findUnique({ where: { clerkId: userId } })
  if (!user) return NextResponse.json({ error: 'no user record' }, { status: 403 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const { id } = await params
  try {
    await softDeleteMediaWithAudit(id, user.id)
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500
    return NextResponse.json({ error: 'not found' }, { status })
  }
  return NextResponse.json({ ok: true })
}
