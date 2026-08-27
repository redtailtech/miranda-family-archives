// Must be the first import: loads env vars before any other module (e.g. `@/lib/s3`)
// reads `process.env.*` into a top-level const at import time. See worker/env.ts.
// This entry can also be run directly (`tsx worker/send-digest.ts`), separate
// from the long-running worker process, so it loads its own env exactly like
// worker/index.ts does.
import './env'

import { pathToFileURL } from 'node:url'
import { Resend } from 'resend'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { collectDigestEvents, digestRecipients, type DigestEvents } from '@/lib/digest'

const SENDER = 'Miranda Family Archives <updates@mirandafamilyarchives.com>'

/** "Today" as a date-only value in the America/New_York calendar day, regardless of server TZ. */
function todayInNewYork(): Date {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
  return new Date(ymd)
}

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

function buildSubject(events: DigestEvents): string {
  const parts: string[] = []
  if (events.newMedia.length > 0) parts.push(`${pluralize(events.newMedia.length, 'new photo')}`)
  if (events.newPeople.length > 0) parts.push(`${pluralize(events.newPeople.length, 'new family member')}`)
  if (parts.length === 0) return 'New in the family archive'
  return parts.join(' and ')
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function mediaLabel(item: { title: string | null; filename: string }): string {
  return escapeHtml(item.title || item.filename)
}

/** Renders the digest as a single self-contained, inline-styled HTML email. */
export function renderDigestHtml(events: DigestEvents, appUrl: string): string {
  const sections: string[] = []

  if (events.newMedia.length > 0) {
    const rows = events.newMedia
      .map((m) => {
        const href = `${appUrl}/media/${m.id}`
        const thumb = m.thumbUrl
          ? `<img src="${escapeHtml(m.thumbUrl)}" width="64" height="64" alt="" style="display:block;width:64px;height:64px;border-radius:8px;object-fit:cover;background:#e8ddce;" />`
          : `<div style="width:64px;height:64px;border-radius:8px;background:#e8ddce;"></div>`
        return `
          <tr>
            <td style="padding:8px 0;width:64px;">
              <a href="${escapeHtml(href)}">${thumb}</a>
            </td>
            <td style="padding:8px 0 8px 12px;font-size:15px;color:#3a2f26;">
              <a href="${escapeHtml(href)}" style="color:#3a2f26;text-decoration:none;font-weight:600;">${mediaLabel(m)}</a>
              <div style="font-size:13px;color:#8a7a68;margin-top:2px;">added by ${escapeHtml(m.byName)}</div>
            </td>
          </tr>`
      })
      .join('')
    sections.push(`
      <tr><td style="padding:24px 0 8px;font-size:17px;font-weight:700;color:#3a2f26;">📷 New photos &amp; documents</td></tr>
      <tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table></td></tr>
    `)
  }

  if (events.newPeople.length > 0) {
    const rows = events.newPeople
      .map((p) => {
        const href = `${appUrl}/people/${p.id}`
        return `
          <tr>
            <td style="padding:6px 0;font-size:15px;color:#3a2f26;">
              <a href="${escapeHtml(href)}" style="color:#3a2f26;text-decoration:none;font-weight:600;">${escapeHtml(p.name)}</a>
              <span style="font-size:13px;color:#8a7a68;"> — added by ${escapeHtml(p.byName)}</span>
            </td>
          </tr>`
      })
      .join('')
    sections.push(`
      <tr><td style="padding:24px 0 8px;font-size:17px;font-weight:700;color:#3a2f26;">🌳 New family members</td></tr>
      <tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table></td></tr>
    `)
  }

  if (events.editedMedia.length > 0 || events.editedPeople.length > 0) {
    const mediaRows = events.editedMedia
      .map((m) => {
        const href = `${appUrl}/media/${m.id}`
        return `
          <tr>
            <td style="padding:6px 0;font-size:15px;color:#3a2f26;">
              <a href="${escapeHtml(href)}" style="color:#3a2f26;text-decoration:none;font-weight:600;">${mediaLabel(m)}</a>
              <div style="font-size:13px;color:#8a7a68;margin-top:2px;">${escapeHtml(m.byName)} updated ${escapeHtml(m.fields.join(', '))}</div>
            </td>
          </tr>`
      })
      .join('')
    const peopleRows = events.editedPeople
      .map((p) => {
        const href = `${appUrl}/people/${p.id}`
        return `
          <tr>
            <td style="padding:6px 0;font-size:15px;color:#3a2f26;">
              <a href="${escapeHtml(href)}" style="color:#3a2f26;text-decoration:none;font-weight:600;">${escapeHtml(p.name)}</a>
              <div style="font-size:13px;color:#8a7a68;margin-top:2px;">${escapeHtml(p.byName)} updated ${escapeHtml(p.fields.join(', '))}</div>
            </td>
          </tr>`
      })
      .join('')
    sections.push(`
      <tr><td style="padding:24px 0 8px;font-size:17px;font-weight:700;color:#3a2f26;">✏️ Updated details</td></tr>
      <tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${mediaRows}${peopleRows}</table></td></tr>
    `)
  }

  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4ede1;padding:32px 0;">
  <tr>
    <td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#fffaf2;border-radius:12px;overflow:hidden;font-family:Georgia,'Times New Roman',serif;">
        <tr>
          <td style="background:#b5622f;padding:20px 32px;">
            <span style="font-size:20px;font-weight:700;color:#fffaf2;">Miranda Family Archives</span>
          </td>
        </tr>
        <tr>
          <td style="padding:8px 32px 32px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              ${sections.join('')}
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 32px;border-top:1px solid #e8ddce;font-size:12px;color:#8a7a68;">
            You can turn these emails off in Settings.
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`
}

function isEmptyDigest(events: DigestEvents): boolean {
  return (
    events.newMedia.length === 0 &&
    events.newPeople.length === 0 &&
    events.editedMedia.length === 0 &&
    events.editedPeople.length === 0
  )
}

/**
 * Resolves the lookback cutoff for `collectDigestEvents`, anchored to the
 * previous digest run rather than a flat now-24h: the most recent DigestLog
 * row strictly before `today` (quiet days create lock rows too, so this
 * naturally covers a delayed retry, a DST 23/25h day, or a missed day
 * without losing or double-counting activity). Falls back to now-24h when
 * there's no prior DigestLog row at all (e.g. the very first run).
 */
export async function resolveDigestSince(today: Date): Promise<Date> {
  const previousLog = await prisma.digestLog.findFirst({
    where: { date: { lt: today } },
    orderBy: { date: 'desc' },
  })
  return previousLog ? previousLog.createdAt : new Date(Date.now() - 24 * 60 * 60 * 1000)
}

type EmailClient = { emails: { send: Resend['emails']['send'] } }

/**
 * Sends one email per recipient, isolating failures per-recipient so one
 * bad address (or a transient provider error) doesn't block the rest.
 * Exported so it can be driven directly in verification with a fake
 * `EmailClient` — no real network call or API key required.
 */
export async function sendDigestBatch(
  client: EmailClient,
  recipients: { email: string; name: string }[],
  subject: string,
  html: string
): Promise<{ successes: string[]; failures: { email: string; error: unknown }[] }> {
  const successes: string[] = []
  const failures: { email: string; error: unknown }[] = []
  for (const recipient of recipients) {
    try {
      const { error } = await client.emails.send({ from: SENDER, to: recipient.email, subject, html })
      if (error) throw new Error(error.message)
      successes.push(recipient.email)
    } catch (err) {
      failures.push({ email: recipient.email, error: err })
    }
  }
  return { successes, failures }
}

/**
 * Runs the daily digest: date-locks first (via a unique DigestLog row for
 * "today" in America/New_York), then collects and sends. A quiet day (no
 * events) still "counts" as handled — the lock stays. A total send failure
 * (every recipient failed, or the failure happened before any send was
 * attempted — e.g. a missing API key) deletes the lock so the next
 * invocation can retry. A PARTIAL failure (at least one recipient
 * succeeded) does NOT delete the lock — today's digest is considered sent,
 * `sentCount` reflects the successes, and the failed recipients simply miss
 * this one digest (acceptable; they'll get the next one).
 */
export async function runDailyDigest(
  opts: { force?: boolean; emailClient?: EmailClient } = {}
): Promise<{ sent: number; skipped: string | null }> {
  const today = todayInNewYork()
  let lockCreatedHere = false

  try {
    await prisma.digestLog.create({ data: { date: today } })
    lockCreatedHere = true
  } catch (err) {
    const isDuplicateLock = err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
    if (!isDuplicateLock) throw err
    if (!opts.force) return { sent: 0, skipped: 'already sent today' }
    // force=true: proceed even though today's lock row already exists.
  }

  const since = await resolveDigestSince(today)
  const events = await collectDigestEvents(since)

  if (isEmptyDigest(events)) {
    // Quiet day: leave the lock in place — nothing to retry.
    return { sent: 0, skipped: 'no activity' }
  }

  try {
    const recipients = await digestRecipients()
    const appUrl = process.env.APP_URL ?? 'http://localhost:3000'
    const subject = buildSubject(events)
    const html = renderDigestHtml(events, appUrl)

    // Constructed lazily, inside the try, so a missing key fails AFTER the
    // lock is created (and is caught below, which deletes it for retry).
    // `opts.emailClient` lets verification substitute a fake client without
    // a real API key or network call; production always builds a real one.
    let client: EmailClient
    if (opts.emailClient) {
      client = opts.emailClient
    } else {
      const apiKey = process.env.RESEND_API_KEY
      if (!apiKey) {
        throw Object.assign(new Error('digest send failed: RESEND_API_KEY is not set'), { tag: 'digest-send-config' })
      }
      client = new Resend(apiKey)
    }

    const { successes, failures } = await sendDigestBatch(client, recipients, subject, html)

    if (successes.length === 0 && failures.length > 0) {
      // Every recipient failed: treat this the same as a pre-send failure —
      // delete the lock and rethrow so the whole digest can be retried.
      const last = failures[failures.length - 1]
      throw Object.assign(
        new Error(`digest send failed for all ${failures.length} recipient(s); last error: ${String(last.error)}`),
        { tag: 'digest-send-failure' }
      )
    }

    for (const failure of failures) {
      console.error(`digest send failed for ${failure.email}:`, failure.error)
    }

    await prisma.digestLog.update({ where: { date: today }, data: { sentCount: successes.length } })
    return { sent: successes.length, skipped: null }
  } catch (err) {
    // Total failure — either every recipient failed above, or something
    // failed before any send was attempted (e.g. missing RESEND_API_KEY):
    // delete today's lock ONLY IF WE CREATED IT so the next run can retry
    // from scratch. If this was a --force rerun of a pre-existing lock that
    // then failed, leave the lock in place (it was created by a prior
    // invocation that might have succeeded partially). A partial failure
    // never reaches here (see the all-failed branch above).
    if (lockCreatedHere) {
      await prisma.digestLog.deleteMany({ where: { date: today } })
    }
    throw err
  }
}

const isDirectRun = (() => {
  const entry = process.argv[1]
  return !!entry && import.meta.url === pathToFileURL(entry).href
})()

if (isDirectRun) {
  runDailyDigest({ force: process.argv.includes('--force') })
    .then((result) => {
      console.log('digest:', result)
      process.exit(0)
    })
    .catch((err) => {
      console.error('digest failed:', err)
      process.exit(1)
    })
}
