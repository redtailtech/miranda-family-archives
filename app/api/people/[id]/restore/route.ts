import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/require-user'
import { restorePersonWithAudit } from '@/lib/audit'
import { safeErrorResponse } from '@/lib/http-errors'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireUser()
  if (error) return error
  if (user!.role !== 'ADMIN') return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const { id } = await params
  try {
    await restorePersonWithAudit(id, user!.id)
  } catch (err) {
    const { status, message } = safeErrorResponse(err)
    return NextResponse.json({ error: message }, { status })
  }
  return NextResponse.json({ ok: true })
}
