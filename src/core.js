export const STATUS = Object.freeze({ FOR_SALE: 'FOR_SALE', SOLD: 'SOLD', RETURNED: 'RETURNED', BREEDER: 'BREEDER', PAIRED: 'PAIRED', INCUBATING: 'INCUBATING' })
export const WRITE_ACTIONS = new Set(['parrots.create','introductions.create','introductions.markForSale','parrots.createFromClutch','parrots.update','parrots.delete','parrots.setBreeder','parrots.unsetBreeder','parrots.setFeedingPlan','feedingPlans.create','feedingPlans.update','feedingPlans.delete','feedingPlans.setEnabled','supplies.create','breeding.pair','breeding.cancel','hatching.create','hatching.updateProgress','hatching.complete','hatching.delete','sales.create','sales.return','sales.updateFollowUp','shares.create','shares.revoke'])

export class ApiError extends Error {
  constructor(code, message, status = 400, details) { super(message); this.code = code; this.status = status; this.details = details }
}
export function ensure(condition, code, message, status = 400, details) { if (!condition) throw new ApiError(code, message, status, details) }
export function text(value, field, max, required = true) { const result = String(value ?? '').trim(); if (required) ensure(result, 'VALIDATION_ERROR', `${field}不能为空`); ensure(result.length <= max, 'VALIDATION_ERROR', `${field}不能超过${max}个字符`); return result }
export function integer(value, field, min, max) { const result = Number(value); ensure(Number.isSafeInteger(result) && result >= min && result <= max, 'VALIDATION_ERROR', `${field}无效`); return result }
export function normalizeRing(value) { return String(value || '').trim().replace(/\s+/g, '').toUpperCase() }
export function dateOnly(value, field = '日期') { const result = String(value || ''); ensure(/^\d{4}-\d{2}-\d{2}$/.test(result), 'VALIDATION_ERROR', `${field}格式无效`); const [y,m,d] = result.split('-').map(Number); const parsed = new Date(Date.UTC(y,m-1,d)); ensure(parsed.getUTCFullYear() === y && parsed.getUTCMonth() === m-1 && parsed.getUTCDate() === d, 'VALIDATION_ERROR', `${field}格式无效`); return result }
export function nowIso() { return new Date().toISOString() }
export function id() { return crypto.randomUUID() }
export function json(value) { return JSON.stringify(value ?? null) }
export function parseJson(value, fallback = null) { try { return JSON.parse(value) } catch { return fallback } }
export function ageLabel(birthDate, now = new Date()) { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(birthDate || ''))) return '未知'; const [by,bm,bd] = birthDate.split('-').map(Number); const sh = new Date(now.getTime() + 28800000); const y=sh.getUTCFullYear(),m=sh.getUTCMonth()+1,d=sh.getUTCDate(); if (Date.UTC(by,bm-1,bd)>Date.UTC(y,m-1,d)) return '未知'; let months=(y-by)*12+m-bm-(d<bd?1:0); months=Math.max(0,months); if(months<24)return `${months} 个月`; const years=Math.floor(months/12),rest=months%12; return rest?`${years} 岁 ${rest} 个月`:`${years} 岁` }

function bytes(value) { return new TextEncoder().encode(value) }
function base64urlFromBytes(value) { let binary=''; for(const byte of new Uint8Array(value)) binary+=String.fromCharCode(byte); return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'') }
function bytesFromBase64url(value) { const padded=value.replace(/-/g,'+').replace(/_/g,'/')+'==='.slice((value.length+3)%4); const binary=atob(padded); return Uint8Array.from(binary,character=>character.charCodeAt(0)) }
export async function sha256(value) { return base64urlFromBytes(await crypto.subtle.digest('SHA-256',bytes(value))) }
export async function hmac(value, secret) { ensure(String(secret||'').length>=32,'CONFIGURATION_ERROR','服务密钥尚未配置',500); const key=await crypto.subtle.importKey('raw',bytes(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']); return base64urlFromBytes(await crypto.subtle.sign('HMAC',key,bytes(value))) }
export function constantTimeEqual(left,right){left=String(left||'');right=String(right||'');if(left.length!==right.length)return false;let difference=0;for(let index=0;index<left.length;index++)difference|=left.charCodeAt(index)^right.charCodeAt(index);return difference===0}
export async function signSession(openId, secret, ttlSeconds = 604800) { const payload=base64urlFromBytes(bytes(JSON.stringify({sub:openId,exp:Math.floor(Date.now()/1000)+ttlSeconds}))); return `${payload}.${await hmac(payload,secret)}` }
export async function verifySession(token, secret) { const [payload,signature]=String(token||'').split('.'); ensure(payload&&signature,'UNAUTHORIZED','登录已失效',401); ensure(constantTimeEqual(await hmac(payload,secret),signature),'UNAUTHORIZED','登录已失效',401); let data; try{data=JSON.parse(new TextDecoder().decode(bytesFromBase64url(payload)))}catch{throw new ApiError('UNAUTHORIZED','登录已失效',401)} ensure(data.exp>Math.floor(Date.now()/1000),'UNAUTHORIZED','登录已过期',401); return data.sub }
export async function deriveShareToken(owner, requestId, secret) { return hmac(`${owner}:${requestId}`,secret) }
export async function mediaSignature(assetId, expires, secret) { return hmac(`${assetId}:${expires}`,secret) }

export function apiResponse(data, status = 200, headers = {}) { return new Response(JSON.stringify({ok:true,data,serverTime:nowIso()}),{status,headers:{'content-type':'application/json; charset=utf-8',...headers}}) }
export function errorResponse(error, headers = {}) { const known=error instanceof ApiError; return new Response(JSON.stringify({ok:false,error:{code:known?error.code:'INTERNAL_ERROR',message:known?error.message:'服务暂时不可用',details:known?error.details:undefined},serverTime:nowIso()}),{status:known?error.status:500,headers:{'content-type':'application/json; charset=utf-8',...headers}}) }
