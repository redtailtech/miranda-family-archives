import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { signPartUrl } from '@/lib/s3'

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { key, uploadId, partNumber } = await req.json()
  if (!key?.startsWith('originals/') || !uploadId || !Number.isInteger(partNumber))
    return NextResponse.json({ error: 'bad request' }, { status: 400 })
  return NextResponse.json({ url: await signPartUrl(key, uploadId, partNumber) })
}
