import { notFound } from 'next/navigation'
import Link from 'next/link'
import { auth } from '@clerk/nextjs/server'
import { prisma } from '@/lib/db'
import { personToDTO } from '@/lib/people'
import { PersonAvatar } from '@/components/person-avatar'
import { PersonAvatarControls } from '@/components/person-avatar-controls'
import { PersonForm } from '@/components/person-form'
import { PersonRelations } from '@/components/person-relations'
import { PersonAdminActions } from '@/components/person-admin-actions'
import { MediaGrid } from '@/components/media-grid'

export default async function PersonProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const person = await personToDTO(id)
  if (!person) notFound()

  const { userId } = await auth()
  const viewer = userId ? await prisma.user.findUnique({ where: { clerkId: userId } }) : null

  const years =
    person.birthYear || person.deathYear
      ? `${person.birthYear ?? '?'}–${person.deathYear ?? ''}`
      : null

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/tree" className="text-lg underline">
        ← Family Tree
      </Link>

      <div className="my-6 flex flex-wrap items-center gap-6">
        <div className="flex flex-col items-center gap-2">
          <PersonAvatar person={person} size="lg" />
          {viewer && <PersonAvatarControls personId={person.id} tagCount={person.tagCount} />}
        </div>
        <div>
          <h1 className="text-3xl font-bold">{person.displayName}</h1>
          {person.maidenName && (
            <p className="text-lg text-black/60">Maiden name: {person.maidenName}</p>
          )}
          {years && <p className="text-lg text-black/60">{years}</p>}
          {person.birthplace && <p className="text-lg text-black/60">{person.birthplace}</p>}
        </div>
      </div>

      <div className="mb-8 flex flex-wrap items-center gap-4">
        <Link href={`/?personId=${person.id}`} className="rounded-xl border px-5 py-3 text-lg">
          See their photos
        </Link>
        {viewer?.role === 'ADMIN' && <PersonAdminActions id={person.id} deleted={false} />}
      </div>

      <div className="mb-10">
        <PersonForm person={person} />
      </div>

      <PersonRelations person={person} />

      {person.tagCount > 0 && (
        <div className="mt-10">
          <h2 className="mb-4 text-2xl font-bold">Photos of {person.displayName}</h2>
          <MediaGrid query={`personId=${person.id}`} />
        </div>
      )}
    </div>
  )
}
