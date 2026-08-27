import {
  S3Client,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

export const BUCKET = process.env.AWS_S3_BUCKET_NAME!

export const s3 = new S3Client({
  endpoint: process.env.AWS_ENDPOINT_URL,
  region: process.env.AWS_DEFAULT_REGION ?? 'auto',
  forcePathStyle: false, // Railway buckets use virtual-host style URLs
})

export async function createMultipart(key: string, contentType: string) {
  const res = await s3.send(
    new CreateMultipartUploadCommand({ Bucket: BUCKET, Key: key, ContentType: contentType })
  )
  return { uploadId: res.UploadId! }
}

export function signPartUrl(key: string, uploadId: string, partNumber: number) {
  return getSignedUrl(
    s3,
    new UploadPartCommand({ Bucket: BUCKET, Key: key, UploadId: uploadId, PartNumber: partNumber }),
    { expiresIn: 3600 }
  )
}

export async function completeMultipart(
  key: string,
  uploadId: string,
  parts: { ETag: string; PartNumber: number }[]
) {
  await s3.send(
    new CompleteMultipartUploadCommand({
      Bucket: BUCKET,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: { Parts: parts },
    })
  )
}

export async function abortMultipart(key: string, uploadId: string) {
  await s3.send(new AbortMultipartUploadCommand({ Bucket: BUCKET, Key: key, UploadId: uploadId }))
}

export function signGetUrl(
  key: string,
  opts: { downloadName?: string; expiresIn?: number } = {}
) {
  const sanitizedName = opts.downloadName
    ? opts.downloadName.replace(/[^\x20-\x7E]/g, '').replace(/"/g, '') || 'download'
    : undefined
  return getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ...(sanitizedName
        ? { ResponseContentDisposition: `attachment; filename="${sanitizedName}"` }
        : {}),
    }),
    { expiresIn: opts.expiresIn ?? 3600 }
  )
}
