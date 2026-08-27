'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { PersonDTO } from '@/lib/people'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type Gender = 'MALE' | 'FEMALE' | 'UNSPECIFIED'

const GENDER_LABELS: Record<Gender, string> = {
  UNSPECIFIED: 'Unspecified',
  MALE: 'Male',
  FEMALE: 'Female',
}

/**
 * Create/edit form for a person. With no `person`, it's always in edit mode
 * (used for "Add person"). With a `person`, it starts collapsed to a
 * read-only "About" view + Edit button, and expands into the form idiom
 * shared with MediaEditForm/AlbumForm — flipping back to the read-only view
 * on save or cancel.
 */
export function PersonForm({
  person,
  onSaved,
  onCancel,
}: {
  person?: PersonDTO
  onSaved?: () => void
  onCancel?: () => void
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(!person)
  const [displayName, setDisplayName] = useState(person?.displayName ?? '')
  const [maidenName, setMaidenName] = useState(person?.maidenName ?? '')
  const [gender, setGender] = useState<Gender>(person?.gender ?? 'UNSPECIFIED')
  const [birthYear, setBirthYear] = useState(person?.birthYear?.toString() ?? '')
  const [deathYear, setDeathYear] = useState(person?.deathYear?.toString() ?? '')
  const [birthplace, setBirthplace] = useState(person?.birthplace ?? '')
  const [notes, setNotes] = useState(person?.notes ?? '')
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [error, setError] = useState('')

  function resetFromPerson() {
    if (!person) return
    setDisplayName(person.displayName)
    setMaidenName(person.maidenName ?? '')
    setGender(person.gender)
    setBirthYear(person.birthYear?.toString() ?? '')
    setDeathYear(person.deathYear?.toString() ?? '')
    setBirthplace(person.birthplace ?? '')
    setNotes(person.notes ?? '')
    setError('')
    setState('idle')
  }

  async function save() {
    const trimmedName = displayName.trim()
    if (!trimmedName) {
      setState('error')
      setError('Name is required')
      return
    }
    if (birthYear && birthYear.length !== 4) {
      setState('error')
      setError('Please enter a 4-digit birth year')
      return
    }
    if (deathYear && deathYear.length !== 4) {
      setState('error')
      setError('Please enter a 4-digit death year')
      return
    }

    const norm = (s: string) => s.trim() || null
    const by = birthYear ? Number(birthYear) : null
    const dy = deathYear ? Number(deathYear) : null

    setState('saving')
    try {
      if (person) {
        const body: Record<string, string | number | null> = {}
        if (trimmedName !== person.displayName) body.displayName = trimmedName
        if (norm(maidenName) !== person.maidenName) body.maidenName = norm(maidenName)
        if (gender !== person.gender) body.gender = gender
        if (by !== person.birthYear) body.birthYear = by
        if (dy !== person.deathYear) body.deathYear = dy
        if (norm(birthplace) !== person.birthplace) body.birthplace = norm(birthplace)
        if (norm(notes) !== person.notes) body.notes = norm(notes)

        if (Object.keys(body).length === 0) {
          setState('idle')
          setEditing(false)
          onSaved?.()
          return
        }

        const res = await fetch(`/api/people/${person.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (res.ok) {
          setState('idle')
          setEditing(false)
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
        const res = await fetch('/api/people', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            displayName: trimmedName,
            maidenName: norm(maidenName),
            gender,
            birthYear: by,
            deathYear: dy,
            birthplace: norm(birthplace),
            notes: norm(notes),
          }),
        })
        if (res.ok) {
          const data = await res.json()
          setState('saved')
          router.push(`/people/${data.id}`)
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

  function cancel() {
    if (person) {
      resetFromPerson()
      setEditing(false)
    }
    onCancel?.()
  }

  if (person && !editing) {
    return (
      <div>
        <h2 className="mb-2 text-2xl font-bold">About</h2>
        {person.notes ? (
          <p className="whitespace-pre-wrap text-lg">{person.notes}</p>
        ) : (
          <p className="text-lg text-black/60">No notes yet.</p>
        )}
        <Button type="button" variant="outline" onClick={() => setEditing(true)} className="mt-4">
          Edit details
        </Button>
      </div>
    )
  }

  return (
    <form
      className="grid max-w-xl gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
    >
      <Label className="grid gap-1 text-lg">
        Name
        <Input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="e.g. Maria Miranda"
          autoFocus
        />
      </Label>
      <Label className="grid gap-1 text-lg">
        Maiden name
        <Input
          value={maidenName}
          onChange={(e) => setMaidenName(e.target.value)}
          placeholder="Optional"
        />
      </Label>
      <Label className="grid gap-1 text-lg">
        Gender
        <Select value={gender} onValueChange={(v) => setGender(v as Gender)}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(GENDER_LABELS) as Gender[]).map((g) => (
              <SelectItem key={g} value={g}>{GENDER_LABELS[g]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Label>
      <div className="flex flex-wrap gap-4">
        <Label className="grid gap-1 text-lg">
          Birth year
          <Input
            className="w-32"
            inputMode="numeric"
            maxLength={4}
            placeholder="e.g. 1950"
            value={birthYear}
            onChange={(e) => setBirthYear(e.target.value.replace(/\D/g, ''))}
          />
        </Label>
        <Label className="grid gap-1 text-lg">
          Death year
          <Input
            className="w-32"
            inputMode="numeric"
            maxLength={4}
            placeholder="Optional"
            value={deathYear}
            onChange={(e) => setDeathYear(e.target.value.replace(/\D/g, ''))}
          />
        </Label>
      </div>
      <Label className="grid gap-1 text-lg">
        Birthplace
        <Input
          value={birthplace}
          onChange={(e) => setBirthplace(e.target.value)}
          placeholder="e.g. Hilo, Hawaii"
        />
      </Label>
      <Label className="grid gap-1 text-lg">
        Notes
        <Textarea
          rows={4}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Anything worth remembering"
        />
      </Label>
      <div className="flex items-center gap-4">
        <Button type="submit" disabled={state === 'saving'}>
          {state === 'saving' ? 'Saving…' : person ? 'Save changes' : 'Add person'}
        </Button>
        {(onCancel || person) && (
          <Button type="button" variant="outline" onClick={cancel}>
            Cancel
          </Button>
        )}
        {state === 'error' && <span className="text-lg text-red-700">{error}</span>}
      </div>
    </form>
  )
}
