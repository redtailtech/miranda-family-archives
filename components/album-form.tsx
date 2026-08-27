'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { AlbumDTO } from '@/lib/albums'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

export function AlbumForm({
  album,
  onSaved,
  onCancel,
}: {
  album?: AlbumDTO
  onSaved?: () => void
  onCancel?: () => void
}) {
  const router = useRouter()
  const [name, setName] = useState(album?.name ?? '')
  const [description, setDescription] = useState(album?.description ?? '')
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [error, setError] = useState('')

  async function save() {
    const trimmedName = name.trim()
    if (!trimmedName) {
      setState('error')
      setError('Name is required')
      return
    }
    setState('saving')
    try {
      if (album) {
        const body: Record<string, string | null> = {}
        const norm = (s: string) => s.trim() || null
        if (trimmedName !== album.name) body.name = trimmedName
        if (norm(description) !== album.description) body.description = norm(description)
        if (Object.keys(body).length === 0) {
          setState('saved')
          onSaved?.()
          return
        }
        const res = await fetch(`/api/albums/${album.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (res.ok) {
          setState('saved')
          router.refresh()
          onSaved?.()
        } else {
          setState('error')
          let msg = `HTTP ${res.status}`
          try {
            msg = (await res.json()).error ?? msg
          } catch {}
          setError(msg)
        }
      } else {
        const res = await fetch('/api/albums', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: trimmedName, description: description.trim() || undefined }),
        })
        if (res.ok) {
          const data = await res.json()
          setState('saved')
          router.push(`/albums/${data.id}`)
        } else {
          setState('error')
          let msg = `HTTP ${res.status}`
          try {
            msg = (await res.json()).error ?? msg
          } catch {}
          setError(msg)
        }
      }
    } catch {
      setState('error')
      setError("Couldn't save — check your connection and try again.")
    }
  }

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
    >
      <Label className="grid gap-1 text-lg">
        Name
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Summer in Hilo"
          autoFocus
        />
      </Label>
      <Label className="grid gap-1 text-lg">
        Description
        <Textarea
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional"
        />
      </Label>
      <div className="flex items-center gap-4">
        <Button type="submit" disabled={state === 'saving'}>
          {state === 'saving' ? 'Saving…' : album ? 'Save changes' : 'Create album'}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
        {state === 'error' && <span className="text-lg text-red-700">{error}</span>}
      </div>
    </form>
  )
}
