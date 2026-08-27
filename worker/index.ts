// Must be the first import: loads env vars before any other module (e.g. `@/lib/s3`)
// reads `process.env.*` into a top-level const at import time. See worker/env.ts.
import './env'

import { PgBoss } from 'pg-boss'
import type { JobWithMetadata } from 'pg-boss'
import { QUEUE_PROCESS_MEDIA } from '@/lib/queue'
import { processMedia } from './process-media'
import { prisma } from '@/lib/db'

async function main() {
  const boss = new PgBoss(process.env.DATABASE_URL!)
  boss.on('error', (err) => console.error('pg-boss error:', err))
  await boss.start()
  await boss.createQueue(QUEUE_PROCESS_MEDIA)

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
