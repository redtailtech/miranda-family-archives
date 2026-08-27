'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { PersonLite } from '@/lib/people'
import { PersonAvatar } from '@/components/person-avatar'
import { PersonForm } from '@/components/person-form'

type PersonWithTagCount = PersonLite & { tagCount: number }

export function PeopleList() {
  const [people, setPeople] = useState<PersonWithTagCount[]>([])
  const [loading, setLoading] = useState(true)
  const [errored, setErrored] = useState(false)
  const [showForm, setShowForm] = useState(false)

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

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex gap-2" role="group" aria-label="View">
          <button
            type="button"
            aria-pressed="true"
            className="rounded-full bg-black px-4 py-2 text-lg text-white"
          >
            List
          </button>
          <button
            type="button"
            aria-pressed="false"
            disabled
            title="coming soon"
            className="rounded-full border border-black/20 px-4 py-2 text-lg text-black/40"
          >
            Tree
          </button>
        </div>
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="rounded-xl bg-black px-6 py-3 text-lg text-white"
        >
          Add person
        </button>
      </div>

      {showForm && (
        <div className="mb-6 rounded-xl border p-6">
          <PersonForm onCancel={() => setShowForm(false)} />
        </div>
      )}

      {loading && <p className="text-xl">Loading…</p>}
      {errored && (
        <p className="text-lg text-red-700">Couldn&apos;t load people — refresh to try again.</p>
      )}
      {!loading && !errored && people.length === 0 && (
        <p className="text-xl">No one added yet — add the first person.</p>
      )}

      {!loading && !errored && people.length > 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {people.map((p) => (
            <Link
              key={p.id}
              href={`/people/${p.id}`}
              className="block overflow-hidden rounded-xl border p-4 text-center"
            >
              <div className="mb-3 flex justify-center">
                <PersonAvatar person={p} size="lg" />
              </div>
              <p className="truncate text-lg font-semibold">{p.displayName}</p>
              <p className="text-black/60">
                {p.tagCount} {p.tagCount === 1 ? 'photo' : 'photos'}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
