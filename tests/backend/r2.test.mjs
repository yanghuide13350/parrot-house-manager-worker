import assert from 'node:assert/strict'
import test from 'node:test'
import { r2GetObject } from '../../src/r2.js'

function object(range) {
  return {
    body: new ReadableStream(),
    httpEtag: 'abc123',
    uploaded: new Date('2026-07-20T00:00:00Z'),
    size: 100,
    range,
    writeHttpMetadata(headers) { headers.set('content-type', 'video/mp4') }
  }
}

test('R2 media read preserves metadata and byte ranges', async () => {
  const env = { MEDIA_BUCKET: { get: async (_key, options) => object(options ? { offset: 10, length: 20 } : null) } }
  const result = await r2GetObject(env, 'private/owner/video.mp4', 'bytes=10-29')
  assert.equal(result.status, 206)
  assert.equal(result.headers.get('content-type'), 'video/mp4')
  assert.equal(result.headers.get('content-range'), 'bytes 10-29/100')
  assert.equal(result.headers.get('content-length'), '20')
})

test('R2 full reads stay 200 even when R2 reports a full-file range', async () => {
  const env = { MEDIA_BUCKET: { get: async () => object({ offset: 0, length: 100 }) } }
  const result = await r2GetObject(env, 'private/owner/video.mp4')
  assert.equal(result.status, 200)
  assert.equal(result.headers.get('content-length'), '100')
  assert.equal(result.headers.get('content-range'), null)
})

test('R2 media read rejects a missing object', async () => {
  await assert.rejects(r2GetObject({ MEDIA_BUCKET: { get: async () => null } }, 'missing'), error => error.code === 'NOT_FOUND')
})
