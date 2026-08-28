'use client'

import { useEffect, useState } from 'react'

type Entry = {
  id: string
  action: 'CREATE' | 'UPDATE' | 'DELETE'
  changes: Record<string, { from: unknown; to: unknown }>
  user: { name: string }
  createdAt: string
}

const LABELS: Record<string, string> = {
  title: 'the title', description: 'the description', location: 'the location',
  dateYear: 'the year', dateMonth: 'the month', dateDay: 'the day',
  dateIsApproximate: 'the approximate-date flag', deletedAt: 'deleted', filename: 'the file',
  people: 'the people', back: 'the back photo', backOf: 'the front photo',
  spouses: 'the spouses',
}

function fieldSentence(field: string, from: unknown, to: unknown): string {
  const label = LABELS[field] ?? field
  if (Array.isArray(from) && Array.isArray(to)) {
    const fromNames = from as string[]
    const toNames = to as string[]
    if (field === 'people') {
      const added = toNames.filter((n) => !fromNames.includes(n))
      const removed = fromNames.filter((n) => !toNames.includes(n))
      const parts: string[] = []
      if (added.length > 0) parts.push(`tagged ${added.join(', ')}`)
      if (removed.length > 0) parts.push(`removed ${removed.join(', ')}`)
      return parts.length > 0 ? parts.join('; ') : `changed ${label}`
    }
    return `changed ${label} from "${fromNames.join(', ')}" to "${toNames.join(', ')}"`
  }
  if (from == null) return `set ${label} to "${to}"`
  if (to == null) return `cleared ${label} (was "${from}")`
  return `changed ${label} from "${from}" to "${to}"`
}

export function HistoryList({ mediaId }: { mediaId: string }) {
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    fetch(`/api/media/${mediaId}/history`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setEntries(d.entries))
      .catch(() => setError(true))
  }, [mediaId])

  if (error) return <p className="text-lg text-red-700">Couldn&apos;t load history — refresh to try again.</p>
  if (entries === null) return <p className="text-lg">Loading…</p>
  if (entries.length === 0) return <p className="text-lg">No changes recorded yet.</p>

  return (
    <ol className="grid max-w-2xl gap-4">
      {entries.map((e) => {
        const when = new Date(e.createdAt).toLocaleString()
        let lines: string[]
        if (e.action === 'CREATE') lines = ['added this item']
        else if (e.action === 'DELETE') lines = ['deleted this item']
        else if ('deletedAt' in e.changes && e.changes.deletedAt.to === null) lines = ['restored this item']
        else lines = Object.entries(e.changes).map(([f, { from, to }]) => fieldSentence(f, from, to))
        return (
          <li key={e.id} className="rounded-xl border p-4 text-lg">
            <span className="font-semibold">{e.user.name}</span>{' '}
            {lines.join('; ')}
            <div className="mt-1 text-sm text-black/60">{when}</div>
          </li>
        )
      })}
    </ol>
  )
}
