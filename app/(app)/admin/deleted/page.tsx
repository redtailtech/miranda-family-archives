import { redirect } from 'next/navigation'
import Link from 'next/link'
import { auth } from '@clerk/nextjs/server'
import { prisma } from '@/lib/db'
import { mediaItemToDTO } from '@/lib/media'
import { personToLite } from '@/lib/people'
import { AdminItemActions } from '@/components/admin-item-actions'
import { PersonAdminActions } from '@/components/person-admin-actions'
import { PersonAvatar } from '@/components/person-avatar'

export default async function DeletedItemsPage() {
  const { userId } = await auth()
  const viewer = userId ? await prisma.user.findUnique({ where: { clerkId: userId } }) : null
  if (viewer?.role !== 'ADMIN') redirect('/')

  const items = await prisma.mediaItem.findMany({
    where: { NOT: { deletedAt: null } },
    orderBy: { deletedAt: 'desc' },
    include: { uploadedBy: true },
  })
  const dtos = await Promise.all(items.map((i) => mediaItemToDTO(i)))

  const deletedPeople = await prisma.person.findMany({
    where: { NOT: { deletedAt: null } },
    orderBy: { deletedAt: 'desc' },
  })
  const peopleLite = await Promise.all(deletedPeople.map((p) => personToLite(p)))

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/" className="text-lg underline">← Library</Link>
      <h1 className="my-4 text-3xl font-bold">Deleted items</h1>
      {dtos.length === 0 && <p className="text-lg">Nothing has been deleted.</p>}
      <ul className="grid gap-4">
        {dtos.map((dto, i) => (
          <li key={dto.id} className="flex items-center gap-4 rounded-xl border p-4">
            {dto.thumbUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={dto.thumbUrl} alt="" className="h-20 w-20 rounded-lg object-cover" />
            ) : (
              <span className="flex h-20 w-20 items-center justify-center rounded-lg bg-black/5">📄</span>
            )}
            <div className="flex-1 text-lg">
              <div className="font-semibold">{dto.title ?? dto.originalFilename}</div>
              <div className="text-sm text-black/60">
                deleted {items[i].deletedAt ? new Date(items[i].deletedAt!).toLocaleDateString() : ''}
              </div>
            </div>
            <AdminItemActions id={dto.id} deleted={true} />
          </li>
        ))}
      </ul>

      <h2 className="my-4 text-2xl font-bold">Deleted people</h2>
      {peopleLite.length === 0 && <p className="text-lg">No one has been deleted.</p>}
      <ul className="grid gap-4">
        {peopleLite.map((p, i) => (
          <li key={p.id} className="flex items-center gap-4 rounded-xl border p-4">
            <PersonAvatar person={p} size="md" />
            <div className="flex-1 text-lg">
              <div className="font-semibold">{p.displayName}</div>
              <div className="text-sm text-black/60">
                deleted{' '}
                {deletedPeople[i].deletedAt
                  ? new Date(deletedPeople[i].deletedAt!).toLocaleDateString()
                  : ''}
              </div>
            </div>
            <PersonAdminActions id={p.id} deleted={true} />
          </li>
        ))}
      </ul>
    </div>
  )
}
