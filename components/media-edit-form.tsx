'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { MediaItemDTO } from '@/lib/media'

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

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
    if (y !== item.dateYear) body.dateYear = y
    if (m !== item.dateMonth) body.dateMonth = m
    if (d !== item.dateDay) body.dateDay = d
    if (approx !== item.dateIsApproximate) body.dateIsApproximate = approx
    if (Object.keys(body).length === 0) { setState('saved'); return }
    const res = await fetch(`/api/media/${item.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) { setState('saved'); router.refresh() }
    else { setState('error'); setError((await res.json()).error ?? `HTTP ${res.status}`) }
  }

  const inputCls = 'w-full rounded-lg border px-4 py-3 text-lg'
  return (
    <form className="grid max-w-xl gap-4" onSubmit={(e) => { e.preventDefault(); save() }}>
      <label className="grid gap-1 text-lg">Title
        <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Grandma at the lake house" />
      </label>
      <label className="grid gap-1 text-lg">Description
        <textarea className={inputCls} rows={4} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Who, what, where — tell the story" />
      </label>
      <label className="grid gap-1 text-lg">Location
        <input className={inputCls} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Hilo, Hawaii" />
      </label>
      <fieldset className="grid gap-2">
        <legend className="text-lg">When was this? Fill in what you know.</legend>
        <div className="flex flex-wrap gap-3">
          <input className="w-28 rounded-lg border px-4 py-3 text-lg" inputMode="numeric" maxLength={4} placeholder="Year" value={year}
            onChange={(e) => { const v = e.target.value.replace(/\D/g, ''); setYear(v); if (!v) { setMonth(''); setDay('') } }} />
          <select className="rounded-lg border px-4 py-3 text-lg" value={month} disabled={!year}
            onChange={(e) => { setMonth(e.target.value); if (!e.target.value) setDay('') }}>
            <option value="">Month (optional)</option>
            {MONTHS.map((name, i) => <option key={name} value={i + 1}>{name}</option>)}
          </select>
          <select className="rounded-lg border px-4 py-3 text-lg" value={day} disabled={!month} onChange={(e) => setDay(e.target.value)}>
            <option value="">Day (optional)</option>
            {Array.from({ length: 31 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-2 text-lg">
          <input type="checkbox" className="h-5 w-5" checked={approx} onChange={(e) => setApprox(e.target.checked)} />
          This date is approximate
        </label>
      </fieldset>
      <div className="flex items-center gap-4">
        <button type="submit" disabled={state === 'saving'} className="rounded-xl bg-black px-6 py-3 text-lg text-white disabled:opacity-50">
          {state === 'saving' ? 'Saving…' : 'Save details'}
        </button>
        {state === 'saved' && <span className="text-lg text-green-700">Saved ✓</span>}
        {state === 'error' && <span className="text-lg text-red-700">{error}</span>}
      </div>
    </form>
  )
}
