# Phase 6: Digest & Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The daily activity digest (Resend, 11am ET, only when something happened), a real Settings page with the email toggle and admin invites, and the visual polish pass that gives the archive its own warm identity — completing v1.

**Architecture:** The digest is a pg-boss cron job in the existing worker: collect last-24h digest-worthy AuditLog events (the rows Phases 3–5 already write), dedupe per entity, render an inline-styled HTML email with 6-day presigned thumbnails, date-lock via `DigestLog` for idempotency, send per opted-in user via Resend. Settings/invites are thin routes over existing patterns (Clerk backend `invitations` API). Polish is a single focused pass driven by the frontend-design skill.

**Tech Stack:** existing stack + `resend` (the one new dependency). Resend domain verification automated via Resend API + the Cloudflare zone API (token on file).

**Spec:** `docs/superpowers/specs/2026-08-26-miranda-family-archives-design.md` (§8 digest — verbatim authority for what counts, §6 Settings/Admin, §11 phase 6)

## Global Constraints

- **NO automated tests** (final prototype phase — after acceptance, offer the user a test-backfill phase as a post-v1 option).
- Digest rules verbatim from spec §8: cron daily **11:00 AM America/New_York**; digest-worthy = new READY photos/documents (CREATE `media_item`, item now READY + non-deleted), new family-tree people (CREATE `person`, non-deleted), and **major edits** = media UPDATE touching `title`/`description`/`dateYear`/`dateMonth`/`dateDay`/`people`, person UPDATE touching `EDITABLE_PERSON_FIELDS`. **Excluded:** hearts/comments/favorites (never audited), album events (`entityType 'album'`), relationship-only (`parents`/`spouses`), avatar-only (`avatarKey`), delete/restore rows. **No activity → no email.** `DigestLog` date row created FIRST as the send-lock (unique date; exists → skip). Recipients: users with `digestEnabled: true`. Sender: `Miranda Family Archives <updates@mirandafamilyarchives.com>`.
- **Ruling:** email thumbnails are presigned GETs with `expiresIn: 518400` (6 days — SigV4 max is 7); images in old digests eventually break, accepted over exposing public bucket paths.
- Email: inline-styled HTML (no CSS classes — email clients), max-width 600, thumbnails ~120px linking to `${APP_URL}/media/{id}`, people entries with names linking to `${APP_URL}/people/{id}`, footer line "You can turn these emails off in Settings." `APP_URL = https://mirandafamilyarchives.com` (env var on the worker).
- Settings (spec §6): digest toggle (immediate save), profile facts (name/email/role via local User), Clerk account management pointer (the existing `UserButton` handles it — say so on the page), ADMIN section: invite-by-email form (Clerk backend `clerkClient().invitations.createInvitation`), links to `/admin/deleted`.
- Polish task MUST invoke the `frontend-design:frontend-design` skill before writing styles; identity goal per spec §6: "warm archival visual design" serving grandparents (≥18px body text, ≥44px touch targets, no hover-only controls, high contrast) AND the young crowd (polish, transitions). Fix the `Create Next App` title/metadata/favicon.
- Existing interfaces: `signGetUrl`, `prisma`, `requireUser`, `safeErrorResponse`, `QUEUE_PROCESS_MEDIA` pattern in `lib/queue.ts` + `worker/index.ts`, `EDITABLE_PERSON_FIELDS` from `lib/audit.ts`.
- Work on `main`; push at deploy tasks only. Commit trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## File map

| File | Responsibility |
|---|---|
| `lib/digest.ts` | Event collection + dedupe + recipient query (pure-ish, worker & scripts share) |
| `worker/send-digest.ts` | Render email HTML, date-lock, Resend send; exported `runDailyDigest({force?: boolean})` |
| `worker/index.ts` | + cron schedule + digest queue worker |
| `lib/queue.ts` | + `QUEUE_DAILY_DIGEST` constant |
| `app/api/me/route.ts` | GET profile, PATCH `{digestEnabled}` |
| `app/api/admin/invite/route.ts` | POST `{email}` → Clerk invitation (ADMIN) |
| `app/(app)/settings/page.tsx` + `components/settings-form.tsx` | Settings UI |
| `app/layout.tsx`, `app/icon.svg`, `app/globals.css`, nav/components | Polish pass |

---

### Task 1: Digest engine (collection, email, cron)

**Files:**
- Create: `lib/digest.ts`, `worker/send-digest.ts`
- Modify: `lib/queue.ts` (+`QUEUE_DAILY_DIGEST = 'daily-digest'`), `worker/index.ts` (cron + worker), `package.json` (`resend` dep + script `"digest:test": "tsx worker/send-digest.ts"`)

**Interfaces:**
- Consumes: `prisma`, `signGetUrl`, `EDITABLE_PERSON_FIELDS`, pg-boss v12 (`boss.schedule(name, cron, data, {tz})`, createQueue, work).
- Produces:
  - `lib/digest.ts`:
    - `DigestEvents = { newMedia: {id, title: string|null, filename: string, type: string, thumbUrl: string|null, byName: string}[], newPeople: {id, name: string, byName: string}[], editedMedia: {id, title: string|null, filename: string, fields: string[], byName: string}[], editedPeople: {id, name: string, fields: string[], byName: string}[] }`
    - `collectDigestEvents(since: Date): Promise<DigestEvents>` — queries AuditLog `createdAt >= since` with user; media CREATEs joined to their MediaItem (keep only READY + non-deleted; thumb signed 518400s); person CREATEs joined (non-deleted); UPDATE rows filtered by `changes` keys per Global Constraints (JS filter over the JSONB); dedup per entity id (one entry, newest actor wins; an entity that was CREATED in-window appears only in the new list, not also in edited).
    - `digestRecipients(): Promise<{email: string, name: string}[]>` — users `digestEnabled: true`.
  - `worker/send-digest.ts`:
    - `runDailyDigest(opts: {force?: boolean} = {}): Promise<{sent: number, skipped: string | null}>` — `today` = current date in America/New_York (`new Intl.DateTimeFormat('en-CA', {timeZone: 'America/New_York'}).format(new Date())` → 'YYYY-MM-DD' → `new Date(that)`); try `prisma.digestLog.create({data: {date: today}})`, on P2002 return `{sent: 0, skipped: 'already sent today'}` unless `force`; collect events since 24h ago; all four lists empty → `{sent: 0, skipped: 'no activity'}` (leave the lock row — a quiet day is "handled"); render + send one email per recipient via `new Resend(process.env.RESEND_API_KEY)`, `from: 'Miranda Family Archives <updates@mirandafamilyarchives.com>'`, subject like `"3 new photos and 1 new family member"` (compose from counts; fall back "New in the family archive"); update the DigestLog row's `sentCount`; return `{sent: n, skipped: null}`.
    - Direct-run entry (`if (import.meta.url === pathToFileURL(process.argv[1]).href)` guard or a simple `process.argv.includes('--run')` check): loads env like worker/env.ts, calls `runDailyDigest({force: process.argv.includes('--force')})`, logs the result — this is the manual/test trigger.
  - `worker/index.ts` additions after existing setup: `await boss.createQueue(QUEUE_DAILY_DIGEST)`; `await boss.schedule(QUEUE_DAILY_DIGEST, '0 11 * * *', {}, { tz: 'America/New_York' })`; `boss.work(QUEUE_DAILY_DIGEST, {batchSize: 1}, async () => { const r = await runDailyDigest(); console.log('digest:', r) })`.
  - Email HTML (in send-digest.ts, a `renderDigestHtml(events, appUrl)` function): 600px table, warm header bar with the app name, one section per non-empty list ("📷 New photos & documents" with thumb+title rows, "🌳 New family members", "✏️ Updated details" listing field names in plain words reusing the History-tab label vocabulary), every row links into the app, footer with the Settings note. All styles inline.

- [ ] Steps: install `resend`; write both files + queue/index wiring per the Produces block; verify module-level with local docker Postgres — seed temp audit rows covering EVERY rule (media CREATE→READY counts, media CREATE→PROCESSING excluded, person CREATE counts, media UPDATE title counts, media UPDATE people counts, album row excluded, person UPDATE parents-only excluded, avatarKey-only excluded, deletedAt row excluded, created+edited same entity dedupes to new-only), assert `collectDigestEvents` buckets exactly; run `runDailyDigest` with RESEND_API_KEY **unset** but events present → expect it to fail gracefully AT the send step (wrap the Resend construction/send so missing key throws a clear tagged error AFTER the lock; on failure delete the lock row so a retry can happen — implement that) and with no events → `no activity` + lock retained; date-lock idempotency (second call skips); clean up. `tsc`/`lint`/`build` clean. Commit `feat: daily digest engine with Resend and cron`.

---

### Task 2: Resend domain + environment (user-assisted)

**Files:** none in-repo (Resend API + Cloudflare DNS + Railway vars).

**Interfaces:** Produces: verified `mirandafamilyarchives.com` sender domain in Resend; `RESEND_API_KEY` + `APP_URL=https://mirandafamilyarchives.com` env vars on the **worker** service.

- [ ] **Step 1 (USER):** create a Resend account (https://resend.com — free tier covers a family's daily digest), create an API key (Full access), and provide it to the controller. THIS IS A USER-INPUT GATE — the controller collects the key, it never goes in the repo.
- [ ] **Step 2:** via Resend API (`POST https://api.resend.com/domains {name: 'mirandafamilyarchives.com', region: 'us-east-1'}`): create the domain; the response lists required DNS records (DKIM TXT `resend._domainkey`, SPF TXT + MX on the `send` subdomain).
- [ ] **Step 3:** add those records to the Cloudflare zone (zone id `fc7d46f793c7ce61c38d3d1f75d4c215`, token at `~/.cloudflare-mfa-token`, records DNS-only) — same API pattern as the Phase 1 cutover.
- [ ] **Step 4:** `POST https://api.resend.com/domains/{id}/verify`, poll `GET /domains/{id}` until `status: 'verified'` (bounded wait; DNS is same-zone so it's fast).
- [ ] **Step 5:** set `RESEND_API_KEY` and `APP_URL` on the Railway **worker** service (`railway variables --service worker --set ...`, values never echoed).
- [ ] **Step 6:** verify with a real one-off send: `railway run`-less local run — locally export the key for one command and `npm run digest:test -- --run --force` IF there is real recent activity, else send a plain Resend test email via a 5-line script to the user's own address; confirm receipt with the user. Clean up any test scripts.

---

### Task 3: Settings page + admin invites

**Files:**
- Create: `app/api/me/route.ts`, `app/api/admin/invite/route.ts`, `components/settings-form.tsx`
- Modify: `app/(app)/settings/page.tsx` (replace placeholder)

**Interfaces:**
- Consumes: `requireUser`, `safeErrorResponse`, house form idiom; Clerk backend: `import { clerkClient } from '@clerk/nextjs/server'` → `(await clerkClient()).invitations.createInvitation({emailAddress, redirectUrl: 'https://mirandafamilyarchives.com/sign-in'})`.
- Produces:
  - `GET /api/me` → `{name, email, role, digestEnabled}`; `PATCH /api/me` `{digestEnabled: boolean}` (strict boolean validation) → `{ok}` — NOT audited (personal preference, not archival data; consistent with spec §7 scope).
  - `POST /api/admin/invite` `{email}` → `{ok}` (ADMIN only; basic email-shape validation; Clerk errors surfaced readably — e.g. already-invited/already-a-member → 400 with the message).
  - Settings page (server component + client form): "Daily email digest" toggle with plain-words description ("One email a day when family adds photos or people — nothing on quiet days."); profile facts; "Manage your account (password, photo) from the 👤 menu in the top corner."; ADMIN card: invite form ("Invite a family member" email input + button, success state "Invitation sent to ___"), link to Deleted items.
- [ ] Steps: routes + UI per contract; module-verify the /api/me PATCH validation + digestEnabled round-trip against local DB (temp user, cleanup); invite route verified to the point of Clerk call construction (do NOT send a real invitation in verification — assert the ADMIN gate + validation with a mocked/dry path or stop before the call; note it; real invite happens in Task 5 acceptance). `tsc`/`lint`/`build`. Commit `feat: settings with digest toggle and admin invites`.

---

### Task 4: Visual polish pass

**Files:**
- Modify: `app/layout.tsx` (metadata: title "Miranda Family Archives", description; viewport), `app/globals.css` (palette tokens), `components/nav.tsx`, empty states/buttons across existing components as the design pass dictates; Create: `app/icon.svg` (favicon).
- **The implementer MUST invoke the `frontend-design:frontend-design` skill FIRST and follow it.**

**Scope checklist (each item verified in the report):**
- [ ] Metadata: page title, description, `app/icon.svg` favicon (a warm mark — e.g. a simple photo/tree motif; no external assets).
- [ ] Identity: a warm archival palette applied via CSS custom properties + Tailwind usage (cream/sepia/deep-brown family or the skill's guidance — decisive, not default-gray); consistent button/link styles; typography scale with ≥18px body.
- [ ] Nav: distinct active state, hover/focus-visible states, wraps usefully on phone widths (test at 390px); keep words+icons.
- [ ] Empty states reviewed for warmth and clarity (library, favorites, albums, tree, comments).
- [ ] Cheap carryovers folded in: album current-cover indicator (AlbumDTO gains `coverMediaId` + a "Cover" badge on that tile in album detail); timeline view hides the non-applicable filter chips (only view toggle + heading shown).
- [ ] Grandparent pass: every interactive control ≥44px touch target; no hover-only affordances; confirm dialogs in plain words; contrast spot-checked (4.5:1 body text).
- [ ] Constraint: NO functional/API changes beyond the two named carryovers; no new dependencies; `tsc`/`lint`/`build` clean. Commit `feat: visual identity and polish pass`.

---

### Task 5: Deploy + digest E2E + final acceptance

- [ ] Full gate; push (authorized); both Railway deployments SUCCESS; worker logs show the digest schedule registered.
- [ ] **Digest E2E:** confirm recent real activity exists (the family's uploads/edits within 24h — or make one small titled edit); controller/implementer triggers `runDailyDigest({force: true})` against production (one-off: `railway run --service worker npx tsx worker/send-digest.ts --run --force` or temporarily via local run with prod DATABASE_URL + key — choose the cleanest, document it); user confirms the email arrived, looks right on phone, thumbnails render, links work, and the Settings toggle stops the next one (flip off → force again → no email to them).
- [ ] **Grandparent usability review (human):** the user walks the whole app on a PHONE as their least-technical relative would: sign in, browse, open a photo, read the story, heart it, find Favorites, view the tree, upload one photo with the quick title form. Anything confusing gets listed and triaged (fix now vs backlog).
- [ ] **Invite E2E:** send a real invitation from Settings to a family member (or a secondary address of the user's), confirm the full journey.
- [ ] Close-out: prototype complete → offer the test-backfill phase as the first post-v1 item.

---

## Deferred / post-v1 backlog (surfaced at close-out)

- Automated test backfill (user deferred until prototype complete — that's now).
- Add-photos picker search; requireUser adoption in pre-Phase-5 routes; status-code convention reconciliation; timeline pagination; upload resume across reloads; PDF multi-page viewing; GEDCOM (spec §10).

## Phase 6 / v1 exit criteria

- Daily 11am ET digest sends ONLY on activity, with correct buckets, thumbnails, links, and opt-out; idempotent per day; verified end-to-end with a real received email.
- Settings: working digest toggle, profile facts, admin invite that a real invitee can accept.
- The app has its own name, favicon, and warm visual identity; nav/empty states/touch targets pass the grandparent checklist on a phone.
- v1 COMPLETE per spec §11.
