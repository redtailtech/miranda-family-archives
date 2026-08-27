'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { AlbumDTO } from '@/lib/albums'
import { AlbumForm } from '@/components/album-form'

export function AlbumGrid() {
  const [albums, setAlbums] = useState<AlbumDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [errored, setErrored] = useState(false)
  const [showForm, setShowForm] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const res = await fetch('/api/albums')
        if (!res.ok) throw new Error()
        const data = await res.json()
        if (!cancelled) setAlbums(data.albums)
      } catch {
        if (!cancelled) setErrored(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div>
      <div className="mb-6 flex items-center justify-end">
        <button
          onClick={() => setShowForm(true)}
          className="rounded-xl bg-ink px-6 py-3 text-lg font-medium text-paper hover:bg-sepia"
        >
          New album
        </button>
      </div>

      {showForm && (
        <div className="mb-6 rounded-xl border bg-surface p-6">
          <AlbumForm onCancel={() => setShowForm(false)} />
        </div>
      )}

      {loading && <p className="text-xl">Loading…</p>}
      {errored && (
        <p className="text-lg text-red-700">Couldn&apos;t load albums — refresh to try again.</p>
      )}
      {!loading && !errored && albums.length === 0 && (
        <p className="text-xl">
          No albums yet — create the first one and give a set of photos a home.
        </p>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {albums.map((album) => (
          <Link
            key={album.id}
            href={`/albums/${album.id}`}
            className="block overflow-hidden rounded-xl border bg-surface shadow-sm transition-shadow hover:shadow-md"
          >
            <div className="flex aspect-square items-center justify-center bg-wash">
              {album.coverThumbUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={album.coverThumbUrl}
                  alt={album.name}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="text-5xl">📚</span>
              )}
            </div>
            <div className="p-3">
              <p className="truncate text-lg font-semibold">{album.name}</p>
              <p className="text-ink-soft">
                {album.itemCount} {album.itemCount === 1 ? 'item' : 'items'}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
