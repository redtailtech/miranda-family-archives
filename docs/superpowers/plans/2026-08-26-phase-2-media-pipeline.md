# Phase 2: Media Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Family members upload 500MB TIFFs and PDFs directly to the Railway bucket with chunked progress, a worker generates thumbnails/web/large derivatives + extracts EXIF, and the library grid + item detail pages display them with original download.

**Architecture:** Browser → S3 multipart presigned URLs (Uppy) → bucket; web enqueues a pg-boss job on completion; a second Railway service (`worker`, Docker image with poppler + exiftool) consumes jobs, streams originals to temp, produces derivatives with sharp, writes back to bucket + Postgres. All media URLs served to the UI are short-lived presigned GETs.

**Tech Stack:** @aws-sdk/client-s3 + s3-request-presigner, @uppy/core + @uppy/aws-s3 + @uppy/react + @uppy/dashboard, pg-boss v10, sharp, poppler (`pdftoppm`), exiftool, tsx (worker runtime).

**Spec:** `docs/superpowers/specs/2026-08-26-miranda-family-archives-design.md` (§4 pipeline, §6 Library/Item detail/Upload pages, Phase 2 of §11)

## Global Constraints

- **NO automated tests** until prototype complete (explicit user decision) — every task ends with a manual verification step; run it and record actual output before committing.
- Next.js 16 App Router, TypeScript, `@/*` alias. Server auth: `const { userId } = await auth()` from `@clerk/nextjs/server` (middleware already protects all non-public routes; routes still resolve the local `User` row for ownership).
- Prisma client from `@/lib/db` (`import { prisma } from '@/lib/db'`). Schema is FROZEN from Phase 1 — no migrations in this phase (all needed columns exist).
- `MediaItem.originalSize` is `BigInt` — NEVER let it hit `JSON.stringify` raw; DTO layer converts with `Number()`.
- Bucket env var names, verbatim (Railway bucket "archives" emits these): `AWS_ENDPOINT_URL`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_S3_BUCKET_NAME`, `AWS_DEFAULT_REGION` (value `auto`). URL style is **virtual-host** → S3 client uses `forcePathStyle: false`.
- Bucket layout, verbatim from spec: originals at `originals/{mediaId}/{filename}`, derivatives at `derived/{mediaId}/thumb.jpg`, `derived/{mediaId}/web.jpg`, `derived/{mediaId}/large.jpg`.
- Derivative sizes: thumb ~400px, web ~1600px, large ~3200px (longest edge), JPEG.
- Accepted uploads: `image/tiff`, `image/jpeg`, `image/png`, `image/heic`, `image/webp` → `type: PHOTO`; `application/pdf` → `type: DOCUMENT`. Max size 2 GB. Chunk size 25 MB.
- pg-boss v10 API: `boss.work(name, opts, handler)` where the handler receives an **array** of jobs (`async ([job]) => {...}`). Queue name: `process-media`. Retry: `{ retryLimit: 3, retryDelay: 60, retryBackoff: true }`.
- Commit after every task; messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Local dev: Postgres via `docker compose up -d` (localhost:5432); bucket is the REAL production bucket (fine for a family prototype — keys are namespaced by generated media ids). Local worker needs `brew install poppler exiftool` on macOS.

## File map (who owns what)

| File | Responsibility |
|---|---|
| `lib/s3.ts` | S3 client singleton + presign helpers (PUT part, GET object, multipart lifecycle) |
| `lib/media.ts` | Key builders, mime→type mapping, `mediaItemToDTO` (BigInt-safe, attaches presigned URLs) |
| `lib/queue.ts` | pg-boss singleton (web sends; worker consumes) |
| `app/api/uploads/route.ts` | POST: create MediaItem row + CreateMultipartUpload |
| `app/api/uploads/sign-part/route.ts` | POST: presign one part URL |
| `app/api/uploads/complete/route.ts` | POST: CompleteMultipartUpload, status→PROCESSING, enqueue, audit CREATE |
| `app/api/uploads/abort/route.ts` | POST: AbortMultipartUpload + delete row |
| `app/api/media/route.ts` | GET: paginated library listing (DTOs with thumb URLs) |
| `app/api/media/[id]/route.ts` | GET: single item DTO (web/large URLs) |
| `app/api/media/[id]/download/route.ts` | GET: 302 → presigned GET of original (attachment) |
| `app/api/media/[id]/retry/route.ts` | POST: FAILED→PROCESSING + re-enqueue |
| `app/(app)/upload/page.tsx` | Uppy Dashboard upload UI |
| `components/media-grid.tsx` | Client grid: infinite scroll, status badges |
| `app/(app)/page.tsx` | Library page (renders MediaGrid) |
| `app/(app)/media/[id]/page.tsx` | Item detail: image/PDF view, info, download, retry |
| `worker/index.ts` | pg-boss consumer bootstrap |
| `worker/process-media.ts` | The processing job (sharp / pdftoppm / exiftool) |
| `worker/Dockerfile` | node + poppler-utils + libimage-exiftool-perl image |

---

### Task 1: S3 client, key helpers, and DTO layer

**Files:**
- Create: `lib/s3.ts`, `lib/media.ts`
- Modify: `package.json` (deps), `.env.local` (bucket vars — NOT committed)

**Interfaces:**
- Consumes: nothing new.
- Produces (exact signatures later tasks rely on):
  - `lib/s3.ts`: `s3` (S3Client), `BUCKET` (string), `createMultipart(key, contentType): Promise<{uploadId: string}>`, `signPartUrl(key, uploadId, partNumber): Promise<string>`, `completeMultipart(key, uploadId, parts: {ETag: string, PartNumber: number}[]): Promise<void>`, `abortMultipart(key, uploadId): Promise<void>`, `signGetUrl(key, opts?: {downloadName?: string, expiresIn?: number}): Promise<string>`
  - `lib/media.ts`: `originalKey(id: string, filename: string): string`, `derivedKey(id: string, size: 'thumb'|'web'|'large'): string`, `mediaTypeForMime(mime: string): 'PHOTO'|'DOCUMENT'|null`, `ACCEPTED_MIMES: string[]`, `MAX_UPLOAD_BYTES` (2GB), `mediaItemToDTO(item, opts?: {detail?: boolean}): Promise<MediaItemDTO>` where `MediaItemDTO = { id, type, status, error, title, description, location, originalFilename, originalSize: number, mimeType, dateYear, dateMonth, dateDay, dateIsApproximate, createdAt: string, uploadedBy: {id, name} | null, thumbUrl: string|null, webUrl?: string|null, largeUrl?: string|null }` (webUrl/largeUrl only when `detail: true`)

- [ ] **Step 1: Install deps**

```bash
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

- [ ] **Step 2: Pull bucket credentials into `.env.local`** (values from `railway bucket credentials --bucket archives`; `.env*` is gitignored)

```bash
railway bucket credentials --bucket archives >> .env.local
```

Confirm `.env.local` now contains `AWS_ENDPOINT_URL`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_S3_BUCKET_NAME`, `AWS_DEFAULT_REGION` lines (fix formatting to `KEY=value` lines if the CLI printed anything extra).

- [ ] **Step 3: Write `lib/s3.ts`**

```typescript
import {
  S3Client,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

export const BUCKET = process.env.AWS_S3_BUCKET_NAME!

export const s3 = new S3Client({
  endpoint: process.env.AWS_ENDPOINT_URL,
  region: process.env.AWS_DEFAULT_REGION ?? 'auto',
  forcePathStyle: false, // Railway buckets use virtual-host style URLs
})

export async function createMultipart(key: string, contentType: string) {
  const res = await s3.send(
    new CreateMultipartUploadCommand({ Bucket: BUCKET, Key: key, ContentType: contentType })
  )
  return { uploadId: res.UploadId! }
}

export function signPartUrl(key: string, uploadId: string, partNumber: number) {
  return getSignedUrl(
    s3,
    new UploadPartCommand({ Bucket: BUCKET, Key: key, UploadId: uploadId, PartNumber: partNumber }),
    { expiresIn: 3600 }
  )
}

export async function completeMultipart(
  key: string,
  uploadId: string,
  parts: { ETag: string; PartNumber: number }[]
) {
  await s3.send(
    new CompleteMultipartUploadCommand({
      Bucket: BUCKET,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: { Parts: parts },
    })
  )
}

export async function abortMultipart(key: string, uploadId: string) {
  await s3.send(new AbortMultipartUploadCommand({ Bucket: BUCKET, Key: key, UploadId: uploadId }))
}

export function signGetUrl(
  key: string,
  opts: { downloadName?: string; expiresIn?: number } = {}
) {
  return getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ...(opts.downloadName
        ? { ResponseContentDisposition: `attachment; filename="${opts.downloadName.replace(/"/g, '')}"` }
        : {}),
    }),
    { expiresIn: opts.expiresIn ?? 3600 }
  )
}
```

- [ ] **Step 4: Write `lib/media.ts`**

```typescript
import type { MediaItem, User } from '@prisma/client'
import { signGetUrl } from '@/lib/s3'

export const ACCEPTED_MIMES = [
  'image/tiff',
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/webp',
  'application/pdf',
]

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024 // 2 GB

export function mediaTypeForMime(mime: string): 'PHOTO' | 'DOCUMENT' | null {
  if (mime === 'application/pdf') return 'DOCUMENT'
  if (ACCEPTED_MIMES.includes(mime)) return 'PHOTO'
  return null
}

export function originalKey(id: string, filename: string) {
  // keep the original filename but strip path separators
  return `originals/${id}/${filename.replace(/[/\\]/g, '_')}`
}

export function derivedKey(id: string, size: 'thumb' | 'web' | 'large') {
  return `derived/${id}/${size}.jpg`
}

export type MediaItemDTO = {
  id: string
  type: string
  status: string
  error: string | null
  title: string | null
  description: string | null
  location: string | null
  originalFilename: string
  originalSize: number
  mimeType: string
  dateYear: number | null
  dateMonth: number | null
  dateDay: number | null
  dateIsApproximate: boolean
  createdAt: string
  uploadedBy: { id: string; name: string } | null
  thumbUrl: string | null
  webUrl?: string | null
  largeUrl?: string | null
}

export async function mediaItemToDTO(
  item: MediaItem & { uploadedBy?: User | null },
  opts: { detail?: boolean } = {}
): Promise<MediaItemDTO> {
  const dto: MediaItemDTO = {
    id: item.id,
    type: item.type,
    status: item.status,
    error: item.error,
    title: item.title,
    description: item.description,
    location: item.location,
    originalFilename: item.originalFilename,
    originalSize: Number(item.originalSize), // BigInt → number (safe far beyond 2GB)
    mimeType: item.mimeType,
    dateYear: item.dateYear,
    dateMonth: item.dateMonth,
    dateDay: item.dateDay,
    dateIsApproximate: item.dateIsApproximate,
    createdAt: item.createdAt.toISOString(),
    uploadedBy: item.uploadedBy ? { id: item.uploadedBy.id, name: item.uploadedBy.name } : null,
    thumbUrl: item.thumbKey ? await signGetUrl(item.thumbKey) : null,
  }
  if (opts.detail) {
    dto.webUrl = item.webKey ? await signGetUrl(item.webKey) : null
    dto.largeUrl = item.largeKey ? await signGetUrl(item.largeKey) : null
  }
  return dto
}
```

- [ ] **Step 5: Verify against the real bucket** — one-off script (do not commit):

```bash
cat > /tmp/s3check.mjs << 'EOF'
import { config } from 'dotenv'
config({ path: '.env.local' })
const { s3, BUCKET, createMultipart, abortMultipart } = await import('./lib/s3.ts')
const { uploadId } = await createMultipart('originals/_check/test.bin', 'application/octet-stream')
console.log('multipart created:', !!uploadId)
await abortMultipart('originals/_check/test.bin', uploadId)
console.log('aborted OK, bucket =', BUCKET)
EOF
npx tsx /tmp/s3check.mjs && rm /tmp/s3check.mjs
```

Expected: `multipart created: true` / `aborted OK, bucket = archives-...`. (Install `tsx` and `dotenv` first: `npm install tsx dotenv` — tsx as a regular dependency, the worker runtime uses it in production.)

- [ ] **Step 6: `npx tsc --noEmit` and `npm run lint`** — both clean.

- [ ] **Step 7: Commit**

```bash
git add lib/s3.ts lib/media.ts package.json package-lock.json
git commit -m "feat: S3 client, media keys, BigInt-safe DTO layer"
```

---

### Task 2: Upload API + job queue

**Files:**
- Create: `lib/queue.ts`, `app/api/uploads/route.ts`, `app/api/uploads/sign-part/route.ts`, `app/api/uploads/complete/route.ts`, `app/api/uploads/abort/route.ts`
- Modify: `package.json` (add `pg-boss`)

**Interfaces:**
- Consumes: Task 1's `lib/s3.ts` + `lib/media.ts` exports (exact names above); `prisma` from `@/lib/db`.
- Produces:
  - `lib/queue.ts`: `getBoss(): Promise<PgBoss>` (started singleton), `enqueueProcessMedia(mediaId: string): Promise<void>`, `QUEUE_PROCESS_MEDIA = 'process-media'` — job payload shape `{ mediaId: string }`.
  - HTTP contract for Task 3 (Uppy) and Task 8:
    - `POST /api/uploads` body `{filename, size, type}` → `{mediaId, key, uploadId}` (400 on bad mime/size)
    - `POST /api/uploads/sign-part` body `{key, uploadId, partNumber}` → `{url}`
    - `POST /api/uploads/complete` body `{mediaId, key, uploadId, parts: [{ETag, PartNumber}]}` → `{ok: true}`
    - `POST /api/uploads/abort` body `{mediaId, key, uploadId}` → `{ok: true}`

- [ ] **Step 1: Install pg-boss**

```bash
npm install pg-boss
```

- [ ] **Step 2: Write `lib/queue.ts`**

```typescript
import PgBoss from 'pg-boss'

export const QUEUE_PROCESS_MEDIA = 'process-media'

const globalForBoss = globalThis as unknown as { boss?: Promise<PgBoss> }

export function getBoss(): Promise<PgBoss> {
  if (!globalForBoss.boss) {
    globalForBoss.boss = (async () => {
      const boss = new PgBoss(process.env.DATABASE_URL!)
      boss.on('error', (err) => console.error('pg-boss error:', err))
      await boss.start()
      await boss.createQueue(QUEUE_PROCESS_MEDIA)
      return boss
    })()
  }
  return globalForBoss.boss
}

export async function enqueueProcessMedia(mediaId: string) {
  const boss = await getBoss()
  await boss.send(QUEUE_PROCESS_MEDIA, { mediaId }, { retryLimit: 3, retryDelay: 60, retryBackoff: true })
}
```

- [ ] **Step 3: Write the four routes.** Every route starts with the same auth resolution; repeat it verbatim in each file (a shared helper would be fine too, but the repetition is 5 lines):

```typescript
// app/api/uploads/route.ts
import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { createMultipart } from '@/lib/s3'
import { mediaTypeForMime, originalKey, MAX_UPLOAD_BYTES } from '@/lib/media'

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const user = await prisma.user.findUnique({ where: { clerkId: userId } })
  if (!user) return NextResponse.json({ error: 'no user record' }, { status: 403 })

  const { filename, size, type } = await req.json()
  const mediaType = mediaTypeForMime(type)
  if (!mediaType) return NextResponse.json({ error: `unsupported file type: ${type}` }, { status: 400 })
  if (!filename || typeof size !== 'number' || size <= 0 || size > MAX_UPLOAD_BYTES)
    return NextResponse.json({ error: 'invalid filename or size (max 2GB)' }, { status: 400 })

  const item = await prisma.mediaItem.create({
    data: {
      type: mediaType,
      status: 'UPLOADING',
      originalKey: '', // set below once we have the id
      originalFilename: filename,
      originalSize: BigInt(size),
      mimeType: type,
      uploadedById: user.id,
    },
  })
  const key = originalKey(item.id, filename)
  await prisma.mediaItem.update({ where: { id: item.id }, data: { originalKey: key } })
  const { uploadId } = await createMultipart(key, type)
  return NextResponse.json({ mediaId: item.id, key, uploadId })
}
```

```typescript
// app/api/uploads/sign-part/route.ts
import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { signPartUrl } from '@/lib/s3'

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { key, uploadId, partNumber } = await req.json()
  if (!key?.startsWith('originals/') || !uploadId || !Number.isInteger(partNumber))
    return NextResponse.json({ error: 'bad request' }, { status: 400 })
  return NextResponse.json({ url: await signPartUrl(key, uploadId, partNumber) })
}
```

```typescript
// app/api/uploads/complete/route.ts
import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { completeMultipart } from '@/lib/s3'
import { enqueueProcessMedia } from '@/lib/queue'

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const user = await prisma.user.findUnique({ where: { clerkId: userId } })
  if (!user) return NextResponse.json({ error: 'no user record' }, { status: 403 })

  const { mediaId, key, uploadId, parts } = await req.json()
  const item = await prisma.mediaItem.findUnique({ where: { id: mediaId } })
  if (!item || item.originalKey !== key)
    return NextResponse.json({ error: 'not found' }, { status: 404 })

  await completeMultipart(key, uploadId, parts)

  await prisma.$transaction([
    prisma.mediaItem.update({ where: { id: mediaId }, data: { status: 'PROCESSING' } }),
    prisma.auditLog.create({
      data: {
        userId: user.id,
        entityType: 'media_item',
        entityId: mediaId,
        action: 'CREATE',
        changes: { filename: { from: null, to: item.originalFilename } },
      },
    }),
  ])
  await enqueueProcessMedia(mediaId)
  return NextResponse.json({ ok: true })
}
```

```typescript
// app/api/uploads/abort/route.ts
import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { abortMultipart } from '@/lib/s3'

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { mediaId, key, uploadId } = await req.json()
  const item = await prisma.mediaItem.findUnique({ where: { id: mediaId } })
  if (item && item.status === 'UPLOADING') {
    if (uploadId && key === item.originalKey) await abortMultipart(key, uploadId).catch(() => {})
    await prisma.mediaItem.delete({ where: { id: mediaId } })
  }
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 4: Verify end-to-end with a script** (bypasses the browser; hits the running dev server is NOT possible without a session cookie, so verify at module level): write `/tmp/upload-check.mjs` that loads `.env.local` with dotenv, then directly exercises the same functions the routes call — `createMultipart` → `signPartUrl` → HTTP PUT a 6MB buffer to the signed URL (via `fetch`, capture the `ETag` response header) → `completeMultipart` → `signGetUrl` → GET and confirm byte length matches. Also `enqueueProcessMedia('smoke-test')` and confirm a row appears: `docker compose exec db psql -U miranda -d miranda -c "select name, data from pgboss.job where name='process-media' limit 3;"`. Record actual outputs in your report, then delete the script and the test object (`originals/_check/...`).

- [ ] **Step 5: `npx tsc --noEmit`, `npm run lint`, `npm run build`** — all clean.

- [ ] **Step 6: Commit**

```bash
git add lib/queue.ts app/api/uploads package.json package-lock.json
git commit -m "feat: multipart upload API and pg-boss queue"
```

---

### Task 3: Upload page (Uppy)

**Files:**
- Create: `components/uploader.tsx`
- Modify: `app/(app)/upload/page.tsx`
- Modify: `package.json` (Uppy deps)

**Interfaces:**
- Consumes: Task 2's HTTP contract, verbatim paths and body shapes.
- Produces: a working `/upload` page; after upload completes it links "View in library".

- [ ] **Step 1: Install Uppy**

```bash
npm install @uppy/core @uppy/dashboard @uppy/react @uppy/aws-s3
```

- [ ] **Step 2: Write `components/uploader.tsx`**

```tsx
'use client'

import { useState } from 'react'
import Uppy from '@uppy/core'
import AwsS3 from '@uppy/aws-s3'
import { Dashboard } from '@uppy/react'
import Link from 'next/link'
import '@uppy/core/css/style.min.css'
import '@uppy/dashboard/css/style.min.css'

const CHUNK_SIZE = 25 * 1024 * 1024

async function api(path: string, body: unknown) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`)
  return res.json()
}

function createUppy() {
  const uppy = new Uppy({
    restrictions: {
      maxFileSize: 2 * 1024 * 1024 * 1024,
      allowedFileTypes: ['image/tiff', 'image/jpeg', 'image/png', 'image/heic', 'image/webp', 'application/pdf', '.tif', '.tiff'],
    },
  })
  uppy.use(AwsS3, {
    shouldUseMultipart: () => true,
    getChunkSize: () => CHUNK_SIZE,
    async createMultipartUpload(file) {
      const { mediaId, key, uploadId } = await api('/api/uploads', {
        filename: file.name,
        size: file.size,
        type: file.type,
      })
      file.meta.mediaId = mediaId
      return { key, uploadId }
    },
    async signPart(_file, { key, uploadId, partNumber }) {
      const { url } = await api('/api/uploads/sign-part', { key, uploadId, partNumber })
      return { url }
    },
    async completeMultipartUpload(file, { key, uploadId, parts }) {
      await api('/api/uploads/complete', { mediaId: file.meta.mediaId, key, uploadId, parts })
      return {}
    },
    async abortMultipartUpload(file, { key, uploadId }) {
      await api('/api/uploads/abort', { mediaId: file.meta.mediaId, key, uploadId })
    },
    async listParts() {
      return [] // resume-across-reload not supported in v1; chunk retries still work in-session
    },
  })
  return uppy
}

export function Uploader() {
  const [uppy] = useState(createUppy)
  const [doneCount, setDoneCount] = useState(0)
  uppy.off('complete', handleComplete).on('complete', handleComplete)
  function handleComplete(result: { successful?: unknown[] }) {
    setDoneCount(result.successful?.length ?? 0)
  }
  return (
    <div>
      <Dashboard uppy={uppy} proudlyDisplayPoweredByUppy={false} height={420} note="Photos (TIFF, JPEG, PNG, HEIC, WebP) and PDF documents, up to 2 GB each" />
      {doneCount > 0 && (
        <p className="mt-4 text-lg">
          {doneCount} file{doneCount > 1 ? 's' : ''} uploaded — processing now.{' '}
          <Link className="underline" href="/">View in library</Link>
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Wire the page**

```tsx
// app/(app)/upload/page.tsx
import { Uploader } from '@/components/uploader'

export default function UploadPage() {
  return (
    <div>
      <h1 className="mb-6 text-3xl font-bold">Upload</h1>
      <Uploader />
    </div>
  )
}
```

- [ ] **Step 4: Verify** — `npm run build` clean, `npx tsc --noEmit` clean, `npm run lint` clean; `npm run dev` and curl `/upload` (expect auth redirect, NOT 500). Full in-browser upload is exercised in Task 8's acceptance run (requires a signed-in human).

- [ ] **Step 5: Commit**

```bash
git add components/uploader.tsx "app/(app)/upload/page.tsx" package.json package-lock.json
git commit -m "feat: Uppy multipart upload page"
```

---

### Task 4: Worker — photo processing

**Files:**
- Create: `worker/index.ts`, `worker/process-media.ts`
- Modify: `package.json` (add `sharp`, script `"worker": "tsx worker/index.ts"`)

**Interfaces:**
- Consumes: `QUEUE_PROCESS_MEDIA`/payload `{mediaId}` (Task 2), `prisma`, `s3`/`BUCKET`/`derivedKey`/`signGetUrl` naming from Task 1.
- Produces: `processMedia(mediaId: string): Promise<void>` (exported from `worker/process-media.ts` — Task 5 extends this same file); a running consumer via `npm run worker`.

- [ ] **Step 1: Install sharp; add script**

```bash
npm install sharp
npm pkg set scripts.worker="tsx worker/index.ts"
```

- [ ] **Step 2: Write `worker/index.ts`**

```typescript
import 'dotenv/config'
import PgBoss from 'pg-boss'
import { QUEUE_PROCESS_MEDIA } from '@/lib/queue'
import { processMedia } from './process-media'
import { prisma } from '@/lib/db'

async function main() {
  const boss = new PgBoss(process.env.DATABASE_URL!)
  boss.on('error', (err) => console.error('pg-boss error:', err))
  await boss.start()
  await boss.createQueue(QUEUE_PROCESS_MEDIA)

  await boss.work<{ mediaId: string }>(
    QUEUE_PROCESS_MEDIA,
    { batchSize: 1 },
    async ([job]) => {
      const { mediaId } = job.data
      console.log(`processing ${mediaId} (attempt ${job.retryCount + 1})`)
      try {
        await processMedia(mediaId)
        console.log(`done ${mediaId}`)
      } catch (err) {
        console.error(`failed ${mediaId}:`, err)
        if (job.retryCount >= 3) {
          await prisma.mediaItem.update({
            where: { id: mediaId },
            data: { status: 'FAILED', error: String(err).slice(0, 1000) },
          })
        }
        throw err // let pg-boss retry
      }
    }
  )
  console.log('worker listening on', QUEUE_PROCESS_MEDIA)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
```

- [ ] **Step 3: Write `worker/process-media.ts`** (photos only in this task; `runPdf` and `extractExif` arrive in Task 5 — leave the two marked call sites out until then)

```typescript
import { createWriteStream } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import sharp from 'sharp'
import { prisma } from '@/lib/db'
import { s3, BUCKET } from '@/lib/s3'
import { derivedKey } from '@/lib/media'

const SIZES = { thumb: 400, web: 1600, large: 3200 } as const

export async function processMedia(mediaId: string) {
  const item = await prisma.mediaItem.findUnique({ where: { id: mediaId } })
  if (!item) throw new Error(`media item ${mediaId} not found`)
  if (item.status === 'READY') return // idempotent re-run

  const dir = await mkdtemp(join(tmpdir(), 'mfa-'))
  try {
    const originalPath = join(dir, 'original')
    const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: item.originalKey }))
    await pipeline(res.Body as Readable, createWriteStream(originalPath))

    const sourceImagePath =
      item.type === 'DOCUMENT' ? await renderPdfPage1(originalPath, dir) : originalPath

    const keys: Record<'thumb' | 'web' | 'large', string> = {} as never
    for (const [name, px] of Object.entries(SIZES) as ['thumb' | 'web' | 'large', number][]) {
      const outPath = join(dir, `${name}.jpg`)
      await sharp(sourceImagePath, { limitInputPixels: false })
        .rotate() // honor EXIF orientation
        .resize({ width: px, height: px, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: name === 'thumb' ? 75 : 85, mozjpeg: true })
        .toFile(outPath)
      const key = derivedKey(item.id, name)
      await s3.send(
        new PutObjectCommand({
          Bucket: BUCKET,
          Key: key,
          Body: await readFile(outPath),
          ContentType: 'image/jpeg',
        })
      )
      keys[name] = key
    }

    const exif = await extractExif(originalPath)

    await prisma.mediaItem.update({
      where: { id: mediaId },
      data: {
        thumbKey: keys.thumb,
        webKey: keys.web,
        largeKey: keys.large,
        exif: exif ?? undefined,
        status: 'READY',
        error: null,
      },
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

// Implemented in Task 5 — until then photos-only: these stubs keep the file compiling.
async function renderPdfPage1(_originalPath: string, _dir: string): Promise<string> {
  throw new Error('PDF processing not implemented yet (Task 5)')
}
async function extractExif(_path: string): Promise<Record<string, unknown> | null> {
  return null
}
```

- [ ] **Step 4: Verify with a real photo** — run `docker compose up -d`, `npm run worker` in one terminal. In another, upload a real JPEG or TIFF through the Task 2 module-level flow (reuse the `/tmp/upload-check.mjs` approach but with a real image file, calling `prisma.mediaItem.create` + `enqueueProcessMedia` the way the routes do — or simpler: insert a row pointing at the object you uploaded in Task 2's check and `enqueueProcessMedia(id)`). Expected: worker logs `processing`/`done`, row flips to READY with three derived keys, and `derived/{id}/thumb.jpg` downloads via a presigned URL and is a valid JPEG (`file thumb.jpg`). Record outputs.

- [ ] **Step 5: `npx tsc --noEmit`, `npm run lint`** — clean. (Note: `worker/` compiles under the app tsconfig; `@/*` alias resolves because tsx respects tsconfig paths.)

- [ ] **Step 6: Commit**

```bash
git add worker/index.ts worker/process-media.ts package.json package-lock.json
git commit -m "feat: worker service with sharp photo derivatives"
```

---

### Task 5: Worker — PDF thumbnails + EXIF

**Files:**
- Modify: `worker/process-media.ts` (replace the two stubs)

**Interfaces:**
- Consumes: Task 4's `processMedia` structure.
- Produces: working `renderPdfPage1(originalPath: string, dir: string): Promise<string>` and `extractExif(path: string): Promise<Record<string, unknown> | null>`.

- [ ] **Step 1: Local tool check** — `pdftoppm -v` and `exiftool -ver`; if missing: `brew install poppler exiftool`.

- [ ] **Step 2: Replace the stubs**

```typescript
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const execFileAsync = promisify(execFile)

async function renderPdfPage1(originalPath: string, dir: string): Promise<string> {
  const outPrefix = join(dir, 'page1')
  // -r 200: high enough for a 3200px large derivative of a letter-size page
  await execFileAsync('pdftoppm', ['-jpeg', '-f', '1', '-l', '1', '-r', '200', originalPath, outPrefix])
  return `${outPrefix}-1.jpg` // pdftoppm names output <prefix>-<page>.jpg
}

async function extractExif(path: string): Promise<Record<string, unknown> | null> {
  try {
    // -json structured output; -n numeric values (GPS as decimals); binary blobs excluded by default
    const { stdout } = await execFileAsync('exiftool', ['-json', '-n', path], {
      maxBuffer: 10 * 1024 * 1024,
    })
    const data = JSON.parse(stdout)[0] ?? null
    if (data) {
      delete data.SourceFile
      delete data.Directory
      delete data.FilePermissions
    }
    return data
  } catch (err) {
    console.warn('exiftool failed (non-fatal):', err)
    return null
  }
}
```

(Adjust the `pdftoppm` output-name handling if the local version emits `page1-01.jpg` — check with `ls` and glob for `page1-*.jpg` if needed.)

- [ ] **Step 3: Verify with a real PDF and re-verify a photo** — same harness as Task 4 Step 4: process one PDF (expect three JPEG derivatives of page 1, status READY) and one photo (expect `exif` JSONB populated — check `select jsonb_object_keys(exif) from "MediaItem" where id='...' limit 10;` shows real tags like `ImageWidth`). Record outputs.

- [ ] **Step 4: `npx tsc --noEmit`, `npm run lint`** — clean.

- [ ] **Step 5: Commit**

```bash
git add worker/process-media.ts
git commit -m "feat: PDF page-1 derivatives and EXIF extraction"
```

---

### Task 6: Library API + grid

**Files:**
- Create: `app/api/media/route.ts`, `components/media-grid.tsx`
- Modify: `app/(app)/page.tsx`

**Interfaces:**
- Consumes: `mediaItemToDTO` (Task 1).
- Produces: `GET /api/media?cursor=<id>&limit=<n>` → `{items: MediaItemDTO[], nextCursor: string|null}` — READY items always; UPLOADING/PROCESSING/FAILED items included too (with null thumbUrl) so fresh uploads are visible with a status badge. Ordered `createdAt desc`, `deletedAt: null` filtered. Task 7 links each grid tile to `/media/{id}`.

- [ ] **Step 1: Write `app/api/media/route.ts`**

```typescript
import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { mediaItemToDTO } from '@/lib/media'

export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const cursor = req.nextUrl.searchParams.get('cursor')
  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') ?? 50), 100)

  const items = await prisma.mediaItem.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: { uploadedBy: true },
  })
  const hasMore = items.length > limit
  const page = hasMore ? items.slice(0, limit) : items
  return NextResponse.json({
    items: await Promise.all(page.map((i) => mediaItemToDTO(i))),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  })
}
```

- [ ] **Step 2: Write `components/media-grid.tsx`** — client component: fetches `/api/media` on mount, renders a responsive grid (`grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3`), each tile a `<Link href={'/media/' + item.id}>` containing the thumb `<img>` (or a status placeholder). Tiles for non-READY items show a large label chip: "Uploading…", "Processing…", or "Failed" (red). DOCUMENT items get a small 📄 badge in the corner. An intersection-observer sentinel div at the bottom loads `nextCursor` pages. Show "Nothing here yet — Upload your first photos" with a link to `/upload` when empty. Full code:

```tsx
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type { MediaItemDTO } from '@/lib/media'

export function MediaGrid() {
  const [items, setItems] = useState<MediaItemDTO[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [loading, setLoading] = useState(false)
  const sentinel = useRef<HTMLDivElement>(null)

  const loadMore = useCallback(async () => {
    if (loading || done) return
    setLoading(true)
    const res = await fetch(`/api/media${cursor ? `?cursor=${cursor}` : ''}`)
    const data = await res.json()
    setItems((prev) => [...prev, ...data.items])
    setCursor(data.nextCursor)
    if (!data.nextCursor) setDone(true)
    setLoading(false)
  }, [cursor, done, loading])

  useEffect(() => {
    loadMore()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const obs = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) loadMore()
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [loadMore])

  if (done && items.length === 0)
    return (
      <p className="text-xl">
        Nothing here yet —{' '}
        <Link href="/upload" className="underline">
          upload your first photos
        </Link>
        .
      </p>
    )

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {items.map((item) => (
          <Link
            key={item.id}
            href={`/media/${item.id}`}
            className="relative block aspect-square overflow-hidden rounded-xl bg-black/5"
          >
            {item.thumbUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.thumbUrl} alt={item.title ?? item.originalFilename} className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full items-center justify-center p-2 text-center text-sm">
                {item.status === 'FAILED' ? (
                  <span className="rounded-full bg-red-100 px-3 py-1 text-red-700">Failed</span>
                ) : (
                  <span className="rounded-full bg-black/10 px-3 py-1">
                    {item.status === 'UPLOADING' ? 'Uploading…' : 'Processing…'}
                  </span>
                )}
              </span>
            )}
            {item.type === 'DOCUMENT' && (
              <span aria-label="document" className="absolute right-2 top-2 rounded bg-white/80 px-1">📄</span>
            )}
          </Link>
        ))}
      </div>
      <div ref={sentinel} className="h-8" />
      {loading && <p className="py-4 text-center">Loading…</p>}
    </div>
  )
}
```

- [ ] **Step 3: Wire `app/(app)/page.tsx`**

```tsx
import { MediaGrid } from '@/components/media-grid'

export default function LibraryPage() {
  return (
    <div>
      <h1 className="mb-6 text-3xl font-bold">Library</h1>
      <MediaGrid />
    </div>
  )
}
```

- [ ] **Step 4: Verify** — `npm run build`, `tsc --noEmit`, `lint` clean. With the dev server + worker running and the items processed in Tasks 4/5 in the local DB, `curl` the API route module-level equivalent is impractical (auth) — instead verify the query directly: `npx tsx -e` script calling the same `prisma.mediaItem.findMany` + `mediaItemToDTO` and print the first DTO — confirm `originalSize` is a plain number and `thumbUrl` is an https URL. Record output.

- [ ] **Step 5: Commit**

```bash
git add app/api/media/route.ts components/media-grid.tsx "app/(app)/page.tsx"
git commit -m "feat: library grid with infinite scroll and status badges"
```

---

### Task 7: Item detail + download original + retry

**Files:**
- Create: `app/(app)/media/[id]/page.tsx`, `app/api/media/[id]/route.ts`, `app/api/media/[id]/download/route.ts`, `app/api/media/[id]/retry/route.ts`

**Interfaces:**
- Consumes: `mediaItemToDTO(item, {detail: true})` (Task 1), `enqueueProcessMedia` (Task 2).
- Produces: `/media/{id}` page; `GET /api/media/{id}` → `MediaItemDTO` (detail); `GET /api/media/{id}/download` → 302 presigned; `POST /api/media/{id}/retry` → `{ok}` (only when FAILED; uploader or ADMIN).

- [ ] **Step 1: The three API routes**

```typescript
// app/api/media/[id]/route.ts
import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { mediaItemToDTO } from '@/lib/media'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  const item = await prisma.mediaItem.findFirst({
    where: { id, deletedAt: null },
    include: { uploadedBy: true },
  })
  if (!item) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json(await mediaItemToDTO(item, { detail: true }))
}
```

```typescript
// app/api/media/[id]/download/route.ts
import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { signGetUrl } from '@/lib/s3'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  const item = await prisma.mediaItem.findFirst({ where: { id, deletedAt: null } })
  if (!item) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const url = await signGetUrl(item.originalKey, {
    downloadName: item.originalFilename,
    expiresIn: 300,
  })
  return NextResponse.redirect(url, 302)
}
```

```typescript
// app/api/media/[id]/retry/route.ts
import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { enqueueProcessMedia } from '@/lib/queue'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const user = await prisma.user.findUnique({ where: { clerkId: userId } })
  if (!user) return NextResponse.json({ error: 'no user record' }, { status: 403 })
  const { id } = await params
  const item = await prisma.mediaItem.findFirst({ where: { id, deletedAt: null } })
  if (!item) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (item.status !== 'FAILED') return NextResponse.json({ error: 'not failed' }, { status: 400 })
  if (user.role !== 'ADMIN' && item.uploadedById !== user.id)
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  await prisma.mediaItem.update({ where: { id }, data: { status: 'PROCESSING', error: null } })
  await enqueueProcessMedia(id)
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 2: Detail page** — server component fetching directly with Prisma (no self-HTTP):

```tsx
// app/(app)/media/[id]/page.tsx
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { prisma } from '@/lib/db'
import { mediaItemToDTO } from '@/lib/media'

export default async function MediaDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const item = await prisma.mediaItem.findFirst({
    where: { id, deletedAt: null },
    include: { uploadedBy: true },
  })
  if (!item) notFound()
  const dto = await mediaItemToDTO(item, { detail: true })
  const sizeMB = (dto.originalSize / (1024 * 1024)).toFixed(1)

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/" className="text-lg underline">← Library</Link>
      <h1 className="my-4 text-3xl font-bold">{dto.title ?? dto.originalFilename}</h1>

      {dto.status === 'READY' && dto.type === 'PHOTO' && dto.webUrl && (
        <a href={dto.largeUrl ?? dto.webUrl} target="_blank" rel="noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={dto.webUrl} alt={dto.title ?? dto.originalFilename} className="w-full rounded-xl" />
        </a>
      )}
      {dto.status === 'READY' && dto.type === 'DOCUMENT' && (
        <div>
          {dto.webUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={dto.webUrl} alt="Page 1" className="w-full rounded-xl border" />
          )}
          <p className="mt-2 text-sm">Preview of page 1 — download the original to read the full document.</p>
        </div>
      )}
      {dto.status !== 'READY' && (
        <p className="rounded-xl bg-black/5 p-8 text-center text-xl">
          {dto.status === 'FAILED' ? `Processing failed: ${dto.error}` : 'Still processing — check back in a minute.'}
        </p>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <a
          href={`/api/media/${dto.id}/download`}
          className="rounded-xl bg-black px-6 py-3 text-lg text-white"
        >
          Download original ({sizeMB} MB)
        </a>
        {dto.status === 'FAILED' && <RetryButton id={dto.id} />}
      </div>

      <dl className="mt-8 grid grid-cols-2 gap-2 text-lg">
        <dt className="font-semibold">Uploaded by</dt><dd>{dto.uploadedBy?.name ?? 'Unknown'}</dd>
        <dt className="font-semibold">Uploaded</dt><dd>{new Date(dto.createdAt).toLocaleDateString()}</dd>
        <dt className="font-semibold">File</dt><dd>{dto.originalFilename} ({dto.mimeType})</dd>
      </dl>
    </div>
  )
}

function RetryButton({ id }: { id: string }) {
  async function retry() {
    'use server'
    const { prisma } = await import('@/lib/db')
    const { enqueueProcessMedia } = await import('@/lib/queue')
    const item = await prisma.mediaItem.findUnique({ where: { id } })
    if (item?.status === 'FAILED') {
      await prisma.mediaItem.update({ where: { id }, data: { status: 'PROCESSING', error: null } })
      await enqueueProcessMedia(id)
    }
  }
  return (
    <form action={retry}>
      <button className="rounded-xl border px-6 py-3 text-lg">Retry processing</button>
    </form>
  )
}
```

(The server-action retry intentionally skips the role check the API route enforces — a signed-in family member re-running a failed job is harmless; the API route keeps the stricter contract for future UI. If the reviewer prefers one path, keep the API route and make the button a client fetch instead.)

- [ ] **Step 3: Verify** — `npm run build`, `tsc --noEmit`, `lint` clean; with dev server + processed items, load `/media/<id>` module-level: `npx tsx -e` calling the page's data path (`findFirst` + DTO) prints web/large URLs; `curl -I` one presigned URL → 200 with `content-type: image/jpeg`. Record outputs.

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/media" app/api/media
git commit -m "feat: item detail with download original and retry"
```

---

### Task 8: Worker deployment + production acceptance

**Files:**
- Create: `worker/Dockerfile`, `.dockerignore`

**Interfaces:**
- Consumes: everything.
- Produces: Railway service `worker` running the consumer in production; web service holding bucket env vars; a human-verified production upload.

- [ ] **Step 1: Write `worker/Dockerfile`** (build context = repo root)

```dockerfile
FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends poppler-utils libimage-exiftool-perl openssl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci
COPY . .

CMD ["npx", "tsx", "worker/index.ts"]
```

- [ ] **Step 2: Write `.dockerignore`**

```
node_modules
.next
.git
.superpowers
.agents
.claude
docs
docker-compose.yml
```

- [ ] **Step 3: Local image sanity check**

```bash
docker build -f worker/Dockerfile -t mfa-worker . \
  && docker run --rm mfa-worker sh -c "pdftoppm -v 2>&1 | head -1 && exiftool -ver && node -e \"require('sharp'); console.log('sharp ok')\""
```

Expected: poppler version line, exiftool version, `sharp ok`.

- [ ] **Step 4: Create the Railway worker service** — via Railway MCP/CLI: new service `worker` in project `miranda-family-archives`, source = GitHub repo `redtailtech/miranda-family-archives` branch `main`, and set the service's variables:

```
DATABASE_URL          = ${{Postgres.DATABASE_URL}}   (reference variable)
RAILWAY_DOCKERFILE_PATH = worker/Dockerfile
AWS_ENDPOINT_URL, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_S3_BUCKET_NAME, AWS_DEFAULT_REGION
                      = values from `railway bucket credentials --bucket archives`
```

No public domain, no pre-deploy command. Also add the same five `AWS_*` variables to the **web** service (it presigns URLs).

- [ ] **Step 5: Push and deploy**

```bash
git add worker/Dockerfile .dockerignore
git commit -m "feat: worker Dockerfile and deployment config"
git push origin main
```

Both services build (web via Nixpacks as before, worker via the Dockerfile). Verify: worker deploy logs show `worker listening on process-media`; web deploy SUCCESS.

- [ ] **Step 6: Production acceptance (human-in-the-loop)** — ask the user to: sign in at https://mirandafamilyarchives.com, upload one large TIFF (ideally 100MB+) and one PDF via `/upload`, watch the progress bars, then confirm both appear in the Library, open each detail page, and download one original. Meanwhile watch `railway logs --service worker` for the processing lines and confirm rows flip to READY. If anything fails, capture logs before fixing.

- [ ] **Step 7: Final commit of any config/doc adjustments and push.**

---

## Deferred to later phases (explicitly NOT in this plan)

- Metadata editing forms, flexible-date picker, audit-diff layer, EXIF "Advanced" tab, History tab → Phase 3 (upload already writes the CREATE audit row so digest data is complete).
- "Add details while you wait" inline upload form → Phase 3 (needs the metadata form built there; YAGNI to build it twice).
- Search/filters, timeline, albums, favorites, comments, hearts → Phase 4.
- Upload resume across page reloads (`listParts` returns `[]`) — in-session chunk retry covers the flaky-connection case; revisit only if the family reports pain.
- Grid virtualization — infinite scroll paging is sufficient at family scale.

## Phase 2 exit criteria

- A signed-in family member uploads a 500MB TIFF from the browser with visible per-file progress and chunk-level retry.
- The worker produces thumb/web/large JPEGs for photos and PDF page-1 derivatives, extracts EXIF into `MediaItem.exif`, marks items READY; failures retry 3× then surface as FAILED with a retry button.
- Library grid shows thumbnails (with status badges for in-flight items) and infinite scroll; detail page shows the web-size image, file info, and a working "Download original" that streams straight from the bucket.
- Both Railway services deploy from `main` on push.
