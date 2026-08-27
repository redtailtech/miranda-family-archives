import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireUser } from '@/lib/require-user'
import { safeErrorResponse } from '@/lib/http-errors'

const MAX_FILENAMES = 100

/**
 * Filename-only, pre-upload duplicate check (warn, never block). Case-
 * insensitive match against non-deleted items' originalFilename. This is a
 * UX affordance only — the authoritative content-based check runs in the
 * worker (contentHash / perceptualHash) once the file actually uploads.
 */
export async function POST(req: NextRequest) {
  const { error } = await requireUser()
  if (error) return error

  let filenames: unknown
  try {
    ;({ filenames } = await req.json())
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }
  if (
    !Array.isArray(filenames) ||
    filenames.length === 0 ||
    filenames.length > MAX_FILENAMES ||
    !filenames.every((f) => typeof f === 'string' && f.length > 0)
  ) {
    return NextResponse.json({ error: `filenames must be a non-empty array of up to ${MAX_FILENAMES} strings` }, { status: 400 })
  }

  try {
    const matches = await prisma.mediaItem.findMany({
      where: {
        deletedAt: null,
        OR: filenames.map((f) => ({ originalFilename: { equals: f, mode: 'insensitive' as const } })),
      },
      select: { originalFilename: true },
    })
    const existingLower = new Set(matches.map((m) => m.originalFilename.toLowerCase()))
    const duplicates = filenames.filter((f) => existingLower.has(f.toLowerCase()))
    return NextResponse.json({ duplicates })
  } catch (err) {
    const { status, message } = safeErrorResponse(err)
    return NextResponse.json({ error: message }, { status })
  }
}
