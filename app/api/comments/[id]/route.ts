import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const user = await prisma.user.findUnique({ where: { clerkId: userId } })
  if (!user) return NextResponse.json({ error: 'no user record' }, { status: 403 })

  const { id } = await params
  const comment = await prisma.comment.findUnique({ where: { id } })
  if (!comment) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (comment.userId !== user.id && user.role !== 'ADMIN')
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  await prisma.comment.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
