import { notFound } from 'next/navigation'
import Link from 'next/link'
import { prisma } from '@/lib/db'
import { mediaItemToDTO } from '@/lib/media'

export default async function MediaDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const item = await prisma.mediaItem.findFirst({
    where: { id, deletedAt: null },
    include: { uploadedBy: true },
  })
  if (!item) notFound()
  const dto = await mediaItemToDTO(item, { detail: true })
  const sizeMB = (dto.originalSize / (1024 * 1024)).toFixed(1)

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/" className="text-lg underline">← Library</Link>
      <h1 className="my-4 text-3xl font-bold">{dto.title ?? dto.originalFilename}</h1>

      {dto.status === 'READY' && dto.type === 'PHOTO' && dto.webUrl && (
        <a href={dto.largeUrl ?? dto.webUrl} target="_blank" rel="noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={dto.webUrl} alt={dto.title ?? dto.originalFilename} className="w-full rounded-xl" />
        </a>
      )}
      {dto.status === 'READY' && dto.type === 'DOCUMENT' && (
        <div>
          {dto.webUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={dto.webUrl} alt="Page 1" className="w-full rounded-xl border" />
          )}
          <p className="mt-2 text-sm">Preview of page 1 — download the original to read the full document.</p>
        </div>
      )}
      {dto.status !== 'READY' && (
        <p className="rounded-xl bg-black/5 p-8 text-center text-xl">
          {dto.status === 'FAILED' ? `Processing failed: ${dto.error}` : 'Still processing — check back in a minute.'}
        </p>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <a
          href={`/api/media/${dto.id}/download`}
          className="rounded-xl bg-black px-6 py-3 text-lg text-white"
        >
          Download original ({sizeMB} MB)
        </a>
        {dto.status === 'FAILED' && <RetryButton id={dto.id} />}
      </div>

      <dl className="mt-8 grid grid-cols-2 gap-2 text-lg">
        <dt className="font-semibold">Uploaded by</dt><dd>{dto.uploadedBy?.name ?? 'Unknown'}</dd>
        <dt className="font-semibold">Uploaded</dt><dd>{new Date(dto.createdAt).toLocaleDateString()}</dd>
        <dt className="font-semibold">File</dt><dd>{dto.originalFilename} ({dto.mimeType})</dd>
      </dl>
    </div>
  )
}

function RetryButton({ id }: { id: string }) {
  async function retry() {
    'use server'
    const { prisma } = await import('@/lib/db')
    const { enqueueProcessMedia } = await import('@/lib/queue')
    const item = await prisma.mediaItem.findUnique({ where: { id } })
    if (item?.status === 'FAILED') {
      await prisma.mediaItem.update({ where: { id }, data: { status: 'PROCESSING', error: null } })
      await enqueueProcessMedia(id)
    }
  }
  return (
    <form action={retry}>
      <button className="rounded-xl border px-6 py-3 text-lg">Retry processing</button>
    </form>
  )
}
