'use client'

import { useEffect, useState } from 'react'
import type { MediaItemDTO } from '@/lib/media'
import { MediaTile } from '@/components/media-grid'

type YearGroup = { year: number; items: MediaItemDTO[] }
type DecadeGroup = { decade: number; years: YearGroup[] }
type TimelineData = { decades: DecadeGroup[]; undated: MediaItemDTO[] }

export function TimelineView() {
  const [data, setData] = useState<TimelineData | null>(null)
  const [loading, setLoading] = useState(true)
  const [errored, setErrored] = useState(false)

  useEffect(() => {
    // Runs once on mount; loading/errored already start at their correct
    // initial values (true/false) so there's nothing to reset here.
    let cancelled = false
    fetch('/api/media/timeline')
      .then((res) => {
        if (!res.ok) throw new Error('failed')
        return res.json()
      })
      .then((json: TimelineData) => {
        if (!cancelled) setData(json)
      })
      .catch(() => {
        if (!cancelled) setErrored(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (loading) return <p className="py-4 text-center">Loading…</p>

  if (errored)
    return (
      <p className="py-4 text-center text-red-700">
        Couldn&apos;t load the timeline — refresh to try again.
      </p>
    )

  const isEmpty = data && data.decades.length === 0 && data.undated.length === 0
  if (isEmpty)
    return <p className="text-xl">Nothing here yet — photos will appear here once they&apos;re dated.</p>

  return (
    <div>
      {data!.decades.map((d) => (
        <section key={d.decade}>
          <h2 className="sticky top-0 z-10 bg-white py-2 text-2xl font-bold">{d.decade}s</h2>
          {d.years.map((y) => (
            <div key={y.year} className="mb-6">
              <h3 className="mb-2 text-lg font-semibold text-black/70">{y.year}</h3>
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
          <h2 className="sticky top-0 z-10 bg-white py-2 text-2xl font-bold">Undated</h2>
          <p className="mb-3 text-sm text-black/60">
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
