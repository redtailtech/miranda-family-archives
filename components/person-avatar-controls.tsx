'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { MediaItemDTO } from '@/lib/media'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const MAX_AVATAR_BYTES = 5 * 1024 * 1024

/**
 * Photo-pick modal for "Choose from their photos". Fetches
 * `/api/media?personId={id}` and mirrors AddPhotosModal's modal/grid idiom.
 */
function PickFromPhotosModal({
  personId,
  onClose,
  onPicked,
}: {
  personId: string
  onClose: () => void
  onPicked: () => void
}) {
  const [items, setItems] = useState<MediaItemDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [errored, setErrored] = useState(false)
  const [pickingId, setPickingId] = useState<string | null>(null)
  const [pickError, setPickError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(`/api/media?personId=${personId}`)
        if (!res.ok) throw new Error()
        const data = await res.json()
        if (!cancelled) setItems((data.items as MediaItemDTO[]).filter((i) => i.status === 'READY'))
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
  }, [personId])

  async function pick(item: MediaItemDTO) {
    setPickingId(item.id)
    setPickError('')
    try {
      const res = await fetch(`/api/people/${personId}/avatar`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mediaId: item.id }),
      })
      if (res.ok) {
        onPicked()
      } else {
        let msg = `HTTP ${res.status}`
        try {
          msg = (await res.json()).error ?? msg
        } catch {}
        setPickError(msg)
      }
    } catch {
      setPickError("Couldn't save — check your connection and try again.")
    } finally {
      setPickingId(null)
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[85vh] w-full max-w-3xl overflow-auto rounded-xl bg-white p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-2xl font-bold">Choose from their photos</h2>
          <button type="button" onClick={onClose} className="rounded-xl border px-4 py-2 text-lg">
            Close
          </button>
        </div>
        {loading && <p className="text-xl">Loading…</p>}
        {errored && <p className="text-lg text-red-700">Couldn&apos;t load photos — try again.</p>}
        {pickError && <p className="mb-4 text-lg text-red-700">{pickError}</p>}
        {!loading && !errored && items.length === 0 && <p className="text-xl">Tag them in a photo first.</p>}
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-5">
          {items.map((item) => (
            <button
              type="button"
              key={item.id}
              onClick={() => pick(item)}
              disabled={pickingId === item.id}
              className="relative aspect-square overflow-hidden rounded-xl bg-black/5 disabled:opacity-70"
            >
              {item.thumbUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.thumbUrl}
                  alt={item.title ?? item.originalFilename}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="flex h-full items-center justify-center p-1 text-center text-xs">Processing…</span>
              )}
              {pickingId === item.id && (
                <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-sm text-white">
                  Saving…
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/** "Change photo" menu near the profile-page avatar: upload / pick-from-tagged-photos / clear-to-silhouette. */
export function PersonAvatarControls({ personId, tagCount }: { personId: string; tagCount: number }) {
  const router = useRouter()
  const [menuOpen, setMenuOpen] = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function uploadFile(file: File) {
    setError('')
    if (file.size > MAX_AVATAR_BYTES) {
      setError('That photo is too large (max 5MB).')
      return
    }
    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file.')
      return
    }
    setBusy(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(`/api/people/${personId}/avatar`, { method: 'POST', body: form })
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
      setError("Couldn't save — check your connection and try again.")
    } finally {
      setBusy(false)
    }
  }

  async function clearAvatar() {
    setError('')
    setBusy(true)
    try {
      const res = await fetch(`/api/people/${personId}/avatar`, { method: 'DELETE' })
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
      setError("Couldn't save — check your connection and try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="relative inline-block">
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" disabled={busy}>
            {busy ? 'Saving…' : 'Change photo'}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[14rem]">
          <DropdownMenuItem onSelect={() => fileInputRef.current?.click()}>
            Upload a photo
          </DropdownMenuItem>
          {tagCount > 0 && (
            <DropdownMenuItem onSelect={() => setShowPicker(true)}>
              Choose from their photos
            </DropdownMenuItem>
          )}
          <DropdownMenuItem variant="destructive" onSelect={clearAvatar}>
            Use silhouette
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) uploadFile(file)
        }}
      />

      {error && <p className="mt-2 max-w-xs text-base text-red-700">{error}</p>}

      {showPicker && (
        <PickFromPhotosModal
          personId={personId}
          onClose={() => setShowPicker(false)}
          onPicked={() => {
            setShowPicker(false)
            router.refresh()
          }}
        />
      )}
    </span>
  )
}
