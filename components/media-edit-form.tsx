'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { MediaItemDTO } from '@/lib/media'
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

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

// Radix Select forbids an empty-string item value, so the "(optional) —
// clear the field" option needs a sentinel that's translated back to '' at
// the state boundary. External behavior (month/day can be reset to unset
// via the dropdown, which also clears day) is unchanged from the native
// <select> version.
const UNSET = '__unset__'

export function MediaEditForm({ item }: { item: MediaItemDTO }) {
  const router = useRouter()
  const [title, setTitle] = useState(item.title ?? '')
  const [description, setDescription] = useState(item.description ?? '')
  const [location, setLocation] = useState(item.location ?? '')
  const [year, setYear] = useState(item.dateYear?.toString() ?? '')
  const [month, setMonth] = useState(item.dateMonth?.toString() ?? '')
  const [day, setDay] = useState(item.dateDay?.toString() ?? '')
  const [approx, setApprox] = useState(item.dateIsApproximate)
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [error, setError] = useState('')

  async function save() {
    setState('saving')
    const body: Record<string, string | number | boolean | null> = {}
    const norm = (s: string) => s.trim() || null
    if (norm(title) !== item.title) body.title = norm(title)
    if (norm(description) !== item.description) body.description = norm(description)
    if (norm(location) !== item.location) body.location = norm(location)
    const y = year ? Number(year) : null
    const m = year && month ? Number(month) : null
    const d = year && month && day ? Number(day) : null
    if (year && year.length !== 4) {
      setState('error')
      setError('Please enter a 4-digit year')
      return
    }
    if (y !== item.dateYear) body.dateYear = y
    if (m !== item.dateMonth) body.dateMonth = m
    if (d !== item.dateDay) body.dateDay = d
    if (approx !== item.dateIsApproximate) body.dateIsApproximate = approx
    if (Object.keys(body).length === 0) { setState('saved'); return }
    try {
      const res = await fetch(`/api/media/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) { setState('saved'); router.refresh() }
      else {
        setState('error')
        let msg = `HTTP ${res.status}`
        try { msg = (await res.json()).error ?? msg } catch {}
        setError(msg)
      }
    } catch {
      setState('error')
      setError("Couldn't save — check your connection and try again.")
    }
  }

  return (
    <form className="grid max-w-xl gap-4" onSubmit={(e) => { e.preventDefault(); save() }}>
      <Label className="grid gap-1 text-lg">Title
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Grandma at the lake house" />
      </Label>
      <Label className="grid gap-1 text-lg">Description
        <Textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Who, what, where — tell the story" />
      </Label>
      <Label className="grid gap-1 text-lg">Location
        <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Hilo, Hawaii" />
      </Label>
      <fieldset className="grid gap-2">
        <legend className="text-lg">When was this? Fill in what you know.</legend>
        <div className="flex flex-wrap gap-3">
          <Input className="w-28" inputMode="numeric" maxLength={4} placeholder="Year" value={year}
            onChange={(e) => { const v = e.target.value.replace(/\D/g, ''); setYear(v); if (!v) { setMonth(''); setDay('') } }} />
          <Select
            value={month || UNSET}
            onValueChange={(v) => { const next = v === UNSET ? '' : v; setMonth(next); if (!next) setDay('') }}
            disabled={!year}
          >
            <SelectTrigger>
              <SelectValue placeholder="Month (optional)" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNSET}>Month (optional)</SelectItem>
              {MONTHS.map((name, i) => <SelectItem key={name} value={String(i + 1)}>{name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={day || UNSET} onValueChange={(v) => setDay(v === UNSET ? '' : v)} disabled={!month}>
            <SelectTrigger>
              <SelectValue placeholder="Day (optional)" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNSET}>Day (optional)</SelectItem>
              {Array.from({ length: 31 }, (_, i) => <SelectItem key={i + 1} value={String(i + 1)}>{i + 1}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <label className="flex items-center gap-2 text-lg">
          <input type="checkbox" className="h-5 w-5" checked={approx} onChange={(e) => setApprox(e.target.checked)} />
          This date is approximate
        </label>
      </fieldset>
      <div className="flex items-center gap-4">
        <Button type="submit" disabled={state === 'saving'}>
          {state === 'saving' ? 'Saving…' : 'Save details'}
        </Button>
        {state === 'saved' && <span className="text-lg text-green-700">Saved ✓</span>}
        {state === 'error' && <span className="text-lg text-red-700">{error}</span>}
      </div>
    </form>
  )
}
