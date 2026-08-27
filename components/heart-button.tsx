'use client'

import { useState } from 'react'

export function HeartButton({
  mediaId,
  initialCount,
  initialHearted,
}: {
  mediaId: string
  initialCount: number
  initialHearted: boolean
}) {
  const [hearted, setHearted] = useState(initialHearted)
  const [count, setCount] = useState(initialCount)
  const [busy, setBusy] = useState(false)

  async function toggle() {
    if (busy) return
    const nextHearted = !hearted
    const prevHearted = hearted
    const prevCount = count
    setBusy(true)
    setHearted(nextHearted)
    setCount((c) => c + (nextHearted ? 1 : -1))
    try {
      const res = await fetch(`/api/media/${mediaId}/heart`, { method: nextHearted ? 'POST' : 'DELETE' })
      if (!res.ok) {
        setHearted(prevHearted)
        setCount(prevCount)
        return
      }
      const data = await res.json()
      if (typeof data?.heartCount === 'number') setCount(data.heartCount)
    } catch {
      setHearted(prevHearted)
      setCount(prevCount)
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-pressed={hearted}
      aria-label={`${hearted ? 'Remove heart' : 'Heart this item'} — ${count} hearts`}
      className="rounded-xl border px-5 py-3 text-2xl disabled:opacity-50"
    >
      {hearted ? '❤️' : '🤍'} {count}
    </button>
  )
}
