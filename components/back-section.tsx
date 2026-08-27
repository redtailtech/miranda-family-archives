'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { MediaItemDTO } from '@/lib/media'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Uploader } from '@/components/uploader'
import { useConfirm } from '@/components/confirm-dialog'

/**
 * Rendered on a front photo's detail page (PHOTO + READY + not itself a
 * back). Shows the attached back if there is one, with a way to remove it;
 * otherwise offers two ways to attach one — upload a new photo as the back,
 * or link an existing archive photo.
 */
export function BackSection({ item }: { item: MediaItemDTO }) {
  const router = useRouter()
  const confirm = useConfirm()
  const [removing, setRemoving] = useState(false)
  const [removeError, setRemoveError] = useState('')

  async function handleRemove() {
    const ok = await confirm({
      title: 'Remove the back of this photo?',
      body: "The back image stays in the archive — it just won't be attached to this photo anymore.",
      actionLabel: 'Remove',
      destructive: true,
    })
    if (!ok) return
    setRemoving(true)
    setRemoveError('')
    try {
      const res = await fetch(`/api/media/${item.id}/back`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setRemoveError(data.error ?? `HTTP ${res.status}`)
        setRemoving(false)
        return
      }
      router.refresh()
    } catch {
      setRemoveError("Couldn't remove the back — check your connection and try again.")
      setRemoving(false)
    }
  }

  if (item.back) {
    const back = item.back
    // The back occupies the slot the moment it's attached, whatever state
    // it's in — surface it (and let it be removed) whether it's still
    // processing, failed, or ready, rather than only showing/removable once
    // READY. This is also what makes onUploaded's router.refresh() show
    // useful feedback instead of silently re-inviting an add.
    return (
      <div className="mt-6 rounded-xl border bg-surface p-4">
        <h2 className="mb-3 text-2xl font-bold">Back of this photo</h2>
        <div className="flex flex-wrap items-center gap-4">
          {back.status === 'READY' ? (
            <Link href={`/media/${back.id}`} className="block shrink-0">
              {back.thumbUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={back.thumbUrl}
                  alt={back.title ?? back.filename}
                  className="h-24 min-h-24 w-24 min-w-24 rounded-lg object-cover"
                />
              ) : (
                <span className="flex h-24 min-h-24 w-24 min-w-24 items-center justify-center rounded-lg bg-wash text-base text-ink-soft">
                  No preview
                </span>
              )}
            </Link>
          ) : back.status === 'FAILED' ? (
            <p className="flex-1 text-lg">The back photo failed to process.</p>
          ) : (
            <p className="flex-1 text-lg">The back is still processing — check back in a minute.</p>
          )}
          <Button variant="destructive" onClick={handleRemove} disabled={removing}>
            {removing ? 'Removing…' : 'Remove the back'}
          </Button>
        </div>
        {removeError && <p className="mt-3 text-lg text-red-700">{removeError}</p>}
      </div>
    )
  }

  return (
    <div className="mt-6 rounded-xl border bg-surface p-4">
      <h2 className="mb-3 text-2xl font-bold">Add the back of this photo</h2>
      <Uploader backOfId={item.id} maxFiles={1} onUploaded={() => router.refresh()} />
      <LinkExistingBack frontId={item.id} onLinked={() => router.refresh()} />
    </div>
  )
}

function LinkExistingBack({ frontId, onLinked }: { frontId: string; onLinked: () => void }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [results, setResults] = useState<MediaItemDTO[]>([])
  const [loading, setLoading] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [linkError, setLinkError] = useState('')
  const [linkingId, setLinkingId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const query = q.trim()
    if (!query) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting search results for an emptied query, not synchronizing with an external system
      setResults([])
      setSearchError('')
      return
    }
    const timeout = setTimeout(async () => {
      setLoading(true)
      setSearchError('')
      try {
        const res = await fetch(`/api/media?q=${encodeURIComponent(query)}`)
        if (!res.ok) {
          setSearchError(`HTTP ${res.status}`)
          setResults([])
          return
        }
        const data = await res.json()
        const items: MediaItemDTO[] = data.items ?? []
        setResults(items.filter((i) => i.id !== frontId && i.type === 'PHOTO' && !i.backOfId))
      } catch {
        setSearchError("Couldn't search — check your connection and try again.")
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 300)
    return () => clearTimeout(timeout)
  }, [q, open, frontId])

  async function attachAsBack(backItemId: string) {
    setLinkingId(backItemId)
    setLinkError('')
    try {
      const res = await fetch(`/api/media/${frontId}/back`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backItemId }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setLinkError(data.error ?? `HTTP ${res.status}`)
        setLinkingId(null)
        return
      }
      onLinked()
    } catch {
      setLinkError("Couldn't link the back — check your connection and try again.")
      setLinkingId(null)
    }
  }

  return (
    <div className="mt-4">
      <Button type="button" variant="outline" onClick={() => setOpen((v) => !v)}>
        {open ? 'Cancel' : 'Link a photo already in the archive'}
      </Button>
      {open && (
        <div className="mt-3">
          <Input
            type="search"
            placeholder="Search titles, descriptions, locations…"
            aria-label="Search the archive for a back photo"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {loading && <p className="mt-2 text-lg">Searching…</p>}
          {searchError && <p className="mt-2 text-lg text-red-700">{searchError}</p>}
          {linkError && <p className="mt-2 text-lg text-red-700">{linkError}</p>}
          {!loading && !searchError && q.trim() && results.length === 0 && (
            <p className="mt-2 text-lg">No matching photos found.</p>
          )}
          {results.length > 0 && (
            <ul className="mt-3 grid gap-2">
              {results.map((r) => (
                <li key={r.id} className="flex items-center gap-3 rounded-xl border bg-paper p-3">
                  {r.thumbUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={r.thumbUrl}
                      alt={r.title ?? r.originalFilename}
                      className="h-16 min-h-16 w-16 min-w-16 shrink-0 rounded-lg object-cover"
                    />
                  ) : (
                    <span className="flex h-16 min-h-16 w-16 min-w-16 shrink-0 items-center justify-center rounded-lg bg-wash text-sm text-ink-soft">
                      No preview
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-lg">{r.title ?? r.originalFilename}</span>
                  <Button type="button" onClick={() => attachAsBack(r.id)} disabled={linkingId === r.id}>
                    {linkingId === r.id ? 'Linking…' : 'Use as back'}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
