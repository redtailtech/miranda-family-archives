import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/require-user'
import { addSpouseWithAudit, removeSpouseWithAudit, setSpouseFormerWithAudit } from '@/lib/audit'
import { safeErrorResponse } from '@/lib/http-errors'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireUser()
  if (error) return error
  const { id } = await params

  let spouseId: unknown
  let former: unknown
  try {
    ;({ spouseId, former } = await req.json())
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }
  if (typeof spouseId !== 'string' || !spouseId)
    return NextResponse.json({ error: 'spouseId is required' }, { status: 400 })
  if (former !== undefined && typeof former !== 'boolean')
    return NextResponse.json({ error: 'former must be true or false' }, { status: 400 })

  try {
    await addSpouseWithAudit(id, spouseId, user!.id, former ?? false)
  } catch (err) {
    const { status, message } = safeErrorResponse(err)
    return NextResponse.json({ error: message }, { status })
  }
  return NextResponse.json({ ok: true })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireUser()
  if (error) return error
  const { id } = await params

  let spouseId: unknown
  let former: unknown
  try {
    ;({ spouseId, former } = await req.json())
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }
  if (typeof spouseId !== 'string' || !spouseId)
    return NextResponse.json({ error: 'spouseId is required' }, { status: 400 })
  if (typeof former !== 'boolean')
    return NextResponse.json({ error: 'former must be true or false' }, { status: 400 })

  try {
    await setSpouseFormerWithAudit(id, spouseId, user!.id, former)
  } catch (err) {
    const { status, message } = safeErrorResponse(err)
    return NextResponse.json({ error: message }, { status })
  }
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireUser()
  if (error) return error
  const { id } = await params
  const spouseId = req.nextUrl.searchParams.get('spouseId')
  if (!spouseId) return NextResponse.json({ error: 'spouseId is required' }, { status: 400 })

  try {
    await removeSpouseWithAudit(id, spouseId, user!.id)
  } catch (err) {
    const { status, message } = safeErrorResponse(err)
    return NextResponse.json({ error: message }, { status })
  }
  return NextResponse.json({ ok: true })
}
