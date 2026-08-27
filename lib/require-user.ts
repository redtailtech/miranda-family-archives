import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function requireUser() {
  const { userId } = await auth()
  if (!userId) return { error: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) }
  const user = await prisma.user.findUnique({ where: { clerkId: userId } })
  if (!user) return { error: NextResponse.json({ error: 'no user record' }, { status: 403 }) }
  return { user }
}
