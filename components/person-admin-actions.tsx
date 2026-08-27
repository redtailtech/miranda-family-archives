'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useConfirm } from '@/components/confirm-dialog'

/**
 * Person variant of AdminItemActions — same delete/restore idiom, pointed at
 * /api/people/[id] instead of /api/media/[id]. Kept as its own component
 * rather than modifying AdminItemActions.
 */
export function PersonAdminActions({ id, deleted }: { id: string; deleted: boolean }) {
  const router = useRouter()
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function act(method: 'DELETE' | 'restore') {
    if (method === 'DELETE') {
      const ok = await confirm({
        title: 'Delete this person?',
        body: 'Move this person to Deleted people? An admin can restore them later.',
        actionLabel: 'Delete',
        destructive: true,
      })
      if (!ok) return
    }
    setBusy(true)
    try {
      const res = await fetch(method === 'DELETE' ? `/api/people/${id}` : `/api/people/${id}/restore`, {
        method: method === 'DELETE' ? 'DELETE' : 'POST',
      })
      setBusy(false)
      if (res.ok) {
        if (method === 'DELETE') router.push('/tree')
        else router.refresh()
      } else {
        let msg = `HTTP ${res.status}`
        try {
          msg = (await res.json()).error ?? msg
        } catch {}
        setError(msg)
      }
    } catch {
      setBusy(false)
      setError("Couldn't save — check your connection and try again.")
    }
  }

  return (
    <span className="flex items-center gap-3">
      {deleted ? (
        <button
          onClick={() => act('restore')}
          disabled={busy}
          className="rounded-xl border border-green-700 px-5 py-3 text-lg text-green-700 disabled:opacity-50"
        >
          Restore
        </button>
      ) : (
        <button
          onClick={() => act('DELETE')}
          disabled={busy}
          className="rounded-xl border border-red-700 px-5 py-3 text-lg text-red-700 disabled:opacity-50"
        >
          Delete
        </button>
      )}
      {error && <span className="text-red-700">{error}</span>}
    </span>
  )
}
