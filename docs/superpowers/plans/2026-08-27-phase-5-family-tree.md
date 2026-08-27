# Phase 5: Family Tree Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** People records with avatars (photo-picked, uploaded, or gender silhouettes), parent/spouse relationships with a pan/zoom tree, person profiles showing their tagged photos, photo people-tagging, and the People filter in the library.

**Architecture:** People/relationship mutations flow through new audited helpers (`entityType: 'person'` — these CREATE rows are Phase 6's "new family member" digest source). Tag mutations audit onto the *media item* (spec §7: people-tags are major media changes → digest-worthy). The tree is a pure layout function (generations via ancestor depth, spouses adjacent, SVG edges) rendered in a CSS-transform pan/zoom container — no new dependencies; editing is form-based only (spec §6).

**Tech Stack:** existing stack only. Avatars: small-image upload resized server-side with `sharp` (already a dependency) or picked from a tagged photo's existing thumbnail.

**Spec:** `docs/superpowers/specs/2026-08-26-miranda-family-archives-design.md` (§3 people/relationships tables, §6 Family tree page, §7 audit, §11 phase 5)

## Global Constraints

- **NO automated tests** — manual verification per task with recorded output and cleanup. (The tree layout function gets a module-level assertion script — it's the one piece of real algorithmic logic.)
- TypeScript, `@/*` alias. NEW routes use a shared `requireUser()` from `lib/require-user.ts` (created in Task 1 — the Phase 4 backlog extraction); existing routes stay untouched.
- Audit (spec §7): person create/update/soft-delete/restore and relationship add/remove → `entityType: 'person'`, `{field: {from, to}}` diffs, same-transaction where the helper mutates. Media tag/untag → `entityType: 'media_item'`, `changes: {people: {from: string[], to: string[]}}` (name arrays). Nothing else audited.
- People soft-delete (`Person.deletedAt`): members create/edit people; **ADMIN-only delete/restore** (mirrors media, spec §5). Deleted people join `/admin/deleted` (new section). Deleted people are filtered from all lists, tags displays, tree, and pickers.
- Relationship integrity, enforced server-side: no self-parent/self-spouse; no duplicate rows; adding a parent must not create an ancestry cycle (walk the parent's ancestors — reject if the child appears); max 2 parents is NOT enforced (step-parents welcome, spec keeps v1 simple).
- Gender drives the default avatar silhouette: `MALE` 👨, `FEMALE` 👩, `UNSPECIFIED` 👤 (rendered client-side when no avatarKey).
- Avatar storage: bucket key in `Person.avatarKey` — either `avatars/{personId}.jpg` (uploaded, sharp-resized to 400px JPEG server-side, 5MB upload cap) or an existing `derived/{mediaId}/thumb.jpg` (picked from a photo the person is tagged in; derived keys are stable).
- Siblings are DERIVED (shared parent), never stored (spec §3).
- Existing interfaces (do not rename): `mediaItemToDTO`, `MediaGrid query prop`, `LibraryControls`, `lib/audit.ts` helpers, `signGetUrl`, `AdminItemActions` pattern, `HistoryList` LABELS map.
- Work on `main`; commit per task; push only at the final task. Commit trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## File map

| File | Responsibility |
|---|---|
| `lib/require-user.ts` | Shared `requireUser()` (Phase 4 backlog) |
| `lib/audit.ts` | + person + relationship + media-tag audit helpers |
| `lib/people.ts` | PersonDTO/PersonLite + converters (avatar URL signing, relationship assembly, sibling derivation) |
| `app/api/people/route.ts` | GET list, POST create |
| `app/api/people/[id]/route.ts` | GET (full profile DTO), PATCH, DELETE (admin) |
| `app/api/people/[id]/restore/route.ts` | POST (admin) |
| `app/api/people/[id]/parents/route.ts` | POST add / DELETE remove parent |
| `app/api/people/[id]/spouses/route.ts` | POST add / DELETE remove spouse |
| `app/api/people/[id]/avatar/route.ts` | POST upload (FormData→sharp→bucket) / PUT pick-from-photo / DELETE clear |
| `app/api/media/[id]/people/route.ts` | POST tag / DELETE untag (audited on media) |
| `lib/tree-layout.ts` | Pure layout: people+relationships → positioned nodes + edges |
| `components/person-avatar.tsx` | Avatar or gender silhouette, sized variants |
| `components/person-form.tsx` | Create/edit person fields |
| `components/person-relations.tsx` | Add/remove parent & spouse pickers, derived siblings display |
| `components/person-picker.tsx` | Search-select of people (shared by relations + tagger) |
| `components/people-tagger.tsx` | "People in this photo" chips + add/remove on detail page |
| `components/tree-view.tsx` | Pan/zoom canvas rendering layout + SVG edges |
| `components/people-list.tsx` | Directory cards (List view of /tree) |
| `app/(app)/tree/page.tsx` | List \| Tree toggle, Add person |
| `app/(app)/people/[id]/page.tsx` | Person profile |
| `app/(app)/media/[id]/page.tsx` | + PeopleTagger in Details tab |
| `app/(app)/admin/deleted/page.tsx` | + Deleted people section |
| `app/api/media/route.ts` + `components/library-controls.tsx` | personId filter + People chips |

---

### Task 1: People & relationship audit helpers + API

**Files:**
- Create: `lib/require-user.ts`, `lib/people.ts`, `app/api/people/route.ts`, `app/api/people/[id]/route.ts`, `app/api/people/[id]/restore/route.ts`, `app/api/people/[id]/parents/route.ts`, `app/api/people/[id]/spouses/route.ts`
- Modify: `lib/audit.ts` (append person + relationship helpers)

**Interfaces:**
- Consumes: `prisma`, `signGetUrl`, established audit patterns.
- Produces:
  - `lib/require-user.ts`: `requireUser(): Promise<{user: User} | {error: NextResponse}>` — exact body of the Phase 4 items-route helper, exported.
  - `lib/audit.ts` additions (all with `entityType: 'person'`):
    - `EDITABLE_PERSON_FIELDS = ['displayName','maidenName','gender','birthYear','deathYear','birthplace','notes'] as const`
    - `validPersonInput(input): string | null` (error message or null): displayName non-empty string when present; maidenName/birthplace/notes string|null; gender one of MALE/FEMALE/UNSPECIFIED; birthYear/deathYear null or 4-digit integer (1000–3000); deathYear ≥ birthYear when both present; rejects objects/arrays (same typing rigor as validFieldValue).
    - `createPersonWithAudit(actorUserId, data: {displayName: string} & Partial<...>): Promise<{id}>` (txn; CREATE row `{displayName: {from: null, to: name}}`)
    - `updatePersonWithAudit(personId, actorUserId, input): Promise<{changed: string[]}>` (diff, no-op safe, txn)
    - `softDeletePersonWithAudit(personId, actorUserId)` / `restorePersonWithAudit(personId, actorUserId)` (mirror the media pair, DELETE/UPDATE rows)
    - `addParentWithAudit(childId, parentId, actorUserId)` — validates: both exist & not deleted, not self, no duplicate, **no ancestry cycle** (BFS up from `parentId` through ParentChild; reject if `childId` found); txn creates row + audit UPDATE on the CHILD `{parents: {from: [...parentNames], to: [...]}}`.
    - `removeParentWithAudit(childId, parentId, actorUserId)`, `addSpouseWithAudit(personAId, personBId, actorUserId)` (normalize: store with the two ids in either order but reject duplicates in BOTH orders; not-self; both alive rows), `removeSpouseWithAudit(...)` (delete whichever orientation exists) — spouse audit rows go on personA with `{spouses: {from: names[], to: names[]}}`.
  - `lib/people.ts`:
    - `PersonLite = {id, displayName, gender, birthYear, deathYear, avatarUrl: string | null}`
    - `PersonDTO = PersonLite & {maidenName, birthplace, notes, tagCount: number, parents: PersonLite[], children: PersonLite[], spouses: PersonLite[], siblings: PersonLite[], createdAt: string}`
    - `personToLite(p: Person): Promise<PersonLite>` (signs avatarKey when set)
    - `personToDTO(personId: string): Promise<PersonDTO | null>` — loads the person (deletedAt null) + relations + `_count` of mediaTags on non-deleted media; siblings = people sharing ≥1 parent, deduped, excluding self; all relation lists exclude deleted people.
  - HTTP contract:
    - `GET /api/people` → `{people: (PersonLite & {tagCount: number})[]}` alphabetical by displayName; deleted excluded.
    - `POST /api/people` `{displayName, ...}` → `{id}` (validated).
    - `GET /api/people/[id]` → `{person: PersonDTO}` (404 deleted/missing).
    - `PATCH /api/people/[id]` partial → `{ok, changed}` (member).
    - `DELETE /api/people/[id]` → ADMIN, soft delete. `POST /api/people/[id]/restore` → ADMIN.
    - `POST /api/people/[id]/parents` `{parentId}` → `{ok}` (400 with reason on any integrity violation, incl. `'that would make someone their own ancestor'` for cycles); `DELETE .../parents?parentId=`.
    - `POST /api/people/[id]/spouses` `{spouseId}` / `DELETE .../spouses?spouseId=`.

- [ ] **Step 1: `lib/require-user.ts`** — extract the helper verbatim from `app/api/albums/[id]/items/route.ts`, export it, and switch THAT file's local copy to the import (single existing-file touch proving the extraction; other old routes untouched).

- [ ] **Step 2: audit + validation helpers in `lib/audit.ts`.** The cycle check:

```typescript
/** True if `candidateAncestorId` has `personId` anywhere in their ancestor chain — used to block cycles. */
async function wouldCreateCycle(childId: string, parentId: string): Promise<boolean> {
  const seen = new Set<string>()
  let frontier = [parentId]
  while (frontier.length > 0) {
    if (frontier.includes(childId)) return true
    const rows = await prisma.parentChild.findMany({
      where: { childId: { in: frontier } },
      select: { parentId: true },
    })
    frontier = rows.map((r) => r.parentId).filter((id) => !seen.has(id))
    frontier.forEach((id) => seen.add(id))
  }
  return false
}
```

Relationship audit rows compute the name arrays with one query before + after inside the transaction scope (query current parent/spouse names, apply change, write audit with from/to arrays).

- [ ] **Step 3: `lib/people.ts`** — sibling derivation:

```typescript
// siblings: anyone sharing at least one parent, excluding self and deleted people
const parentIds = parents.map((p) => p.id)
const siblingRows = parentIds.length
  ? await prisma.parentChild.findMany({
      where: { parentId: { in: parentIds }, NOT: { childId: personId } },
      include: { child: true },
    })
  : []
const siblings = dedupeById(siblingRows.map((r) => r.child).filter((c) => c.deletedAt === null))
```

- [ ] **Step 4: routes** per contract; new routes use `requireUser()`; validation errors 400 with the specific message; admin checks mirror media DELETE/restore.

- [ ] **Step 5: Verify module-level** — tsx harness (local docker Postgres): create 4 temp people (Grandpa, Grandma, Dad, Kid); spouse Grandpa↔Grandma (assert duplicate-both-orders rejected); parent chains Grandpa→Dad→Kid; **assert cycle rejection**: addParent(Grandpa, Kid) → error; assert Kid's DTO shows parents [Dad], siblings [] then add a second child of Dad and assert sibling appears; soft-delete + restore a person with audit rows checked (entityType 'person', CREATE/UPDATE/DELETE actions); validPersonInput matrix (bad gender, float year, object value → errors). Full cleanup; record outputs. `tsc`/`lint`/`build` clean.

- [ ] **Step 6: Commit**

```bash
git add lib/require-user.ts lib/people.ts lib/audit.ts app/api/people "app/api/albums/[id]/items/route.ts"
git commit -m "feat: audited people and relationships API with cycle protection"
```

---

### Task 2: Person UI — directory, form, profile, relations, admin-deleted section

**Files:**
- Create: `components/person-avatar.tsx`, `components/person-form.tsx`, `components/person-relations.tsx`, `components/person-picker.tsx`, `components/people-list.tsx`, `app/(app)/people/[id]/page.tsx`
- Modify: `app/(app)/tree/page.tsx` (replace placeholder: heading, List|Tree toggle [Tree disabled until Task 4], Add-person flow, `<PeopleList />`), `app/(app)/admin/deleted/page.tsx` (add Deleted people section with restore)

**Interfaces:**
- Consumes: Task 1 HTTP contract; house form idiom (`components/media-edit-form.tsx`); `AdminItemActions` pattern for delete/restore buttons (make a person variant inline — do not modify AdminItemActions).
- Produces: `<PersonAvatar person={PersonLite} size={'sm'|'md'|'lg'} />` (image via avatarUrl or gender silhouette emoji in a colored circle); `<PersonPicker exclude={string[]} onPick={(p: PersonLite) => void} />` (client, fetches /api/people once, text-filter, large touch rows — shared by relations + Task 5 tagger); `<PersonForm person?>` create/edit; `<PersonRelations person={PersonDTO} />` (Parents/Spouses/Children/Siblings sections; add-parent + add-spouse via PersonPicker; remove buttons with confirm; children/siblings read-only lists linking to profiles — children are edited from the child's own profile); `<PeopleList />` (avatar cards grid → profiles; tagCount badge "n photos"); profile page (server component: personToDTO, notFound, PersonAvatar lg + vitals + PersonForm edit toggle + PersonRelations + admin delete button; "See their photos" link to `/?personId={id}` — inert until Task 5 wires the filter, include it now).
- Verification: `tsc`/`lint`/`build` clean; `/people/[id]` + `/tree` in route table; unauthenticated curls redirect. Commit `feat: people directory, profiles, and relationship management`.

---

### Task 3: Avatars — upload, pick-from-photo, clear

**Files:**
- Create: `app/api/people/[id]/avatar/route.ts`
- Modify: `components/person-form.tsx` or profile page (avatar controls), `lib/people.ts` (nothing — avatarKey already signed)

**Interfaces:**
- Consumes: `s3`/`BUCKET` PutObject, `sharp`, `requireUser`, MediaPerson rows (for pick-from-photo choices).
- Produces:
  - `POST /api/people/[id]/avatar` — `multipart/form-data` field `file`: ≤5MB, mime image/*; server: `sharp(buffer).rotate().resize({width: 400, height: 400, fit: 'cover'}).jpeg({quality: 82})` → PutObject `avatars/{personId}.jpg` → set avatarKey (audited via `updatePersonWithAudit` path? NO — avatar changes are cosmetic; ruling: avatar set/clear IS audited as a person UPDATE `{avatarKey: {from, to}}` since spec §7 audits people changes; use a direct small txn mirroring updatePersonWithAudit).
  - `PUT /api/people/[id]/avatar` `{mediaId}` — person must be TAGGED in that media (400 otherwise); media READY non-deleted; sets avatarKey to `derived/{mediaId}/thumb.jpg` (audited same way).
  - `DELETE /api/people/[id]/avatar` — clears to null (audited).
  - UI on the profile page: "Change photo" menu → Upload a photo (file input) / Choose from their photos (grid of tagged-photo thumbs — fetch `/api/media?personId={id}` once Task 5 lands; until then show only when tagCount > 0 and hide gracefully on empty) / Use silhouette (clear).
- Verification: module-level — generate a small test JPEG with sharp, POST-path logic exercised via direct function calls (route logic factored so the sharp+put+audit path is callable), assert bucket object exists at avatars/{id}.jpg (then delete), avatarKey set, audit row present; oversized (6MB buffer) rejected; PUT with untagged media rejected. Cleanup. `tsc`/`lint`/`build`. Commit `feat: person avatars — upload, photo pick, silhouette`.

---

### Task 4: Tree layout + pan/zoom visualization

**Files:**
- Create: `lib/tree-layout.ts`, `components/tree-view.tsx`
- Modify: `app/(app)/tree/page.tsx` (activate Tree toggle)

**Interfaces:**
- Consumes: `GET /api/people` won't suffice — add `GET /api/people?full=1` in THIS task returning `{people: PersonLite[], parentLinks: {childId, parentId}[], spouseLinks: {personAId, personBId}[]}` (deleted people and links touching them excluded).
- Produces:
  - `lib/tree-layout.ts` (pure, no prisma — unit-verifiable):

```typescript
export type TreeNode = { id: string; x: number; y: number }
export type TreeEdge =
  | { kind: 'parent'; from: string; to: string } // parent -> child
  | { kind: 'spouse'; a: string; b: string }
export type TreeLayout = { nodes: TreeNode[]; edges: TreeEdge[]; width: number; height: number }

export function layoutTree(
  people: { id: string }[],
  parentLinks: { childId: string; parentId: string }[],
  spouseLinks: { personAId: string; personBId: string }[],
  opts = { cardW: 176, cardH: 88, gapX: 32, gapY: 96 }
): TreeLayout
```

  Algorithm (implement exactly): (1) generation = longest ancestor-chain depth (memoized DFS; cycle-safe because the API prevents cycles, but guard with a visiting set anyway → treat back-edge as depth 0). (2) Pull spouses into the same generation (max of the pair). (3) Within a generation, order nodes by: family cluster (children under the mean x of their parents where parents are already placed — process generations top-down), spouses adjacent (place b immediately after a). (4) Assign x by cumulative slot index resolving overlaps left-to-right; y = generation * (cardH + gapY). (5) Edges: one 'spouse' edge per couple; one 'parent' edge per ParentChild link. Return canvas width/height.
  - `components/tree-view.tsx`: fetches `?full=1`; renders a relative container with `transform: translate(pan) scale(zoom)`; wheel → zoom (0.4–2.5, cursor-centered is NOT required — center zoom fine), pointer drag → pan (ignore drags starting on a card); SVG `<line>`/`<path>` edges underneath absolutely-positioned cards (PersonAvatar sm + name + years) that link to `/people/[id]`; zoom +/− buttons and "Fit" (reset) for the grandparents; empty state "No people yet — add the first family member."
  - Tree page toggle activated (List | Tree).
- Verification: module-level layout assertions — build the 3-generation fixture (Grandpa♥Grandma → Dad; Dad♥Mom → Kid1, Kid2): assert generations {Grandpa,Grandma,Mom? no — Mom has no parents but spouse Dad pulls her to gen 1}, spouses adjacent, kids below Dad/Mom mean x, no overlapping x within a generation, edge counts (2 spouse, 3 parent). Record output. `tsc`/`lint`/`build`. Commit `feat: family tree layout and pan/zoom view`.

---

### Task 5: Photo tagging + People filter

**Files:**
- Create: `app/api/media/[id]/people/route.ts`, `components/people-tagger.tsx`
- Modify: `lib/audit.ts` (tag audit helper), `app/(app)/media/[id]/page.tsx` (mount tagger in Details tab), `app/api/media/route.ts` (personId param), `components/library-controls.tsx` (People chips), `lib/media.ts` (DTO: `people: PersonLite[]` on detail), `app/(app)/people/[id]/page.tsx` (tagged-photos grid via `<MediaGrid query={'personId=' + id} />`), `components/history-list.tsx` (LABELS: `people: 'the people'`)

**Interfaces:**
- Consumes: PersonPicker (Task 2), MediaGrid query prop, requireUser.
- Produces:
  - `lib/audit.ts`: `setMediaPeopleWithAudit(mediaId, actorUserId, change: {addPersonId?: string, removePersonId?: string}): Promise<void>` — loads current tag names (non-deleted people), applies the single add/remove (409-equivalent errors as thrown {status} for dup add / missing remove; person must exist non-deleted; media READY-or-PROCESSING non-deleted), writes MediaPerson row + audit UPDATE on the MEDIA (`entityType 'media_item'`, `changes: {people: {from: names[], to: names[]}}`) in one txn.
  - `POST /api/media/[id]/people` `{personId}` → `{ok}`; `DELETE .../people?personId=` → `{ok}` (member).
  - `<PeopleTagger mediaId people={PersonLite[]} />` — chips (PersonAvatar sm + name, × to remove with confirm) + "Tag a person" → PersonPicker (exclude= current tags) → POST → router.refresh().
  - `/api/media` `personId` param → `people: {some: {personId}}` (composable, invalid ignored).
  - LibraryControls People chip row (people list passed from the Library server page like decades/albums — only when people exist).
  - MediaItemDTO detail gains `people: PersonLite[]` (include mediaPeople→person, filter deleted).
- Verification: module-level — temp person + media; tag (assert MediaPerson row + media audit row with people from [] to [name]); duplicate tag rejected; untag (audit to []); personId filter returns the item; deleted person excluded from DTO people. Cleanup; `tsc`/`lint`/`build`. Commit `feat: photo people-tagging with People filter`.

---

### Task 6: Deploy + acceptance

- [ ] Full gate (`tsc`/`lint`/`build`; route table: /api/people*, /people/[id], /api/media/[id]/people). Push origin main (authorized); both Railway deployments SUCCESS; `/tree` spot-check auth-redirects.
- [ ] Production acceptance (human): add several family members with birth years; set genders and watch silhouettes; marry two, add children; open the Tree view — pan, zoom, click through to a profile; upload an avatar for one person and photo-pick for another; tag people in photos from the detail page; click a person's "See their photos"; use the People chip in the library; check a tagged photo's History shows the people change; admin-delete a person and restore them from /admin/deleted.

---

## Deferred (explicitly NOT in this plan)

- GEDCOM import/export, sources/citations, complex relationship types (spec §10).
- Tree print/export, auto-layout refinements for very wide generations (revisit if the family outgrows it).
- Add-photos picker search (Phase 4 backlog — remains open; Phase 6 polish candidate).

## Phase 5 exit criteria

- People CRUD with audited changes; ADMIN soft-delete/restore incl. `/admin/deleted` section.
- Relationships: spouse + parent links with duplicate/self/cycle protection; siblings derived on profiles.
- Tree view: pan/zoom, generation layout, spouse-adjacent, clickable cards; editing only via forms.
- Avatars: upload (sharp 400px), pick-from-tagged-photo, silhouette fallback by gender.
- Tagging: chips on the item Details tab, audited as media people-changes (visible in History); person profiles and the library People chip filter photos by person.
