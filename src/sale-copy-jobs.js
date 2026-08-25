import { ageLabel, ApiError, nowIso, parseJson, text } from './core.js'
import { all, first } from './db.js'
import { generateSaleCopy, saleCopyBird } from './sale-copy.js'

const EXPIRY_MS = 3 * 24 * 60 * 60 * 1000

function view(row) {
  if (!row) return null
  return {
    status: row.status,
    title: row.title || '',
    content: row.content || '',
    style: (parseJson(row.request_json, {}) || {}).style || 'PROFESSIONAL',
    errorMessage: row.error_message || '',
    unread: row.status === 'READY' && !row.viewed_at,
    expiresAt: row.expires_at || ''
  }
}

export async function getSaleCopy(env, owner, parrotId, markViewed = false) {
  const id = text(parrotId, '鹦鹉', 80)
  const row = await first(env, 'SELECT * FROM sale_copy_documents WHERE owner_open_id=? AND parrot_id=?', owner, id)
  if (!row) return null
  if (markViewed && row.status === 'READY' && !row.viewed_at) {
    const viewedAt = nowIso()
    await env.DB.prepare('UPDATE sale_copy_documents SET viewed_at=?,updated_at=? WHERE id=? AND viewed_at IS NULL').bind(viewedAt, viewedAt, row.id).run()
    row.viewed_at = viewedAt
  }
  return view(row)
}

function notificationView(row) {
  const failed = String(row.title || '').includes('失败')
  return { id: row.id, type: row.type, status: failed ? 'FAILED' : 'SUCCESS', title: failed ? 'AI 售卖文案生成失败' : 'AI 售卖文案已完成', targetType: row.target_type, targetId: row.target_id, read: Boolean(row.read_at), createdAt: row.created_at, parrot: { name: row.parrot_name || '鹦鹉档案', breed: row.parrot_breed || '未填写品种', ringNumber: row.parrot_ring_number || '未填写编号', gender: row.parrot_gender || 'UNKNOWN', genderLabel: ({ MALE: '公', FEMALE: '母', UNKNOWN: '未知' })[row.parrot_gender] || '未知', age: ageLabel(row.parrot_birth_date) } }
}

const notificationSelect = `SELECT n.*,p.species AS parrot_name,p.breed AS parrot_breed,p.ring_number AS parrot_ring_number,p.gender AS parrot_gender,p.birth_date AS parrot_birth_date FROM notifications n LEFT JOIN parrots p ON p.id=n.target_id AND p.owner_open_id=n.owner_open_id`
const notificationById = (env, owner, id) => first(env, `${notificationSelect} WHERE n.id=? AND n.owner_open_id=?`, id, owner)

export async function listNotifications(env, owner) {
  const rows = await all(env, `${notificationSelect} WHERE n.owner_open_id=? ORDER BY n.created_at DESC LIMIT 50`, owner)
  return { items: rows.map(notificationView), unreadCount: rows.filter(row => !row.read_at).length }
}

export async function readNotification(env, owner, notificationId) {
  const id = text(notificationId, '通知', 80), readAt = nowIso(), row = await notificationById(env, owner, id)
  if (!row) throw new ApiError('NOT_FOUND', '通知不存在', 404)
  if (!row.read_at) { await env.DB.prepare('UPDATE notifications SET read_at=? WHERE id=? AND owner_open_id=? AND read_at IS NULL').bind(readAt, id, owner).run(); row.read_at = readAt }
  return notificationView(row)
}

export async function setNotificationRead(env, owner, notificationId, read) {
  const id = text(notificationId, '通知', 80)
  const row = await notificationById(env, owner, id)
  if (!row) throw new ApiError('NOT_FOUND', '通知不存在', 404)
  const readAt = read ? nowIso() : null
  await env.DB.prepare('UPDATE notifications SET read_at=? WHERE id=? AND owner_open_id=?').bind(readAt, id, owner).run()
  row.read_at = readAt
  return notificationView(row)
}

export async function deleteNotification(env, owner, notificationId) {
  const id = text(notificationId, '通知', 80)
  const result = await env.DB.prepare('DELETE FROM notifications WHERE id=? AND owner_open_id=?').bind(id, owner).run()
  if (!result.meta.changes) throw new ApiError('NOT_FOUND', '通知不存在', 404)
  return { id, deleted: true }
}

export async function readAllNotifications(env, owner) {
  const result = await env.DB.prepare('UPDATE notifications SET read_at=? WHERE owner_open_id=? AND read_at IS NULL').bind(nowIso(), owner).run()
  return { updated: result.meta.changes || 0 }
}

export async function deleteAllNotifications(env, owner) {
  const result = await env.DB.prepare('DELETE FROM notifications WHERE owner_open_id=?').bind(owner).run()
  return { deleted: result.meta.changes || 0 }
}

async function notifySaleCopyComplete(env, job, failed = false) {
  const createdAt = nowIso(), raw = { id: crypto.randomUUID(), type: 'SALE_COPY', title: failed ? 'AI 售卖文案生成失败' : 'AI 售卖文案已完成', targetType: 'PARROT_DETAIL', targetId: job.parrot_id, createdAt }
  // 同一只鸟只保留最新一条文案通知，避免用户连续生成后堆积重复提醒。
  await env.DB.prepare('DELETE FROM notifications WHERE owner_open_id=? AND type=? AND target_type=? AND target_id=?').bind(job.owner_open_id, raw.type, raw.targetType, raw.targetId).run()
  await env.DB.prepare('INSERT INTO notifications (id,owner_open_id,type,title,content,target_type,target_id,read_at,created_at) VALUES (?,?,?,?,?,?,?,?,?)').bind(raw.id, job.owner_open_id, raw.type, raw.title, '', raw.targetType, raw.targetId, null, createdAt).run()
  const notification = notificationView(await notificationById(env, job.owner_open_id, raw.id))
  await env.SALE_COPY_COORDINATOR.get(env.SALE_COPY_COORDINATOR.idFromName(job.owner_open_id)).fetch('https://sale-copy/notification', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(notification) })
}

async function createSaleCopyJob(env, owner, input) {
  const parrotId = text(input.id, '鹦鹉', 80)
  await saleCopyBird(env, owner, input)
  const now = nowIso(), token = crypto.randomUUID(), request = { id: parrotId, style: input.style || 'PROFESSIONAL', traits: input.traits || {}, note: input.note || '' }
  await env.DB.prepare("DELETE FROM notifications WHERE owner_open_id=? AND type='SALE_COPY' AND target_type='PARROT_DETAIL' AND target_id=?").bind(owner, parrotId).run()
  await env.DB.prepare(`INSERT INTO sale_copy_documents (id,owner_open_id,parrot_id,generation_token,request_json,status,title,content,error_message,completed_at,expires_at,viewed_at,created_at,updated_at)
    VALUES (?,?,?,?,?,?,'','','',NULL,NULL,NULL,?,?)
    ON CONFLICT(owner_open_id,parrot_id) DO UPDATE SET generation_token=excluded.generation_token,request_json=excluded.request_json,status=excluded.status,title='',content='',error_message='',completed_at=NULL,expires_at=NULL,viewed_at=NULL,updated_at=excluded.updated_at`)
    .bind(crypto.randomUUID(), owner, parrotId, token, JSON.stringify(request), 'PENDING', now, now).run()
  const durableId = env.SALE_COPY_COORDINATOR.idFromName(owner)
  await env.SALE_COPY_COORDINATOR.get(durableId).fetch('https://sale-copy/enqueue', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ owner }) })
  return { id: parrotId, token, request }
}

export async function enqueueSaleCopy(env, owner, input) {
  await createSaleCopyJob(env, owner, input)
  return { status: 'PENDING' }
}

export class SaleCopyCoordinator {
  constructor(state, env) { this.state = state; this.env = env }
  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === '/socket') {
      if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') return new Response('WebSocket upgrade required', { status: 426 })
      const pair = new WebSocketPair(), [client, server] = Object.values(pair)
      this.state.acceptWebSocket(server)
      return new Response(null, { status: 101, webSocket: client })
    }
    const payload = await request.json()
    if (url.pathname === '/notification') {
      const message = JSON.stringify({ type: 'notification', notification: payload })
      for (const socket of this.state.getWebSockets()) { try { socket.send(message) } catch { socket.close(1011, '通知发送失败') } }
      return new Response(null, { status: 204 })
    }
    const owner = text(payload && payload.owner, 'owner', 200)
    await this.state.storage.put('owner', owner)
    const target = Date.now()
    const current = await this.state.storage.getAlarm()
    if (!current || target < current) await this.state.storage.setAlarm(target)
    return new Response(null, { status: 204 })
  }
  async alarm() {
    const owner = await this.state.storage.get('owner')
    if (!owner) return
    let job = await first(this.env, "SELECT * FROM sale_copy_documents WHERE owner_open_id=? AND status='PENDING' ORDER BY updated_at LIMIT 1", owner)
    if (!job) return
    const processingAt = nowIso()
    await this.env.DB.prepare("UPDATE sale_copy_documents SET status='PROCESSING',updated_at=? WHERE id=? AND generation_token=? AND status='PENDING'").bind(processingAt, job.id, job.generation_token).run()
    try {
      const result = await generateSaleCopy(this.env, job.owner_open_id, parseJson(job.request_json, {}))
      const completedAt = nowIso(), expiresAt = new Date(Date.now() + EXPIRY_MS).toISOString()
      const saved = await this.env.DB.prepare("UPDATE sale_copy_documents SET status='READY',title=?,content=?,error_message='',completed_at=?,expires_at=?,updated_at=? WHERE id=? AND generation_token=?").bind(result.title, result.content, completedAt, expiresAt, completedAt, job.id, job.generation_token).run()
      if (saved.meta.changes) await notifySaleCopyComplete(this.env, job)
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'AI 服务暂时不可用，请稍后换一版'
      const saved = await this.env.DB.prepare("UPDATE sale_copy_documents SET status='FAILED',error_message=?,updated_at=? WHERE id=? AND generation_token=?").bind(message.slice(0, 200), nowIso(), job.id, job.generation_token).run()
      if (saved.meta.changes) await notifySaleCopyComplete(this.env, job, true)
    }
    const next = await first(this.env, "SELECT id FROM sale_copy_documents WHERE owner_open_id=? AND status='PENDING' LIMIT 1", owner)
    if (next) await this.state.storage.setAlarm(Date.now())
  }
}
