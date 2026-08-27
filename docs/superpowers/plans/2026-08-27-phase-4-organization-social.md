# Phase 4: Organization & Social Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Albums with drag-to-reorder and covers, a one-tap heart that doubles as the personal Favorites list, comment threads, library search + filter chips, and a decade→year timeline view.

**Architecture:** Album mutations flow through new audited helpers in `lib/audit.ts` (spec §7 audits album changes; hearts/favorites/comments are deliberately NOT audited). Social actions are thin transactional routes. Search/filters extend the existing `/api/media` listing; the timeline is a separate grouped endpoint. UI reuses the established component patterns (client components + API routes, `router.refresh()`).

**Tech Stack:** existing stack + `@dnd-kit/core`/`@dnd-kit/sortable` (drag-to-reorder with touch support; the only new dependency).

**Spec:** `docs/superpowers/specs/2026-08-26-miranda-family-archives-design.md` (§3 tables, §5 permissions, §6 Library/Albums/Favorites pages, §7 audit scope)

## Global Constraints

- **NO automated tests** — manual verification per task, recorded output, cleanup of any test rows.
- TypeScript, `@/*` alias; auth pattern verbatim from existing routes (`auth()` → 401; `prisma.user.findUnique({where:{clerkId}})` → 403).
- **Design ruling (heart = favorite):** the heart toggle writes BOTH `Heart` and `Favorite` rows in one `$transaction` (and removes both on un-heart). The Favorites page is the user's hearted grid (spec §6). There is no separate favorite gesture.
- **Design ruling (album ownership):** `Album` has no creator column — ANY member may create/edit/reorder/delete albums (family-trust model, schema-conformant). Album mutations ARE audited (spec §7 "album changes") with `entityType: 'album'`; album events do NOT feed the digest (spec §8 "album shuffling" excluded — Phase 6 filters by entityType).
- Hearts, favorites, comments: NOT audited (spec §7).
- Comments: any member posts; author may delete own comment; ADMIN may delete any. No editing in v1 (YAGNI — delete and repost).
- Album deletion is a HARD delete (schema has no `deletedAt` on Album); the transaction deletes `AlbumItem` rows first, then the album, then writes the audit row. Media items themselves are never touched.
- Search matches `title`, `description`, `location`, `originalFilename` (case-insensitive contains). Filters: `type` (PHOTO/DOCUMENT), `decade` (e.g. 1960 → dateYear 1960–1969), `albumId`, `favorite=1` (viewer's hearts). People filter is **Phase 5**.
- Existing interfaces (do not rename): `MediaGrid` in `components/media-grid.tsx` fetches `/api/media`; `mediaItemToDTO`; `EDITABLE_MEDIA_FIELDS`/audit helpers in `lib/audit.ts`; `prisma` from `@/lib/db`.
- Work on `main`; commit per task; push only at the final task. Commit trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## File map

| File | Responsibility |
|---|---|
| `lib/audit.ts` | + album audit helpers (create/update/delete/items) |
| `lib/albums.ts` | Album DTO (cover thumb URL, item count) |
| `app/api/albums/route.ts` | GET list, POST create |
| `app/api/albums/[id]/route.ts` | GET detail, PATCH (name/desc/cover), DELETE |
| `app/api/albums/[id]/items/route.ts` | POST add item, PATCH reorder, DELETE remove item |
| `app/api/media/[id]/heart/route.ts` | POST heart, DELETE un-heart (Heart+Favorite in txn) |
| `app/api/media/[id]/comments/route.ts` | GET list, POST create |
| `app/api/comments/[id]/route.ts` | DELETE (own or admin) |
| `app/api/media/route.ts` | + q/type/decade/albumId/favorite filters |
| `app/api/media/timeline/route.ts` | Decade→year grouped listing |
| `components/album-grid.tsx`, `components/album-form.tsx` | Albums index UI |
| `components/album-detail.tsx` | Album page: reorder (dnd-kit), add/remove, cover |
| `components/heart-button.tsx` | Toggle + count |
| `components/comment-thread.tsx` | List + post + delete |
| `components/library-controls.tsx` | Search box + filter chips + view toggle |
| `components/timeline-view.tsx` | Decade→year sections |
| `app/(app)/albums/page.tsx`, `app/(app)/albums/[id]/page.tsx` | Album pages |
| `app/(app)/favorites/page.tsx` | Hearted grid |
| `app/(app)/page.tsx` | Library: controls + grid/timeline |
| `app/(app)/media/[id]/page.tsx` | + HeartButton, CommentThread, album membership chips |

---

### Task 1: Album audit helpers + albums API

**Files:**
- Create: `lib/albums.ts`, `app/api/albums/route.ts`, `app/api/albums/[id]/route.ts`, `app/api/albums/[id]/items/route.ts`
- Modify: `lib/audit.ts` (append album helpers)

**Interfaces:**
- Consumes: `prisma`, existing auth pattern, `signGetUrl` from `@/lib/s3`.
- Produces:
  - `lib/audit.ts` additions:
    - `createAlbumWithAudit(actorUserId: string, data: {name: string, description?: string | null}): Promise<{id: string}>`
    - `updateAlbumWithAudit(albumId: string, actorUserId: string, input: Partial<{name: string, description: string | null, coverMediaId: string | null}>): Promise<{changed: string[]}>` (diff-based, no-op safe, same `{field:{from,to}}` shape)
    - `deleteAlbumWithAudit(albumId: string, actorUserId: string): Promise<void>` (txn: delete AlbumItems → delete Album → audit DELETE with `{name:{from,to:null}}`)
    - `albumItemsChangeWithAudit(albumId: string, actorUserId: string, change: {added?: string[], removed?: string[], reordered?: boolean}): Promise<void>` — ONE audit UPDATE row per mutation call with `changes: {items: {from: <count-before>, to: <count-after>}}` plus `added`/`removed` id arrays in the JSON when present (keeps history compact — no row per item).
  - `lib/albums.ts`: `AlbumDTO = {id, name, description, itemCount: number, coverThumbUrl: string | null, createdAt: string}`; `albumToDTO(album & {items: (AlbumItem & {mediaItem: MediaItem})[]}): Promise<AlbumDTO>` (cover = explicit coverMediaId's thumb, else first item's thumb, else null).
  - HTTP contract:
    - `GET /api/albums` → `{albums: AlbumDTO[]}` (by createdAt desc)
    - `POST /api/albums` `{name, description?}` → `{id}` (400 empty name)
    - `GET /api/albums/[id]` → `{album: AlbumDTO, items: MediaItemDTO[]}` (items by position asc; deleted media excluded)
    - `PATCH /api/albums/[id]` partial `{name, description, coverMediaId}` → `{ok, changed}` (400 empty-string name; coverMediaId must be an item in the album or null)
    - `DELETE /api/albums/[id]` → `{ok}`
    - `POST /api/albums/[id]/items` `{mediaId}` → `{ok}` (appends at max position + 1; 409 if already in album; 404 unknown media)
    - `PATCH /api/albums/[id]/items` `{orderedMediaIds: string[]}` → `{ok}` (must be a permutation of current items → 400 otherwise; positions rewritten 0..n-1 in txn)
    - `DELETE /api/albums/[id]/items?mediaId=<id>` → `{ok}`
  - All routes: any signed-in member (auth + user lookup only, no role checks).

- [ ] **Step 1: Append album helpers to `lib/audit.ts`**

```typescript
// append to lib/audit.ts

export async function createAlbumWithAudit(
  actorUserId: string,
  data: { name: string; description?: string | null }
): Promise<{ id: string }> {
  const album = await prisma.$transaction(async (tx) => {
    const created = await tx.album.create({
      data: { name: data.name, description: data.description ?? null },
    })
    await tx.auditLog.create({
      data: {
        userId: actorUserId,
        entityType: 'album',
        entityId: created.id,
        action: 'CREATE',
        changes: { name: { from: null, to: data.name } },
      },
    })
    return created
  })
  return { id: album.id }
}

const EDITABLE_ALBUM_FIELDS = ['name', 'description', 'coverMediaId'] as const

export async function updateAlbumWithAudit(
  albumId: string,
  actorUserId: string,
  input: Partial<{ name: string; description: string | null; coverMediaId: string | null }>
): Promise<{ changed: string[] }> {
  const album = await prisma.album.findUnique({ where: { id: albumId } })
  if (!album) throw Object.assign(new Error('not found'), { status: 404 })
  const changes: Record<string, { from: unknown; to: unknown }> = {}
  for (const field of EDITABLE_ALBUM_FIELDS) {
    if (!(field in input)) continue
    const to = input[field] ?? null
    const from = (album as Record<string, unknown>)[field] ?? null
    if (from !== to) changes[field] = { from, to }
  }
  if (Object.keys(changes).length === 0) return { changed: [] }
  const data = Object.fromEntries(Object.entries(changes).map(([f, { to }]) => [f, to]))
  await prisma.$transaction([
    prisma.album.update({ where: { id: albumId }, data }),
    prisma.auditLog.create({
      data: {
        userId: actorUserId,
        entityType: 'album',
        entityId: albumId,
        action: 'UPDATE',
        changes: changes as Prisma.InputJsonValue,
      },
    }),
  ])
  return { changed: Object.keys(changes) }
}

export async function deleteAlbumWithAudit(albumId: string, actorUserId: string): Promise<void> {
  const album = await prisma.album.findUnique({ where: { id: albumId } })
  if (!album) throw Object.assign(new Error('not found'), { status: 404 })
  await prisma.$transaction([
    prisma.albumItem.deleteMany({ where: { albumId } }),
    prisma.album.delete({ where: { id: albumId } }),
    prisma.auditLog.create({
      data: {
        userId: actorUserId,
        entityType: 'album',
        entityId: albumId,
        action: 'DELETE',
        changes: { name: { from: album.name, to: null } },
      },
    }),
  ])
}

export async function albumItemsChangeWithAudit(
  albumId: string,
  actorUserId: string,
  change: { added?: string[]; removed?: string[]; reordered?: boolean },
  countBefore: number,
  countAfter: number
): Promise<void> {
  await prisma.auditLog.create({
    data: {
      userId: actorUserId,
      entityType: 'album',
      entityId: albumId,
      action: 'UPDATE',
      changes: {
        items: { from: countBefore, to: countAfter },
        ...(change.added ? { added: change.added } : {}),
        ...(change.removed ? { removed: change.removed } : {}),
        ...(change.reordered ? { reordered: true } : {}),
      } as Prisma.InputJsonValue,
    },
  })
}
```

- [ ] **Step 2: `lib/albums.ts`**

```typescript
import type { Album, AlbumItem, MediaItem } from '@prisma/client'
import { signGetUrl } from '@/lib/s3'

export type AlbumDTO = {
  id: string
  name: string
  description: string | null
  itemCount: number
  coverThumbUrl: string | null
  createdAt: string
}

type AlbumWithItems = Album & { items: (AlbumItem & { mediaItem: MediaItem })[] }

export async function albumToDTO(album: AlbumWithItems): Promise<AlbumDTO> {
  const live = album.items
    .filter((i) => i.mediaItem.deletedAt === null)
    .sort((a, b) => a.position - b.position)
  const cover =
    live.find((i) => i.mediaItemId === album.coverMediaId)?.mediaItem ?? live[0]?.mediaItem ?? null
  return {
    id: album.id,
    name: album.name,
    description: album.description,
    itemCount: live.length,
    coverThumbUrl: cover?.thumbKey ? await signGetUrl(cover.thumbKey) : null,
    createdAt: album.createdAt.toISOString(),
  }
}
```

- [ ] **Step 3: The three route files.** Auth boilerplate per existing pattern in every handler. Route logic per the Produces contract above; the items route:

```typescript
// app/api/albums/[id]/items/route.ts
import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { albumItemsChangeWithAudit } from '@/lib/audit'

async function requireUser() {
  const { userId } = await auth()
  if (!userId) return { error: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) }
  const user = await prisma.user.findUnique({ where: { clerkId: userId } })
  if (!user) return { error: NextResponse.json({ error: 'no user record' }, { status: 403 }) }
  return { user }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireUser()
  if (error) return error
  const { id } = await params
  const { mediaId } = await req.json()
  const album = await prisma.album.findUnique({ where: { id }, include: { items: true } })
  if (!album) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const media = await prisma.mediaItem.findFirst({ where: { id: mediaId, deletedAt: null } })
  if (!media) return NextResponse.json({ error: 'media not found' }, { status: 404 })
  if (album.items.some((i) => i.mediaItemId === mediaId))
    return NextResponse.json({ error: 'already in album' }, { status: 409 })
  const maxPos = album.items.reduce((m, i) => Math.max(m, i.position), -1)
  await prisma.albumItem.create({ data: { albumId: id, mediaItemId: mediaId, position: maxPos + 1 } })
  await albumItemsChangeWithAudit(id, user.id, { added: [mediaId] }, album.items.length, album.items.length + 1)
  return NextResponse.json({ ok: true })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireUser()
  if (error) return error
  const { id } = await params
  const { orderedMediaIds } = await req.json()
  const items = await prisma.albumItem.findMany({ where: { albumId: id } })
  if (items.length === 0) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const current = new Set(items.map((i) => i.mediaItemId))
  if (
    !Array.isArray(orderedMediaIds) ||
    orderedMediaIds.length !== items.length ||
    !orderedMediaIds.every((m: unknown) => typeof m === 'string' && current.has(m))
  )
    return NextResponse.json({ error: 'orderedMediaIds must be a permutation of album items' }, { status: 400 })
  await prisma.$transaction(
    orderedMediaIds.map((mediaItemId: string, position: number) =>
      prisma.albumItem.update({
        where: { albumId_mediaItemId: { albumId: id, mediaItemId } },
        data: { position },
      })
    )
  )
  await albumItemsChangeWithAudit(id, user.id, { reordered: true }, items.length, items.length)
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireUser()
  if (error) return error
  const { id } = await params
  const mediaId = req.nextUrl.searchParams.get('mediaId')
  if (!mediaId) return NextResponse.json({ error: 'mediaId required' }, { status: 400 })
  const before = await prisma.albumItem.count({ where: { albumId: id } })
  const del = await prisma.albumItem.deleteMany({ where: { albumId: id, mediaItemId: mediaId } })
  if (del.count === 0) return NextResponse.json({ error: 'not in album' }, { status: 404 })
  const album = await prisma.album.findUnique({ where: { id } })
  if (album?.coverMediaId === mediaId)
    await prisma.album.update({ where: { id }, data: { coverMediaId: null } })
  await albumItemsChangeWithAudit(id, user.id, { removed: [mediaId] }, before, before - 1)
  return NextResponse.json({ ok: true })
}
```

`app/api/albums/route.ts` (GET: findMany include items+mediaItem, map albumToDTO; POST: trim name, 400 if empty, `createAlbumWithAudit`) and `app/api/albums/[id]/route.ts` (GET: album + `mediaItemToDTO` per live item ordered by position; PATCH: validate `name` non-empty string if present, `coverMediaId` null-or-member-of-album, then `updateAlbumWithAudit`; DELETE: `deleteAlbumWithAudit`; both map thrown `{status}` errors like the Phase 3 routes do) — write them following those exact contracts; the `requireUser` helper may be duplicated per file or imported from the items route — implementer's choice, note it.

- [ ] **Step 4: Verify module-level** — repo-root tsx script: create temp user + 3 temp MediaItems (READY, tiny fake keys are fine — no bucket objects needed since only thumbKey signing is exercised, use a real derived key from an existing prod-verified item? NO — local DB: leave thumbKey null, expect coverThumbUrl null); `createAlbumWithAudit` → add 3 items via direct prisma (mirroring the route logic) → `updateAlbumWithAudit` name change (assert audit row + changed) → reorder via the PATCH logic inline → `deleteAlbumWithAudit` (assert album + items gone, 3+ audit rows with entityType 'album'). Clean up all rows. `tsc`/`lint`/`build` clean; new routes in build output. Record outputs.

- [ ] **Step 5: Commit**

```bash
git add lib/audit.ts lib/albums.ts app/api/albums
git commit -m "feat: audited albums API"
```

---

### Task 2: Albums UI

**Files:**
- Create: `components/album-grid.tsx`, `components/album-form.tsx`, `components/album-detail.tsx`
- Modify: `app/(app)/albums/page.tsx` (replace placeholder), create `app/(app)/albums/[id]/page.tsx`
- Modify: `package.json` (dnd-kit)

**Interfaces:**
- Consumes: Task 1's HTTP contract verbatim; `MediaItemDTO`.
- Produces: `/albums` (cover-card grid + "New album" button/dialog) and `/albums/[id]` (item grid with drag-to-reorder, add-photos picker, remove, set-cover, edit name/description, delete album).

- [ ] **Step 1: `npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities`**

- [ ] **Step 2: `components/album-form.tsx`** — client: name (required) + description inputs; used for create (POST /api/albums then `router.push('/albums/' + id)`) and edit (PATCH; `router.refresh()`); busy/error states per the codebase's established form pattern (see components/media-edit-form.tsx for the state-machine idiom: idle/saving/saved/error, try/catch with network-failure message, safe json parse).

- [ ] **Step 3: `components/album-grid.tsx`** — client: fetch `/api/albums` on mount; card per album: cover img (or 📚 placeholder), name, "N items"; link to `/albums/{id}`; "New album" opens AlbumForm; empty state "No albums yet — make the first one."

- [ ] **Step 4: `components/album-detail.tsx`** — client component receiving `{album: AlbumDTO, items: MediaItemDTO[]}` from the server page. Features:
  - dnd-kit `SortableContext` grid of item thumbs (drag handle = whole tile; touch-friendly via PointerSensor with `activationConstraint: {distance: 8}`); on drop → PATCH items with the new `orderedMediaIds`, optimistic local order, revert + error message on failure.
  - Per-tile hover/tap menu: "Remove from album" (DELETE), "Make cover" (PATCH album {coverMediaId}).
  - "Add photos" button → modal fetching `/api/media?limit=100` (Task 5 adds filters; plain listing is fine now), grid of thumbs with checkmarks for already-in-album, click → POST item, appears immediately.
  - Header: editable name/description (AlbumForm in edit mode), Delete album button with `confirm()` → DELETE → `router.push('/albums')`.
- [ ] **Step 5: Pages** — `/albums/page.tsx`: heading + `<AlbumGrid />`. `/albums/[id]/page.tsx`: server component — fetch album + items via prisma + DTOs directly (same data path as the GET route; no self-HTTP), `notFound()` if missing, render `<AlbumDetail album={...} items={...} />`.

- [ ] **Step 6: Verify** — `tsc`/`lint`/`build` clean; `/albums` and `/albums/[id]` in build routes; unauthenticated curls redirect. Record outputs. (Interactive verification lands in Task 7 acceptance.)

- [ ] **Step 7: Commit**

```bash
git add components/album-grid.tsx components/album-form.tsx components/album-detail.tsx "app/(app)/albums" package.json package-lock.json
git commit -m "feat: albums UI with drag-to-reorder and covers"
```

---

### Task 3: Hearts (=favorites) + comments API

**Files:**
- Create: `app/api/media/[id]/heart/route.ts`, `app/api/media/[id]/comments/route.ts`, `app/api/comments/[id]/route.ts`
- Modify: `lib/media.ts` (DTO: `heartCount`, `heartedByMe`)

**Interfaces:**
- Consumes: auth pattern, `prisma`.
- Produces:
  - `POST /api/media/[id]/heart` → `{ok, heartCount}` — txn creates Heart + Favorite (idempotent: if Heart exists, no-op success). `DELETE` → `{ok, heartCount}` — txn deletes both.
  - `GET /api/media/[id]/comments` → `{comments: {id, body, user: {id, name}, createdAt, canDelete: boolean}[]}` (oldest first; canDelete = own || viewer ADMIN)
  - `POST /api/media/[id]/comments` `{body}` → `{comment}` (400 empty/`>2000` chars; trimmed)
  - `DELETE /api/comments/[id]` → `{ok}` (403 unless own or ADMIN)
  - DTO additions (BOTH list and detail, computed via `_count` + viewer id passed in): `heartCount: number`, `heartedByMe: boolean`. To avoid changing every call site: `mediaItemToDTO(item, {detail?, viewerUserId?})` — when item includes `hearts` relation or `_count`, populate; otherwise default `0`/`false`. Callers in `/api/media` and the detail page add `include: {_count: {select: {hearts: true}}, hearts: viewerUserId ? {where: {userId: viewerUserId}} : false}`.

- [ ] **Step 1: Heart route** — both handlers resolve user, verify media exists non-deleted (404), then:

```typescript
// POST body of app/api/media/[id]/heart/route.ts (DELETE mirrors with deleteMany)
await prisma.$transaction(async (tx) => {
  const existing = await tx.heart.findUnique({
    where: { userId_mediaItemId: { userId: user.id, mediaItemId: id } },
  })
  if (!existing) {
    await tx.heart.create({ data: { userId: user.id, mediaItemId: id } })
    await tx.favorite.upsert({
      where: { userId_mediaItemId: { userId: user.id, mediaItemId: id } },
      create: { userId: user.id, mediaItemId: id },
      update: {},
    })
  }
})
const heartCount = await prisma.heart.count({ where: { mediaItemId: id } })
return NextResponse.json({ ok: true, heartCount })
```

(DELETE: `tx.heart.deleteMany` + `tx.favorite.deleteMany` for the pair, then recount.)

- [ ] **Step 2: Comments routes** — per contract; POST validates `typeof body === 'string'`, trimmed non-empty, ≤2000 chars; GET orders `createdAt: 'asc'`, includes user, maps `canDelete: c.userId === viewer.id || viewer.role === 'ADMIN'`; DELETE checks the same condition server-side.

- [ ] **Step 3: DTO** — extend `mediaItemToDTO` opts with `viewerUserId?: string`; populate `heartCount` from `(item as any)._count?.hearts ?? 0` and `heartedByMe` from `Array.isArray((item as any).hearts) && (item as any).hearts.length > 0` (typed via a widened input type, not `any` — extend the accepted item type with optional `_count`/`hearts`). Update `/api/media` GET and the detail page + `/api/media/[id]` GET to pass the includes + viewerUserId.

- [ ] **Step 4: Verify module-level** — tsx harness: temp user A + B, temp item; A hearts (assert Heart + Favorite rows, count 1, idempotent double-POST logic via direct call), B hearts (count 2), A un-hearts (both A rows gone, count 1); comment create by A, canDelete matrix (A yes, B no unless ADMIN); cleanup. `tsc`/`lint`/`build` clean. Record outputs.

- [ ] **Step 5: Commit**

```bash
git add app/api/media app/api/comments lib/media.ts
git commit -m "feat: hearts-as-favorites and comments API"
```

---

### Task 4: Social UI — heart button, comments, Favorites page

**Files:**
- Create: `components/heart-button.tsx`, `components/comment-thread.tsx`
- Modify: `app/(app)/media/[id]/page.tsx` (mount both), `app/(app)/favorites/page.tsx` (replace placeholder), `components/media-grid.tsx` (small heart badge on tiles), `app/api/media/route.ts` (add `favorite=1` filter ONLY — Task 5 adds the rest)

**Interfaces:**
- Consumes: Task 3 contracts; `MediaItemDTO.heartCount/heartedByMe`.
- Produces: `<HeartButton mediaId, initialCount, initialHearted />` (optimistic toggle, big touch target, ❤️/🤍 + count); `<CommentThread mediaId />` (fetch on mount, textarea + "Add a comment", per-comment delete when canDelete, relative-friendly `toLocaleString()` dates); `/favorites` = server component rendering `<MediaGrid query="favorite=1" />`; `MediaGrid` accepts optional `query?: string` prop appended to the fetch URL (`/api/media?favorite=1&cursor=...`) — default unchanged.

- [ ] **Step 1: HeartButton** — client; optimistic flip + count adjust; POST/DELETE per state; revert on failure; `aria-pressed`; classes sized for grandparents (`px-5 py-3 text-2xl`).
- [ ] **Step 2: CommentThread** — client; established form idiom (busy/error/try-catch/safe-parse); empty state "No comments yet — share a memory."
- [ ] **Step 3: Detail page** — heart button next to the download button; CommentThread below the tabs under a "Comments" heading.
- [ ] **Step 4: MediaGrid** — add `query` prop; also render a small `❤️ n` badge on tiles when `heartCount > 0` (bottom-left, like the 📄 badge pattern).
- [ ] **Step 5: `/api/media` favorite filter** — `favorite=1` → `where: {favorites: {some: {userId: viewer.id}}}` (viewer already resolved for hearts include).
- [ ] **Step 6: Favorites page** — heading "Favorites" + `<MediaGrid query="favorite=1" />`; empty state comes from MediaGrid (adjust its empty-state copy when query includes favorite: "Nothing here yet — tap the ❤️ on any photo to save it here.").
- [ ] **Step 7: Verify** — `tsc`/`lint`/`build` clean; routes unchanged count. Record outputs.
- [ ] **Step 8: Commit**

```bash
git add components/heart-button.tsx components/comment-thread.tsx components/media-grid.tsx "app/(app)/media/[id]/page.tsx" "app/(app)/favorites/page.tsx" app/api/media/route.ts
git commit -m "feat: heart button, comments, favorites page"
```

---

### Task 5: Search + filter chips on the Library

**Files:**
- Create: `components/library-controls.tsx`
- Modify: `app/api/media/route.ts` (q/type/decade/albumId), `app/(app)/page.tsx`, `components/media-grid.tsx` (re-fetch when query prop changes)

**Interfaces:**
- Consumes: existing listing route + MediaGrid `query` prop (Task 4).
- Produces:
  - `/api/media` params: `q` (contains, case-insensitive, across title/description/location/originalFilename via `OR`), `type` (`PHOTO`|`DOCUMENT`), `decade` (int year like 1960 → `dateYear: {gte: 1960, lte: 1969}`), `albumId` (`albumItems: {some: {albumId}}`). All composable with cursor pagination and `favorite`.
  - `GET /api/media/filters` (same file, or computed inline in the Library page server-side — implementer choice): available decades (`SELECT DISTINCT dateYear/10`) and albums (id+name) for chip rendering.
  - `<LibraryControls />` client component managing state in URL search params (`useRouter`/`useSearchParams`, shallow push): search input (debounced 300ms), chip rows — Type: All/Photos/Documents; Decade: All + each present decade ("1960s"); Album: All + album names; view toggle Grid/Timeline (Timeline wired in Task 6 — until then the toggle renders only Grid active). MediaGrid receives the serialized query string and refetches on change (reset items/cursor when query changes — add a `useEffect` on the query prop).

- [ ] **Step 1: Route filters** — build the `where` object compositionally; validate `type` against the enum, `decade` as integer, ignore invalid params (don't 400 — filters are UX, degrade gracefully).
- [ ] **Step 2: LibraryControls + page wiring** — Library page becomes: heading, `<LibraryControls decades={...} albums={...} />` (server page computes distinct decades + album list via prisma and passes them down), `<MediaGrid query={serializedFromSearchParams} />`. The page reads `searchParams` (Next 16: `searchParams: Promise<...>` — await it).
- [ ] **Step 3: MediaGrid re-fetch on query change** — reset state when `query` changes; keep infinite scroll working per filter set.
- [ ] **Step 4: Verify** — module-level: tsx script exercising the `where`-builder against local DB with 3 temp items (one 1962 PHOTO "Grandma", one 1971 DOCUMENT, one undated) asserting q/type/decade combos return expected ids; cleanup. `tsc`/`lint`/`build` clean. Record outputs.
- [ ] **Step 5: Commit**

```bash
git add components/library-controls.tsx app/api/media/route.ts "app/(app)/page.tsx" components/media-grid.tsx
git commit -m "feat: library search and filter chips"
```

---

### Task 6: Timeline view

**Files:**
- Create: `app/api/media/timeline/route.ts`, `components/timeline-view.tsx`
- Modify: `app/(app)/page.tsx` + `components/library-controls.tsx` (activate the Timeline toggle)

**Interfaces:**
- Consumes: `mediaItemToDTO`, LibraryControls' view param (`view=timeline` in URL).
- Produces: `GET /api/media/timeline` → `{decades: {decade: number, years: {year: number, items: MediaItemDTO[]}[]}[], undated: MediaItemDTO[]}` — READY + non-deleted only, decades desc, years desc within, items by createdAt desc; no pagination (family scale; revisit if the archive outgrows it — note in route comment). `<TimelineView />` fetches it and renders sticky decade headers ("1960s"), year subheadings, thumb grids per year, "Undated" section last with a hint ("Add a year on a photo's Details tab to place it in time."). Library page renders TimelineView instead of MediaGrid when `view=timeline`.

- [ ] **Step 1: Route** — single query `findMany` (READY, deletedAt null, include hearts/_count for badges) then group in JS by `dateYear`: decade = `Math.floor(year/10)*10`; nulls → undated.
- [ ] **Step 2: TimelineView component** — client; loading/error/empty states per house idiom; tiles link to `/media/{id}` (reuse the tile markup shape from MediaGrid — extract a shared `MediaTile` component into `components/media-grid.tsx`'s file and export it rather than duplicating).
- [ ] **Step 3: Wire the toggle** — `view` URL param via LibraryControls; page branches.
- [ ] **Step 4: Verify** — module-level grouping check with temp rows (1962, 1968, 1971, undated → decades [1970,1960], years nested, undated 1); cleanup; `tsc`/`lint`/`build`. Record outputs.
- [ ] **Step 5: Commit**

```bash
git add app/api/media/timeline components/timeline-view.tsx components/library-controls.tsx components/media-grid.tsx "app/(app)/page.tsx"
git commit -m "feat: timeline view grouped by decade and year"
```

---

### Task 7: Deploy + acceptance

**Files:** none new.

- [ ] **Step 1: Full local gate** — `npx tsc --noEmit`, `npm run lint`, `npm run build`; route table includes `/api/albums`, `/albums/[id]`, `/api/media/timeline`, `/favorites`.
- [ ] **Step 2: Push**

```bash
git push origin main
```

Both Railway deployments SUCCESS; spot-check `https://mirandafamilyarchives.com/albums` returns auth redirect or 200.

- [ ] **Step 3: Production acceptance (human)** — ask the user to: create an album, add photos, drag to reorder, set a cover, see it on `/albums`; heart a few photos and check `/favorites`; comment on a photo (and delete the comment); search for a word from a title; filter by decade and by Photos/Documents; switch to Timeline and confirm decade→year grouping with the undated section.

---

## Deferred (explicitly NOT in this plan)

- People filter chips + person-based browsing → Phase 5 (family tree provides Person records + tagging).
- Digest wiring for social events → none needed ever (spec §8 excludes them); album audit rows exist but Phase 6's digest filters them out by entityType.
- Timeline pagination — revisit only if the archive outgrows single-response scale.
- Comment editing — delete-and-repost covers v1.

## Phase 4 exit criteria

- Albums: create/edit/delete (audited, `entityType: 'album'`), add/remove items, drag-to-reorder persists, covers show on the album grid.
- One heart gesture = social count + personal Favorites page.
- Comment threads on items with own/admin delete.
- Library search (title/description/location/filename) + chips (type, decade, album) compose with infinite scroll.
- Timeline toggle renders decade→year sections with an Undated tail.
