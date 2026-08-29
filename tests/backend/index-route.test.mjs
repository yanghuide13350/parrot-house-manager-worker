import test from 'node:test'
import assert from 'node:assert/strict'
import worker from '../../src/index.js'

test('does not wildcard a configured CORS allowlist', async () => {
  const env = { API_ALLOWED_ORIGIN: 'https://console.example.com' }
  const denied = await worker.fetch(new Request('https://api.example.com/api/health', { headers: { Origin: 'https://evil.example.com' } }), env)
  assert.equal(denied.status, 200)
  assert.equal(denied.headers.get('access-control-allow-origin'), null)
  const allowed = await worker.fetch(new Request('https://api.example.com/api/health', { headers: { Origin: env.API_ALLOWED_ORIGIN } }), env)
  assert.equal(allowed.headers.get('access-control-allow-origin'), env.API_ALLOWED_ORIGIN)
})

test('ADMIN_OPENIDS members share the primary owner workspace', async () => {
  const { signSession } = await import('../../src/core.js')
  const { createD1 } = await import('./helpers/d1-adapter.mjs')
  const fs = await import('node:fs')
  const migration = [
    fs.readFileSync(new URL('../../migrations/0001_initial.sql', import.meta.url), 'utf8'),
    fs.readFileSync(new URL('../../migrations/0002_access_control.sql', import.meta.url), 'utf8'),
    fs.readFileSync(new URL('../../migrations/0003_access_settings.sql', import.meta.url), 'utf8')
  ].join('\n')
  const secret = 'session-secret-that-is-longer-than-thirty-two'
  const env = { DB: createD1(migration), SESSION_SECRET: secret, OWNER_OPENID: 'owner-open-id', ADMIN_OPENIDS: ' admin-a , admin-b ' }
  try {
    for (const [openId, expected] of [['owner-open-id', 200], ['admin-a', 200], ['admin-b', 200], ['stranger', 200]]) {
      const token = await signSession(openId, secret)
      const response = await worker.fetch(new Request('https://api.example.com/api/session', { headers: { authorization: `Bearer ${token}` } }), env)
      assert.equal(response.status, expected, openId)
      const body = await response.json()
      assert.equal(body.data.openId, openId)
      assert.equal(body.data.configured, true)
      if (openId === 'owner-open-id') assert.equal(body.data.role, 'OWNER')
      else if (openId === 'stranger') {
        assert.equal(body.data.authorized, false)
        assert.equal(body.data.role, 'NONE')
        assert.equal(body.data.accessStatus, 'none')
      } else {
        assert.equal(body.data.authorized, true)
        assert.equal(body.data.role, 'ADMIN')
        assert.equal(body.data.accessStatus, 'active')
        assert.equal(body.data.canManageAccess, true)
      }
    }
  } finally { env.DB.close() }
})

test('notification lists are scoped to the authorized user instead of the shared workspace owner', async () => {
  const { signSession } = await import('../../src/core.js')
  const { createD1 } = await import('./helpers/d1-adapter.mjs')
  const fs = await import('node:fs')
  const migration = ['0001_initial.sql', '0002_access_control.sql', '0003_access_settings.sql', '0006_parrot_breed.sql', '0016_notifications.sql'].map(name => fs.readFileSync(new URL(`../../migrations/${name}`, import.meta.url), 'utf8')).join('\n')
  const secret = 'session-secret-that-is-longer-than-thirty-two'
  const env = { DB: createD1(migration), SESSION_SECRET: secret, OWNER_OPENID: 'owner-open-id', ADMIN_OPENIDS: 'user-a,user-b' }
  try {
    await env.DB.prepare('INSERT INTO notifications (id,owner_open_id,type,title,content,target_type,target_id,read_at,created_at) VALUES (?,?,?,?,?,?,?,?,?)').bind('notice-a', 'user-a', 'SALE_COPY', 'A 完成', '', 'PARROT_DETAIL', 'parrot-a', null, '2026-08-29T00:00:00.000Z').run()
    await env.DB.prepare('INSERT INTO notifications (id,owner_open_id,type,title,content,target_type,target_id,read_at,created_at) VALUES (?,?,?,?,?,?,?,?,?)').bind('notice-b', 'user-b', 'SALE_COPY', 'B 完成', '', 'PARROT_DETAIL', 'parrot-b', null, '2026-08-29T00:01:00.000Z').run()
    for (const [openId, expectedId] of [['user-a', 'notice-a'], ['user-b', 'notice-b']]) {
      const token = await signSession(openId, secret)
      const response = await worker.fetch(new Request('https://api.example.com/api/manage', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'notifications.list', input: {} }) }), env)
      assert.equal(response.status, 200)
      const body = await response.json()
      assert.deepEqual(body.data.items.map(item => item.id), [expectedId])
    }
  } finally { env.DB.close() }
})

test('only the owner or an administrator may remove completed hatching records', async () => {
  const { signSession } = await import('../../src/core.js')
  const { createD1 } = await import('./helpers/d1-adapter.mjs')
  const fs = await import('node:fs')
  const migration = [
    fs.readFileSync(new URL('../../migrations/0001_initial.sql', import.meta.url), 'utf8'),
    fs.readFileSync(new URL('../../migrations/0002_access_control.sql', import.meta.url), 'utf8'),
    fs.readFileSync(new URL('../../migrations/0003_access_settings.sql', import.meta.url), 'utf8')
  ].join('\n')
  const secret = 'session-secret-that-is-longer-than-thirty-two'
  const env = { DB: createD1(migration), SESSION_SECRET: secret, OWNER_OPENID: 'owner-open-id', ADMIN_OPENIDS: '' }
  try {
    await env.DB.prepare("INSERT INTO access_grants (id,open_id,role,note,status,created_by,created_at,updated_at,disabled_at) VALUES ('member-grant','member-open-id','MEMBER','','ACTIVE','owner-open-id','2025-01-01T00:00:00.000Z','2025-01-01T00:00:00.000Z',NULL)").run()
    const token = await signSession('member-open-id', secret)
    const response = await worker.fetch(new Request('https://api.example.com/api/manage', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'hatching.delete', input: { id: 'record-id', revision: 1 }, requestId: 'remove-completed-1' })
    }), env)
    assert.equal(response.status, 403)
    const body = await response.json()
    assert.equal(body.error.code, 'FORBIDDEN')
    assert.equal(body.error.message, '仅主账号或管理员可移除已完成档案')
  } finally { env.DB.close() }
})

test('access list includes ADMIN_OPENIDS configuration grants', async () => {
  const { signSession } = await import('../../src/core.js')
  const { createD1 } = await import('./helpers/d1-adapter.mjs')
  const fs = await import('node:fs')
  const migration = [
    fs.readFileSync(new URL('../../migrations/0001_initial.sql', import.meta.url), 'utf8'),
    fs.readFileSync(new URL('../../migrations/0002_access_control.sql', import.meta.url), 'utf8'),
    fs.readFileSync(new URL('../../migrations/0003_access_settings.sql', import.meta.url), 'utf8')
  ].join('\n')
  const secret = 'session-secret-that-is-longer-than-thirty-two'
  const env = { DB: createD1(migration), SESSION_SECRET: secret, OWNER_OPENID: 'owner-open-id', ADMIN_OPENIDS: 'admin-aaaa,admin-bbbb' }
  try {
    const ownerToken = await signSession('owner-open-id', secret)
    let response = await worker.fetch(new Request('https://api.example.com/api/manage', {
      method: 'POST',
      headers: { authorization: `Bearer ${ownerToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'access.list', input: {} })
    }), env)
    assert.equal(response.status, 200)
    let body = await response.json()
    assert.equal(body.data.grants.length, 2)
    assert.deepEqual(body.data.grants.map((item) => item.openId).sort(), ['admin-aaaa', 'admin-bbbb'])
    assert.equal(body.data.grants.every((item) => item.source === 'env'), true)
    assert.equal(body.data.grants.every((item) => item.role === 'ADMIN'), true)

    response = await worker.fetch(new Request('https://api.example.com/api/manage', {
      method: 'POST',
      headers: { authorization: `Bearer ${ownerToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'access.unsetAdmin', input: { openId: 'admin-aaaa' } })
    }), env)
    assert.equal(response.status, 200)
    body = await response.json()
    const demoted = body.data.grants.find((item) => item.openId === 'admin-aaaa')
    assert.equal(demoted.role, 'MEMBER')
    assert.equal(demoted.source, 'database')

    response = await worker.fetch(new Request('https://api.example.com/api/manage', {
      method: 'POST',
      headers: { authorization: `Bearer ${ownerToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'access.revokeMember', input: { openId: 'admin-bbbb' } })
    }), env)
    assert.equal(response.status, 200)
    body = await response.json()
    assert.equal(body.data.grants.some((item) => item.openId === 'admin-bbbb'), false)

    const adminToken = await signSession('admin-bbbb', secret)
    response = await worker.fetch(new Request('https://api.example.com/api/session', {
      headers: { authorization: `Bearer ${adminToken}` }
    }), env)
    body = await response.json()
    assert.equal(body.data.authorized, false)
    assert.equal(body.data.role, 'NONE')
  } finally { env.DB.close() }
})

test('access workflow supports request review and owner-only admin promotion', async () => {
  const { signSession } = await import('../../src/core.js')
  const { createD1 } = await import('./helpers/d1-adapter.mjs')
  const fs = await import('node:fs')
  const migration = [
    fs.readFileSync(new URL('../../migrations/0001_initial.sql', import.meta.url), 'utf8'),
    fs.readFileSync(new URL('../../migrations/0002_access_control.sql', import.meta.url), 'utf8'),
    fs.readFileSync(new URL('../../migrations/0003_access_settings.sql', import.meta.url), 'utf8')
  ].join('\n')
  const secret = 'session-secret-that-is-longer-than-thirty-two'
  const env = { DB: createD1(migration), SESSION_SECRET: secret, OWNER_OPENID: 'owner-open-id', ADMIN_OPENIDS: '' }
  try {
    const ownerToken = await signSession('owner-open-id', secret)
    const strangerToken = await signSession('stranger-open-id', secret)
    const rejectToken = await signSession('reject-open-id', secret)

    let response = await worker.fetch(new Request('https://api.example.com/api/manage', {
      method: 'POST',
      headers: { authorization: `Bearer ${strangerToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'access.request', input: { note: '销售协作' } })
    }), env)
    assert.equal(response.status, 200)

    response = await worker.fetch(new Request('https://api.example.com/api/session', {
      headers: { authorization: `Bearer ${strangerToken}` }
    }), env)
    let body = await response.json()
    assert.equal(body.data.accessStatus, 'pending')
    assert.equal(body.data.requestNote, '销售协作')

    response = await worker.fetch(new Request('https://api.example.com/api/manage', {
      method: 'POST',
      headers: { authorization: `Bearer ${ownerToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'access.list', input: {} })
    }), env)
    body = await response.json()
    assert.equal(body.data.pending.length, 1)

    const approveId = body.data.pending[0].id
    response = await worker.fetch(new Request('https://api.example.com/api/manage', {
      method: 'POST',
      headers: { authorization: `Bearer ${ownerToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'access.approve', input: { requestId: approveId, note: '销售协作' } })
    }), env)
    assert.equal(response.status, 200)

    response = await worker.fetch(new Request('https://api.example.com/api/session', {
      headers: { authorization: `Bearer ${strangerToken}` }
    }), env)
    body = await response.json()
    assert.equal(body.data.authorized, true)
    assert.equal(body.data.role, 'MEMBER')

    response = await worker.fetch(new Request('https://api.example.com/api/manage', {
      method: 'POST',
      headers: { authorization: `Bearer ${strangerToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'access.setAdmin', input: { openId: 'stranger-open-id' } })
    }), env)
    assert.equal(response.status, 403)

    response = await worker.fetch(new Request('https://api.example.com/api/manage', {
      method: 'POST',
      headers: { authorization: `Bearer ${ownerToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'access.setAdmin', input: { openId: 'stranger-open-id' } })
    }), env)
    assert.equal(response.status, 200)

    response = await worker.fetch(new Request('https://api.example.com/api/session', {
      headers: { authorization: `Bearer ${strangerToken}` }
    }), env)
    body = await response.json()
    assert.equal(body.data.role, 'ADMIN')

    response = await worker.fetch(new Request('https://api.example.com/api/manage', {
      method: 'POST',
      headers: { authorization: `Bearer ${rejectToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'access.request', input: { note: '临时访问' } })
    }), env)
    assert.equal(response.status, 200)

    response = await worker.fetch(new Request('https://api.example.com/api/manage', {
      method: 'POST',
      headers: { authorization: `Bearer ${ownerToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'access.list', input: {} })
    }), env)
    body = await response.json()
    const rejectId = body.data.pending.find((item) => item.openId === 'reject-open-id').id

    response = await worker.fetch(new Request('https://api.example.com/api/manage', {
      method: 'POST',
      headers: { authorization: `Bearer ${ownerToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'access.reject', input: { requestId: rejectId, reviewNote: '当前仅开放内部同事' } })
    }), env)
    assert.equal(response.status, 200)

    response = await worker.fetch(new Request('https://api.example.com/api/session', {
      headers: { authorization: `Bearer ${rejectToken}` }
    }), env)
    body = await response.json()
    assert.equal(body.data.authorized, false)
    assert.equal(body.data.accessStatus, 'rejected')
    assert.equal(body.data.reviewNote, '当前仅开放内部同事')
  } finally { env.DB.close() }
})

test('owner can enable open access policy', async () => {
  const { signSession } = await import('../../src/core.js')
  const { createD1 } = await import('./helpers/d1-adapter.mjs')
  const fs = await import('node:fs')
  const migration = [
    fs.readFileSync(new URL('../../migrations/0001_initial.sql', import.meta.url), 'utf8'),
    fs.readFileSync(new URL('../../migrations/0002_access_control.sql', import.meta.url), 'utf8'),
    fs.readFileSync(new URL('../../migrations/0003_access_settings.sql', import.meta.url), 'utf8')
  ].join('\n')
  const secret = 'session-secret-that-is-longer-than-thirty-two'
  const env = { DB: createD1(migration), SESSION_SECRET: secret, OWNER_OPENID: 'owner-open-id', ADMIN_OPENIDS: '' }
  try {
    const ownerToken = await signSession('owner-open-id', secret)
    const strangerToken = await signSession('stranger-open-id', secret)

    let response = await worker.fetch(new Request('https://api.example.com/api/session', {
      headers: { authorization: `Bearer ${strangerToken}` }
    }), env)
    let body = await response.json()
    assert.equal(body.data.authorized, false)

    response = await worker.fetch(new Request('https://api.example.com/api/manage', {
      method: 'POST',
      headers: { authorization: `Bearer ${ownerToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'access.setPolicy', input: { openAccess: true } })
    }), env)
    assert.equal(response.status, 200)
    body = await response.json()
    assert.equal(body.data.policy.openAccess, true)

    response = await worker.fetch(new Request('https://api.example.com/api/session', {
      headers: { authorization: `Bearer ${strangerToken}` }
    }), env)
    body = await response.json()
    assert.equal(body.data.authorized, true)
    assert.equal(body.data.role, 'MEMBER')
  } finally { env.DB.close() }
})
