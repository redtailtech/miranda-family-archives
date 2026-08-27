'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type { MediaItemDTO } from '@/lib/media'

export function MediaGrid() {
  const [items, setItems] = useState<MediaItemDTO[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [loading, setLoading] = useState(false)
  const [errored, setErrored] = useState(false)
  const sentinel = useRef<HTMLDivElement>(null)

  const loadMore = useCallback(async () => {
    if (loading || done) return
    setLoading(true)
    try {
      const res = await fetch(`/api/media${cursor ? `?cursor=${cursor}` : ''}`)
      if (!res.ok) {
        setDone(true)
        setErrored(true)
        return
      }
      const data = await res.json()
      setItems((prev) => [...prev, ...data.items])
      setCursor(data.nextCursor)
      if (!data.nextCursor) setDone(true)
    } catch {
      setDone(true)
      setErrored(true)
    } finally {
      setLoading(false)
    }
  }, [cursor, done, loading])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadMore()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const obs = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) loadMore()
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [loadMore])

  if (done && !errored && items.length === 0)
    return (
      <p className="text-xl">
        Nothing here yet —{' '}
        <Link href="/upload" className="underline">
          upload your first photos
        </Link>
        .
      </p>
    )

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {items.map((item) => (
          <Link
            key={item.id}
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
          </Link>
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
