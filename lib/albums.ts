import type { Album, AlbumItem, MediaItem } from '@prisma/client'
import { signGetUrl } from '@/lib/s3'

export type AlbumDTO = {
  id: string
  name: string
  description: string | null
  itemCount: number
  coverThumbUrl: string | null
  createdAt: string
}

type AlbumWithItems = Album & { items: (AlbumItem & { mediaItem: MediaItem })[] }

export async function albumToDTO(album: AlbumWithItems): Promise<AlbumDTO> {
  const live = album.items
    .filter((i) => i.mediaItem.deletedAt === null)
    .sort((a, b) => a.position - b.position)
  const cover =
    live.find((i) => i.mediaItemId === album.coverMediaId)?.mediaItem ?? live[0]?.mediaItem ?? null
  return {
    id: album.id,
    name: album.name,
    description: album.description,
    itemCount: live.length,
    coverThumbUrl: cover?.thumbKey ? await signGetUrl(cover.thumbKey) : null,
    createdAt: album.createdAt.toISOString(),
  }
}
