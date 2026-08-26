// app/api/webhooks/clerk/route.ts
import { verifyWebhook } from '@clerk/nextjs/webhooks'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'

function isAdminEmail(email: string): boolean {
  const admins = (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
  return admins.includes(email.toLowerCase())
}

export async function POST(req: NextRequest) {
  let evt
  try {
    evt = await verifyWebhook(req)
  } catch (err) {
    console.error('Clerk webhook verification failed:', err)
    return new Response('Verification failed', { status: 400 })
  }

  if (evt.type === 'user.created' || evt.type === 'user.updated') {
    const { id, email_addresses, first_name, last_name, image_url } = evt.data
    const email = email_addresses[0]?.email_address
    if (!email) return new Response('No email on user', { status: 200 })
    const name = `${first_name ?? ''} ${last_name ?? ''}`.trim() || email

    await prisma.user.upsert({
      where: { clerkId: id },
      create: {
        clerkId: id,
        email,
        name,
        avatarUrl: image_url,
        role: isAdminEmail(email) ? 'ADMIN' : 'MEMBER',
      },
      update: { email, name, avatarUrl: image_url },
    })
  }

  // user.deleted: keep the row — uploads, comments, and audit history
  // reference it. Access is already revoked because the Clerk user is gone.

  return new Response('OK', { status: 200 })
}
