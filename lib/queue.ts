import { PgBoss } from 'pg-boss'

export const QUEUE_PROCESS_MEDIA = 'process-media'
export const QUEUE_DAILY_DIGEST = 'daily-digest'

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
