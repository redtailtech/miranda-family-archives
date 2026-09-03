'use client'

import { useEffect, useRef, useState } from 'react'
import type { MediaItemDTO } from '@/lib/media'
import { MediaTile } from '@/components/media-grid'

type YearGroup = { year: number; items: MediaItemDTO[] }
type DecadeGroup = { decade: number; years: YearGroup[] }
type TimelineData = { decades: DecadeGroup[]; undated: MediaItemDTO[] }

export function TimelineView({ query }: { query?: string } = {}) {
  const [data, setData] = useState<TimelineData | null>(null)
  const [loading, setLoading] = useState(true)
  const [errored, setErrored] = useState(false)
  // Bumped every time the query changes, so an in-flight response from a
  // superseded query can be told apart from the current one — mirrors
  // MediaGrid's generation counter. A slow fetch under the old filters must
  // never overwrite the timeline for the filters showing now.
  const generation = useRef(0)

  useEffect(() => {
    generation.current += 1
    const requestGeneration = generation.current
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting load state for a new filter query, not synchronizing with an external system
    setLoading(true)
    setErrored(false)
    fetch(`/api/media/timeline${query ? `?${query}` : ''}`)
      .then((res) => {
        if (!res.ok) throw new Error('failed')
        return res.json()
      })
      .then((json: TimelineData) => {
        if (cancelled || requestGeneration !== generation.current) return
        setData(json)
      })
      .catch(() => {
        if (cancelled || requestGeneration !== generation.current) return
        setErrored(true)
      })
      .finally(() => {
        if (cancelled || requestGeneration !== generation.current) return
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [query])

  if (loading) return <p className="py-4 text-center">Loading…</p>

  if (errored)
    return (
      <p className="py-4 text-center text-red-700">
        Couldn&apos;t load the timeline — refresh to try again.
      </p>
    )

  const isEmpty = data && data.decades.length === 0 && data.undated.length === 0
  if (isEmpty) {
    if (query) return <p className="text-xl">No photos match — try a different search or clear a filter.</p>
    return (
      <p className="text-xl">
        The timeline is empty so far — upload photos and they&apos;ll take their place in time.
      </p>
    )
  }

  return (
    <div>
      {data!.decades.map((d) => (
        <section key={d.decade}>
          <h2 className="sticky top-0 z-10 bg-paper py-2 text-2xl font-bold">{d.decade}s</h2>
          {d.years.map((y) => (
            <div key={y.year} className="mb-6">
              <h3 className="mb-2 text-lg font-semibold text-ink-soft">{y.year}</h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {y.items.map((item) => (
                  <MediaTile key={item.id} item={item} />
                ))}
              </div>
            </div>
          ))}
        </section>
      ))}

      {data!.undated.length > 0 && (
        <section>
          <h2 className="sticky top-0 z-10 bg-paper py-2 text-2xl font-bold">Undated</h2>
          <p className="mb-3 text-base text-ink-soft">
            Add a year on a photo&apos;s Details tab to place it in time.
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {data!.undated.map((item) => (
              <MediaTile key={item.id} item={item} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
