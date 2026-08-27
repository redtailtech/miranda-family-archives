import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { restoreMediaWithAudit } from '@/lib/audit'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const user = await prisma.user.findUnique({ where: { clerkId: userId } })
  if (!user) return NextResponse.json({ error: 'no user record' }, { status: 403 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const { id } = await params
  try {
    await restoreMediaWithAudit(id, user.id)
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500
    return NextResponse.json({ error: 'not deleted' }, { status })
  }
  return NextResponse.json({ ok: true })
}
