# Phase 1: Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deployed, invite-only Next.js app on Railway with Clerk auth, the complete Prisma schema migrated into Railway Postgres, Clerk→DB user sync, and a navigable app shell.

**Architecture:** Single Next.js (App Router) web service on Railway + Railway Postgres + Railway bucket (bucket provisioned now, used in Phase 2). Clerk handles auth (invite-only, no public sign-up); a webhook syncs users into our `users` table where the `role` and `digest_enabled` fields live. The full data model ships in this phase so later phases only write application code.

**Tech Stack:** Next.js (latest, App Router, TypeScript, Tailwind), @clerk/nextjs, Prisma + PostgreSQL, Railway (web service + Postgres + bucket).

**Spec:** `docs/superpowers/specs/2026-08-26-miranda-family-archives-design.md`

## Global Constraints

- **No automated tests** until the prototype is complete (explicit user decision). Every task ends with a manual verification step instead — run it and confirm the expected output before committing.
- Node.js ≥ 20.9.0 (Clerk SDK floor).
- TypeScript everywhere; `@/*` import alias.
- Next.js 16+: the Clerk middleware file is `proxy.ts` at repo root (NOT `middleware.ts` — that's Next ≤15). `auth()` is async: always `await auth()`.
- Server code imports from `@clerk/nextjs/server`; client code from `@clerk/nextjs`; webhook verification from `@clerk/nextjs/webhooks`.
- `ClerkProvider` goes **inside `<body>`**, never wrapping `<html>`.
- Roles live in **our** `users` table (`ADMIN`/`MEMBER`), not Clerk metadata. Admin bootstrap via `ADMIN_EMAILS` env var (comma-separated, matches `btmclaughlin@gmail.com` initially).
- Env files: `.env` holds `DATABASE_URL` (Prisma reads it); `.env.local` holds Clerk keys + `ADMIN_EMAILS`. Both gitignored.
- Commit after every task; commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- GitHub remote `origin` = https://github.com/redtailtech/miranda-family-archives (already configured, empty repo, branch `main`).

---

### Task 1: Scaffold the Next.js app

**Files:**
- Create: entire Next.js scaffold at repo root (`app/`, `package.json`, `tsconfig.json`, `next.config.ts`, `.gitignore`, etc.)

**Interfaces:**
- Consumes: nothing (repo contains only `docs/` and `.agents/`).
- Produces: a running Next.js app; `npm run dev` on port 3000; `@/*` alias for imports.

- [ ] **Step 1: Scaffold into a temp dir** (create-next-app refuses non-empty dirs — `docs/` and `.agents/` already exist)

```bash
cd "$(mktemp -d)" && npx create-next-app@latest miranda --ts --tailwind --eslint --app --no-src-dir --import-alias "@/*" --use-npm --yes
```

- [ ] **Step 2: Move scaffold into the repo** (dotfiles included; do not overwrite `.git`, `docs/`, `.agents/`)

```bash
rsync -a --exclude .git <tempdir>/miranda/ /Users/brianmclaughlin/LazyRiver/miranda-family-archives/
```

- [ ] **Step 3: Verify the dev server runs**

Run: `npm run dev` (in repo root), then `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000`
Expected: `200`. Stop the server.

- [ ] **Step 4: Verify `.gitignore` covers env files** — it must ignore `.env*` (create-next-app default does). If not, add `.env*` line.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: scaffold Next.js app (TypeScript, Tailwind, App Router)"
```

---

### Task 2: Prisma schema + local Postgres

**Files:**
- Create: `docker-compose.yml`, `prisma/schema.prisma`, `lib/db.ts`, `.env`
- Modify: `package.json` (prisma deps + `postinstall: prisma generate`)

**Interfaces:**
- Consumes: nothing.
- Produces: `prisma` singleton exported from `lib/db.ts` (`import { prisma } from '@/lib/db'`); the full v1 schema (all models below — later phases add columns only if the spec changed); local DB at `postgresql://miranda:miranda@localhost:5432/miranda`.

- [ ] **Step 1: Local Postgres via Docker**

```yaml
# docker-compose.yml
services:
  db:
    image: postgres:17
    environment:
      POSTGRES_USER: miranda
      POSTGRES_PASSWORD: miranda
      POSTGRES_DB: miranda
    ports:
      - "5432:5432"
    volumes:
      - dbdata:/var/lib/postgresql/data
volumes:
  dbdata:
```

Run: `docker compose up -d` and confirm `docker compose ps` shows the db healthy/running.

- [ ] **Step 2: Install Prisma and write `.env`**

```bash
npm install prisma @prisma/client && npx prisma init --datasource-provider postgresql
```

Set `.env`:
```
DATABASE_URL="postgresql://miranda:miranda@localhost:5432/miranda"
```

- [ ] **Step 3: Write the complete schema** (this is the whole approved data model — spec §3)

```prisma
// prisma/schema.prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Role {
  ADMIN
  MEMBER
}

enum MediaType {
  PHOTO
  DOCUMENT
}

enum MediaStatus {
  UPLOADING
  PROCESSING
  READY
  FAILED
}

enum Gender {
  MALE
  FEMALE
  UNSPECIFIED
}

enum AuditAction {
  CREATE
  UPDATE
  DELETE
}

model User {
  id            String     @id @default(cuid())
  clerkId       String     @unique
  email         String     @unique
  name          String
  avatarUrl     String?
  role          Role       @default(MEMBER)
  digestEnabled Boolean    @default(true)
  createdAt     DateTime   @default(now())
  updatedAt     DateTime   @updatedAt
  mediaItems    MediaItem[]
  favorites     Favorite[]
  comments      Comment[]
  hearts        Heart[]
  auditLogs     AuditLog[]
}

model MediaItem {
  id                String      @id @default(cuid())
  type              MediaType
  status            MediaStatus @default(UPLOADING)
  error             String?
  originalKey       String
  originalFilename  String
  originalSize      BigInt
  mimeType          String
  thumbKey          String?
  webKey            String?
  largeKey          String?
  exif              Json?
  title             String?
  description       String?
  location          String?
  dateYear          Int?
  dateMonth         Int?
  dateDay           Int?
  dateIsApproximate Boolean     @default(false)
  uploadedById      String
  uploadedBy        User        @relation(fields: [uploadedById], references: [id])
  deletedAt         DateTime?
  createdAt         DateTime    @default(now())
  updatedAt         DateTime    @updatedAt
  people            MediaPerson[]
  albumItems        AlbumItem[]
  favorites         Favorite[]
  comments          Comment[]
  hearts            Heart[]

  @@index([status])
  @@index([dateYear])
  @@index([deletedAt])
}

model Person {
  id          String    @id @default(cuid())
  displayName String
  maidenName  String?
  gender      Gender    @default(UNSPECIFIED)
  birthYear   Int?
  deathYear   Int?
  birthplace  String?
  notes       String?
  avatarKey   String?
  deletedAt   DateTime?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  parents     ParentChild[] @relation("ChildSide")
  children    ParentChild[] @relation("ParentSide")
  spousesA    Spouse[]      @relation("SpouseA")
  spousesB    Spouse[]      @relation("SpouseB")
  mediaTags   MediaPerson[]
}

model ParentChild {
  childId  String
  parentId String
  child    Person @relation("ChildSide", fields: [childId], references: [id])
  parent   Person @relation("ParentSide", fields: [parentId], references: [id])

  @@id([childId, parentId])
}

model Spouse {
  personAId String
  personBId String
  personA   Person @relation("SpouseA", fields: [personAId], references: [id])
  personB   Person @relation("SpouseB", fields: [personBId], references: [id])

  @@id([personAId, personBId])
}

model MediaPerson {
  mediaItemId String
  personId    String
  mediaItem   MediaItem @relation(fields: [mediaItemId], references: [id])
  person      Person    @relation(fields: [personId], references: [id])

  @@id([mediaItemId, personId])
}

model Album {
  id           String      @id @default(cuid())
  name         String
  description  String?
  coverMediaId String?
  createdAt    DateTime    @default(now())
  updatedAt    DateTime    @updatedAt
  items        AlbumItem[]
}

model AlbumItem {
  albumId     String
  mediaItemId String
  position    Int
  album       Album     @relation(fields: [albumId], references: [id])
  mediaItem   MediaItem @relation(fields: [mediaItemId], references: [id])

  @@id([albumId, mediaItemId])
}

model Favorite {
  userId      String
  mediaItemId String
  createdAt   DateTime  @default(now())
  user        User      @relation(fields: [userId], references: [id])
  mediaItem   MediaItem @relation(fields: [mediaItemId], references: [id])

  @@id([userId, mediaItemId])
}

model Comment {
  id          String    @id @default(cuid())
  mediaItemId String
  userId      String
  body        String
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  mediaItem   MediaItem @relation(fields: [mediaItemId], references: [id])
  user        User      @relation(fields: [userId], references: [id])
}

model Heart {
  userId      String
  mediaItemId String
  createdAt   DateTime  @default(now())
  user        User      @relation(fields: [userId], references: [id])
  mediaItem   MediaItem @relation(fields: [mediaItemId], references: [id])

  @@id([userId, mediaItemId])
}

model AuditLog {
  id         String      @id @default(cuid())
  userId     String
  entityType String
  entityId   String
  action     AuditAction
  changes    Json
  createdAt  DateTime    @default(now())
  user       User        @relation(fields: [userId], references: [id])

  @@index([createdAt])
  @@index([entityType, entityId])
}

model DigestLog {
  id        String   @id @default(cuid())
  date      DateTime @unique @db.Date
  sentCount Int      @default(0)
  createdAt DateTime @default(now())
}
```

- [ ] **Step 4: Migrate and generate**

Run: `npx prisma migrate dev --name init`
Expected: migration created under `prisma/migrations/`, "Your database is now in sync".

- [ ] **Step 5: Prisma client singleton**

```typescript
// lib/db.ts
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma = globalForPrisma.prisma ?? new PrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
```

Add to `package.json` scripts: `"postinstall": "prisma generate"` (Railway builds need generated client).

- [ ] **Step 6: Verify** — `npx prisma studio` opens and shows all 13 models (or run `npx prisma validate`; expected: "The schema is valid").

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: complete Prisma schema, local Postgres, db client"
```

---

### Task 3: Clerk integration (auth-gated app)

**Files:**
- Create: `proxy.ts`, `app/sign-in/[[...sign-in]]/page.tsx`
- Modify: `app/layout.tsx`, `.env.local` (written by Clerk CLI)

**Interfaces:**
- Consumes: nothing.
- Produces: every route except `/sign-in` and `/api/webhooks/*` requires auth; `<ClerkProvider>` wraps the app; `await auth()` works in server components.

- [ ] **Step 1: Link the existing Clerk app and pull keys.** The user already created a Clerk project. Run:

```bash
clerk auth login   # user may need to do this interactively: suggest `! clerk auth login`
clerk apps list --json
```

Ask the user which `app_id` is the family-archives app if more than one, then:

```bash
clerk link --app <app_id>
clerk env pull
npm install @clerk/nextjs
```

Expected: `.env.local` contains `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`.

- [ ] **Step 2: Middleware — protect everything except sign-in and webhooks**

```typescript
// proxy.ts  (repo root — Next.js 16 name for middleware)
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'

const isPublicRoute = createRouteMatcher(['/sign-in(.*)', '/api/webhooks(.*)'])

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) await auth.protect()
})

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
}
```

- [ ] **Step 3: ClerkProvider in root layout** (inside `<body>`)

```tsx
// app/layout.tsx — keep existing font/css imports from the scaffold
import { ClerkProvider } from '@clerk/nextjs'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ClerkProvider>{children}</ClerkProvider>
      </body>
    </html>
  )
}
```

- [ ] **Step 4: Sign-in page**

```tsx
// app/sign-in/[[...sign-in]]/page.tsx
import { SignIn } from '@clerk/nextjs'

export default function SignInPage() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <SignIn />
    </main>
  )
}
```

- [ ] **Step 5: Verify** — `npm run dev`; visiting `http://localhost:3000` while signed out redirects to `/sign-in` and the Clerk sign-in UI renders. Run `clerk doctor --json`; expected: no failing checks.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: Clerk auth — middleware, provider, sign-in page"
```

---

### Task 4: Clerk → DB user sync webhook + admin bootstrap

**Files:**
- Create: `app/api/webhooks/clerk/route.ts`
- Modify: `.env.local` (add `ADMIN_EMAILS`, `CLERK_WEBHOOK_SIGNING_SECRET`)

**Interfaces:**
- Consumes: `prisma` from `@/lib/db` (Task 2).
- Produces: `users` rows kept in sync with Clerk; `role` = `ADMIN` when the Clerk email is in `ADMIN_EMAILS`.

- [ ] **Step 1: Webhook handler**

```typescript
// app/api/webhooks/clerk/route.ts
import { verifyWebhook } from '@clerk/nextjs/webhooks'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'

function isAdminEmail(email: string): boolean {
  const admins = (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
  return admins.includes(email.toLowerCase())
}

export async function POST(req: NextRequest) {
  let evt
  try {
    evt = await verifyWebhook(req)
  } catch (err) {
    console.error('Clerk webhook verification failed:', err)
    return new Response('Verification failed', { status: 400 })
  }

  if (evt.type === 'user.created' || evt.type === 'user.updated') {
    const { id, email_addresses, first_name, last_name, image_url } = evt.data
    const email = email_addresses[0]?.email_address
    if (!email) return new Response('No email on user', { status: 200 })
    const name = `${first_name ?? ''} ${last_name ?? ''}`.trim() || email

    await prisma.user.upsert({
      where: { clerkId: id },
      create: {
        clerkId: id,
        email,
        name,
        avatarUrl: image_url,
        role: isAdminEmail(email) ? 'ADMIN' : 'MEMBER',
      },
      update: { email, name, avatarUrl: image_url },
    })
  }

  // user.deleted: keep the row — uploads, comments, and audit history
  // reference it. Access is already revoked because the Clerk user is gone.

  return new Response('OK', { status: 200 })
}
```

- [ ] **Step 2: Env vars** — append to `.env.local`:

```
ADMIN_EMAILS=btmclaughlin@gmail.com
```

- [ ] **Step 3: Local webhook test via Clerk tunnel**

```bash
clerk webhooks listen --token "$(clerk webhooks token)" --forward-to http://localhost:3000/api/webhooks/clerk
```

Add the printed relay URL as a webhook endpoint in the Clerk Dashboard (events: `user.created`, `user.updated`, `user.deleted`), copy that endpoint's signing secret into `.env.local` as `CLERK_WEBHOOK_SIGNING_SECRET`, restart `npm run dev`.

- [ ] **Step 4: Verify end-to-end** — sign in to the dev app (or `clerk users create --json` a test user). Then:

Run: `docker compose exec db psql -U miranda -d miranda -c 'select email, role from "User";'`
Expected: your user row with `role = ADMIN` (email matches `ADMIN_EMAILS`).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: Clerk user-sync webhook with admin bootstrap"
```

---

### Task 5: App shell — navigation + placeholder pages

**Files:**
- Create: `app/(app)/layout.tsx`, `app/(app)/page.tsx`, `app/(app)/albums/page.tsx`, `app/(app)/tree/page.tsx`, `app/(app)/favorites/page.tsx`, `app/(app)/upload/page.tsx`, `app/(app)/settings/page.tsx`, `components/nav.tsx`
- Delete: scaffold's default `app/page.tsx` content (the `(app)/page.tsx` replaces it — remove `app/page.tsx` itself so routes don't collide)

**Interfaces:**
- Consumes: Clerk's `<UserButton />`.
- Produces: route group `(app)` whose layout renders top nav + content; the 5 nav destinations (Library `/`, Albums `/albums`, Family Tree `/tree`, Favorites `/favorites`, Upload `/upload`) plus `/settings` reachable from the user menu area. Later phases fill these pages in.

- [ ] **Step 1: Nav component** — large touch targets, words + icons (inline SVG or emoji placeholders for now; real design pass is Phase 6)

```tsx
// components/nav.tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { UserButton } from '@clerk/nextjs'

const links = [
  { href: '/', label: 'Library', icon: '🖼️' },
  { href: '/albums', label: 'Albums', icon: '📚' },
  { href: '/tree', label: 'Family Tree', icon: '🌳' },
  { href: '/favorites', label: 'Favorites', icon: '❤️' },
  { href: '/upload', label: 'Upload', icon: '⬆️' },
]

export function Nav() {
  const pathname = usePathname()
  return (
    <header className="border-b">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link href="/" className="text-xl font-semibold">
          Miranda Family Archives
        </Link>
        <nav className="flex items-center gap-1">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`rounded-lg px-4 py-3 text-lg ${
                pathname === l.href ? 'bg-black/10 font-semibold' : 'hover:bg-black/5'
              }`}
            >
              <span aria-hidden>{l.icon}</span> {l.label}
            </Link>
          ))}
          <UserButton />
        </nav>
      </div>
    </header>
  )
}
```

- [ ] **Step 2: Route-group layout and placeholder pages.** Move the home route into the group: delete `app/page.tsx`, then:

```tsx
// app/(app)/layout.tsx
import { Nav } from '@/components/nav'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <Nav />
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  )
}
```

Each placeholder page follows this exact pattern (repeat for Library `(app)/page.tsx` "Library", `albums` "Albums", `tree` "Family Tree", `favorites` "Favorites", `upload` "Upload", `settings` "Settings"):

```tsx
// app/(app)/page.tsx
export default function LibraryPage() {
  return <h1 className="text-3xl font-bold">Library</h1>
}
```

- [ ] **Step 3: Verify** — `npm run dev`; signed in, all five nav links plus `/settings` render their headings with the nav bar; signed out, all redirect to `/sign-in`.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: app shell with nav and placeholder pages"
```

---

### Task 6: Railway provisioning

**Files:** none in-repo (infrastructure via Railway MCP tools / `use-railway` skill).

**Interfaces:**
- Consumes: the GitHub repo (pushed in this task).
- Produces: Railway project `miranda-family-archives` with: Postgres service, bucket `archives`, web service `web` building from GitHub `redtailtech/miranda-family-archives` `main`, public domain, all env vars set. Phase 2 consumes the bucket credentials.

- [ ] **Step 1: Push the repo**

```bash
git push -u origin main
```

- [ ] **Step 2: Create Railway project + Postgres.** Use the `use-railway` / `railway:database` skill flow: create project `miranda-family-archives` in the user's workspace (confirm workspace via `whoami`/`list_workspaces`), add a Postgres database service.

- [ ] **Step 3: Create bucket** — Railway object storage bucket named `archives` in the same project/environment (MCP `create_bucket`). Record the generated credential variables (endpoint, access key, secret, bucket name) — Phase 2 wires them into the worker and web services.

- [ ] **Step 4: Create web service from GitHub** — service `web`, source repo `redtailtech/miranda-family-archives`, branch `main`. Set **pre-deploy command**: `npx prisma migrate deploy` (runs migrations against Railway Postgres before each deploy starts).

- [ ] **Step 5: Set web service variables** (MCP `set_variables`):

```
DATABASE_URL   → reference variable to the Postgres service's DATABASE_URL
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY → from .env.local
CLERK_SECRET_KEY                  → from .env.local
ADMIN_EMAILS                      → btmclaughlin@gmail.com
```

(`CLERK_WEBHOOK_SIGNING_SECRET` is added in Task 7 once the production endpoint exists. Dev-instance Clerk keys are fine for the prototype; a Clerk production instance is a launch task, not a Phase 1 task.)

- [ ] **Step 6: Generate domain** (MCP `generate_domain`) and trigger a deploy if one didn't start automatically.

- [ ] **Step 7: Verify** — deployment status is SUCCESS (MCP `list_deployments`); `curl -s -o /dev/null -w "%{http_code}" https://<domain>/sign-in` returns `200`; deploy logs show `prisma migrate deploy` applied the init migration.

---

### Task 7: Production cutover — custom domain, Clerk production instance, invite-only lockdown

*(Rescoped 2026-08-26 by user direction: the deployed environment is production-only on `mirandafamilyarchives.com`, DNS managed at GoDaddy via the `gddy` CLI.)*

**Files:** none in-repo (Railway + GoDaddy DNS + Clerk CLI/Dashboard).

**Interfaces:**
- Consumes: deployed web service (Task 6), webhook route (Task 4), domain `mirandafamilyarchives.com` (GoDaddy-hosted DNS), authenticated `gddy` CLI.
- Produces: the app live at `https://mirandafamilyarchives.com`, Clerk **production** instance with live keys, invite-only, users syncing to Railway Postgres.

- [ ] **Step 1: Railway custom domains** — add `mirandafamilyarchives.com` and `www.mirandafamilyarchives.com` to the `web` service; record the DNS target values Railway returns.

- [ ] **Step 2: DNS via Cloudflare** *(revised: GoDaddy's DNS cannot host apex CNAME/ALIAS — Railway docs list it as unsupported; user chose Cloudflare nameservers)* — create the zone at Cloudflare, add `CNAME @ → 90xyn1gl.up.railway.app` (proxied, SSL mode **Full**), `CNAME www → 2c17jcam.up.railway.app` (proxied), and the five Clerk CNAMEs as **DNS-only** (grey cloud — Clerk requires unproxied). Then switch the domain's nameservers at GoDaddy to Cloudflare's pair (`gddy` with the `domains.nameserver:update` scope).

- [ ] **Step 3: Clerk production instance** — create a production instance for the app on `mirandafamilyarchives.com` (CLI: `clerk` instance/deploy commands; Dashboard fallback). Retrieve the production `pk_live_`/`sk_live_` keys and Clerk's required DNS records (frontend API, accounts, DKIM/mail).

- [ ] **Step 4: GoDaddy DNS for Clerk** — add Clerk's records via `gddy`; wait for Clerk's domain verification + SSL to go green.

- [ ] **Step 5: Swap Railway env to production keys** — `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`/`CLERK_SECRET_KEY` → live keys on the `web` service.

- [ ] **Step 6: Production webhook endpoint** — on the production instance: URL `https://mirandafamilyarchives.com/api/webhooks/clerk`, events `user.created`, `user.updated`, `user.deleted` (Dashboard if the API can't create endpoints). Set its signing secret as `CLERK_WEBHOOK_SIGNING_SECRET` on the `web` service.

- [ ] **Step 7: Restrict sign-ups** on the production instance (Configure → Restrictions → Restricted); Dashboard toggle by the user if no CLI path.

- [ ] **Step 8: Verify end-to-end** — `https://mirandafamilyarchives.com` serves the app over valid TLS (www redirects or serves too); send an invitation, accept, sign in, confirm the `User` row in Railway Postgres with `role = ADMIN` for btmclaughlin@gmail.com; confirm a non-invited email cannot sign up; confirm a webhook delivery shows success in Clerk.

- [ ] **Step 9: Commit doc updates and push**

```bash
git add -A && git commit -m "chore: phase 1 complete — production cutover to mirandafamilyarchives.com" && git push
```

---

## Phase 1 exit criteria

- Deployed Railway app, invite-only, Clerk-authenticated.
- Full schema migrated in Railway Postgres; users sync via webhook; `btmclaughlin@gmail.com` is ADMIN.
- App shell navigates between Library / Albums / Family Tree / Favorites / Upload / Settings placeholders.
- Bucket provisioned (unused until Phase 2).

**Next:** Phase 2 plan (media pipeline: Uppy multipart upload → bucket, worker service with pg-boss + sharp + poppler + exiftool, library grid, item detail, download original) gets written after Phase 1 lands.
