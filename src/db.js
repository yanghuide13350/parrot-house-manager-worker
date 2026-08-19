import { ageLabel, ensure, id, json, mediaSignature, nowIso, parseJson } from './core.js'

export async function first(env, sql, ...values) { return env.DB.prepare(sql).bind(...values).first() }
export async function all(env, sql, ...values) { return (await env.DB.prepare(sql).bind(...values).all()).results || [] }
export function statement(env, sql, ...values) { return env.DB.prepare(sql).bind(...values) }
export async function owned(env, table, idValue, owner, includeDeleted = false) {
  const row = await first(env, `SELECT * FROM ${table} WHERE id = ? AND owner_open_id = ?${includeDeleted ? '' : ' AND deleted_at IS NULL'}`, idValue, owner)
  ensure(row, 'NOT_FOUND', '记录不存在', 404)
  return row
}
export function revisionCheck(row, expected) { ensure(Number(row.revision) === Number(expected), 'CONFLICT', '记录已被其他操作更新，请刷新后重试', 409, { currentRevision: row.revision }) }
export function auditStatement(env, owner, action, targetType, targetId, requestId, before, after) { return statement(env, 'INSERT INTO audit_logs (id,owner_open_id,action,target_type,target_id,request_id,before_json,after_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)', id(), owner, action, targetType, targetId, requestId, json(before), json(after), nowIso()) }
export function activeWhere() { return 'owner_open_id = ? AND deleted_at IS NULL' }
export function rowMedia(row) { return parseJson(row && row.media_json, []) }
export async function mediaItems(env, items, secret, baseUrl, _token) {
  const expiry = Math.floor(Date.now()/86400000)*86400 + 86400
  return Promise.all((items || []).map(async item => {
    const url=item.key?`${baseUrl}/api/media/${encodeURIComponent(item.assetId)}?expires=${expiry}&signature=${await mediaSignature(item.assetId,expiry,secret)}`:''
    const thumbnailUrl=item.type==='image'?url:''
    return {assetId:item.assetId,type:item.type,fileID:url,url,thumbnailFileID:thumbnailUrl,posterFileID:''}
  }))
}
export async function serializeParrot(env, row, secret, baseUrl, token) {
  const media = await mediaItems(env, rowMedia(row), secret, baseUrl, token)
  return { id: row.id, species: row.species, ringNumber: row.ring_number, gender: row.gender, status: row.status, birthDate: row.birth_date, ageLabel: ageLabel(row.birth_date), priceCents: row.price_cents, publicIntro: row.public_intro || '', privateNotes: row.private_notes || '', media, father: parseJson(row.father_snapshot_json, null), mother: parseJson(row.mother_snapshot_json, null), activePairId: row.active_pair_id, mate: null, pairedAt: row.paired_at, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at }
}
export function snapshot(row) { return { species: row.species, ringNumber: row.ring_number, gender: row.gender, birthDate: row.birth_date, media: rowMedia(row) } }
