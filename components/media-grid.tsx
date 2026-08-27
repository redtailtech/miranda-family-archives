'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type { MediaItemDTO } from '@/lib/media'

export function MediaGrid({ query }: { query?: string } = {}) {
  const [items, setItems] = useState<MediaItemDTO[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [loading, setLoading] = useState(false)
  const [errored, setErrored] = useState(false)
  const sentinel = useRef<HTMLDivElement>(null)
  // Bumped every time the query changes, so in-flight responses from a
  // superseded query can be told apart from the current one. A slow page
  // fetched under the old query must never be appended into the new list.
  const generation = useRef(0)

  const fetchPage = useCallback(
    async (cursorArg: string | null, append: boolean) => {
      const requestGeneration = generation.current
      setLoading(true)
      try {
        const params = [query, cursorArg ? `cursor=${cursorArg}` : null].filter(Boolean).join('&')
        const res = await fetch(`/api/media${params ? `?${params}` : ''}`)
        if (requestGeneration !== generation.current) return
        if (!res.ok) {
          setDone(true)
          setErrored(true)
          return
        }
        const data = await res.json()
        if (requestGeneration !== generation.current) return
        setItems((prev) => (append ? [...prev, ...data.items] : data.items))
        setCursor(data.nextCursor)
        setDone(!data.nextCursor)
      } catch {
        if (requestGeneration !== generation.current) return
        setDone(true)
        setErrored(true)
      } finally {
        if (requestGeneration === generation.current) setLoading(false)
      }
    },
    [query]
  )

  const loadMore = useCallback(() => {
    if (loading || done) return
    fetchPage(cursor, true)
  }, [cursor, done, loading, fetchPage])

  // Reset paging state and refetch whenever the filter query changes (search,
  // type/decade/album chips). Fetches directly rather than through loadMore
  // so the reset isn't racing stale cursor/done state from the prior query.
  useEffect(() => {
    generation.current += 1
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting paging state for a new filter query, not synchronizing with an external system
    setItems([])
    setCursor(null)
    setDone(false)
    setErrored(false)
    fetchPage(null, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const obs = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) loadMore()
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [loadMore])

  if (done && !errored && items.length === 0) {
    if (query?.includes('favorite'))
      return <p className="text-xl">Nothing here yet — tap the ❤️ on any photo to save it here.</p>
    if (query)
      return <p className="text-xl">No matches — try different search or filters.</p>
    return (
      <p className="text-xl">
        Nothing here yet —{' '}
        <Link href="/upload" className="underline">
          upload your first photos
        </Link>
        .
      </p>
    )
  }

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {items.map((item) => (
          <MediaTile key={item.id} item={item} />
        ))}
      </div>
      <div ref={sentinel} className="h-8" />
      {loading && <p className="py-4 text-center">Loading…</p>}
      {errored && (
        <p className="py-4 text-center text-red-700">
          Couldn&apos;t load photos — refresh to try again.
        </p>
      )}
    </div>
  )
}

export function MediaTile({ item }: { item: MediaItemDTO }) {
  return (
    <Link
      href={`/media/${item.id}`}
      className="relative block aspect-square overflow-hidden rounded-xl bg-black/5"
    >
      {item.thumbUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.thumbUrl} alt={item.title ?? item.originalFilename} className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full items-center justify-center p-2 text-center text-sm">
          {item.status === 'FAILED' ? (
            <span className="rounded-full bg-red-100 px-3 py-1 text-red-700">Failed</span>
          ) : (
            <span className="rounded-full bg-black/10 px-3 py-1">
              {item.status === 'UPLOADING' ? 'Uploading…' : 'Processing…'}
            </span>
          )}
        </span>
      )}
      {item.type === 'DOCUMENT' && (
        <span aria-label="document" className="absolute right-2 top-2 rounded bg-white/80 px-1">📄</span>
      )}
      {item.heartCount > 0 && (
        <span className="absolute bottom-2 left-2 rounded bg-white/80 px-1 text-sm">
          ❤️ {item.heartCount}
        </span>
      )}
    </Link>
  )
}
