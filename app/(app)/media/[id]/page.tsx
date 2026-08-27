import { notFound } from 'next/navigation'
import Link from 'next/link'
import { auth } from '@clerk/nextjs/server'
import { prisma } from '@/lib/db'
import { mediaItemToDTO } from '@/lib/media'
import { RetryButton } from '@/components/retry-button'
import { DetailTabs } from '@/components/detail-tabs'
import { MediaEditForm } from '@/components/media-edit-form'
import { PeopleTagger } from '@/components/people-tagger'
import { ExifTable } from '@/components/exif-table'
import { HistoryList } from '@/components/history-list'
import { AdminItemActions } from '@/components/admin-item-actions'
import { HeartButton } from '@/components/heart-button'
import { CommentThread } from '@/components/comment-thread'

export default async function MediaDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { userId } = await auth()
  const viewer = userId ? await prisma.user.findUnique({ where: { clerkId: userId } }) : null
  const item = await prisma.mediaItem.findFirst({
    where: { id, deletedAt: null },
    include: {
      uploadedBy: true,
      _count: { select: { hearts: true } },
      hearts: viewer ? { where: { userId: viewer.id } } : false,
      people: { include: { person: true } },
    },
  })
  if (!item) notFound()
  const dto = await mediaItemToDTO(item, { detail: true, viewerUserId: viewer?.id })
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
          {dto.inlineUrl ? (
            <iframe src={dto.inlineUrl} title={dto.title ?? dto.originalFilename} className="h-[80vh] w-full rounded-xl border" />
          ) : null}
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
        <HeartButton mediaId={dto.id} initialCount={dto.heartCount} initialHearted={dto.heartedByMe} />
        {dto.status === 'FAILED' && <RetryButton id={dto.id} />}
        {viewer?.role === 'ADMIN' && <AdminItemActions id={dto.id} deleted={false} />}
      </div>

      <DetailTabs
        details={
          <>
            <dl className="grid grid-cols-2 gap-2 text-lg">
              <dt className="font-semibold">Uploaded by</dt><dd>{dto.uploadedBy?.name ?? 'Unknown'}</dd>
              <dt className="font-semibold">Uploaded</dt><dd>{new Date(dto.createdAt).toLocaleDateString()}</dd>
              <dt className="font-semibold">File</dt><dd>{dto.originalFilename} ({dto.mimeType})</dd>
            </dl>
            <div className="mt-8">
              <PeopleTagger mediaId={dto.id} people={dto.people ?? []} />
            </div>
            <div className="mt-8">
              <MediaEditForm item={dto} />
            </div>
          </>
        }
        advanced={<ExifTable exif={dto.exif} type={dto.type} />}
        history={<HistoryList mediaId={dto.id} />}
      />

      <div className="mt-8">
        <h2 className="mb-4 text-2xl font-bold">Comments</h2>
        <CommentThread mediaId={dto.id} />
      </div>
    </div>
  )
}
