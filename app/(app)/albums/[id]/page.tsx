import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import { albumToDTO } from '@/lib/albums'
import { mediaItemToDTO } from '@/lib/media'
import { AlbumDetail } from '@/components/album-detail'

export default async function AlbumDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const album = await prisma.album.findUnique({
    where: { id },
    include: { items: { include: { mediaItem: { include: { uploadedBy: true } } } } },
  })
  if (!album) notFound()

  const liveItems = album.items
    .filter((i) => i.mediaItem.deletedAt === null)
    .sort((a, b) => a.position - b.position)

  return (
    <AlbumDetail
      album={await albumToDTO(album)}
      items={await Promise.all(liveItems.map((i) => mediaItemToDTO(i.mediaItem)))}
    />
  )
}
