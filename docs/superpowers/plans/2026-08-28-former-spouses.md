# Former Spouses Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Support divorced/separated relationships: mark a spouse link as "former", place ex-partners adjacent on the family tree with a dashed connecting line, and show the relationship plainly on the person page.

**Architecture:** One new `former Boolean @default(false)` column on the existing `Spouse` join table — no new models. Former spouses participate in generation-pulling and cluster adjacency exactly like current spouses (that's the point: Thomas lands NEXT TO Susan); only the rendered line differs (dashed). A cluster-ordering pass arranges each spouse-cluster as a path so a person with two partners sits between them. Audit reuses the existing before/after spouse-name-list diff with a " (former)" suffix; relationship changes stay non-digest-worthy (existing rule).

**Tech Stack:** Existing stack only. No new deps.

**Spec:** user request (2026-08-28) building on the accepted tree work; base spec docs/superpowers/specs/2026-08-26-miranda-family-archives-design.md (§5: members manage relationships; grandparent rules). Plain-words vocabulary: "former spouse" (not "ex", not "divorced" — we don't record why).

## Global Constraints

- NO automated tests (standing decision). lib/tree-layout.ts changes verify via a workspace assertion script like prior rounds.
- Grandparent rules: ≥44px targets, ≥18px text, plain words.
- Audit: same-transaction {field:{from,to}} diffs; spouse-name lists get " (former)" suffixes so history sentences stay readable; `spouses` remains OUT of digest allowlists (verify no digest change needed).
- lib/tree-layout.ts: generation logic (joint fixed point) and connector-lane logic must remain byte-identical in behavior; only clustering ORDER within a generation item and the spouse-edge type may change.
- House patterns: requireUser/safeErrorResponse, status-tagged throws in lib/audit.ts.
- Commit trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. Work on `main`; controller pushes after review.

## File map

| File | Responsibility |
|---|---|
| `prisma/schema.prisma` + migration `add_former_spouses` | `former Boolean @default(false)` on Spouse |
| `lib/audit.ts` | addSpouseWithAudit gains `former` param; new `setSpouseFormerWithAudit`; `currentSpouseNames` appends " (former)" |
| `app/api/people/[id]/spouses/route.ts` | POST accepts `former?: boolean`; new PATCH `{ spouseId, former }` toggles |
| `lib/people.ts` | `PersonDTO.spouses: (PersonLite & { former: boolean })[]` |
| `app/api/people/route.ts` | full=1 payload: spouseLinks gain `former` |
| `lib/tree-layout.ts` | TreeEdge spouse gains `former: boolean` (passthrough); cluster path-ordering |
| `components/tree-view.tsx` | dashed stroke for former-spouse edges |
| `components/person-relations.tsx` | "Former spouse" badge, add-flow checkbox, mark-as-former/current action |

---

### Task 1: Data model, audit, API, DTO

**Files:**
- Modify: `prisma/schema.prisma` (+ `npx prisma migrate dev --name add_former_spouses`, `npx prisma generate`), `lib/audit.ts`, `app/api/people/[id]/spouses/route.ts`, `lib/people.ts`, `app/api/people/route.ts`

**Interfaces (Tasks 2–3 rely on these exactly):**
- `PersonDTO.spouses: (PersonLite & { former: boolean })[]` (was `PersonLite[]`)
- `GET /api/people?full=1` → `spouseLinks: { personAId, personBId, former: boolean }[]`
- `POST /api/people/[id]/spouses` body `{ spouseId, former?: boolean }` (absent = false)
- `PATCH /api/people/[id]/spouses` body `{ spouseId, former: boolean }` → `{ ok: true }`; 404 `'that spouse relationship does not exist'` if no link either direction; no-op-tolerant (setting the current value succeeds quietly)
- `lib/audit.ts`: `addSpouseWithAudit(personAId, personBId, actorUserId, former = false)`; `setSpouseFormerWithAudit(personAId, personBId, actorUserId, former: boolean)`

- [ ] **Step 1 — schema:** add `former Boolean @default(false)` to `model Spouse`. Migrate + generate. Existing rows default to false (current) — correct for all existing data.
- [ ] **Step 2 — audit helpers (`lib/audit.ts`):**
  - `currentSpouseNames`: for each spouse row include the flag — return names as `displayName` or `` `${displayName} (former)` `` when the row's `former` is true, still sorted. (Find the existing helper near addSpouseWithAudit; it queries both directions.)
  - `addSpouseWithAudit`: add trailing param `former = false`; pass into `tx.spouse.create({ data: { personAId, personBId, former } })`. Everything else (validation, before/after diff shape) unchanged.
  - New `setSpouseFormerWithAudit(personAId, personBId, actorUserId, former)`: locate the row in either direction (mirror removeSpouseWithAudit's forward/backward lookup); 404-throw if missing; in one transaction update `former` and write the same `{ spouses: { from: beforeNames, to: afterNames } }` UPDATE diff on `personAId`. If the value is already `former`, still succeed (write no audit row — no-op).
- [ ] **Step 3 — route:** POST reads optional `former` (must be boolean if present, else 400 `'former must be true or false'`); PATCH per the interface above using `setSpouseFormerWithAudit`. DELETE unchanged.
- [ ] **Step 4 — DTO (`lib/people.ts`):** thread the flag: when collecting `spousesA`/`spousesB`, keep each row's `former` alongside the partner Person, dedupe by id keeping the first, and produce `(PersonLite & { former })[]`. Update the `PersonDTO` type.
- [ ] **Step 5 — full graph (`app/api/people/route.ts`):** add `former: l.former` to the spouseLinks mapping.
- [ ] **Step 6 — verify:** `tsc`/`lint`/`build` clean; `npx prisma migrate status` applied. Note in the report: `spouses` is not in PERSON_DIGEST_FIELDS (lib/digest.ts) so digest needs no change — verify by reading, state it.
- [ ] **Step 7 — commit:** `feat: former-spouse flag on relationships (model, audit, API)`

---

### Task 2: Tree — dashed edges + path-ordered clusters

**Files:**
- Modify: `lib/tree-layout.ts`, `components/tree-view.tsx`

**Interfaces:**
- Consumes: Task 1's `spouseLinks[].former` via the tree-view fetch.
- Produces: `TreeEdge` spouse variant becomes `{ kind: 'spouse'; a: string; b: string; former: boolean }`; `layoutTree`'s `spouseLinks` param type gains optional `former?: boolean` (default false) so existing callers/tests stay valid.

- [ ] **Step 1 — passthrough:** `layoutTree` accepts `former` on spouse links and emits it on the spouse edges. Generation pulling, pushdown, centering, connector lanes: UNCHANGED (former spouses cluster and pull identically — that is the feature).
- [ ] **Step 2 — cluster path-ordering:** in `buildGenerationItems` (or a small ordering step after it), order each multi-member cluster's `members` as a path through the cluster's spouse-link graph when the graph IS a path (every member degree ≤ 2, exactly two degree-1 endpoints, connected): start at a degree-1 endpoint (tie-break: the endpoint whose id sorts lower, for determinism) and walk. Non-path clusters (triangles, stars of degree ≥3) keep the existing BFS order. Effect: Thomas — Susan — Christopher, with Susan between her former and current spouse, no spouse line crossing a card.
- [ ] **Step 3 — render (`components/tree-view.tsx`):** spouse edges with `edge.former` get `strokeDasharray="6 6"` (same color/width); current spouses unchanged.
- [ ] **Step 4 — verify:** workspace assertion script (git-ignored, NOT committed) in this plan's SDD workspace: (1) the Susan shape — spouses {S,C} current + {S,T} former, T also co-parent of B: assert T, S, C all on one row, S adjacent to BOTH (|xS−xT| = |xS−xC| = spacingX), and the spouse edges carry the right `former` flags; (2) generation/centering invariants from prior rounds still hold (no overlap, parents above children, min x = 0, y-values unchanged vs current HEAD algorithm for a non-spouse-flag input); (3) a triangle cluster falls back to BFS order without error; (4) determinism. Plus `tsc`/`lint`/`build`.
- [ ] **Step 5 — commit:** `feat: dashed former-spouse lines and path-ordered spouse clusters`

---

### Task 3: Person page UI + deploy + acceptance

**Files:**
- Modify: `components/person-relations.tsx`

**Interfaces:**
- Consumes: `PersonDTO.spouses[].former`, POST `former` field, PATCH endpoint — exactly as Task 1 shipped them.

- [ ] **Step 1 — display:** in the Spouses section rows, show a muted `Former spouse` label under/next to the name when `former` (≥18px, `text-ink-soft`). Current spouses get no label.
- [ ] **Step 2 — add flow:** when adding a spouse, a labeled checkbox (≥44px touch row): `This is a former spouse (they were married or together before)` — sends `former: true` on POST. Default unchecked.
- [ ] **Step 3 — toggle:** each spouse row gains a secondary text button: for current spouses `Mark as former spouse`, for former `Mark as current spouse` → PATCH → `router.refresh()`; busy state disables the row's buttons; errors surface in the existing inline error line. No confirm dialog (easily reversible).
- [ ] **Step 4 — verify + deploy:** `tsc`/`lint`/`build`; controller pushes; both Railway deployments SUCCESS.
- [ ] **Step 5 — commit** (before controller push): `feat: former-spouse controls on the person page`
- [ ] **Step 6 (human acceptance):** live: add Thomas as Susan's former spouse → tree shows Thomas beside Susan with a dashed line (and Susan between Thomas and Christopher); person pages show "Former spouse"; toggle works both ways; history shows readable spouse-list changes with "(former)"; tomorrow's digest does NOT mention relationship changes.

## Phase exit criteria

- Former-spouse links render adjacent + dashed on the tree; person pages label and manage them; audit history readable; digest unaffected; deployed and user-accepted.
