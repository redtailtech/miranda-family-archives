import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/require-user'
import { safeErrorResponse } from '@/lib/http-errors'
import { setPersonAvatarFromUpload, setPersonAvatarFromMedia, clearPersonAvatar } from '@/lib/avatar'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireUser()
  if (error) return error
  const { id } = await params

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'expected multipart form data' }, { status: 400 })
  }
  const file = form.get('file')
  if (!(file instanceof Blob)) return NextResponse.json({ error: 'file is required' }, { status: 400 })

  const buffer = Buffer.from(await file.arrayBuffer())
  const mimeType = 'type' in file && typeof file.type === 'string' ? file.type : ''

  try {
    await setPersonAvatarFromUpload(id, user!.id, buffer, mimeType)
  } catch (err) {
    const { status, message } = safeErrorResponse(err)
    return NextResponse.json({ error: message }, { status })
  }
  return NextResponse.json({ ok: true })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireUser()
  if (error) return error
  const { id } = await params

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }
  const mediaId = body.mediaId
  if (typeof mediaId !== 'string' || !mediaId)
    return NextResponse.json({ error: 'mediaId is required' }, { status: 400 })

  try {
    await setPersonAvatarFromMedia(id, mediaId, user!.id)
  } catch (err) {
    const { status, message } = safeErrorResponse(err)
    return NextResponse.json({ error: message }, { status })
  }
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireUser()
  if (error) return error
  const { id } = await params

  try {
    await clearPersonAvatar(id, user!.id)
  } catch (err) {
    const { status, message } = safeErrorResponse(err)
    return NextResponse.json({ error: message }, { status })
  }
  return NextResponse.json({ ok: true })
}
