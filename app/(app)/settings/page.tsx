import { redirect } from 'next/navigation'
import { auth } from '@clerk/nextjs/server'
import { prisma } from '@/lib/db'
import { SettingsForm } from '@/components/settings-form'

export default async function SettingsPage() {
  const { userId } = await auth()
  const viewer = userId ? await prisma.user.findUnique({ where: { clerkId: userId } }) : null
  if (!viewer) redirect('/')

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="my-4 text-3xl font-bold">Settings</h1>
      <SettingsForm
        profile={{
          name: viewer.name,
          email: viewer.email,
          role: viewer.role,
          digestEnabled: viewer.digestEnabled,
        }}
        isAdmin={viewer.role === 'ADMIN'}
      />
    </div>
  )
}
