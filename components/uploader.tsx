'use client'

import { useEffect, useState } from 'react'
import Uppy from '@uppy/core'
import Dashboard from '@uppy/react/dashboard'
import Link from 'next/link'
import '@uppy/core/css/style.min.css'
import '@uppy/dashboard/css/style.min.css'

const CHUNK_SIZE = 25 * 1024 * 1024
const MAX_CONCURRENT_FILES = 3
const MAX_RETRIES = 3
const RETRY_DELAYS = [1000, 3000] // ms delays between retries

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

async function api(path: string, body: unknown) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const message = (await res.json()).error ?? `HTTP ${res.status}`
    throw new ApiError(res.status, message)
  }
  return res.json()
}

async function uploadChunk(signedUrl: string, chunk: Blob, onProgress: (bytesUploaded: number, bytesTotal: number) => void) {
  return new Promise<{ etag: string }>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        onProgress(e.loaded, e.total)
      }
    })
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const etag = xhr.getResponseHeader('etag') ?? xhr.getResponseHeader('ETag') ?? ''
        resolve({ etag: etag.replace(/^"(.*)"$/, '$1') })
      } else {
        reject(new Error(`Upload failed with status ${xhr.status}`))
      }
    })
    xhr.addEventListener('error', () => reject(new Error('Upload failed')))
    xhr.open('PUT', signedUrl)
    xhr.send(chunk)
  })
}

async function uploadChunkWithRetry(
  key: string,
  uploadId: string,
  partNumber: number,
  chunk: Blob,
  fileData: Blob,
  start: number,
  uppy: Uppy<Record<string, unknown>, Record<string, unknown>>,
  file: ReturnType<typeof uppy.getFile>,
) {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      // Re-fetch presigned URL on each attempt (URLs can expire)
      const { url } = await api('/api/uploads/sign-part', { key, uploadId, partNumber })
      const { etag } = await uploadChunk(url, chunk, (loaded) => {
        uppy.emit('upload-progress', file, {
          bytesUploaded: start + loaded,
          bytesTotal: fileData.size,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any)
      })
      return { etag }
    } catch (err) {
      // Don't retry 4xx errors from sign-part (client errors are not retryable)
      if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
        throw err
      }
      const isLastAttempt = attempt === MAX_RETRIES - 1
      if (isLastAttempt) throw err
      // Wait before retrying (network errors or 5xx)
      const delay = RETRY_DELAYS[attempt] ?? 5000
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
  throw new Error('Max retries exceeded')
}

async function abortUpload(
  mediaId: string | undefined,
  key: string | undefined,
  uploadId: string | undefined,
  settledMediaIds: Set<string>,
) {
  if (!mediaId || !key || !uploadId) return
  // Guard against double-abort (already aborted or completed)
  if (settledMediaIds.has(mediaId)) return
  settledMediaIds.add(mediaId)
  try {
    await api('/api/uploads/abort', { mediaId, key, uploadId })
  } catch (err) {
    // Log abort failure but don't throw - upload is already failed
    console.error('Failed to abort upload:', err)
  }
}

async function processFilesWithConcurrency(
  fileIds: string[],
  uppy: Uppy<Record<string, unknown>, Record<string, unknown>>,
  settledMediaIds: Set<string>,
) {
  const results: Array<{ fileId: string; successful: boolean }> = []

  const processFile = async (fileId: string) => {
    const file = uppy.getFile(fileId)
    if (!file) return

    let mediaId: string | undefined
    let key: string | undefined
    let uploadId: string | undefined

    try {
      const response = await api('/api/uploads', {
        filename: file.name,
        size: file.size,
        type: file.type,
      })
      mediaId = response.mediaId
      key = response.key
      uploadId = response.uploadId

      const meta = file.meta as Record<string, unknown>
      meta.mediaId = mediaId
      meta.key = key
      meta.uploadId = uploadId

      uppy.emit('upload-start', [file])

      const parts: Array<{ PartNumber: number; ETag: string }> = []
      const fileData = file.data as Blob
      let uploadedBytes = 0

      for (let partNumber = 1; uploadedBytes < fileData.size; partNumber++) {
        const start = uploadedBytes
        const end = Math.min(uploadedBytes + CHUNK_SIZE, fileData.size)
        const chunk = fileData.slice(start, end)

        const { etag } = await uploadChunkWithRetry(
          key!,
          uploadId!,
          partNumber,
          chunk,
          fileData,
          start,
          uppy,
          file,
        )

        parts.push({ PartNumber: partNumber, ETag: etag })
        uploadedBytes = end
      }

      await api('/api/uploads/complete', { mediaId, key, uploadId, parts })
      // Mark as settled so abort handlers won't try to abort a completed upload
      if (mediaId) settledMediaIds.add(mediaId)
      uppy.emit('upload-success', file, { status: 200 })
      results.push({ fileId, successful: true })
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      uppy.emit('upload-error', file, { name: 'UploadError', message: error.message })
      results.push({ fileId, successful: false })
      // Abort upload on backend
      await abortUpload(mediaId, key, uploadId, settledMediaIds)
    }
  }

  const workers = Math.min(MAX_CONCURRENT_FILES, fileIds.length)
  const queue = [...fileIds]

  const worker = async () => {
    while (queue.length > 0) {
      const fileId = queue.shift()
      if (fileId) await processFile(fileId)
    }
  }

  await Promise.all(Array.from({ length: workers }, () => worker()))
  return results
}

function createUppy() {
  const uppy = new Uppy<Record<string, unknown>, Record<string, unknown>>({
    restrictions: {
      maxFileSize: 2 * 1024 * 1024 * 1024,
      allowedFileTypes: ['image/tiff', 'image/jpeg', 'image/png', 'image/heic', 'image/webp', 'application/pdf', '.tif', '.tiff'],
    },
  })

  // Track both aborted and completed mediaIds to prevent duplicate aborts
  const settledMediaIds = new Set<string>()

  uppy.addUploader(async (fileIds) => {
    return processFilesWithConcurrency(fileIds, uppy, settledMediaIds)
  })

  // Handle file removal (user cancelled)
  uppy.on('file-removed', (file) => {
    const mediaId = (file.meta as Record<string, unknown>)?.mediaId as string | undefined
    const key = (file.meta as Record<string, unknown>)?.key as string | undefined
    const uploadId = (file.meta as Record<string, unknown>)?.uploadId as string | undefined
    abortUpload(mediaId, key, uploadId, settledMediaIds)
  })

  // Store for use in cancel-all handler (attached in useEffect)
  ;(uppy as unknown as Record<string, unknown>).__settledMediaIds = settledMediaIds

  return uppy
}

type UploadedFile = { mediaId: string; name: string }

function UploadDetailRow({ mediaId, name }: UploadedFile) {
  const [title, setTitle] = useState('')
  const [year, setYear] = useState('')
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [error, setError] = useState('')

  async function save() {
    setState('saving')
    if (year && year.length !== 4) {
      setState('error')
      setError('Please enter a 4-digit year')
      return
    }
    const body: Record<string, string | number> = {}
    if (title.trim()) body.title = title.trim()
    if (year.trim()) body.dateYear = Number(year.trim())
    if (Object.keys(body).length === 0) { setState('saved'); return }
    try {
      const res = await fetch(`/api/media/${mediaId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        setState('saved')
      } else {
        setState('error')
        let msg = `HTTP ${res.status}`
        try { msg = (await res.json()).error ?? msg } catch {}
        setError(msg)
      }
    } catch {
      setState('error')
      setError("Couldn't save — check your connection and try again.")
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-3 rounded-xl border bg-surface p-3">
      <span className="min-w-0 flex-1 truncate text-lg" title={name}>{name}</span>
      <input
        className="min-h-11 w-48 rounded-lg border border-ink/25 px-3 py-2 text-lg"
        placeholder="Title"
        value={title}
        disabled={state === 'saving' || state === 'saved'}
        onChange={(e) => setTitle(e.target.value)}
      />
      <input
        className="min-h-11 w-24 rounded-lg border border-ink/25 px-3 py-2 text-lg"
        placeholder="Year"
        inputMode="numeric"
        maxLength={4}
        value={year}
        disabled={state === 'saving' || state === 'saved'}
        onChange={(e) => setYear(e.target.value.replace(/\D/g, ''))}
      />
      {state === 'saved' ? (
        <span className="text-lg text-green-700">Saved ✓</span>
      ) : (
        <button
          type="button"
          onClick={save}
          disabled={state === 'saving'}
          className="min-h-11 rounded-lg bg-ink px-4 py-2 text-lg text-paper hover:bg-sepia disabled:opacity-50"
        >
          {state === 'saving' ? 'Saving…' : 'Save'}
        </button>
      )}
      {state === 'error' && <span className="text-lg text-red-700">{error}</span>}
    </li>
  )
}

export function Uploader() {
  const [uppy] = useState(createUppy)
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([])

  useEffect(() => {
    const handleUploadSuccess = (file: ReturnType<typeof uppy.getFile> | undefined) => {
      const mediaId = (file?.meta as Record<string, unknown> | undefined)?.mediaId as string | undefined
      if (!mediaId || !file) return
      setUploadedFiles((prev) => (prev.some((f) => f.mediaId === mediaId) ? prev : [...prev, { mediaId, name: file.name ?? mediaId }]))
    }
    uppy.on('upload-success', handleUploadSuccess)

    // Handle cancel-all event to abort pending uploads
    const handleCancelAll = () => {
      const settledMediaIds = (uppy as unknown as Record<string, unknown>).__settledMediaIds as Set<string>
      uppy.getFiles().forEach((file) => {
        const mediaId = (file.meta as Record<string, unknown>)?.mediaId as string | undefined
        const key = (file.meta as Record<string, unknown>)?.key as string | undefined
        const uploadId = (file.meta as Record<string, unknown>)?.uploadId as string | undefined
        abortUpload(mediaId, key, uploadId, settledMediaIds)
      })
    }
    uppy.on('cancel-all', handleCancelAll)

    return () => {
      uppy.off('upload-success', handleUploadSuccess)
      uppy.off('cancel-all', handleCancelAll)
    }
  }, [uppy])

  return (
    <div>
      <Dashboard uppy={uppy} proudlyDisplayPoweredByUppy={false} height={420} note="Photos (TIFF, JPEG, PNG, HEIC, WebP) and PDF documents, up to 2 GB each" />
      {uploadedFiles.length > 0 && (
        <div className="mt-4">
          <p className="text-lg">
            {uploadedFiles.length} file{uploadedFiles.length > 1 ? 's' : ''} uploaded — processing now. Add a title and year now, or fill in the rest later.{' '}
            <Link className="underline" href="/">View in library</Link>
          </p>
          <ul className="mt-4 grid gap-2">
            {uploadedFiles.map((f) => (
              <UploadDetailRow key={f.mediaId} mediaId={f.mediaId} name={f.name} />
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
