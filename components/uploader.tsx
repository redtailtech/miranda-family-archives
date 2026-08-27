'use client'

import { useState } from 'react'
import Uppy from '@uppy/core'
import Dashboard from '@uppy/react/dashboard'
import Link from 'next/link'
import '@uppy/core/css/style.min.css'
import '@uppy/dashboard/css/style.min.css'

const CHUNK_SIZE = 25 * 1024 * 1024

async function api(path: string, body: unknown) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`)
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

function createUppy() {
  const uppy = new Uppy<Record<string, unknown>, Record<string, unknown>>({
    restrictions: {
      maxFileSize: 2 * 1024 * 1024 * 1024,
      allowedFileTypes: ['image/tiff', 'image/jpeg', 'image/png', 'image/heic', 'image/webp', 'application/pdf', '.tif', '.tiff'],
    },
  })

  uppy.addUploader(async (fileIds) => {
    const results = []
    for (const fileId of fileIds) {
      const file = uppy.getFile(fileId)
      if (!file) continue

      try {
        const { mediaId, key, uploadId } = await api('/api/uploads', {
          filename: file.name,
          size: file.size,
          type: file.type,
        })
        ;(file.meta as Record<string, unknown>).mediaId = mediaId

        const parts: Array<{ PartNumber: number; ETag: string }> = []
        const fileData = file.data as Blob
        let uploadedBytes = 0

        for (let partNumber = 1; uploadedBytes < fileData.size; partNumber++) {
          const start = uploadedBytes
          const end = Math.min(uploadedBytes + CHUNK_SIZE, fileData.size)
          const chunk = fileData.slice(start, end)

          const { url } = await api('/api/uploads/sign-part', { key, uploadId, partNumber })
          const { etag } = await uploadChunk(url, chunk, (loaded) => {
            uppy.emit('upload-progress', file, { uploadStarted: Date.now(), bytesUploaded: start + loaded, bytesTotal: fileData.size })
          })

          parts.push({ PartNumber: partNumber, ETag: etag })
          uploadedBytes = end
        }

        await api('/api/uploads/complete', { mediaId, key, uploadId, parts })
        results.push({ fileId, successful: true })
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        results.push({ fileId, successful: false, error })
      }
    }
    return results
  })

  return uppy
}

export function Uploader() {
  const [uppy] = useState(createUppy)
  const [doneCount, setDoneCount] = useState(0)
  uppy.off('complete', handleComplete).on('complete', handleComplete)
  function handleComplete(result: { successful?: unknown[] }) {
    setDoneCount(result.successful?.length ?? 0)
  }
  return (
    <div>
      <Dashboard uppy={uppy} proudlyDisplayPoweredByUppy={false} height={420} note="Photos (TIFF, JPEG, PNG, HEIC, WebP) and PDF documents, up to 2 GB each" />
      {doneCount > 0 && (
        <p className="mt-4 text-lg">
          {doneCount} file{doneCount > 1 ? 's' : ''} uploaded — processing now.{' '}
          <Link className="underline" href="/">View in library</Link>
        </p>
      )}
    </div>
  )
}
