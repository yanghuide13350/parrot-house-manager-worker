import { ApiError, ensure } from './core.js'

function bucket(env) {
  ensure(env.MEDIA_BUCKET, 'CONFIGURATION_ERROR', 'R2 存储桶尚未配置', 500)
  return env.MEDIA_BUCKET
}

export async function r2CreateMultipartUpload(env, key, mime) {
  return (await bucket(env).createMultipartUpload(key, { httpMetadata: { contentType: mime } })).uploadId
}

export async function r2UploadPart(env, key, uploadId, partNumber, body) {
  return (await bucket(env).resumeMultipartUpload(key, uploadId).uploadPart(partNumber, body)).etag
}

export async function r2CompleteMultipartUpload(env, key, uploadId, parts) {
  await bucket(env).resumeMultipartUpload(key, uploadId).complete(parts)
}

export async function r2AbortMultipartUpload(env, key, uploadId) {
  await bucket(env).resumeMultipartUpload(key, uploadId).abort()
}

export async function r2PutObject(env, key, body, mime) {
  await bucket(env).put(key, body, { httpMetadata: { contentType: mime } })
}

export async function r2DeleteObject(env, key) {
  await bucket(env).delete(key)
}

function rangeBounds(range, size) {
  if (range.offset != null) return { offset: range.offset, length: range.length == null ? size - range.offset : range.length }
  const length = Math.min(range.suffix || size, size)
  return { offset: size - length, length }
}

export async function r2GetObject(env, key, range = '') {
  const object = await bucket(env).get(key, range ? { range: new Headers({ range }) } : undefined)
  if (!object) throw new ApiError('NOT_FOUND', '媒体文件不存在', 404)
  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('etag', object.httpEtag)
  headers.set('last-modified', object.uploaded.toUTCString())
  // R2 会在未请求 Range 时也返回覆盖全文件的 object.range，此时必须按 200 完整响应处理
  if (range && object.range) {
    const { offset, length } = rangeBounds(object.range, object.size)
    headers.set('content-length', String(length))
    headers.set('content-range', `bytes ${offset}-${offset + length - 1}/${object.size}`)
    return { body: object.body, headers, status: 206 }
  }
  headers.set('content-length', String(object.size))
  return { body: object.body, headers, status: 200 }
}
