'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function RetryButton({ id }: { id: string }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function retry() {
    setPending(true)
    setError(null)
    try {
      const res = await fetch(`/api/media/${id}/retry`, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setError(data?.error ?? 'Retry failed')
        return
      }
      router.refresh()
    } catch {
      setError('Retry failed')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={retry}
        disabled={pending}
        className="rounded-xl border px-6 py-3 text-lg disabled:opacity-50"
      >
        {pending ? 'Retrying…' : 'Retry processing'}
      </button>
      {error && <p className="text-red-700">{error}</p>}
    </div>
  )
}
