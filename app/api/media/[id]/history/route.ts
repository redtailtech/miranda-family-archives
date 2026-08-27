import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  const entries = await prisma.auditLog.findMany({
    where: { entityType: 'media_item', entityId: id },
    orderBy: { createdAt: 'desc' },
    include: { user: true },
  })
  return NextResponse.json({
    entries: entries.map((e) => ({
      id: e.id,
      action: e.action,
      changes: e.changes,
      user: { name: e.user.name || e.user.email },
      createdAt: e.createdAt.toISOString(),
    })),
  })
}
