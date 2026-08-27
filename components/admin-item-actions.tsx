'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useConfirm } from '@/components/confirm-dialog'

export function AdminItemActions({ id, deleted }: { id: string; deleted: boolean }) {
  const router = useRouter()
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function act(method: 'DELETE' | 'restore') {
    if (method === 'DELETE') {
      const ok = await confirm({
        title: 'Delete this item?',
        body: 'Move this item to Deleted items? An admin can restore it later.',
        actionLabel: 'Delete',
        destructive: true,
      })
      if (!ok) return
    }
    setBusy(true)
    try {
      const res = await fetch(method === 'DELETE' ? `/api/media/${id}` : `/api/media/${id}/restore`, {
        method: method === 'DELETE' ? 'DELETE' : 'POST',
      })
      setBusy(false)
      if (res.ok) {
        if (method === 'DELETE') router.push('/')
        else router.refresh()
      } else {
        let msg = `HTTP ${res.status}`
        try { msg = (await res.json()).error ?? msg } catch {}
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
        <button onClick={() => act('restore')} disabled={busy} className="rounded-xl border border-green-700 px-5 py-3 text-lg text-green-700 disabled:opacity-50">
          Restore
        </button>
      ) : (
        <button onClick={() => act('DELETE')} disabled={busy} className="rounded-xl border border-red-700 px-5 py-3 text-lg text-red-700 disabled:opacity-50">
          Delete
        </button>
      )}
      {error && <span className="text-red-700">{error}</span>}
    </span>
  )
}
