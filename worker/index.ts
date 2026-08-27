// Must be the first import: loads env vars before any other module (e.g. `@/lib/s3`)
// reads `process.env.*` into a top-level const at import time. See worker/env.ts.
import './env'

import { PgBoss } from 'pg-boss'
import type { JobWithMetadata } from 'pg-boss'
import { QUEUE_PROCESS_MEDIA, QUEUE_DAILY_DIGEST, enqueueProcessMedia } from '@/lib/queue'
import { processMedia } from './process-media'
import { runDailyDigest } from './send-digest'
import { prisma } from '@/lib/db'

const STALE_SWEEP_INTERVAL_MS = 10 * 60 * 1000
const STALE_THRESHOLD_MS = 30 * 60 * 1000

async function sweepStaleProcessing() {
  try {
    const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS)
    const stale = await prisma.mediaItem.findMany({
      where: { status: 'PROCESSING', updatedAt: { lt: cutoff } },
      select: { id: true },
    })
    let reenqueued = 0
    for (const { id } of stale) {
      // Guard against racing a live job: only touch/re-enqueue if it's still stale
      // at the moment we act on it.
      const touched = await prisma.mediaItem.updateMany({
        where: { id, status: 'PROCESSING', updatedAt: { lt: cutoff } },
        data: { updatedAt: new Date() },
      })
      if (touched.count === 1) {
        await enqueueProcessMedia(id)
        reenqueued++
        console.log(`stale sweep: re-enqueued ${id}`)
      }
    }
    console.log(`stale sweep: checked ${stale.length} candidate(s), ${reenqueued} re-enqueued`)
  } catch (err) {
    console.error('stale sweep failed:', err)
  }
}

async function main() {
  const boss = new PgBoss(process.env.DATABASE_URL!)
  boss.on('error', (err) => console.error('pg-boss error:', err))
  await boss.start()
  await boss.createQueue(QUEUE_PROCESS_MEDIA)
  await boss.createQueue(QUEUE_DAILY_DIGEST)
  await boss.schedule(QUEUE_DAILY_DIGEST, '0 11 * * *', {}, { tz: 'America/New_York' })

  await boss.work(
    QUEUE_PROCESS_MEDIA,
    { batchSize: 1, includeMetadata: true },
    async ([job]: JobWithMetadata<{ mediaId: string }>[]) => {
      const { mediaId } = job.data
      console.log(`processing ${mediaId} (attempt ${job.retryCount + 1})`)
      try {
        await processMedia(mediaId)
        console.log(`done ${mediaId}`)
      } catch (err) {
        console.error(`failed ${mediaId}:`, err)
        if (job.retryCount >= job.retryLimit) {
          try {
            await prisma.mediaItem.update({
              where: { id: mediaId },
              data: { status: 'FAILED', error: String(err).slice(0, 1000) },
            })
          } catch (updateErr) {
            console.error(`failed to mark ${mediaId} as FAILED:`, updateErr)
          }
        }
        throw err // let pg-boss retry
      }
    }
  )
  await boss.work(QUEUE_DAILY_DIGEST, { batchSize: 1 }, async () => {
    try {
      const r = await runDailyDigest()
      console.log('digest:', r)
    } catch (err) {
      console.error('digest failed:', err)
      throw err // let pg-boss record the failure
    }
  })
  console.log('worker listening on', QUEUE_PROCESS_MEDIA, QUEUE_DAILY_DIGEST)

  await sweepStaleProcessing()
  setInterval(sweepStaleProcessing, STALE_SWEEP_INTERVAL_MS)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
