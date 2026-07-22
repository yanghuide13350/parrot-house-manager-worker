import test from 'node:test'
import assert from 'node:assert/strict'
import { ageLabel, dateOnly, deriveShareToken, normalizeRing, signSession, verifySession } from '../../src/core.js'
import { isUnsafeHostname, sniff } from '../../src/media-security.js'

test('normalizes ring numbers and rejects invalid dates', () => {
  assert.equal(normalizeRing(' r- 001 m '),'R-001M')
  assert.throws(()=>dateOnly('2026-02-29'),error=>error.code==='VALIDATION_ERROR')
  assert.equal(dateOnly('2024-02-29'),'2024-02-29')
})

test('calculates age using Asia Shanghai calendar boundaries', () => {
  assert.equal(ageLabel('2025-07-18',new Date('2026-07-18T03:00:00Z')),'12 个月')
  assert.equal(ageLabel('2024-06-18',new Date('2026-07-18T03:00:00Z')),'2 岁 1 个月')
})

test('signs sessions and deterministic share tokens without exposing secrets', async () => {
  const secret='test-secret-that-is-longer-than-thirty-two-characters'
  const session=await signSession('owner',secret,60)
  assert.equal(await verifySession(session,secret),'owner')
  assert.equal(await deriveShareToken('owner','request-1',secret),await deriveShareToken('owner','request-1',secret))
  await assert.rejects(verifySession(`${session}x`,secret),error=>error.code==='UNAUTHORIZED')
})

test('blocks unsafe media hosts and sniffs bytes instead of extensions', () => {
  for(const host of ['localhost','127.0.0.1','10.0.0.1','192.168.1.2','::1','fd00::1'])assert.equal(isUnsafeHostname(host),true,host)
  assert.equal(isUnsafeHostname('cdn.example.com'),false)
  assert.equal(sniff(Uint8Array.from([0xff,0xd8,0xff,0]).buffer,10,100).mime,'image/jpeg')
  assert.equal(sniff(new TextEncoder().encode('<svg onload="alert(1)"></svg>').buffer,10,100),null)
})
