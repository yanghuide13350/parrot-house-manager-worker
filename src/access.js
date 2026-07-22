import { ApiError, ensure, id, nowIso, text } from './core.js'
import { all, first, statement } from './db.js'

const ROLES = Object.freeze({ OWNER: 'OWNER', ADMIN: 'ADMIN', MEMBER: 'MEMBER', NONE: 'NONE' })
const ACCESS_STATUS = Object.freeze({ NONE: 'none', PENDING: 'pending', REJECTED: 'rejected', ACTIVE: 'active' })

function ownerConfigured(env) {
  return Boolean(env.OWNER_OPENID && !String(env.OWNER_OPENID).startsWith('replace-'))
}

function envAdminOpenIds(env) {
  return new Set(String(env.ADMIN_OPENIDS || '').split(',').map(value => value.trim()).filter(Boolean))
}

function isOwnerOpenId(env, openId) {
  return ownerConfigured(env) && openId === env.OWNER_OPENID
}

async function accessPolicy(env) {
  if (!ownerConfigured(env)) return { openAccess: false, updatedAt: '', updatedBy: '' }
  const current = await first(env, 'SELECT open_access, updated_at, updated_by FROM access_settings WHERE owner_open_id = ?', env.OWNER_OPENID)
  return {
    openAccess: Boolean(current && Number(current.open_access)),
    updatedAt: current?.updated_at || '',
    updatedBy: current?.updated_by || ''
  }
}

export async function resolveAccess(env, openId) {
  const configured = ownerConfigured(env)
  if (!configured) {
    return {
      openId,
      configured: false,
      authorized: false,
      role: ROLES.NONE,
      accessStatus: ACCESS_STATUS.NONE,
      canManageAccess: false,
      requestNote: '',
      reviewNote: ''
    }
  }

  if (isOwnerOpenId(env, openId)) {
    return {
      openId,
      configured: true,
      authorized: true,
      role: ROLES.OWNER,
      accessStatus: ACCESS_STATUS.ACTIVE,
      canManageAccess: true,
      requestNote: '',
      reviewNote: ''
    }
  }

  const grant = await first(env, "SELECT * FROM access_grants WHERE open_id = ? AND status = 'ACTIVE'", openId)
  if (grant) {
    const role = grant.role === ROLES.ADMIN ? ROLES.ADMIN : ROLES.MEMBER
    return {
      openId,
      configured: true,
      authorized: true,
      role,
      accessStatus: ACCESS_STATUS.ACTIVE,
      canManageAccess: role === ROLES.ADMIN,
      requestNote: '',
      reviewNote: ''
    }
  }

  const disabled = await first(env, "SELECT id FROM access_grants WHERE open_id = ? AND status = 'DISABLED'", openId)
  if (disabled) {
    // 本地撤销优先于环境变量 ADMIN_OPENIDS，便于在线管理历史配置名单
  } else if (envAdminOpenIds(env).has(openId)) {
    return {
      openId,
      configured: true,
      authorized: true,
      role: ROLES.ADMIN,
      accessStatus: ACCESS_STATUS.ACTIVE,
      canManageAccess: true,
      requestNote: '',
      reviewNote: ''
    }
  }

  const policy = await accessPolicy(env)
  if (policy.openAccess) {
    return {
      openId,
      configured: true,
      authorized: true,
      role: ROLES.MEMBER,
      accessStatus: ACCESS_STATUS.ACTIVE,
      canManageAccess: false,
      requestNote: '',
      reviewNote: ''
    }
  }

  const request = await first(env, 'SELECT * FROM access_requests WHERE open_id = ? ORDER BY requested_at DESC LIMIT 1', openId)
  if (request?.status === 'PENDING') {
    return {
      openId,
      configured: true,
      authorized: false,
      role: ROLES.NONE,
      accessStatus: ACCESS_STATUS.PENDING,
      canManageAccess: false,
      requestNote: request.note || '',
      reviewNote: ''
    }
  }
  if (request?.status === 'REJECTED') {
    return {
      openId,
      configured: true,
      authorized: false,
      role: ROLES.NONE,
      accessStatus: ACCESS_STATUS.REJECTED,
      canManageAccess: false,
      requestNote: request.note || '',
      reviewNote: request.review_note || ''
    }
  }

  return {
    openId,
    configured: true,
    authorized: false,
    role: ROLES.NONE,
    accessStatus: ACCESS_STATUS.NONE,
    canManageAccess: false,
    requestNote: '',
    reviewNote: ''
  }
}

function requireManageAccess(session) {
  ensure(session.canManageAccess, 'FORBIDDEN', '仅主账号或管理员可管理权限', 403)
}

function requireOwner(session) {
  ensure(session.role === ROLES.OWNER, 'FORBIDDEN', '仅主账号可管理管理员', 403)
}

function openIdValue(value, field = 'OpenID') {
  const result = text(value, field, 128)
  ensure(/^[A-Za-z0-9_-]{8,128}$/.test(result), 'VALIDATION_ERROR', `${field}格式无效`)
  return result
}

async function listAccess(env) {
  const policy = await accessPolicy(env)
  const pending = await all(env, "SELECT id, open_id, note, status, requested_at, reviewed_at, reviewed_by, review_note FROM access_requests WHERE status = 'PENDING' ORDER BY requested_at ASC")
  const grants = await all(env, "SELECT id, open_id, role, note, status, created_by, created_at, updated_at FROM access_grants WHERE status = 'ACTIVE' ORDER BY CASE role WHEN 'ADMIN' THEN 0 ELSE 1 END, created_at ASC")
  const approvedRequests = await all(env, "SELECT open_id, note, requested_at FROM access_requests WHERE status = 'APPROVED' ORDER BY requested_at DESC")
  const disabled = await all(env, "SELECT open_id FROM access_grants WHERE status = 'DISABLED'")
  const blocked = new Set(disabled.map(row => row.open_id))
  const approvedMap = new Map()
  for (const row of approvedRequests) if (!approvedMap.has(row.open_id)) approvedMap.set(row.open_id, row)
  const mapped = grants.map(row => {
    const requested = approvedMap.get(row.open_id)
    return {
      id: row.id,
      openId: row.open_id,
      role: row.role,
      note: row.note || '',
      status: row.status,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      requestedAt: requested?.requested_at || '',
      requestNote: requested?.note || row.note || '',
      source: 'database'
    }
  })
  const known = new Set(mapped.map(item => item.openId))
  if (ownerConfigured(env) && env.OWNER_OPENID) known.add(env.OWNER_OPENID)
  for (const openId of envAdminOpenIds(env)) {
    if (known.has(openId) || blocked.has(openId)) continue
    mapped.push({
      id: `env:${openId}`,
      openId,
      role: ROLES.ADMIN,
      note: '配置名单',
      status: 'ACTIVE',
      createdBy: 'env',
      createdAt: '',
      updatedAt: '',
      requestedAt: '',
      requestNote: '',
      source: 'env'
    })
    known.add(openId)
  }
  mapped.sort((left, right) => {
    const rank = item => item.role === ROLES.ADMIN ? 0 : 1
    if (rank(left) !== rank(right)) return rank(left) - rank(right)
    return String(left.createdAt || '').localeCompare(String(right.createdAt || ''))
  })
  return {
    policy,
    pending: pending.map(row => ({
      id: row.id,
      openId: row.open_id,
      note: row.note || '',
      status: row.status,
      requestedAt: row.requested_at,
      reviewedAt: row.reviewed_at,
      reviewedBy: row.reviewed_by,
      reviewNote: row.review_note || ''
    })),
    grants: mapped
  }
}

async function requestAccess(env, session, input) {
  ensure(session.configured, 'CONFIGURATION_ERROR', '主账号尚未配置', 503)
  ensure(!session.authorized, 'INVALID_STATE', '当前账号已有访问权限')
  const existing = await first(env, "SELECT * FROM access_requests WHERE open_id = ? AND status = 'PENDING' ORDER BY requested_at DESC LIMIT 1", session.openId)
  if (existing) {
    return {
      id: existing.id,
      openId: existing.open_id,
      note: existing.note || '',
      status: existing.status,
      requestedAt: existing.requested_at,
      accessStatus: ACCESS_STATUS.PENDING
    }
  }
  const note = text(input.note || '', '申请备注', 120)
  const now = nowIso()
  const requestId = id()
  await statement(env, 'INSERT INTO access_requests (id, open_id, note, status, requested_at, reviewed_at, reviewed_by, review_note) VALUES (?,?,?,?,?,?,?,?)', requestId, session.openId, note, 'PENDING', now, null, null, '').run()
  return {
    id: requestId,
    openId: session.openId,
    note,
    status: 'PENDING',
    requestedAt: now,
    accessStatus: ACCESS_STATUS.PENDING
  }
}

async function myStatus(env, session) {
  return resolveAccess(env, session.openId)
}

async function setAccessPolicy(env, session, input) {
  requireOwner(session)
  ensure(ownerConfigured(env), 'CONFIGURATION_ERROR', '主账号尚未配置', 503)
  const openAccess = Boolean(input.openAccess)
  const now = nowIso()
  const current = await first(env, 'SELECT owner_open_id FROM access_settings WHERE owner_open_id = ?', env.OWNER_OPENID)
  if (current) {
    await statement(env, 'UPDATE access_settings SET open_access = ?, updated_at = ?, updated_by = ? WHERE owner_open_id = ?', openAccess ? 1 : 0, now, session.openId, env.OWNER_OPENID).run()
  } else {
    await statement(env, 'INSERT INTO access_settings (owner_open_id, open_access, updated_at, updated_by) VALUES (?,?,?,?)', env.OWNER_OPENID, openAccess ? 1 : 0, now, session.openId).run()
  }
  return listAccess(env)
}

async function approveRequest(env, session, input) {
  requireManageAccess(session)
  const requestId = text(input.requestId, '申请 ID', 80)
  const request = await first(env, 'SELECT * FROM access_requests WHERE id = ?', requestId)
  ensure(request, 'NOT_FOUND', '申请不存在', 404)
  ensure(request.status === 'PENDING', 'INVALID_STATE', '该申请已处理')
  ensure(!isOwnerOpenId(env, request.open_id), 'FORBIDDEN', '不能操作主账号', 403)

  const note = text(input.note ?? request.note ?? '', '备注', 120, false)
  const now = nowIso()
  const existing = await first(env, 'SELECT * FROM access_grants WHERE open_id = ?', request.open_id)
  const statements = [
    statement(env, "UPDATE access_requests SET status = 'APPROVED', reviewed_at = ?, reviewed_by = ?, review_note = ? WHERE id = ? AND status = 'PENDING'", now, session.openId, '', requestId)
  ]
  if (existing) {
    statements.push(statement(env, "UPDATE access_grants SET role = 'MEMBER', note = ?, status = 'ACTIVE', updated_at = ?, disabled_at = NULL WHERE open_id = ?", note, now, request.open_id))
  } else {
    statements.push(statement(env, 'INSERT INTO access_grants (id, open_id, role, note, status, created_by, created_at, updated_at, disabled_at) VALUES (?,?,?,?,?,?,?,?,?)', id(), request.open_id, 'MEMBER', note, 'ACTIVE', session.openId, now, now, null))
  }
  await env.DB.batch(statements)
  return listAccess(env)
}

async function rejectRequest(env, session, input) {
  requireManageAccess(session)
  const requestId = text(input.requestId, '申请 ID', 80)
  const reviewNote = text(input.reviewNote || '', '拒绝原因', 200, false)
  const request = await first(env, 'SELECT * FROM access_requests WHERE id = ?', requestId)
  ensure(request, 'NOT_FOUND', '申请不存在', 404)
  ensure(request.status === 'PENDING', 'INVALID_STATE', '该申请已处理')
  const now = nowIso()
  const result = await statement(env, "UPDATE access_requests SET status = 'REJECTED', reviewed_at = ?, reviewed_by = ?, review_note = ? WHERE id = ? AND status = 'PENDING'", now, session.openId, reviewNote, requestId).run()
  ensure(result.meta?.changes, 'INVALID_STATE', '该申请已处理')
  return listAccess(env)
}

async function upsertGrant(env, openId, role, note, createdBy, status = 'ACTIVE') {
  const now = nowIso()
  const existing = await first(env, 'SELECT * FROM access_grants WHERE open_id = ?', openId)
  if (existing) {
    await statement(env, 'UPDATE access_grants SET role = ?, note = ?, status = ?, updated_at = ?, disabled_at = ? WHERE open_id = ?', role, note, status, now, status === 'DISABLED' ? now : null, openId).run()
    return
  }
  await statement(env, 'INSERT INTO access_grants (id, open_id, role, note, status, created_by, created_at, updated_at, disabled_at) VALUES (?,?,?,?,?,?,?,?,?)', id(), openId, role, note, status, createdBy, now, now, status === 'DISABLED' ? now : null).run()
}

async function revokeMember(env, session, input) {
  requireManageAccess(session)
  const openId = openIdValue(input.openId)
  ensure(openId !== session.openId, 'FORBIDDEN', '不能撤销自己的权限', 403)
  ensure(!isOwnerOpenId(env, openId), 'FORBIDDEN', '不能撤销主账号', 403)
  const grant = await first(env, "SELECT * FROM access_grants WHERE open_id = ? AND status = 'ACTIVE'", openId)
  const fromEnv = envAdminOpenIds(env).has(openId)
  ensure(grant || fromEnv, 'NOT_FOUND', '未找到可撤销的授权')
  if (grant?.role === 'ADMIN' || (!grant && fromEnv)) requireOwner(session)
  const note = grant?.note || (fromEnv ? '配置名单' : '')
  const role = grant?.role || 'ADMIN'
  await upsertGrant(env, openId, role, note, session.openId, 'DISABLED')
  return listAccess(env)
}

async function setAdmin(env, session, input) {
  requireOwner(session)
  const openId = openIdValue(input.openId)
  ensure(!isOwnerOpenId(env, openId), 'FORBIDDEN', '主账号已是最高权限', 403)
  const grant = await first(env, "SELECT * FROM access_grants WHERE open_id = ? AND status = 'ACTIVE'", openId)
  const fromEnv = envAdminOpenIds(env).has(openId)
  ensure(grant || fromEnv, 'NOT_FOUND', '未找到该授权账号')
  if (grant?.role === 'ADMIN' || (!grant && fromEnv)) throw new ApiError('INVALID_STATE', '该用户已是管理员')
  await upsertGrant(env, openId, 'ADMIN', grant?.note || '', session.openId, 'ACTIVE')
  return listAccess(env)
}

async function unsetAdmin(env, session, input) {
  requireOwner(session)
  const openId = openIdValue(input.openId)
  ensure(!isOwnerOpenId(env, openId), 'FORBIDDEN', '不能调整主账号角色', 403)
  const grant = await first(env, "SELECT * FROM access_grants WHERE open_id = ? AND status = 'ACTIVE'", openId)
  const fromEnv = envAdminOpenIds(env).has(openId)
  ensure(grant || fromEnv, 'NOT_FOUND', '未找到该授权账号')
  if (grant && grant.role !== 'ADMIN') throw new ApiError('INVALID_STATE', '该用户不是管理员')
  if (!grant && !fromEnv) throw new ApiError('INVALID_STATE', '该用户不是管理员')
  await upsertGrant(env, openId, 'MEMBER', grant?.note || (fromEnv ? '配置名单' : ''), session.openId, 'ACTIVE')
  return listAccess(env)
}

export async function handleAccessAction(env, session, action, input = {}) {
  switch (action) {
    case 'access.request': return requestAccess(env, session, input)
    case 'access.myStatus': return myStatus(env, session)
    case 'access.list': requireManageAccess(session); return listAccess(env)
    case 'access.approve': return approveRequest(env, session, input)
    case 'access.reject': return rejectRequest(env, session, input)
    case 'access.revokeMember': return revokeMember(env, session, input)
    case 'access.setAdmin': return setAdmin(env, session, input)
    case 'access.unsetAdmin': return unsetAdmin(env, session, input)
    case 'access.setPolicy': return setAccessPolicy(env, session, input)
    default: throw new ApiError('NOT_FOUND', `未知权限操作: ${action}`, 404)
  }
}

export { ROLES, ACCESS_STATUS, ownerConfigured }
