import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/require-user'
import { setMediaPeopleWithAudit } from '@/lib/audit'
import { safeErrorResponse } from '@/lib/http-errors'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireUser()
  if (error) return error
  const { id } = await params

  let personId: unknown
  try {
    ;({ personId } = await req.json())
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }
  if (typeof personId !== 'string' || !personId)
    return NextResponse.json({ error: 'personId is required' }, { status: 400 })

  try {
    await setMediaPeopleWithAudit(id, user!.id, { addPersonId: personId })
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
  const personId = req.nextUrl.searchParams.get('personId')
  if (!personId) return NextResponse.json({ error: 'personId is required' }, { status: 400 })

  try {
    await setMediaPeopleWithAudit(id, user!.id, { removePersonId: personId })
  } catch (err) {
    const { status, message } = safeErrorResponse(err)
    return NextResponse.json({ error: message }, { status })
  }
  return NextResponse.json({ ok: true })
}
