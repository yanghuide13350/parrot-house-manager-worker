import { ApiError, nowIso, parseJson, text } from './core.js'
import { first } from './db.js'
import { generateSaleCopy, saleCopyBird, streamSaleCopy } from './sale-copy.js'

const EXPIRY_MS = 3 * 24 * 60 * 60 * 1000
const STREAM_FALLBACK_DELAY_MS = 2 * 60 * 1000

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

async function createSaleCopyJob(env, owner, input, status = 'PENDING', delayMs = 0) {
  const parrotId = text(input.id, '鹦鹉', 80)
  await saleCopyBird(env, owner, input)
  const now = nowIso(), token = crypto.randomUUID(), request = { id: parrotId, style: input.style || 'PROFESSIONAL', traits: input.traits || {}, note: input.note || '' }
  await env.DB.prepare(`INSERT INTO sale_copy_documents (id,owner_open_id,parrot_id,generation_token,request_json,status,title,content,error_message,completed_at,expires_at,viewed_at,created_at,updated_at)
    VALUES (?,?,?,?,?,?,'','','',NULL,NULL,NULL,?,?)
    ON CONFLICT(owner_open_id,parrot_id) DO UPDATE SET generation_token=excluded.generation_token,request_json=excluded.request_json,status=excluded.status,title='',content='',error_message='',completed_at=NULL,expires_at=NULL,viewed_at=NULL,updated_at=excluded.updated_at`)
    .bind(crypto.randomUUID(), owner, parrotId, token, JSON.stringify(request), status, now, now).run()
  const durableId = env.SALE_COPY_COORDINATOR.idFromName(owner)
  await env.SALE_COPY_COORDINATOR.get(durableId).fetch('https://sale-copy/enqueue', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ owner, delayMs }) })
  return { id: parrotId, token, request }
}

export async function enqueueSaleCopy(env, owner, input) {
  await createSaleCopyJob(env, owner, input)
  return { status: 'PENDING' }
}

export async function streamSaleCopyDocument(env, owner, input, controller) {
  const job = await createSaleCopyJob(env, owner, input, 'STREAMING', STREAM_FALLBACK_DELAY_MS)
  const encoder = new TextEncoder()
  const send = value => controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`))
  try {
    const result = await streamSaleCopy(env, owner, job.request, value => send({ type: 'delta', value }))
    const completedAt = nowIso(), expiresAt = new Date(Date.now() + EXPIRY_MS).toISOString()
    await env.DB.prepare("UPDATE sale_copy_documents SET status='READY',title=?,content=?,error_message='',completed_at=?,expires_at=?,updated_at=? WHERE owner_open_id=? AND parrot_id=? AND generation_token=?").bind(result.title, result.content, completedAt, expiresAt, completedAt, owner, job.id, job.token).run()
    send({ type: 'done', saleCopy: { status: 'READY', title: result.title, content: result.content, style: result.style, unread: false, expiresAt } })
  } catch (error) {
    const message = error instanceof ApiError ? error.message : 'AI 服务暂时不可用，请稍后重试'
    await env.DB.prepare("UPDATE sale_copy_documents SET status='FAILED',error_message=?,updated_at=? WHERE owner_open_id=? AND parrot_id=? AND generation_token=?").bind(message.slice(0, 200), nowIso(), owner, job.id, job.token).run()
    send({ type: 'error', message })
  } finally { controller.close() }
}

export class SaleCopyCoordinator {
  constructor(state, env) { this.state = state; this.env = env }
  async fetch(request) {
    const payload = await request.json()
    const owner = text(payload && payload.owner, 'owner', 200)
    await this.state.storage.put('owner', owner)
    const target = Date.now() + Math.max(0, Math.min(Number(payload && payload.delayMs) || 0, STREAM_FALLBACK_DELAY_MS))
    const current = await this.state.storage.getAlarm()
    if (!current || target < current) await this.state.storage.setAlarm(target)
    return new Response(null, { status: 204 })
  }
  async alarm() {
    const owner = await this.state.storage.get('owner')
    if (!owner) return
    let job = await first(this.env, "SELECT * FROM sale_copy_documents WHERE owner_open_id=? AND status='PENDING' ORDER BY updated_at LIMIT 1", owner)
    if (!job) {
      job = await first(this.env, "SELECT * FROM sale_copy_documents WHERE owner_open_id=? AND status='STREAMING' ORDER BY updated_at LIMIT 1", owner)
      if (job) await this.env.DB.prepare("UPDATE sale_copy_documents SET status='PENDING',updated_at=? WHERE id=? AND generation_token=? AND status='STREAMING'").bind(nowIso(), job.id, job.generation_token).run()
    }
    if (!job) return
    const processingAt = nowIso()
    await this.env.DB.prepare("UPDATE sale_copy_documents SET status='PROCESSING',updated_at=? WHERE id=? AND generation_token=? AND status='PENDING'").bind(processingAt, job.id, job.generation_token).run()
    try {
      const result = await generateSaleCopy(this.env, job.owner_open_id, parseJson(job.request_json, {}))
      const completedAt = nowIso(), expiresAt = new Date(Date.now() + EXPIRY_MS).toISOString()
      await this.env.DB.prepare("UPDATE sale_copy_documents SET status='READY',title=?,content=?,error_message='',completed_at=?,expires_at=?,updated_at=? WHERE id=? AND generation_token=?").bind(result.title, result.content, completedAt, expiresAt, completedAt, job.id, job.generation_token).run()
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'AI 服务暂时不可用，请稍后换一版'
      await this.env.DB.prepare("UPDATE sale_copy_documents SET status='FAILED',error_message=?,updated_at=? WHERE id=? AND generation_token=?").bind(message.slice(0, 200), nowIso(), job.id, job.generation_token).run()
    }
    const next = await first(this.env, "SELECT id FROM sale_copy_documents WHERE owner_open_id=? AND status='PENDING' LIMIT 1", owner)
    if (next) await this.state.storage.setAlarm(Date.now())
    else {
      const streaming = await first(this.env, "SELECT id FROM sale_copy_documents WHERE owner_open_id=? AND status='STREAMING' LIMIT 1", owner)
      if (streaming) await this.state.storage.setAlarm(Date.now() + STREAM_FALLBACK_DELAY_MS)
    }
  }
}
