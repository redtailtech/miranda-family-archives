# Miranda Family Archives — Design Spec

**Date:** 2026-08-26
**Status:** Approved design, pre-implementation
**Repo:** https://github.com/redtailtech/miranda-family-archives

## 1. Purpose

A private, web-based family archive for the Miranda family. Family members upload
archival-quality photographs (TIFF scans up to ~500MB each) and scanned historical
documents (PDFs), enrich them with metadata (people, descriptions, flexible dates),
organize them into albums, browse them by timeline and by family member via an
interactive family tree, and receive a daily email digest when new material arrives.

The audience spans tech-challenged grandparents and phone-native younger family
members. One interface serves both: simple structure, modern polish.

**Scale target:** 1,000–10,000 items over time (0.5–2+ TB of originals).
**Testing:** No automated tests until the first complete prototype (explicit user
decision). Manual verification during development.

## 2. Architecture

One repo, one Railway project, four pieces:

| Piece | What | Notes |
|---|---|---|
| **web** | Next.js (App Router) service | Clerk auth, all UI, API routes/server actions |
| **worker** | Node service, same repo | pg-boss job consumer + cron; Docker image includes poppler (`pdftoppm`) and `exiftool` |
| **Postgres** | Railway managed Postgres | Single source of truth; also the job queue (pg-boss) |
| **Bucket** | Railway S3-compatible object storage | Originals + derivatives; never public; presigned URLs only |

Key decisions:
- **Direct-to-bucket uploads** via S3 multipart presigned URLs. 500MB files never
  pass through the web server.
- **Background worker** for all heavy processing (TIFF derivative generation, PDF
  rendering, EXIF extraction) with retries via pg-boss. No Redis; Postgres-backed queue.
- **Prisma** ORM. Migrations run on web deploy.
- Stack: Next.js + TypeScript + Tailwind. Uploader UI: Uppy (AWS S3 multipart plugin).
  Image processing: sharp (libvips). EXIF: exiftool. Email: Resend. Auth: Clerk.

## 3. Data model (Postgres + Prisma)

### Core tables

- **users** — mirrors Clerk via webhook: `clerk_id`, `name`, `email`, `avatar_url`;
  plus `role` (`admin` | `member`) and `digest_enabled` (default `true`).
- **media_items** — unified photos and documents:
  - `type` (`photo` | `document`)
  - Original file: `original_key`, `original_filename`, `original_size`, `mime_type`
  - `status`: `uploading` → `processing` → `ready` | `failed` (+ `error` text)
  - Derivative keys as columns: `thumb_key`, `web_key`, `large_key` (exactly three
    fixed sizes; a separate derivatives table is deliberately avoided)
  - `exif` JSONB
  - Human metadata: `title`, `description`, `location`
  - Flexible date: `date_year`, `date_month`, `date_day` (each nullable) +
    `date_is_approximate` boolean. Representable: "1962", "June 1962",
    "circa 1960s", "June 14, 1962".
  - `uploaded_by`, timestamps, `deleted_at` (soft delete)
- **people** — `display_name`, `maiden_name`, `gender` (drives default silhouette
  avatar), `birth_year`, `death_year`, `birthplace`, `notes`, optional avatar image,
  `deleted_at` (soft delete).
- **relationships** — two kinds of rows: parent–child (`child_id`, `parent_id`) and
  spouse (`person_a`, `person_b`). Siblings are derived from shared parents.
- **media_people** — person-tag join table (powers "click a person → their photos").
- **albums** — `name`, `description`, cover media reference.
- **album_items** — join with `position` for ordering.
- **favorites** — (`user_id`, `media_item_id`) pairs.
- **comments** — per media item: author, body, timestamps.
- **hearts** — (`user_id`, `media_item_id`) reaction pairs.

### Audit & digest tables

- **audit_log** — one row per change: `user_id`, `entity_type`, `entity_id`,
  `action` (`create` | `update` | `delete`), `changes` JSONB of
  `{field: {from, to}}`, `created_at`. Written by the data layer **in the same
  transaction** as the mutation. Doubles as the activity source for the daily digest.
- **digest_log** — one row per digest send date; written before sending as a lock
  against double-sends.

## 4. Upload & processing pipeline

### Upload (browser → bucket, direct)
1. User drops files on the upload page (Uppy UI; drag-drop or big "Choose photos"
   button; multiple files in parallel).
2. App creates `media_items` row (`status: uploading`), initiates S3 multipart
   upload against the bucket, hands the browser presigned part URLs.
3. Browser uploads in ~25MB chunks with per-file progress. Failed chunks retry
   individually — a flaky connection never restarts a 500MB file.
4. App finalizes the multipart upload, flips status to `processing`, enqueues a
   `process-media` job. An inline "add details while you wait" form lets users
   enter metadata during upload.

### Processing (worker)
- Stream original from bucket to temp file.
- **Images** (sharp/libvips — streams TIFFs without full-decode memory blowups):
  - `thumb` ~400px (grids), `web` ~1600px (lightbox), `large` ~3200px (zoom) — JPEG/WebP.
- **PDFs**: render page 1 via `pdftoppm`, then same three sizes. Detail page embeds
  the actual PDF for reading.
- **EXIF**: `exiftool` → `exif` JSONB (TIFF tags, scanner metadata, GPS, etc.).
- Success → `status: ready`. Failure → 3 pg-boss retries → `status: failed` with
  stored error; UI shows a retry button (admin). Originals are safe in the bucket
  regardless — processing failure never loses data.

### Downloads
"Download original" issues a short-lived presigned GET URL; the file streams
bucket → browser, never through the app.

### Bucket layout
`originals/{id}/{filename}`; `derived/{id}/thumb.jpg`, `web.jpg`, `large.jpg`.
Nothing public.

## 5. Access model

- **Invite-only** via Clerk invitations; public sign-up disabled in Clerk.
- Roles: **admin** (invite users, delete/restore items, manage tree, retry failed
  jobs) and **member** (upload, edit metadata, tag, album, favorite, comment, heart).
  Everyone can view everything.
- Clerk webhook syncs user records into the `users` table.

## 6. UI structure

One interface for both generations. Grandparent-proofing through structure (large
type/touch targets, high contrast, ≤5 nav items with words + icons, no hover-only
controls, forgiving forms); youth appeal through polish (warm archival visual
design, smooth transitions, satisfying heart animation). Fully responsive.
The frontend-design skill will be used during implementation for a distinctive look.

### Pages
- **Library** (home) — photo grid, prominent search, filter chips (People, Albums,
  Decades, Photos/Documents), toggle to **timeline view** (decade → year), infinite
  scroll. Documents show page-1 thumbnail + "document" badge.
- **Item detail** — lightbox (web size, tap-to-zoom to large; PDFs inline). Metadata
  panel: title, description, flexible date picker ("fill in what you know" +
  approximate checkbox), location, tagged-people avatar chips, album membership,
  hearts, comments. Tabs: **Details** (edit) / **Advanced** (formatted EXIF table) /
  **History** (human-readable audit trail). Clear **Download original** button
  showing file size.
- **Upload** — giant drop zone, per-file progress, inline metadata form.
- **Albums** — cover-image cards; album grid with drag-to-reorder.
- **Family tree** — pan/zoom interactive tree; default silhouette avatars by gender,
  photo avatars when set. Person profile: vitals, relationships, all tagged photos.
  Editing is form-based ("Add child", "Add spouse"), never diagram manipulation.
- **Favorites** — the user's hearted grid.
- **Settings** — digest email toggle.
- **Admin** — invite members, manage roles, retry failed processing, restore
  soft-deleted items.

## 7. Audit history

- Small data layer computes field-level diffs and writes `audit_log` in the same
  transaction as every mutation.
- Covered: media metadata edits, uploads, deletes, people/relationship changes,
  album changes. **Not** covered (deliberate): hearts, favorites, comments — social
  signals, not archival facts.
- **Soft deletes** for media items and people; admin-restorable. Bucket originals
  never auto-purged.

## 8. Daily digest (Resend)

- pg-boss cron in the worker, daily 8:00 AM America/New_York.
- Digest-worthy events from last 24h of `audit_log`: new ready photos/documents
  (with thumbnails), new family tree people, and **major edits** — concretely:
  changes to title, description, date fields, or people-tags on media, and edits to
  people records. Hearts/comments/album-shuffles do not trigger a send.
- **No activity → no email.** Otherwise one email per subscribed user
  (`digest_enabled = true`) with inline thumbnails linking into the app.
- `digest_log` written first as a send-lock (idempotent across worker restarts).
- Setup dependency: verified sending domain in Resend (DNS records — user task).

## 9. Deployment

- Push to `main` → Railway deploys web + worker from the same repo (worker uses its
  own Dockerfile with poppler + exiftool; different start command).
- Prisma migrations run on web deploy.
- Env vars: Clerk keys + webhook secret, `DATABASE_URL` (Railway reference var),
  bucket credentials/endpoint, `RESEND_API_KEY`, app public URL.
- Clerk dashboard: public sign-up off, invitations on, webhook → web service URL.

## 10. Out of scope for v1

- Automated tests (deferred until prototype complete, per user decision)
- GEDCOM import/export; sources/citations; complex relationship types
  (adoption/step, multiple marriages with date ranges)
- Mobile apps (web only)
- Video uploads
- Public sharing links
- Full-text/OCR search of documents

## 11. Build phases

1. **Foundation** — Next.js scaffold, Clerk (invite-only + roles), Prisma schema,
   Railway deploy (web + Postgres + bucket), user-sync webhook.
2. **Media pipeline** — Uppy multipart upload, worker + pg-boss, sharp/pdftoppm/
   exiftool processing, library grid, item detail with download-original.
3. **Metadata & audit** — edit forms, flexible dates, audit data layer, History and
   Advanced (EXIF) tabs, soft delete + admin restore.
4. **Organization & social** — albums, favorites, timeline view, search/filters,
   comments, hearts.
5. **Family tree** — people CRUD, relationships, tree visualization, person
   profiles, photo tagging integration.
6. **Digest & polish** — Resend digest job, settings, admin screens, visual polish
   pass, grandparent usability review.
