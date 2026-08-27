/**
 * Maps a thrown error to a safe HTTP status + client-facing message.
 *
 * Only errors carrying the `Object.assign(new Error(...), { status })` tag
 * (the convention used throughout lib/audit.ts) are considered deliberately
 * authored and safe to echo verbatim to the client. Anything untagged — e.g.
 * a Prisma constraint race between a pre-check and its transaction — is
 * logged server-side and replaced with a generic message so internal error
 * text never leaks to the client.
 */
export function safeErrorResponse(err: unknown): { status: number; message: string } {
  const status = (err as { status?: unknown })?.status
  if (typeof status === 'number' && err instanceof Error) {
    return { status, message: err.message }
  }
  console.error(err)
  return { status: 500, message: 'something went wrong' }
}
