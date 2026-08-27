'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { PersonDTO, PersonLite } from '@/lib/people'
import { PersonAvatar } from '@/components/person-avatar'
import { PersonPicker } from '@/components/person-picker'

type RelationKind = 'parents' | 'spouses'

const CONFIG: Record<RelationKind, { path: string; bodyKey: string; queryKey: string; label: string }> = {
  parents: { path: 'parents', bodyKey: 'parentId', queryKey: 'parentId', label: 'parent' },
  spouses: { path: 'spouses', bodyKey: 'spouseId', queryKey: 'spouseId', label: 'spouse' },
}

export function PersonRelations({ person }: { person: PersonDTO }) {
  const router = useRouter()
  const [adding, setAdding] = useState<RelationKind | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState('')

  const excludeIds = [
    person.id,
    ...person.parents.map((p) => p.id),
    ...person.spouses.map((p) => p.id),
    ...person.children.map((p) => p.id),
  ]

  async function addRelation(kind: RelationKind, other: PersonLite) {
    const { path, bodyKey } = CONFIG[kind]
    setError('')
    try {
      const res = await fetch(`/api/people/${person.id}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [bodyKey]: other.id }),
      })
      if (res.ok) {
        setAdding(null)
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

  async function removeRelation(kind: RelationKind, other: PersonLite) {
    const { path, queryKey, label } = CONFIG[kind]
    if (!confirm(`Remove ${other.displayName} as ${person.displayName}'s ${label}?`)) return
    setError('')
    setBusyId(other.id)
    try {
      const res = await fetch(`/api/people/${person.id}/${path}?${queryKey}=${other.id}`, {
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
    <div className="grid gap-8">
      {error && <p className="text-lg text-red-700">{error}</p>}

      <RelationSection
        title="Parents"
        people={person.parents}
        busyId={busyId}
        addLabel="Add parent"
        adding={adding === 'parents'}
        onStartAdd={() => setAdding('parents')}
        onCancelAdd={() => setAdding(null)}
        exclude={excludeIds}
        onPick={(p) => addRelation('parents', p)}
        onRemove={(p) => removeRelation('parents', p)}
      />

      <RelationSection
        title="Spouses"
        people={person.spouses}
        busyId={busyId}
        addLabel="Add spouse"
        adding={adding === 'spouses'}
        onStartAdd={() => setAdding('spouses')}
        onCancelAdd={() => setAdding(null)}
        exclude={excludeIds}
        onPick={(p) => addRelation('spouses', p)}
        onRemove={(p) => removeRelation('spouses', p)}
      />

      <ReadOnlySection
        title="Children"
        people={person.children}
        empty="No children linked yet — add this person as a parent from the child's own profile."
      />

      <ReadOnlySection title="Siblings" people={person.siblings} empty="No siblings on record." />
    </div>
  )
}

function RelationSection({
  title,
  people,
  busyId,
  addLabel,
  adding,
  onStartAdd,
  onCancelAdd,
  exclude,
  onPick,
  onRemove,
}: {
  title: string
  people: PersonLite[]
  busyId: string | null
  addLabel: string
  adding: boolean
  onStartAdd: () => void
  onCancelAdd: () => void
  exclude: string[]
  onPick: (p: PersonLite) => void
  onRemove: (p: PersonLite) => void
}) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-2xl font-bold">{title}</h2>
        {!adding && (
          <button type="button" onClick={onStartAdd} className="rounded-xl border px-4 py-2 text-lg">
            {addLabel}
          </button>
        )}
      </div>

      {adding && (
        <div className="mb-4 rounded-xl border p-4">
          <PersonPicker exclude={exclude} onPick={onPick} />
          <button
            type="button"
            onClick={onCancelAdd}
            className="mt-3 rounded-xl border px-4 py-2 text-lg"
          >
            Cancel
          </button>
        </div>
      )}

      {people.length === 0 ? (
        <p className="text-lg text-black/60">None yet.</p>
      ) : (
        <ul className="grid gap-2">
          {people.map((p) => (
            <li key={p.id} className="flex items-center gap-4 rounded-xl border p-3">
              <PersonAvatar person={p} size="sm" />
              <Link href={`/people/${p.id}`} className="flex-1 text-lg underline">
                {p.displayName}
              </Link>
              <button
                type="button"
                onClick={() => onRemove(p)}
                disabled={busyId === p.id}
                className="rounded-xl border border-red-700 px-4 py-2 text-lg text-red-700 disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function ReadOnlySection({
  title,
  people,
  empty,
}: {
  title: string
  people: PersonLite[]
  empty: string
}) {
  return (
    <section>
      <h2 className="mb-3 text-2xl font-bold">{title}</h2>
      {people.length === 0 ? (
        <p className="text-lg text-black/60">{empty}</p>
      ) : (
        <ul className="grid gap-2">
          {people.map((p) => (
            <li key={p.id} className="flex items-center gap-4 rounded-xl border p-3">
              <PersonAvatar person={p} size="sm" />
              <Link href={`/people/${p.id}`} className="flex-1 text-lg underline">
                {p.displayName}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
