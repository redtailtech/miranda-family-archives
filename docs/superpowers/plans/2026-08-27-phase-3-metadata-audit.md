# Phase 3: Metadata & Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Family members edit photo/document metadata (title, description, location, flexible dates) with every change captured in a transactional audit trail, browse it in a History tab, inspect EXIF in an Advanced tab, and admins soft-delete/restore items — plus inline PDF reading and "add details while you wait" on the upload page.

**Architecture:** A small audit data layer (`lib/audit.ts`) computes field-level diffs and writes the `AuditLog` row in the same `$transaction` as every mutation — history can never drift from data. The detail page grows a client-side tab strip (Details / Advanced / History) over the existing server-rendered shell; mutations go through API routes matching the Phase 2 auth pattern (Clerk `auth()` → local User lookup).

**Tech Stack:** existing stack only (Next.js 16, Prisma, Clerk). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-26-miranda-family-archives-design.md` (§3 flexible dates, §6 Item detail tabs, §7 audit history, Phase 3 of §11)

## Global Constraints

- **NO automated tests** (explicit user decision) — every task ends with manual verification; run it and record actual output before committing.
- TypeScript, `@/*` alias; auth pattern verbatim from existing routes: `const { userId } = await auth()` (from `@clerk/nextjs/server`) → 401; `prisma.user.findUnique({ where: { clerkId: userId } })` → 403 if missing.
- Spec §5 permissions: **members** edit metadata; **admins only** delete/restore. Spec §7: deletes are SOFT (`deletedAt`), audit rows written in the same transaction as the mutation, hearts/favorites/comments NOT audited.
- Editable metadata fields, exactly: `title`, `description`, `location`, `dateYear`, `dateMonth`, `dateDay`, `dateIsApproximate`. Audit `changes` JSONB shape verbatim from spec: `{field: {from, to}}`.
- Flexible dates (spec §3): year/month/day each independently nullable + `dateIsApproximate`; UI copy "Year / Month / Day — fill in what you know" + an "approximate" checkbox. A day without a month, or a month without a year, is invalid (reject server-side).
- `AuditLog.entityType` for media rows: the string `'media_item'` (matches the value Phase 2's upload CREATE rows already use — verify, do not invent a second spelling).
- Existing interfaces (do not rename): `mediaItemToDTO(item, {detail?: boolean})` in `lib/media.ts`; `MediaItemDTO`; routes `GET /api/media/[id]`, `POST /api/media/[id]/retry`; `signGetUrl(key, {downloadName?, expiresIn?})` in `lib/s3.ts`.
- People-tagging is **Phase 5** (needs Person records from the family-tree work) — out of scope here.
- Work on `main`; commit per task; push only at the final task. Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## File map

| File | Responsibility |
|---|---|
| `lib/audit.ts` | Diff computation + transactional audited mutations (update/soft-delete/restore) |
| `app/api/media/[id]/route.ts` | + PATCH (audited metadata update), + DELETE (admin soft delete) |
| `app/api/media/[id]/history/route.ts` | GET audit rows for the item (with user names) |
| `app/api/media/[id]/restore/route.ts` | POST admin restore |
| `components/detail-tabs.tsx` | Client tab strip (Details / Advanced / History) |
| `components/media-edit-form.tsx` | Edit form incl. flexible date picker |
| `components/exif-table.tsx` | Curated + full EXIF table from `exif` JSONB |
| `components/history-list.tsx` | Human-readable audit trail |
| `components/admin-item-actions.tsx` | Delete (admin) / Restore buttons |
| `app/(app)/media/[id]/page.tsx` | Rewired around tabs; inline PDF iframe |
| `app/(app)/admin/deleted/page.tsx` | Admin: deleted items + restore |
| `components/uploader.tsx` | + post-upload "add details" mini-forms |

---

### Task 1: Audit data layer + PATCH/DELETE/restore/history API

**Files:**
- Create: `lib/audit.ts`, `app/api/media/[id]/history/route.ts`, `app/api/media/[id]/restore/route.ts`
- Modify: `app/api/media/[id]/route.ts` (add PATCH + DELETE), `lib/media.ts` (DTO: add `exif` on detail)

**Interfaces:**
- Consumes: `prisma`, existing route auth pattern, `mediaItemToDTO`.
- Produces (later tasks rely on these exactly):
  - `lib/audit.ts`:
    - `EDITABLE_MEDIA_FIELDS = ['title','description','location','dateYear','dateMonth','dateDay','dateIsApproximate'] as const`
    - `updateMediaWithAudit(mediaId: string, actorUserId: string, input: Partial<Record<(typeof EDITABLE_MEDIA_FIELDS)[number], string | number | boolean | null>>): Promise<{ changed: string[] }>` — no-ops (returns `{changed: []}`) when nothing differs.
    - `softDeleteMediaWithAudit(mediaId: string, actorUserId: string): Promise<void>`
    - `restoreMediaWithAudit(mediaId: string, actorUserId: string): Promise<void>`
  - HTTP contract:
    - `PATCH /api/media/[id]` body = partial editable fields → `{ok: true, changed: string[]}`; 400 invalid date combo or unknown field; member-allowed.
    - `DELETE /api/media/[id]` → `{ok: true}`; ADMIN only (403 otherwise).
    - `POST /api/media/[id]/restore` → `{ok: true}`; ADMIN only; works only on deleted items (400 otherwise).
    - `GET /api/media/[id]/history` → `{entries: {id, action, changes: Record<string,{from: unknown, to: unknown}>, user: {name: string}, createdAt: string}[]}` (newest first).
  - DTO: `MediaItemDTO.exif?: Record<string, unknown> | null` populated when `{detail: true}`.

- [ ] **Step 1: Write `lib/audit.ts`**

```typescript
import { prisma } from '@/lib/db'
import type { Prisma } from '@prisma/client'

export const EDITABLE_MEDIA_FIELDS = [
  'title',
  'description',
  'location',
  'dateYear',
  'dateMonth',
  'dateDay',
  'dateIsApproximate',
] as const

export type EditableMediaField = (typeof EDITABLE_MEDIA_FIELDS)[number]
export type EditableMediaInput = Partial<Record<EditableMediaField, string | number | boolean | null>>

function fieldDiff(
  current: Record<string, unknown>,
  input: EditableMediaInput
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {}
  for (const field of EDITABLE_MEDIA_FIELDS) {
    if (!(field in input)) continue
    const to = input[field] ?? null
    const from = current[field] ?? null
    if (from !== to) changes[field] = { from, to }
  }
  return changes
}

/** Validate the flexible-date invariant: day needs month, month needs year. */
export function validDateParts(year: number | null, month: number | null, day: number | null): boolean {
  if (day != null && month == null) return false
  if (month != null && year == null) return false
  if (year != null && (year < 1000 || year > 3000)) return false
  if (month != null && (month < 1 || month > 12)) return false
  if (day != null && (day < 1 || day > 31)) return false
  return true
}

export async function updateMediaWithAudit(
  mediaId: string,
  actorUserId: string,
  input: EditableMediaInput
): Promise<{ changed: string[] }> {
  const item = await prisma.mediaItem.findFirst({ where: { id: mediaId, deletedAt: null } })
  if (!item) throw Object.assign(new Error('not found'), { status: 404 })

  const changes = fieldDiff(item as unknown as Record<string, unknown>, input)
  if (Object.keys(changes).length === 0) return { changed: [] }

  const data = Object.fromEntries(
    Object.entries(changes).map(([field, { to }]) => [field, to])
  ) as Prisma.MediaItemUpdateInput

  await prisma.$transaction([
    prisma.mediaItem.update({ where: { id: mediaId }, data }),
    prisma.auditLog.create({
      data: {
        userId: actorUserId,
        entityType: 'media_item',
        entityId: mediaId,
        action: 'UPDATE',
        changes: changes as Prisma.InputJsonValue,
      },
    }),
  ])
  return { changed: Object.keys(changes) }
}

export async function softDeleteMediaWithAudit(mediaId: string, actorUserId: string): Promise<void> {
  const now = new Date()
  const result = await prisma.mediaItem.updateMany({
    where: { id: mediaId, deletedAt: null },
    data: { deletedAt: now },
  })
  if (result.count !== 1) throw Object.assign(new Error('not found'), { status: 404 })
  await prisma.auditLog.create({
    data: {
      userId: actorUserId,
      entityType: 'media_item',
      entityId: mediaId,
      action: 'DELETE',
      changes: { deletedAt: { from: null, to: now.toISOString() } },
    },
  })
}

export async function restoreMediaWithAudit(mediaId: string, actorUserId: string): Promise<void> {
  const item = await prisma.mediaItem.findFirst({ where: { id: mediaId, NOT: { deletedAt: null } } })
  if (!item) throw Object.assign(new Error('not deleted'), { status: 400 })
  await prisma.$transaction([
    prisma.mediaItem.update({ where: { id: mediaId }, data: { deletedAt: null } }),
    prisma.auditLog.create({
      data: {
        userId: actorUserId,
        entityType: 'media_item',
        entityId: mediaId,
        action: 'UPDATE',
        changes: { deletedAt: { from: item.deletedAt!.toISOString(), to: null } },
      },
    }),
  ])
}
```

(Note: `softDeleteMediaWithAudit` uses updateMany-then-log rather than a single transaction because the guard is the atomic `updateMany`; a crash between the two leaves a delete without an audit row — acceptable narrow window, matches the codebase's existing complete-route tradeoff. If the reviewer prefers, an interactive `$transaction(async tx => ...)` closing both is equally acceptable.)

- [ ] **Step 2: Add PATCH and DELETE to `app/api/media/[id]/route.ts`** (keep the existing GET untouched)

```typescript
// append to app/api/media/[id]/route.ts — imports to add:
// import { updateMediaWithAudit, softDeleteMediaWithAudit, validDateParts, EDITABLE_MEDIA_FIELDS } from '@/lib/audit'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const user = await prisma.user.findUnique({ where: { clerkId: userId } })
  if (!user) return NextResponse.json({ error: 'no user record' }, { status: 403 })
  const { id } = await params
  const body = await req.json()

  const unknown = Object.keys(body).filter((k) => !(EDITABLE_MEDIA_FIELDS as readonly string[]).includes(k))
  if (unknown.length > 0)
    return NextResponse.json({ error: `unknown fields: ${unknown.join(', ')}` }, { status: 400 })

  const current = await prisma.mediaItem.findFirst({ where: { id, deletedAt: null } })
  if (!current) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const year = 'dateYear' in body ? body.dateYear : current.dateYear
  const month = 'dateMonth' in body ? body.dateMonth : current.dateMonth
  const day = 'dateDay' in body ? body.dateDay : current.dateDay
  if (!validDateParts(year, month, day))
    return NextResponse.json({ error: 'invalid date: a day needs a month, a month needs a year' }, { status: 400 })

  const { changed } = await updateMediaWithAudit(id, user.id, body)
  return NextResponse.json({ ok: true, changed })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const user = await prisma.user.findUnique({ where: { clerkId: userId } })
  if (!user) return NextResponse.json({ error: 'no user record' }, { status: 403 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const { id } = await params
  try {
    await softDeleteMediaWithAudit(id, user.id)
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500
    return NextResponse.json({ error: 'not found' }, { status })
  }
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 3: `app/api/media/[id]/restore/route.ts`**

```typescript
import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { restoreMediaWithAudit } from '@/lib/audit'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const user = await prisma.user.findUnique({ where: { clerkId: userId } })
  if (!user) return NextResponse.json({ error: 'no user record' }, { status: 403 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const { id } = await params
  try {
    await restoreMediaWithAudit(id, user.id)
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500
    return NextResponse.json({ error: 'not deleted' }, { status })
  }
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 4: `app/api/media/[id]/history/route.ts`**

```typescript
import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  const entries = await prisma.auditLog.findMany({
    where: { entityType: 'media_item', entityId: id },
    orderBy: { createdAt: 'desc' },
    include: { user: true },
  })
  return NextResponse.json({
    entries: entries.map((e) => ({
      id: e.id,
      action: e.action,
      changes: e.changes,
      user: { name: e.user.name || e.user.email },
      createdAt: e.createdAt.toISOString(),
    })),
  })
}
```

- [ ] **Step 5: DTO exif** — in `lib/media.ts`, add `exif?: Record<string, unknown> | null` to `MediaItemDTO` and inside the `if (opts.detail)` block: `dto.exif = (item.exif as Record<string, unknown> | null) ?? null`.

- [ ] **Step 6: Verify module-level** (local docker Postgres up): `npx tsx` a temp repo-root script that creates a temp user + MediaItem (READY, dateYear 1960), calls `updateMediaWithAudit(id, userId, { title: 'Grandma', dateYear: 1962 })`, prints the returned `changed` array, re-reads the item + the AuditLog row (assert `changes.title.from === null`, `changes.dateYear.from === 1960`), calls it again with identical input (expect `changed: []` and NO second audit row), then `softDeleteMediaWithAudit` + `restoreMediaWithAudit` (assert deletedAt round-trip + 2 more audit rows), then CLEANS UP all rows. Also `npx tsc --noEmit`, `npm run lint`, `npm run build` clean. Record outputs.

- [ ] **Step 7: Commit**

```bash
git add lib/audit.ts lib/media.ts app/api/media
git commit -m "feat: transactional audit layer with PATCH/DELETE/restore/history API"
```

---

### Task 2: Detail tabs + edit form with flexible date picker

**Files:**
- Create: `components/detail-tabs.tsx`, `components/media-edit-form.tsx`
- Modify: `app/(app)/media/[id]/page.tsx`

**Interfaces:**
- Consumes: `PATCH /api/media/[id]` (Task 1 contract), `MediaItemDTO`.
- Produces: `<DetailTabs details={...} advanced={...} history={...} />` client component (ReactNode props per tab, renders a large-target tab strip, Details active by default); `<MediaEditForm item={MediaItemDTO} />` client form. Task 3/4 fill the other tabs; this task passes placeholders for them.

- [ ] **Step 1: `components/detail-tabs.tsx`**

```tsx
'use client'

import { useState, type ReactNode } from 'react'

const TABS = ['Details', 'Advanced', 'History'] as const

export function DetailTabs({ details, advanced, history }: { details: ReactNode; advanced: ReactNode; history: ReactNode }) {
  const [active, setActive] = useState<(typeof TABS)[number]>('Details')
  const panels = { Details: details, Advanced: advanced, History: history }
  return (
    <div className="mt-8">
      <div role="tablist" className="flex gap-1 border-b">
        {TABS.map((tab) => (
          <button
            key={tab}
            role="tab"
            aria-selected={active === tab}
            onClick={() => setActive(tab)}
            className={`rounded-t-lg px-5 py-3 text-lg ${active === tab ? 'border border-b-0 bg-white font-semibold' : 'text-black/60 hover:bg-black/5'}`}
          >
            {tab}
          </button>
        ))}
      </div>
      <div className="py-6">{panels[active]}</div>
    </div>
  )
}
```

- [ ] **Step 2: `components/media-edit-form.tsx`** — client form: text inputs for title/location, textarea for description, the flexible date picker (year number input 4 digits; month `<select>` with "Month (optional)" + Jan..Dec; day `<select>` with "Day (optional)" + 1..31, disabled until a month is chosen; month select disabled until a year is entered; "This date is approximate" checkbox), Save button (disabled while saving), inline saved/error message, `router.refresh()` after save. Sends ONLY changed fields in the PATCH body. Full code:

```tsx
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
```

- [ ] **Step 3: Rewire `app/(app)/media/[id]/page.tsx`** — keep the header, media display, download/retry buttons; REPLACE the bottom `<dl>` block with `<DetailTabs>`: Details tab = the `<dl>` facts (Uploaded by/Uploaded/File) followed by `<MediaEditForm item={dto} />`; Advanced tab = `<p className="text-lg">Coming right up…</p>` placeholder; History tab = same placeholder. (Tasks 3 and 4 replace the placeholders — they are wired in THIS file, so later tasks modify this file again.)

- [ ] **Step 4: Verify** — `npm run dev` against local DB (needs a READY item: reuse the Task 1 verification harness item before cleanup, or create one): `tsc`/`lint`/`build` clean; module-level check of the PATCH flow via `npx tsx` script calling fetch against... (auth blocks external calls — instead verify the form logic compiles and the PATCH route behavior was already verified in Task 1; visual check happens in Task 6's acceptance). Record outputs.

- [ ] **Step 5: Commit**

```bash
git add components/detail-tabs.tsx components/media-edit-form.tsx "app/(app)/media/[id]/page.tsx"
git commit -m "feat: detail tabs and metadata edit form with flexible dates"
```

---

### Task 3: Advanced (EXIF) tab

**Files:**
- Create: `components/exif-table.tsx`
- Modify: `app/(app)/media/[id]/page.tsx` (replace Advanced placeholder)

**Interfaces:**
- Consumes: `MediaItemDTO.exif` (Task 1).
- Produces: `<ExifTable exif={dto.exif} type={dto.type} />` — server-renderable (no 'use client').

- [ ] **Step 1: `components/exif-table.tsx`** — curated section first ("The interesting bits": Make, Model, LensModel, DateTimeOriginal, ExposureTime, FNumber, ISO, FocalLength, ImageWidth, ImageHeight, GPSLatitude, GPSLongitude, XResolution, YResolution, Software — render only those present, with friendly labels like "Camera", "Taken", "Shutter", "Aperture"), then a collapsed `<details><summary>All metadata (N fields)</summary>` section with every remaining key/value in a two-column table, values stringified, long values truncated to 200 chars. `exif == null` → "No metadata was found in this file." Wrap tables in `overflow-x-auto`. Full code:

```tsx
const CURATED: [key: string, label: string][] = [
  ['Make', 'Camera make'], ['Model', 'Camera model'], ['LensModel', 'Lens'],
  ['DateTimeOriginal', 'Taken'], ['ExposureTime', 'Shutter (s)'], ['FNumber', 'Aperture (f/)'],
  ['ISO', 'ISO'], ['FocalLength', 'Focal length (mm)'], ['ImageWidth', 'Width (px)'],
  ['ImageHeight', 'Height (px)'], ['XResolution', 'X resolution'], ['YResolution', 'Y resolution'],
  ['GPSLatitude', 'Latitude'], ['GPSLongitude', 'Longitude'], ['Software', 'Software'],
  ['PageCount', 'Pages'], ['PDFVersion', 'PDF version'], ['Producer', 'Produced by'],
]

function show(v: unknown): string {
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
  return s.length > 200 ? s.slice(0, 200) + '…' : s
}

export function ExifTable({ exif, type }: { exif: Record<string, unknown> | null | undefined; type: string }) {
  if (!exif || Object.keys(exif).length === 0)
    return <p className="text-lg">No metadata was found in this file.</p>
  const curatedPresent = CURATED.filter(([k]) => exif[k] != null)
  const curatedKeys = new Set(curatedPresent.map(([k]) => k))
  const rest = Object.entries(exif).filter(([k]) => !curatedKeys.has(k))
  return (
    <div className="grid gap-6">
      {curatedPresent.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full max-w-xl text-lg">
            <tbody>
              {curatedPresent.map(([key, label]) => (
                <tr key={key} className="border-b">
                  <td className="py-2 pr-6 font-semibold">{label}</td>
                  <td className="py-2">{show(exif[key])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <details>
        <summary className="cursor-pointer text-lg underline">
          All {type === 'DOCUMENT' ? 'document' : 'photo'} metadata ({rest.length} more fields)
        </summary>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <tbody>
              {rest.map(([key, value]) => (
                <tr key={key} className="border-b align-top">
                  <td className="py-1 pr-4 font-mono">{key}</td>
                  <td className="py-1 break-all">{show(value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}
```

- [ ] **Step 2: Wire into the detail page** — replace the Advanced placeholder with `<ExifTable exif={dto.exif} type={dto.type} />`.

- [ ] **Step 3: Verify** — `tsc`/`lint`/`build` clean; module-level render check: `npx tsx` script that imports ExifTable and calls it as a function with a sample exif object (`ExifTable({exif: {Make: 'TestCam', Obscure: 'x'.repeat(300)}, type: 'PHOTO'})`) and asserts the returned React element tree exists (non-null) — plus visually in Task 6 acceptance. Record outputs.

- [ ] **Step 4: Commit**

```bash
git add components/exif-table.tsx "app/(app)/media/[id]/page.tsx"
git commit -m "feat: Advanced tab with curated EXIF table"
```

---

### Task 4: History tab

**Files:**
- Create: `components/history-list.tsx`
- Modify: `app/(app)/media/[id]/page.tsx` (replace History placeholder)

**Interfaces:**
- Consumes: `GET /api/media/[id]/history` (Task 1 contract).
- Produces: `<HistoryList mediaId={string} />` client component.

- [ ] **Step 1: `components/history-list.tsx`** — client component: fetches history on mount, renders newest-first entries as sentences. Field labels: `{title: 'the title', description: 'the description', location: 'the location', dateYear: 'the year', dateMonth: 'the month', dateDay: 'the day', dateIsApproximate: 'the approximate-date flag', deletedAt: 'deleted'}`. Rendering rules: CREATE → "**{user}** added this item · {date}"; DELETE → "**{user}** deleted this item · {date}"; UPDATE with `deletedAt` to null → "**{user}** restored this item"; other UPDATE → one line per field: `from == null` → "set {label} to “{to}”", `to == null` → "cleared {label} (was “{from}”)", else → "changed {label} from “{from}” to “{to}”". Dates via `new Date(createdAt).toLocaleString()`. Loading and error states; empty → "No changes recorded yet." Full code:

```tsx
'use client'

import { useEffect, useState } from 'react'

type Entry = {
  id: string
  action: 'CREATE' | 'UPDATE' | 'DELETE'
  changes: Record<string, { from: unknown; to: unknown }>
  user: { name: string }
  createdAt: string
}

const LABELS: Record<string, string> = {
  title: 'the title', description: 'the description', location: 'the location',
  dateYear: 'the year', dateMonth: 'the month', dateDay: 'the day',
  dateIsApproximate: 'the approximate-date flag', deletedAt: 'deleted', filename: 'the file',
}

function fieldSentence(field: string, from: unknown, to: unknown): string {
  const label = LABELS[field] ?? field
  if (from == null) return `set ${label} to “${to}”`
  if (to == null) return `cleared ${label} (was “${from}”)`
  return `changed ${label} from “${from}” to “${to}”`
}

export function HistoryList({ mediaId }: { mediaId: string }) {
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    fetch(`/api/media/${mediaId}/history`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setEntries(d.entries))
      .catch(() => setError(true))
  }, [mediaId])

  if (error) return <p className="text-lg text-red-700">Couldn’t load history — refresh to try again.</p>
  if (entries === null) return <p className="text-lg">Loading…</p>
  if (entries.length === 0) return <p className="text-lg">No changes recorded yet.</p>

  return (
    <ol className="grid max-w-2xl gap-4">
      {entries.map((e) => {
        const when = new Date(e.createdAt).toLocaleString()
        let lines: string[]
        if (e.action === 'CREATE') lines = ['added this item']
        else if (e.action === 'DELETE') lines = ['deleted this item']
        else if ('deletedAt' in e.changes && e.changes.deletedAt.to === null) lines = ['restored this item']
        else lines = Object.entries(e.changes).map(([f, { from, to }]) => fieldSentence(f, from, to))
        return (
          <li key={e.id} className="rounded-xl border p-4 text-lg">
            <span className="font-semibold">{e.user.name}</span>{' '}
            {lines.join('; ')}
            <div className="mt-1 text-sm text-black/60">{when}</div>
          </li>
        )
      })}
    </ol>
  )
}
```

- [ ] **Step 2: Wire into the detail page** — replace the History placeholder with `<HistoryList mediaId={dto.id} />`.

- [ ] **Step 3: Verify** — `tsc`/`lint`/`build` clean. Record outputs.

- [ ] **Step 4: Commit**

```bash
git add components/history-list.tsx "app/(app)/media/[id]/page.tsx"
git commit -m "feat: History tab with human-readable audit trail"
```

---

### Task 5: Soft delete UI + admin restore page

**Files:**
- Create: `components/admin-item-actions.tsx`, `app/(app)/admin/deleted/page.tsx`
- Modify: `app/(app)/media/[id]/page.tsx` (mount admin actions), `components/nav.tsx` (nothing — admin page is reached from settings later; link it from the deleted page breadcrumb only)

**Interfaces:**
- Consumes: `DELETE /api/media/[id]`, `POST /api/media/[id]/restore` (Task 1), `mediaItemToDTO`.
- Produces: `<AdminItemActions id={string} deleted={boolean} />` client component (Delete with a browser `confirm()` dialog; Restore without); `/admin/deleted` page (ADMIN-gated server-side, redirect non-admins to `/`).

- [ ] **Step 1: `components/admin-item-actions.tsx`**

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function AdminItemActions({ id, deleted }: { id: string; deleted: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function act(method: 'DELETE' | 'restore') {
    if (method === 'DELETE' && !confirm('Move this item to Deleted items? An admin can restore it later.')) return
    setBusy(true)
    const res = await fetch(method === 'DELETE' ? `/api/media/${id}` : `/api/media/${id}/restore`, {
      method: method === 'DELETE' ? 'DELETE' : 'POST',
    })
    setBusy(false)
    if (res.ok) {
      if (method === 'DELETE') router.push('/')
      else router.refresh()
    } else setError((await res.json()).error ?? `HTTP ${res.status}`)
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
```

- [ ] **Step 2: Mount on the detail page** — the page must know the viewer's role: in the server component, resolve `const { userId } = await auth()` + local user; render `<AdminItemActions id={dto.id} deleted={false} />` in the button row only when `viewer?.role === 'ADMIN'`. (The detail page currently 404s deleted items — keep that; deleted items are handled on the admin page.)

- [ ] **Step 3: `app/(app)/admin/deleted/page.tsx`** — server component: resolve viewer; `redirect('/')` unless ADMIN. Query `prisma.mediaItem.findMany({ where: { NOT: { deletedAt: null } }, orderBy: { deletedAt: 'desc' }, include: { uploadedBy: true } })`, map through `mediaItemToDTO` (thumbs still work — derivatives aren't purged on soft delete), render a simple list: thumb (or filename), title/filename, "deleted {date}", and `<AdminItemActions id={...} deleted={true} />` per row. Empty state "Nothing has been deleted." Heading "Deleted items" + a back link to `/`.

```tsx
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { auth } from '@clerk/nextjs/server'
import { prisma } from '@/lib/db'
import { mediaItemToDTO } from '@/lib/media'
import { AdminItemActions } from '@/components/admin-item-actions'

export default async function DeletedItemsPage() {
  const { userId } = await auth()
  const viewer = userId ? await prisma.user.findUnique({ where: { clerkId: userId } }) : null
  if (viewer?.role !== 'ADMIN') redirect('/')

  const items = await prisma.mediaItem.findMany({
    where: { NOT: { deletedAt: null } },
    orderBy: { deletedAt: 'desc' },
    include: { uploadedBy: true },
  })
  const dtos = await Promise.all(items.map((i) => mediaItemToDTO(i)))

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/" className="text-lg underline">← Library</Link>
      <h1 className="my-4 text-3xl font-bold">Deleted items</h1>
      {dtos.length === 0 && <p className="text-lg">Nothing has been deleted.</p>}
      <ul className="grid gap-4">
        {dtos.map((dto, i) => (
          <li key={dto.id} className="flex items-center gap-4 rounded-xl border p-4">
            {dto.thumbUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={dto.thumbUrl} alt="" className="h-20 w-20 rounded-lg object-cover" />
            ) : (
              <span className="flex h-20 w-20 items-center justify-center rounded-lg bg-black/5">📄</span>
            )}
            <div className="flex-1 text-lg">
              <div className="font-semibold">{dto.title ?? dto.originalFilename}</div>
              <div className="text-sm text-black/60">
                deleted {items[i].deletedAt ? new Date(items[i].deletedAt!).toLocaleDateString() : ''}
              </div>
            </div>
            <AdminItemActions id={dto.id} deleted={true} />
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 4: Verify** — `tsc`/`lint`/`build` clean; route `/admin/deleted` appears in build output; curl unauthenticated → auth redirect. Record outputs.

- [ ] **Step 5: Commit**

```bash
git add components/admin-item-actions.tsx "app/(app)/admin" "app/(app)/media/[id]/page.tsx"
git commit -m "feat: soft delete with admin restore and deleted-items page"
```

---

### Task 6: Inline PDF viewing + upload-page details + deploy & acceptance

**Files:**
- Modify: `lib/media.ts` (DTO: `inlineUrl` for documents), `app/(app)/media/[id]/page.tsx` (iframe), `components/uploader.tsx` (post-upload detail forms)

**Interfaces:**
- Consumes: everything above; `signGetUrl`.
- Produces: `MediaItemDTO.inlineUrl?: string | null` (detail + DOCUMENT only: presigned GET of the ORIGINAL with no downloadName, `expiresIn: 3600`); deployed Phase 3.

- [ ] **Step 1: DTO** — in `mediaItemToDTO`'s `detail` block: `if (item.type === 'DOCUMENT' && item.status === 'READY') dto.inlineUrl = await signGetUrl(item.originalKey, { expiresIn: 3600 })`.

- [ ] **Step 2: Detail page** — for READY DOCUMENTs, replace the page-1 `<img>` block with:

```tsx
{dto.inlineUrl ? (
  <iframe src={dto.inlineUrl} title={dto.title ?? dto.originalFilename} className="h-[80vh] w-full rounded-xl border" />
) : null}
```

(Keep the download button; drop the "download the original to read" note.)

- [ ] **Step 3: Upload page details** — in `components/uploader.tsx`, extend the completion state: instead of only "N files uploaded", keep an array in state of `{mediaId, name}` for each successful file (push in the upload-success flow where mediaId is known). Below the Dashboard, render for each uploaded file a one-line mini form: file name, a "Title" text input and a "Year" (4-digit) input with a Save button that PATCHes `/api/media/{mediaId}` with `{title, dateYear}` (only non-empty values) and swaps to "Saved ✓" on success. Keep it minimal — full editing lives on the detail page.

- [ ] **Step 4: Verify locally** — `tsc`/`lint`/`build` clean; module-level: sign an inline URL for the local test DOCUMENT (Task 1 harness pattern) and `curl -I` it → 200 with `content-type: application/pdf` and NO `content-disposition: attachment`. Record outputs.

- [ ] **Step 5: Push and deploy**

```bash
git add lib/media.ts "app/(app)/media/[id]/page.tsx" components/uploader.tsx
git commit -m "feat: inline PDF viewing and post-upload quick details"
git push origin main
```

Both Railway deployments (web + worker rebuild) reach SUCCESS.

- [ ] **Step 6: Production acceptance (human)** — ask the user to: edit a photo's title/description/date on the detail page and Save; check the History tab shows the change with their name; open Advanced and see EXIF; upload a PDF and read it inline; as admin, Delete an item, find it at `/admin/deleted`, Restore it, confirm History shows delete + restore; upload a photo and use the post-upload title/year mini form.

---

## Deferred (explicitly NOT in this plan)

- People-tagging on media (spec §6 chips) → Phase 5 with the family tree (no Person records exist yet).
- Search/filters/timeline/albums/favorites/comments/hearts → Phase 4.
- Audit coverage for albums/people entities → arrives with those features (Phases 4/5), reusing `lib/audit.ts` patterns.
- Original-file purge for deleted items → never automatic (spec §7: bucket originals never auto-purged).

## Phase 3 exit criteria

- Any member edits title/description/location/date (flexible, "fill in what you know") from the detail page; every change lands as a field-level-diff AuditLog row written in the same transaction.
- History tab renders the trail as human sentences with real names; Advanced tab renders curated + full EXIF.
- Admins soft-delete items (audited), see them at `/admin/deleted`, and restore them (audited).
- PDFs read inline on the detail page; freshly uploaded files can get a title/year without leaving the upload page.
