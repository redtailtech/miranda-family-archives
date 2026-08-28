'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { ReactNode } from 'react'
import type { PersonDTO, PersonLite } from '@/lib/people'
import { PersonAvatar } from '@/components/person-avatar'
import { PersonPicker } from '@/components/person-picker'
import { useConfirm } from '@/components/confirm-dialog'

type RelationKind = 'parents' | 'spouses'
type SpouseLite = PersonLite & { former: boolean }

const CONFIG: Record<RelationKind, { path: string; bodyKey: string; queryKey: string; label: string }> = {
  parents: { path: 'parents', bodyKey: 'parentId', queryKey: 'parentId', label: 'parent' },
  spouses: { path: 'spouses', bodyKey: 'spouseId', queryKey: 'spouseId', label: 'spouse' },
}

export function PersonRelations({ person }: { person: PersonDTO }) {
  const router = useRouter()
  const confirm = useConfirm()
  const [adding, setAdding] = useState<RelationKind | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [formerChecked, setFormerChecked] = useState(false)

  const excludeIds = [
    person.id,
    ...person.parents.map((p) => p.id),
    ...person.spouses.map((p) => p.id),
    ...person.children.map((p) => p.id),
  ]

  function cancelAdd() {
    setAdding(null)
    setFormerChecked(false)
  }

  async function addRelation(kind: RelationKind, other: PersonLite, extra?: Record<string, unknown>) {
    const { path, bodyKey } = CONFIG[kind]
    setError('')
    try {
      const res = await fetch(`/api/people/${person.id}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [bodyKey]: other.id, ...extra }),
      })
      if (res.ok) {
        setAdding(null)
        setFormerChecked(false)
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
    const ok = await confirm({
      title: `Remove ${other.displayName} as ${person.displayName}'s ${label}?`,
      actionLabel: 'Remove',
      destructive: true,
    })
    if (!ok) return
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

  async function toggleSpouseFormer(spouse: SpouseLite) {
    setError('')
    setBusyId(spouse.id)
    try {
      const res = await fetch(`/api/people/${person.id}/spouses`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spouseId: spouse.id, former: !spouse.former }),
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
        onCancelAdd={cancelAdd}
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
        onCancelAdd={cancelAdd}
        exclude={excludeIds}
        onPick={(p) => addRelation('spouses', p, { former: formerChecked })}
        onRemove={(p) => removeRelation('spouses', p)}
        renderMeta={(p) =>
          p.former ? <span className="mt-1 block text-lg text-ink-soft">Former spouse</span> : null
        }
        renderSecondaryAction={(p) => (
          <button
            type="button"
            onClick={() => toggleSpouseFormer(p)}
            disabled={busyId === p.id}
            className="rounded-xl border px-4 py-2 text-lg disabled:opacity-50"
          >
            {p.former ? 'Mark as current spouse' : 'Mark as former spouse'}
          </button>
        )}
        addExtra={
          <label className="mt-3 flex min-h-11 items-center gap-3 text-lg">
            <input
              type="checkbox"
              checked={formerChecked}
              onChange={(e) => setFormerChecked(e.target.checked)}
              className="h-5 w-5 shrink-0"
            />
            This is a former spouse (they were married or together before)
          </label>
        }
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

function RelationSection<T extends PersonLite>({
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
  renderMeta,
  renderSecondaryAction,
  addExtra,
}: {
  title: string
  people: T[]
  busyId: string | null
  addLabel: string
  adding: boolean
  onStartAdd: () => void
  onCancelAdd: () => void
  exclude: string[]
  onPick: (p: PersonLite) => void
  onRemove: (p: T) => void
  renderMeta?: (p: T) => ReactNode
  renderSecondaryAction?: (p: T) => ReactNode
  addExtra?: ReactNode
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
          {addExtra}
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
              {renderMeta ? (
                <div className="flex-1">
                  <Link href={`/people/${p.id}`} className="text-lg underline">
                    {p.displayName}
                  </Link>
                  {renderMeta(p)}
                </div>
              ) : (
                <Link href={`/people/${p.id}`} className="flex-1 text-lg underline">
                  {p.displayName}
                </Link>
              )}
              {renderSecondaryAction?.(p)}
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
