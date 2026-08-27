# Photo Backs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a photo's back (handwritten notes, stamps) be uploaded or linked as a second image tied to the front's detail page, hidden from the library unless a filter chip is enabled.

**Architecture:** The back is a full `MediaItem` (keeps the whole pipeline: chunked upload, derivatives, EXIF, audit, duplicate detection) linked by a new `backOfId` self-relation with a `@unique` constraint (one back per front). The library/timeline default queries exclude items that are backs; a "Photo backs" chip shows them. Activity is attributed to the FRONT item: creating/linking a back writes an UPDATE audit row on the front with a `back` field diff, which flows into the digest as an edit ("back of photo") rather than a new item.

**Tech Stack:** Existing stack only (Next.js 16, Prisma 5.22/Postgres, Uppy-based custom uploader, shadcn/ui + ConfirmProvider). No new deps.

**Spec:** user-approved design in-conversation (2026-08-27): back linked to one front; hidden from library unless filter enabled; digest treats back upload as an update to the front; one back per front; transcription lives in the back's description (searchable). Base spec docs/superpowers/specs/2026-08-26-miranda-family-archives-design.md governs permissions (§5: members upload/edit/tag — linking/unlinking a back is member-level; hard rules on delete stay admin-only) and UX constants (grandparent rules: ≥44px targets, ≥18px text, plain words).

## Global Constraints

- NO automated tests (standing decision; backfill is a separate offered project).
- Grandparent rules: every new control ≥44px touch target, ≥18px body text, plain-words copy, no hover-only affordances.
- House route pattern: `requireUser()` / `safeErrorResponse` where the touched file already uses them; otherwise match the file's existing auth pattern exactly.
- All audited mutations use the `{field: {from, to}}` JSONB diff shape in the same transaction as the write (see lib/audit.ts).
- Backs are PHOTOs of PHOTO fronts only. No chains: an item that IS a back can't have a back; an item with a back can't become a back.
- Commit trailer on every commit: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. Work on `main`; push at Task 2 only.

## File map

| File | Responsibility |
|---|---|
| `prisma/schema.prisma` + migration `add_photo_backs` | `backOfId String? @unique` self-relation on MediaItem |
| `lib/media.ts` | DTO: `backOfId`; detail adds `back` (front's back) and `backOf` (when item is a back) |
| `app/api/media/route.ts` | `buildMediaWhere`: `backs` param — absent ⇒ `backOfId: null`; `'1'` ⇒ `backOfId: { not: null }` |
| `app/api/media/timeline/route.ts` | add `backOfId: null` to its where |
| `app/api/uploads/route.ts` | accept optional `backOfId` with validations; store on create |
| `app/api/uploads/complete/route.ts` | back items: UPDATE audit on the FRONT (`back` diff) instead of CREATE on the back |
| `app/api/media/[id]/back/route.ts` (new) | POST link existing item as back; DELETE unlink — validations + audits both sides |
| `lib/digest.ts` | `'back'` joins MEDIA_DIGEST_FIELDS; label `back of photo` |
| `components/back-section.tsx` (new) | Front detail: show/unlink back, "Add the back" upload, "Link an existing photo" picker |
| `components/uploader.tsx` | optional `backOfId` + `maxFiles` props threaded to POST /api/uploads |
| `app/(app)/media/[id]/page.tsx` | mount BackSection on fronts; "back of" banner on backs |
| `components/library-controls.tsx` | "Photo backs" chip in the type row |

---

### Task 1: Schema, API, and digest wiring

**Files:**
- Modify: `prisma/schema.prisma` (+ `npx prisma migrate dev --name add_photo_backs` against local dev Postgres, then `npx prisma generate`)
- Modify: `lib/media.ts`, `app/api/media/route.ts`, `app/api/media/timeline/route.ts`, `app/api/uploads/route.ts`, `app/api/uploads/complete/route.ts`, `lib/digest.ts`
- Create: `app/api/media/[id]/back/route.ts`

**Interfaces:**
- Consumes: existing `mediaItemToDTO`, `buildMediaWhere`, audit JSONB diff conventions, `prisma.auditLog` writes as in uploads/complete.
- Produces (Task 2 relies on these exactly): `MediaItemDTO.backOfId: string | null`; detail-only `MediaItemDTO.back?: { id: string; title: string | null; filename: string; thumbUrl: string | null } | null` and `MediaItemDTO.backOf?: { id: string; title: string | null; filename: string } | null`; `GET /api/media?backs=1`; `POST /api/uploads` body field `backOfId?: string`; `POST /api/media/[id]/back` body `{ backItemId: string }` → 200 `{ ok: true }`; `DELETE /api/media/[id]/back` → 200 `{ ok: true }`.

- [ ] **Step 1 — schema:** In `model MediaItem` add below `duplicateOfId`:

```prisma
  backOfId          String?     @unique
  backOf            MediaItem?  @relation("PhotoBack", fields: [backOfId], references: [id])
  backItem          MediaItem?  @relation("PhotoBack")
```

Prisma also requires the self-relation for `duplicateOfId`? No — `duplicateOfId` is a bare column today (no relation); leave it as is. Run the migration + generate. (Dev DB: docker-compose Postgres on localhost, same flow as the Phase 6 `add_duplicate_detection` migration.)

- [ ] **Step 2 — DTO (`lib/media.ts`):** add `backOfId: string | null` to `MediaItemDTO` and set `backOfId: item.backOfId` in the base DTO (next to `duplicateOfId`). Add optional `back` and `backOf` fields typed as in Interfaces. In the `opts.detail` block:

```ts
    if (item.backOfId) {
      const front = await prisma.mediaItem.findFirst({
        where: { id: item.backOfId, deletedAt: null },
        select: { id: true, title: true, originalFilename: true },
      })
      dto.backOf = front ? { id: front.id, title: front.title, filename: front.originalFilename } : null
    } else {
      const back = await prisma.mediaItem.findFirst({
        where: { backOfId: item.id, deletedAt: null, status: 'READY' },
        select: { id: true, title: true, originalFilename: true, thumbKey: true },
      })
      dto.back = back
        ? { id: back.id, title: back.title, filename: back.originalFilename, thumbUrl: back.thumbKey ? await signGetUrl(back.thumbKey) : null }
        : null
    }
```

- [ ] **Step 3 — list filtering:** In `buildMediaWhere` add `backs?: string | null` to the params type and to the returned clause:

```ts
    ...(params.backs === '1' ? { backOfId: { not: null } } : { backOfId: null }),
```

Pass `backs: req.nextUrl.searchParams.get('backs')` from the GET handler. In `app/api/media/timeline/route.ts` change the where to `{ status: 'READY', deletedAt: null, backOfId: null }`.

- [ ] **Step 4 — upload create (`app/api/uploads/route.ts`):** read `backOfId` from the body. When present:

```ts
  if (backOfId) {
    if (typeof backOfId !== 'string') return NextResponse.json({ error: 'invalid backOfId' }, { status: 400 })
    if (mediaType !== 'PHOTO')
      return NextResponse.json({ error: 'the back of a photo must be a photo' }, { status: 400 })
    const front = await prisma.mediaItem.findFirst({
      where: { id: backOfId, deletedAt: null },
      include: { backItem: { select: { id: true, deletedAt: true } } },
    })
    if (!front) return NextResponse.json({ error: 'photo not found' }, { status: 404 })
    if (front.type !== 'PHOTO')
      return NextResponse.json({ error: 'only photos can have a back' }, { status: 400 })
    if (front.backOfId)
      return NextResponse.json({ error: 'that photo is itself the back of another photo' }, { status: 409 })
    if (front.backItem && front.backItem.deletedAt === null)
      return NextResponse.json({ error: 'that photo already has a back' }, { status: 409 })
  }
```

and include `...(backOfId ? { backOfId } : {})` in the `mediaItem.create` data. NOTE the soft-delete wrinkle: `backOfId` is `@unique`, so a soft-deleted back still occupies the slot. In the "already has a back" check above, a soft-deleted back must return 409 with the message `'that photo already has a back in Deleted items — an admin can restore or remove it'` (distinct message, still 409).

- [ ] **Step 5 — complete route:** in `app/api/uploads/complete/route.ts`, replace the fixed CREATE audit with a branch:

```ts
    prisma.auditLog.create({
      data: item.backOfId
        ? {
            userId: user.id,
            entityType: 'media_item',
            entityId: item.backOfId,
            action: 'UPDATE',
            changes: { back: { from: null, to: item.originalFilename } },
          }
        : {
            userId: user.id,
            entityType: 'media_item',
            entityId: mediaId,
            action: 'CREATE',
            changes: { filename: { from: null, to: item.originalFilename } },
          },
    }),
```

- [ ] **Step 6 — link/unlink route (`app/api/media/[id]/back/route.ts`):** new file following the house pattern of sibling routes (look at `app/api/media/[id]/heart/route.ts` for auth/params shape). POST body `{ backItemId }`. Validations (each its own 4xx with a plain-words error): front exists live, front is PHOTO, front is not itself a back, front has no live back (soft-deleted back ⇒ the distinct 409 message from Step 4); back item exists live + READY + PHOTO, `backItemId !== id`, back item is not already a back (`backOfId === null`), back item has no back of its own (`backItem` relation empty of live rows). Then in ONE transaction: `update` back item set `backOfId: id`; two `auditLog.create` rows — UPDATE on front `{ back: { from: null, to: <back filename> } }`, UPDATE on back `{ backOf: { from: null, to: id } }`. DELETE: find the live back (`backOfId: id, deletedAt: null`); 404 if none; one transaction clearing `backOfId` + two mirrored audit rows (`from` filled, `to: null`). Both verbs require a signed-in member (same auth as heart route; NOT admin-gated).

- [ ] **Step 7 — digest:** in `lib/digest.ts` add `'back'` to `MEDIA_DIGEST_FIELDS` (append to the array literal: `[...EDITABLE_MEDIA_FIELDS, 'people', 'back']`) and `back: 'back of photo'` to `MEDIA_FIELD_LABELS`.

- [ ] **Step 8 — verify:** `npx tsc --noEmit`, `npm run lint`, `npm run build` clean. `npx prisma migrate status` shows the migration applied locally. Manual API sanity against the dev server with the seeded dev DB is optional; structural verification + Task 2 acceptance covers behavior.

- [ ] **Step 9 — commit:** `feat: photo backs data model, API, and digest wiring`

---

### Task 2: UI, deploy, and acceptance

**Files:**
- Create: `components/back-section.tsx`
- Modify: `components/uploader.tsx` (optional `backOfId?: string`, `maxFiles?: number`, `onUploaded?: () => void` props), `app/(app)/media/[id]/page.tsx`, `components/library-controls.tsx`

**Interfaces:**
- Consumes: Task 1's DTO fields and endpoints verbatim; `useConfirm` from `components/confirm-dialog.tsx`; shadcn `Button`/`Input`; `MediaTile` export from `components/media-grid.tsx` if useful for the picker, else plain rows.

**Rules:** behavior-preserving for everything not named; uploader's existing library flow must be byte-identical when the new props are absent.

- [ ] **Step 1 — uploader props:** thread `backOfId` into the POST `/api/uploads` body when set; `maxFiles` maps to Uppy's `restrictions.maxNumberOfFiles`; when `backOfId` is set, SKIP the duplicate-filename prompt loop (a back legitimately shares context with its front; content-dupe warning still fine server-side) and call `onUploaded` after the file settles. Default-prop behavior unchanged — verify by reading the diff against the library usage.
- [ ] **Step 2 — BackSection (client component)** rendered on front detail pages (PHOTO + READY + not itself a back):
  - Has a back: heading "Back of this photo", the back's thumbnail (min 96px, links to `/media/<back.id>`), and a "Remove the back" button → `useConfirm({ title: 'Remove the back of this photo?', body: "The back image stays in the archive — it just won't be attached to this photo anymore.", actionLabel: 'Remove', destructive: true })` → DELETE `/api/media/<id>/back` → `router.refresh()`.
  - No back: "Add the back of this photo" — two affordances: (a) the uploader with `backOfId`, `maxFiles=1`, `onUploaded: router.refresh`; (b) "Link a photo already in the archive" toggle revealing a search input (reuse the `/api/media?q=` endpoint client-side, filter out `id === front.id`, non-PHOTO, anything with `backOfId` set) listing thumbnail rows with a "Use as back" button → POST → refresh. Plain-words errors surfaced inline from the API's error strings.
- [ ] **Step 3 — detail page:** in `app/(app)/media/[id]/page.tsx`: if `dto.backOf` (item IS a back) render a banner above the image — `This is the back of <link to front title/filename>` styled like the existing duplicateOf banner; if the item is a READY PHOTO front, mount `<BackSection item={dto} />` between the image and the action row. Backs still render their own full detail (edit form for transcription in description, comments, etc.).
- [ ] **Step 4 — library chip:** in `components/library-controls.tsx` type row, add `Chip active={backs === '1'} onClick={() => updateParams({ backs: backs === '1' ? null : '1', type: null })}` labeled "Photo backs" (reading `backs` from searchParams like the others; selecting All/Photos/Documents clears `backs`). `components/media-grid.tsx` already forwards the full query string? Verify how MediaGrid builds its fetch URL and include `backs` the same way the other filters travel.
- [ ] **Step 5 — verify + deploy:** `tsc`/`lint`/`build` clean; push origin main (authorized); both Railway deployments SUCCESS.
- [ ] **Step 6 — commit** (before push): `feat: photo backs UI — attach, view, and filter photo backs`
- [ ] **Step 7 (controller + human acceptance):** on the live site: upload a back onto a photo (progress bar, appears in the front's Back section, NOT in the library grid); enable the "Photo backs" chip and see it; open the back — banner links to the front; write a transcription in the back's description and find the front... (search finds the back via the chip); remove the back and re-link it via the picker; confirm tomorrow-morning digest lists "back of photo" as an update if a back was added today.

## Phase exit criteria

- A photo can carry exactly one back; backs are invisible in library/timeline by default and visible via the chip; the front's detail shows and manages its back; digests report back additions as updates to the front; all plain-words + size rules hold; deployed and user-accepted.
