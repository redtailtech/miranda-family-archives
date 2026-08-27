import { createWriteStream } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import sharp from 'sharp'
import type { Prisma } from '@prisma/client'
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
        exif: (exif ?? undefined) as Prisma.InputJsonValue | undefined,
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
