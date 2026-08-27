import { MediaGrid } from '@/components/media-grid'

export default function FavoritesPage() {
  return (
    <div>
      <h1 className="mb-6 text-3xl font-bold">Favorites</h1>
      <MediaGrid query="favorite=1" />
    </div>
  )
}
