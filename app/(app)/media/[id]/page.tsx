import { notFound } from 'next/navigation'
import Link from 'next/link'
import { auth } from '@clerk/nextjs/server'
import { prisma } from '@/lib/db'
import { mediaItemToDTO } from '@/lib/media'
import { BackLink } from '@/components/back-link'
import { RetryButton } from '@/components/retry-button'
import { DetailTabs } from '@/components/detail-tabs'
import { MediaEditForm } from '@/components/media-edit-form'
import { PeopleTagger } from '@/components/people-tagger'
import { ExifTable } from '@/components/exif-table'
import { HistoryList } from '@/components/history-list'
import { AdminItemActions } from '@/components/admin-item-actions'
import { HeartButton } from '@/components/heart-button'
import { CommentThread } from '@/components/comment-thread'
import { BackSection } from '@/components/back-section'

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

  // Backs carry no details of their own — the details section (and its
  // form/tagger) operate on the FRONT item, so edits land on the front's
  // record. See .superpowers/sdd/2026-09-03-back-shows-front-details/.
  const backOfId = dto.backOfId
  const isBack = Boolean(backOfId)
  const front = backOfId
    ? await prisma.mediaItem.findFirst({
        where: { id: backOfId, deletedAt: null },
        include: {
          uploadedBy: true,
          _count: { select: { hearts: true } },
          hearts: viewer ? { where: { userId: viewer.id } } : false,
          people: { include: { person: true } },
        },
      })
    : null
  const frontDto = front ? await mediaItemToDTO(front, { detail: true, viewerUserId: viewer?.id }) : null

  return (
    <div className="mx-auto max-w-4xl">
      <BackLink fallback="/" label="← Back" />
      <h1 className="my-4 text-3xl font-bold">
        {isBack
          ? `Back of ${frontDto?.title ?? frontDto?.originalFilename ?? dto.title ?? dto.originalFilename}`
          : (dto.title ?? dto.originalFilename)}
      </h1>

      {dto.backOf && (
        <div className="mb-4 flex items-center gap-4 rounded-xl border border-amber/40 bg-wash p-4">
          <p className="flex-1 text-lg">
            This is the back of{' '}
            <Link href={`/media/${dto.backOf.id}`} className="font-medium underline">
              {dto.backOf.title ?? dto.backOf.filename}
            </Link>
            .
          </p>
        </div>
      )}

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

      {dto.duplicateOf && (
        <div className="mt-6 flex flex-wrap items-center gap-4 rounded-xl border border-amber/40 bg-wash p-4">
          {dto.duplicateOf.thumbUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={dto.duplicateOf.thumbUrl}
              alt=""
              className="h-16 w-16 shrink-0 rounded-lg object-cover"
            />
          )}
          <p className="flex-1 text-lg">
            This might be a duplicate of{' '}
            <Link href={`/media/${dto.duplicateOf.id}`} className="font-medium underline">
              {dto.duplicateOf.title ?? dto.duplicateOf.filename}
            </Link>
            . It&apos;s okay to keep both — an admin can delete one from its page.
          </p>
        </div>
      )}

      {dto.status === 'READY' && dto.type === 'PHOTO' && !dto.backOfId && <BackSection item={dto} />}

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <a
          href={`/api/media/${dto.id}/download`}
          className="rounded-xl bg-black px-6 py-3 text-lg text-white"
        >
          {isBack ? `Download this back (${sizeMB} MB)` : `Download original (${sizeMB} MB)`}
        </a>
        {!isBack && <HeartButton mediaId={dto.id} initialCount={dto.heartCount} initialHearted={dto.heartedByMe} />}
        {dto.status === 'FAILED' && <RetryButton id={dto.id} />}
        {viewer?.role === 'ADMIN' && <AdminItemActions id={dto.id} deleted={false} />}
      </div>

      {!isBack && (
        <>
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
        </>
      )}

      {isBack && (
        <div className="mt-8">
          <h2 className="mb-4 text-2xl font-bold">Photo details</h2>
          {frontDto ? (
            <>
              <p className="mt-2 text-lg text-ink-soft">
                These details belong to the photo — the back is just its other side.
              </p>
              <div className="mt-8">
                <PeopleTagger mediaId={frontDto.id} people={frontDto.people ?? []} />
              </div>
              <div className="mt-8">
                <MediaEditForm item={frontDto} />
              </div>
            </>
          ) : (
            <p className="mt-2 text-lg text-ink-soft">
              This is the back of a photo that&apos;s in Deleted items.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
