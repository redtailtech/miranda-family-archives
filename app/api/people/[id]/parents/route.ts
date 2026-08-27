import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/require-user'
import { addParentWithAudit, removeParentWithAudit } from '@/lib/audit'
import { safeErrorResponse } from '@/lib/http-errors'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireUser()
  if (error) return error
  const { id } = await params

  let parentId: unknown
  try {
    ;({ parentId } = await req.json())
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }
  if (typeof parentId !== 'string' || !parentId)
    return NextResponse.json({ error: 'parentId is required' }, { status: 400 })

  try {
    await addParentWithAudit(id, parentId, user!.id)
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
  const parentId = req.nextUrl.searchParams.get('parentId')
  if (!parentId) return NextResponse.json({ error: 'parentId is required' }, { status: 400 })

  try {
    await removeParentWithAudit(id, parentId, user!.id)
  } catch (err) {
    const { status, message } = safeErrorResponse(err)
    return NextResponse.json({ error: message }, { status })
  }
  return NextResponse.json({ ok: true })
}
