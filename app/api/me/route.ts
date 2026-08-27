import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireUser } from '@/lib/require-user'

// PATCH is intentionally NOT audited: digestEnabled is a personal preference,
// not archival data, and is out of scope for the audit log (spec §7).

export async function GET() {
  const { user, error } = await requireUser()
  if (error) return error
  return NextResponse.json({
    name: user!.name,
    email: user!.email,
    role: user!.role,
    digestEnabled: user!.digestEnabled,
  })
}

export async function PATCH(req: NextRequest) {
  const { user, error } = await requireUser()
  if (error) return error

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }

  const unknown = Object.keys(body).filter((k) => k !== 'digestEnabled')
  if (unknown.length > 0)
    return NextResponse.json({ error: `unknown fields: ${unknown.join(', ')}` }, { status: 400 })

  if (!('digestEnabled' in body) || typeof body.digestEnabled !== 'boolean')
    return NextResponse.json({ error: 'digestEnabled must be a boolean' }, { status: 400 })

  await prisma.user.update({
    where: { id: user!.id },
    data: { digestEnabled: body.digestEnabled },
  })

  return NextResponse.json({ ok: true })
}
