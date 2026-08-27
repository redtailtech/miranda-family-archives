import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/require-user'
import { restorePersonWithAudit } from '@/lib/audit'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireUser()
  if (error) return error
  if (user!.role !== 'ADMIN') return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const { id } = await params
  try {
    await restorePersonWithAudit(id, user!.id)
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500
    return NextResponse.json({ error: 'not deleted' }, { status })
  }
  return NextResponse.json({ ok: true })
}
