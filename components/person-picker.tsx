'use client'

import { useEffect, useState } from 'react'
import type { PersonLite } from '@/lib/people'
import { PersonAvatar } from '@/components/person-avatar'

/**
 * Fetches the full people list once and lets the caller filter/pick from it.
 * Shared by relationship editing (PersonRelations) and, later, the photo
 * tagger (Task 5).
 */
export function PersonPicker({
  exclude = [],
  onPick,
}: {
  exclude?: string[]
  onPick: (person: PersonLite) => void
}) {
  const [people, setPeople] = useState<PersonLite[]>([])
  const [loading, setLoading] = useState(true)
  const [errored, setErrored] = useState(false)
  const [q, setQ] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const res = await fetch('/api/people')
        if (!res.ok) throw new Error()
        const data = await res.json()
        if (!cancelled) setPeople(data.people)
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

  const excludeSet = new Set(exclude)
  const needle = q.trim().toLowerCase()
  const filtered = people.filter(
    (p) => !excludeSet.has(p.id) && p.displayName.toLowerCase().includes(needle)
  )

  return (
    <div className="grid gap-3">
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search by name…"
        aria-label="Search people"
        className="w-full rounded-lg border px-4 py-3 text-lg"
        autoFocus
      />
      {loading && <p className="text-lg">Loading…</p>}
      {errored && (
        <p className="text-lg text-red-700">Couldn&apos;t load people — refresh to try again.</p>
      )}
      {!loading && !errored && filtered.length === 0 && (
        <p className="text-lg text-black/60">No matches.</p>
      )}
      <ul className="grid max-h-80 gap-1 overflow-y-auto">
        {filtered.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => onPick(p)}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-lg hover:bg-black/5"
            >
              <PersonAvatar person={p} size="sm" />
              <span>
                {p.displayName}
                {p.birthYear && <span className="text-black/50"> (b. {p.birthYear})</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
