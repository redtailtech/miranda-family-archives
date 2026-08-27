import { createReadStream, createWriteStream } from 'node:fs'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import sharp from 'sharp'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { s3, BUCKET } from '@/lib/s3'
import { derivedKey } from '@/lib/media'
import { dHash, hammingHex } from '@/lib/dupes'

const NEAR_MATCH_MAX_HAMMING = 6

const execFileAsync = promisify(execFile)

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

    const contentHash = await hashFile(originalPath)
    const perceptualHash = item.type === 'PHOTO' ? await computePerceptualHash(sourceImagePath) : null
    const duplicateOfId = await findDuplicate(mediaId, contentHash, perceptualHash)

    await prisma.mediaItem.update({
      where: { id: mediaId },
      data: {
        thumbKey: keys.thumb,
        webKey: keys.web,
        largeKey: keys.large,
        exif: (exif ?? undefined) as Prisma.InputJsonValue | undefined,
        status: 'READY',
        error: null,
        contentHash,
        perceptualHash,
        duplicateOfId,
      },
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** SHA-256 of the original file, streamed so a 500MB TIFF never sits in memory. */
async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex')
}

async function computePerceptualHash(sourceImagePath: string): Promise<string> {
  const raw = await sharp(sourceImagePath, { limitInputPixels: false })
    .grayscale()
    .resize(9, 8, { fit: 'fill' })
    .raw()
    .toBuffer()
  return dHash(raw)
}

/**
 * Exact contentHash match (any type) takes precedence over a near (dHash)
 * match, which only applies to PHOTOs. Excludes self and soft-deleted items.
 * Family-scale dataset — loading all photos' {id, perceptualHash} is fine.
 */
async function findDuplicate(
  selfId: string,
  contentHash: string,
  perceptualHash: string | null
): Promise<string | null> {
  const exact = await prisma.mediaItem.findFirst({
    where: { id: { not: selfId }, deletedAt: null, contentHash },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  })
  if (exact) return exact.id

  if (!perceptualHash) return null

  const candidates = await prisma.mediaItem.findMany({
    where: {
      id: { not: selfId },
      deletedAt: null,
      type: 'PHOTO',
      perceptualHash: { not: null },
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true, perceptualHash: true },
  })
  for (const candidate of candidates) {
    if (candidate.perceptualHash && hammingHex(perceptualHash, candidate.perceptualHash) <= NEAR_MATCH_MAX_HAMMING) {
      return candidate.id
    }
  }
  return null
}

async function renderPdfPage1(originalPath: string, dir: string): Promise<string> {
  const outPrefix = join(dir, 'page1')
  // -r 200: high enough for a 3200px large derivative of a letter-size page
  await execFileAsync('pdftoppm', ['-jpeg', '-f', '1', '-l', '1', '-r', '200', originalPath, outPrefix])
  // pdftoppm names output <prefix>-<page>.jpg, but the page-number padding varies by
  // version (e.g. page1-1.jpg vs page1-01.jpg) — glob for it instead of assuming.
  const entries = await readdir(dir)
  const match = entries.find((f) => /^page1-0*1\.jpg$/.test(f))
  if (!match) {
    throw new Error(`pdftoppm did not produce a page1-*.jpg output in ${dir} (found: ${entries.join(', ')})`)
  }
  return join(dir, match)
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
