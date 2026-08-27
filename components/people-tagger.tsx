'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { PersonLite } from '@/lib/people'
import { PersonAvatar } from '@/components/person-avatar'
import { PersonPicker } from '@/components/person-picker'

export function PeopleTagger({ mediaId, people }: { mediaId: string; people: PersonLite[] }) {
  const router = useRouter()
  const [adding, setAdding] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState('')

  async function tag(person: PersonLite) {
    setError('')
    try {
      const res = await fetch(`/api/media/${mediaId}/people`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personId: person.id }),
      })
      if (res.ok) {
        setAdding(false)
        router.refresh()
      } else {
        let msg = `HTTP ${res.status}`
        try {
          msg = (await res.json()).error ?? msg
        } catch {}
        setError(msg)
      }
    } catch {
      setError("Couldn't save — check your connection and try again.")
    }
  }

  async function untag(person: PersonLite) {
    if (!confirm(`Remove ${person.displayName} from this photo?`)) return
    setError('')
    setBusyId(person.id)
    try {
      const res = await fetch(`/api/media/${mediaId}/people?personId=${person.id}`, {
        method: 'DELETE',
      })
      setBusyId(null)
      if (res.ok) {
        router.refresh()
      } else {
        let msg = `HTTP ${res.status}`
        try {
          msg = (await res.json()).error ?? msg
        } catch {}
        setError(msg)
      }
    } catch {
      setBusyId(null)
      setError("Couldn't save — check your connection and try again.")
    }
  }

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-2xl font-bold">People</h2>
        {!adding && (
          <button type="button" onClick={() => setAdding(true)} className="rounded-xl border px-4 py-2 text-lg">
            Tag a person
          </button>
        )}
      </div>

      {error && <p className="mb-3 text-lg text-red-700">{error}</p>}

      {adding && (
        <div className="mb-4 rounded-xl border p-4">
          <PersonPicker exclude={people.map((p) => p.id)} onPick={tag} />
          <button
            type="button"
            onClick={() => setAdding(false)}
            className="mt-3 rounded-xl border px-4 py-2 text-lg"
          >
            Cancel
          </button>
        </div>
      )}

      {people.length === 0 ? (
        <p className="text-lg text-black/60">No one tagged yet.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {people.map((p) => (
            <li key={p.id} className="flex items-center gap-2 rounded-full border py-1 pl-1 pr-3">
              <PersonAvatar person={p} size="sm" />
              <Link href={`/people/${p.id}`} className="text-lg underline">
                {p.displayName}
              </Link>
              <button
                type="button"
                onClick={() => untag(p)}
                disabled={busyId === p.id}
                aria-label={`Remove ${p.displayName}`}
                className="ml-1 text-lg text-red-700 disabled:opacity-50"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
