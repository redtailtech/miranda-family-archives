import { NextRequest, NextResponse } from 'next/server'
import { clerkClient } from '@clerk/nextjs/server'
import { requireUser } from '@/lib/require-user'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Real invitation emails are only sent once this route is exercised end-to-end
// against a live Clerk instance (Task 5 acceptance). Module verification stops
// just short of that: it asserts the ADMIN gate and the email-shape validation,
// and does not invoke clerkClient().invitations.createInvitation for real.

export async function POST(req: NextRequest) {
  const { user, error } = await requireUser()
  if (error) return error
  if (user!.role !== 'ADMIN') return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }

  const unknown = Object.keys(body).filter((k) => k !== 'email')
  if (unknown.length > 0)
    return NextResponse.json({ error: `unknown fields: ${unknown.join(', ')}` }, { status: 400 })

  const email = typeof body.email === 'string' ? body.email.trim() : ''
  if (!EMAIL_RE.test(email))
    return NextResponse.json({ error: 'a valid email address is required' }, { status: 400 })

  try {
    const client = await clerkClient()
    await client.invitations.createInvitation({
      emailAddress: email,
      redirectUrl: 'https://mirandafamilyarchives.com/sign-in',
    })
  } catch (err) {
    return NextResponse.json({ error: extractClerkMessage(err) }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}

function extractClerkMessage(err: unknown): string {
  const errors = (err as { errors?: Array<{ message?: string }> } | null | undefined)?.errors
  if (Array.isArray(errors) && typeof errors[0]?.message === 'string') return errors[0].message
  return 'Could not send the invitation. Please try again.'
}
