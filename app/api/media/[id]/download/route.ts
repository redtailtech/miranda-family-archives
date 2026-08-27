import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { signGetUrl } from '@/lib/s3'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  const item = await prisma.mediaItem.findFirst({ where: { id, deletedAt: null } })
  if (!item) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const url = await signGetUrl(item.originalKey, {
    downloadName: item.originalFilename,
    expiresIn: 300,
  })
  return NextResponse.redirect(url, 302)
}
