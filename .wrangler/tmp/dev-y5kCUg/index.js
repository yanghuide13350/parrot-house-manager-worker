var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/core.js
var STATUS = Object.freeze({ FOR_SALE: "FOR_SALE", SOLD: "SOLD", RETURNED: "RETURNED", BREEDER: "BREEDER", PAIRED: "PAIRED", INCUBATING: "INCUBATING" });
var WRITE_ACTIONS = /* @__PURE__ */ new Set(["parrots.create", "parrots.update", "parrots.delete", "parrots.setBreeder", "parrots.unsetBreeder", "breeding.pair", "breeding.cancel", "hatching.create", "hatching.updateProgress", "hatching.complete", "hatching.delete", "sales.create", "sales.return", "sales.updateFollowUp", "shares.create", "shares.revoke"]);
var ApiError = class extends Error {
  static {
    __name(this, "ApiError");
  }
  constructor(code, message, status = 400, details) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
};
function ensure(condition, code, message, status = 400, details) {
  if (!condition) throw new ApiError(code, message, status, details);
}
__name(ensure, "ensure");
function text(value, field, max, required = true) {
  const result = String(value ?? "").trim();
  if (required) ensure(result, "VALIDATION_ERROR", `${field}\u4E0D\u80FD\u4E3A\u7A7A`);
  ensure(result.length <= max, "VALIDATION_ERROR", `${field}\u4E0D\u80FD\u8D85\u8FC7${max}\u4E2A\u5B57\u7B26`);
  return result;
}
__name(text, "text");
function integer(value, field, min, max) {
  const result = Number(value);
  ensure(Number.isSafeInteger(result) && result >= min && result <= max, "VALIDATION_ERROR", `${field}\u65E0\u6548`);
  return result;
}
__name(integer, "integer");
function normalizeRing(value) {
  return String(value || "").trim().replace(/\s+/g, "").toUpperCase();
}
__name(normalizeRing, "normalizeRing");
function dateOnly(value, field = "\u65E5\u671F") {
  const result = String(value || "");
  ensure(/^\d{4}-\d{2}-\d{2}$/.test(result), "VALIDATION_ERROR", `${field}\u683C\u5F0F\u65E0\u6548`);
  const [y, m, d] = result.split("-").map(Number);
  const parsed = new Date(Date.UTC(y, m - 1, d));
  ensure(parsed.getUTCFullYear() === y && parsed.getUTCMonth() === m - 1 && parsed.getUTCDate() === d, "VALIDATION_ERROR", `${field}\u683C\u5F0F\u65E0\u6548`);
  return result;
}
__name(dateOnly, "dateOnly");
function nowIso() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
__name(nowIso, "nowIso");
function id() {
  return crypto.randomUUID();
}
__name(id, "id");
function json(value) {
  return JSON.stringify(value ?? null);
}
__name(json, "json");
function parseJson(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
__name(parseJson, "parseJson");
function ageLabel(birthDate, now = /* @__PURE__ */ new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(birthDate || ""))) return "\u672A\u77E5";
  const [by, bm, bd] = birthDate.split("-").map(Number);
  const sh = new Date(now.getTime() + 288e5);
  const y = sh.getUTCFullYear(), m = sh.getUTCMonth() + 1, d = sh.getUTCDate();
  if (Date.UTC(by, bm - 1, bd) > Date.UTC(y, m - 1, d)) return "\u672A\u77E5";
  let months = (y - by) * 12 + m - bm - (d < bd ? 1 : 0);
  months = Math.max(0, months);
  if (months < 24) return `${months} \u4E2A\u6708`;
  const years = Math.floor(months / 12), rest = months % 12;
  return rest ? `${years} \u5C81 ${rest} \u4E2A\u6708` : `${years} \u5C81`;
}
__name(ageLabel, "ageLabel");
function bytes(value) {
  return new TextEncoder().encode(value);
}
__name(bytes, "bytes");
function base64urlFromBytes(value) {
  let binary = "";
  for (const byte of new Uint8Array(value)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
__name(base64urlFromBytes, "base64urlFromBytes");
function bytesFromBase64url(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
__name(bytesFromBase64url, "bytesFromBase64url");
async function sha256(value) {
  return base64urlFromBytes(await crypto.subtle.digest("SHA-256", bytes(value)));
}
__name(sha256, "sha256");
async function hmac(value, secret) {
  ensure(String(secret || "").length >= 32, "CONFIGURATION_ERROR", "\u670D\u52A1\u5BC6\u94A5\u5C1A\u672A\u914D\u7F6E", 500);
  const key = await crypto.subtle.importKey("raw", bytes(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  return base64urlFromBytes(await crypto.subtle.sign("HMAC", key, bytes(value)));
}
__name(hmac, "hmac");
function constantTimeEqual(left, right) {
  left = String(left || "");
  right = String(right || "");
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}
__name(constantTimeEqual, "constantTimeEqual");
async function signSession(openId, secret, ttlSeconds = 604800) {
  const payload = base64urlFromBytes(bytes(JSON.stringify({ sub: openId, exp: Math.floor(Date.now() / 1e3) + ttlSeconds })));
  return `${payload}.${await hmac(payload, secret)}`;
}
__name(signSession, "signSession");
async function verifySession(token, secret) {
  const [payload, signature] = String(token || "").split(".");
  ensure(payload && signature, "UNAUTHORIZED", "\u767B\u5F55\u5DF2\u5931\u6548", 401);
  ensure(constantTimeEqual(await hmac(payload, secret), signature), "UNAUTHORIZED", "\u767B\u5F55\u5DF2\u5931\u6548", 401);
  let data;
  try {
    data = JSON.parse(new TextDecoder().decode(bytesFromBase64url(payload)));
  } catch {
    throw new ApiError("UNAUTHORIZED", "\u767B\u5F55\u5DF2\u5931\u6548", 401);
  }
  ensure(data.exp > Math.floor(Date.now() / 1e3), "UNAUTHORIZED", "\u767B\u5F55\u5DF2\u8FC7\u671F", 401);
  return data.sub;
}
__name(verifySession, "verifySession");
async function deriveShareToken(owner2, requestId, secret) {
  return hmac(`${owner2}:${requestId}`, secret);
}
__name(deriveShareToken, "deriveShareToken");
async function mediaSignature(assetId, expires, secret) {
  return hmac(`${assetId}:${expires}`, secret);
}
__name(mediaSignature, "mediaSignature");
function apiResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify({ ok: true, data, serverTime: nowIso() }), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });
}
__name(apiResponse, "apiResponse");
function errorResponse(error, headers = {}) {
  const known = error instanceof ApiError;
  return new Response(JSON.stringify({ ok: false, error: { code: known ? error.code : "INTERNAL_ERROR", message: known ? error.message : "\u670D\u52A1\u6682\u65F6\u4E0D\u53EF\u7528", details: known ? error.details : void 0 }, serverTime: nowIso() }), { status: known ? error.status : 500, headers: { "content-type": "application/json; charset=utf-8", ...headers } });
}
__name(errorResponse, "errorResponse");

// src/db.js
async function first(env, sql, ...values) {
  return env.DB.prepare(sql).bind(...values).first();
}
__name(first, "first");
async function all(env, sql, ...values) {
  return (await env.DB.prepare(sql).bind(...values).all()).results || [];
}
__name(all, "all");
function statement(env, sql, ...values) {
  return env.DB.prepare(sql).bind(...values);
}
__name(statement, "statement");
async function owned(env, table, idValue, owner2, includeDeleted = false) {
  const row = await first(env, `SELECT * FROM ${table} WHERE id = ? AND owner_open_id = ?${includeDeleted ? "" : " AND deleted_at IS NULL"}`, idValue, owner2);
  ensure(row, "NOT_FOUND", "\u8BB0\u5F55\u4E0D\u5B58\u5728", 404);
  return row;
}
__name(owned, "owned");
function revisionCheck(row, expected) {
  ensure(Number(row.revision) === Number(expected), "CONFLICT", "\u8BB0\u5F55\u5DF2\u88AB\u5176\u4ED6\u64CD\u4F5C\u66F4\u65B0\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5", 409, { currentRevision: row.revision });
}
__name(revisionCheck, "revisionCheck");
function auditStatement(env, owner2, action, targetType, targetId, requestId, before, after) {
  return statement(env, "INSERT INTO audit_logs (id,owner_open_id,action,target_type,target_id,request_id,before_json,after_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)", id(), owner2, action, targetType, targetId, requestId, json(before), json(after), nowIso());
}
__name(auditStatement, "auditStatement");
function rowMedia(row) {
  return parseJson(row && row.media_json, []);
}
__name(rowMedia, "rowMedia");
async function mediaItems(env, items, secret, baseUrl, _token) {
  const expiry = Math.floor(Date.now() / 864e5) * 86400 + 86400;
  return Promise.all((items || []).map(async (item) => {
    const url = item.key ? `${baseUrl}/api/media/${encodeURIComponent(item.assetId)}?expires=${expiry}&signature=${await mediaSignature(item.assetId, expiry, secret)}` : "";
    const thumbnailUrl = item.type === "image" ? url : "";
    return { assetId: item.assetId, type: item.type, fileID: url, url, thumbnailFileID: thumbnailUrl, posterFileID: "" };
  }));
}
__name(mediaItems, "mediaItems");
async function serializeParrot(env, row, secret, baseUrl, token) {
  const media = await mediaItems(env, rowMedia(row), secret, baseUrl, token);
  return { id: row.id, species: row.species, ringNumber: row.ring_number, gender: row.gender, status: row.status, birthDate: row.birth_date, ageLabel: ageLabel(row.birth_date), priceCents: row.price_cents, publicIntro: row.public_intro || "", privateNotes: row.private_notes || "", media, activePairId: row.active_pair_id, mate: null, pairedAt: row.paired_at, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at };
}
__name(serializeParrot, "serializeParrot");
function snapshot(row) {
  return { species: row.species, ringNumber: row.ring_number, gender: row.gender, birthDate: row.birth_date, media: rowMedia(row) };
}
__name(snapshot, "snapshot");

// src/r2.js
function bucket(env) {
  ensure(env.MEDIA_BUCKET, "CONFIGURATION_ERROR", "R2 \u5B58\u50A8\u6876\u5C1A\u672A\u914D\u7F6E", 500);
  return env.MEDIA_BUCKET;
}
__name(bucket, "bucket");
async function r2CreateMultipartUpload(env, key, mime) {
  return (await bucket(env).createMultipartUpload(key, { httpMetadata: { contentType: mime } })).uploadId;
}
__name(r2CreateMultipartUpload, "r2CreateMultipartUpload");
async function r2UploadPart(env, key, uploadId, partNumber, body2) {
  return (await bucket(env).resumeMultipartUpload(key, uploadId).uploadPart(partNumber, body2)).etag;
}
__name(r2UploadPart, "r2UploadPart");
async function r2CompleteMultipartUpload(env, key, uploadId, parts) {
  await bucket(env).resumeMultipartUpload(key, uploadId).complete(parts);
}
__name(r2CompleteMultipartUpload, "r2CompleteMultipartUpload");
async function r2AbortMultipartUpload(env, key, uploadId) {
  await bucket(env).resumeMultipartUpload(key, uploadId).abort();
}
__name(r2AbortMultipartUpload, "r2AbortMultipartUpload");
async function r2PutObject(env, key, body2, mime) {
  await bucket(env).put(key, body2, { httpMetadata: { contentType: mime } });
}
__name(r2PutObject, "r2PutObject");
async function r2DeleteObject(env, key) {
  await bucket(env).delete(key);
}
__name(r2DeleteObject, "r2DeleteObject");
function rangeBounds(range, size) {
  if (range.offset != null) return { offset: range.offset, length: range.length == null ? size - range.offset : range.length };
  const length = Math.min(range.suffix || size, size);
  return { offset: size - length, length };
}
__name(rangeBounds, "rangeBounds");
async function r2GetObject(env, key, range = "") {
  const object = await bucket(env).get(key, range ? { range: new Headers({ range }) } : void 0);
  if (!object) throw new ApiError("NOT_FOUND", "\u5A92\u4F53\u6587\u4EF6\u4E0D\u5B58\u5728", 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("last-modified", object.uploaded.toUTCString());
  if (object.range) {
    const { offset, length } = rangeBounds(object.range, object.size);
    headers.set("content-length", String(length));
    headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
    return { body: object.body, headers, status: 206 };
  }
  headers.set("content-length", String(object.size));
  return { body: object.body, headers, status: 200 };
}
__name(r2GetObject, "r2GetObject");

// src/service.js
var GENDERS = /* @__PURE__ */ new Set(["MALE", "FEMALE", "UNKNOWN"]);
var FOLLOW_UP = /* @__PURE__ */ new Set(["WAITING", "VISITED", "UNREACHABLE"]);
function validateParrot(input, partial = false) {
  const result = {};
  const has = /* @__PURE__ */ __name((key) => Object.prototype.hasOwnProperty.call(input || {}, key), "has");
  if (!partial || has("species")) result.species = text(input.species, "\u54C1\u79CD", 60);
  if (!partial || has("ringNumber")) {
    result.ringNumber = text(input.ringNumber, "\u5708\u53F7", 40);
    result.ringNumberNormalized = normalizeRing(result.ringNumber);
    ensure(result.ringNumberNormalized, "VALIDATION_ERROR", "\u5708\u53F7\u65E0\u6548");
  }
  if (!partial || has("gender")) {
    ensure(GENDERS.has(input.gender), "VALIDATION_ERROR", "\u6027\u522B\u65E0\u6548");
    result.gender = input.gender;
  }
  if (!partial || has("birthDate")) {
    result.birthDate = dateOnly(input.birthDate, "\u51FA\u751F\u65E5\u671F");
    const sh = new Date(Date.now() + 288e5);
    const today = `${sh.getUTCFullYear()}-${String(sh.getUTCMonth() + 1).padStart(2, "0")}-${String(sh.getUTCDate()).padStart(2, "0")}`;
    ensure(result.birthDate <= today, "VALIDATION_ERROR", "\u51FA\u751F\u65E5\u671F\u4E0D\u80FD\u665A\u4E8E\u4ECA\u5929");
  }
  if (!partial || has("priceCents")) result.priceCents = integer(input.priceCents, "\u4EF7\u683C", 0, 99999999900);
  if (!partial || has("publicIntro")) result.publicIntro = text(input.publicIntro, "\u516C\u5F00\u4ECB\u7ECD", 1e3, false);
  if (!partial || has("privateNotes")) result.privateNotes = text(input.privateNotes, "\u5185\u90E8\u5907\u6CE8", 3e3, false);
  if (!partial || has("media")) {
    ensure(Array.isArray(input.media) && input.media.length <= 20, "VALIDATION_ERROR", "\u5A92\u4F53\u6570\u91CF\u65E0\u6548");
    result.media = input.media.map((item) => ({ assetId: text(item.assetId, "\u5A92\u4F53\u6807\u8BC6", 80), type: item.type }));
  }
  return result;
}
__name(validateParrot, "validateParrot");
async function validateMedia(env, owner2, items) {
  const output = [];
  const seen = /* @__PURE__ */ new Set();
  for (const item of items || []) {
    ensure(["image", "video"].includes(item.type), "VALIDATION_ERROR", "\u5A92\u4F53\u7C7B\u578B\u65E0\u6548");
    ensure(!seen.has(item.assetId), "VALIDATION_ERROR", "\u5A92\u4F53\u4E0D\u80FD\u91CD\u590D");
    seen.add(item.assetId);
    const asset = await first(env, "SELECT * FROM media_assets WHERE id=? AND owner_open_id=? AND status=? AND deleted_at IS NULL", item.assetId, owner2, "COMMITTED");
    ensure(asset && asset.type === item.type, "VALIDATION_ERROR", "\u5A92\u4F53\u5C1A\u672A\u5B8C\u6210\u4E0A\u4F20");
    output.push({ assetId: asset.id, type: asset.type, key: asset.object_key });
  }
  return output;
}
__name(validateMedia, "validateMedia");
async function receipt(env, owner2, requestId) {
  return first(env, "SELECT * FROM command_receipts WHERE receipt_id=?", await sha256(`${owner2}:${requestId}`));
}
__name(receipt, "receipt");
function receiptResult(row) {
  return parseJson(row.result_json, {});
}
__name(receiptResult, "receiptResult");
async function saveBatch(env, owner2, action, requestId, statements, result) {
  const receiptId = await sha256(`${owner2}:${requestId}`);
  statements.push(statement(env, "INSERT INTO command_receipts (receipt_id,owner_open_id,request_id,action,result_json,created_at) VALUES (?,?,?,?,?,?)", receiptId, owner2, requestId, action, json(action === "shares.create" ? { parrotId: result.parrotId, expiresAt: result.expiresAt } : result), nowIso()));
  try {
    await env.DB.batch(statements);
  } catch (error) {
    const message = String(error && error.message || "");
    if (["parrots.create", "parrots.update"].includes(action) && /unique|parrots_owner_ring/i.test(message)) throw new ApiError("DUPLICATE_RING", "\u5708\u53F7\u5DF2\u5B58\u5728", 409);
    throw error;
  }
  return result;
}
__name(saveBatch, "saveBatch");
async function executeCommand(env, owner2, action, input, requestId) {
  ensure(WRITE_ACTIONS.has(action), "NOT_FOUND", "\u63A5\u53E3\u4E0D\u5B58\u5728", 404);
  text(requestId, "requestId", 100);
  const existing = await receipt(env, owner2, requestId);
  if (existing) {
    ensure(existing.action === action, "CONFLICT", "\u8BF7\u6C42\u53F7\u5DF2\u7528\u4E8E\u5176\u4ED6\u64CD\u4F5C", 409);
    const stored = receiptResult(existing);
    if (action === "shares.create") return { ...stored, token: await deriveShareToken(owner2, requestId, env.SHARE_TOKEN_SECRET) };
    return stored;
  }
  const result = await commandHandlers[action](env, owner2, input || {}, requestId);
  const data = await saveBatch(env, owner2, action, requestId, result.statements, result.data);
  await purgeReleasedMedia(env, owner2, result.releasedAssetIds);
  return data;
}
__name(executeCommand, "executeCommand");
function mediaIds(items) {
  return [...new Set((items || []).map((item) => item && item.assetId).filter(Boolean))];
}
__name(mediaIds, "mediaIds");
function removedMediaIds(before, after) {
  const next = new Set(mediaIds(after));
  return mediaIds(before).filter((assetId) => !next.has(assetId));
}
__name(removedMediaIds, "removedMediaIds");
async function purgeReleasedMedia(env, owner2, assetIds = []) {
  for (const assetId of new Set(assetIds)) {
    const asset = await first(env, "SELECT * FROM media_assets WHERE id=? AND owner_open_id=?", assetId, owner2);
    if (!asset) continue;
    const referenced = await first(env, "SELECT 1 AS found FROM parrots,json_each(parrots.media_json) WHERE parrots.owner_open_id=? AND json_extract(json_each.value,'$.assetId')=? UNION ALL SELECT 1 AS found FROM sales_records,json_each(sales_records.media_json) WHERE sales_records.owner_open_id=? AND json_extract(json_each.value,'$.assetId')=? LIMIT 1", owner2, assetId, owner2, assetId);
    if (referenced) continue;
    try {
      if (asset.status === "PENDING" && asset.upload_id) await r2AbortMultipartUpload(env, asset.object_key, asset.upload_id);
      else await r2DeleteObject(env, asset.object_key);
      await env.DB.prepare("DELETE FROM media_assets WHERE id=? AND owner_open_id=?").bind(assetId, owner2).run();
    } catch (error) {
      console.error("[media purge]", assetId, error);
    }
  }
}
__name(purgeReleasedMedia, "purgeReleasedMedia");
async function simpleStatus(env, owner2, input, requestId, from, to, action) {
  const bird = await owned(env, "parrots", text(input.id, "id", 80), owner2);
  revisionCheck(bird, input.revision);
  ensure(bird.status === from, "INVALID_STATE", "\u5F53\u524D\u72B6\u6001\u4E0D\u5141\u8BB8\u6267\u884C\u8BE5\u64CD\u4F5C");
  const now = nowIso(), next = { ...bird, status: to, revision: bird.revision + 1, updated_at: now };
  return { data: { id: bird.id, revision: next.revision }, statements: [statement(env, "UPDATE parrots SET status=?,revision=?,updated_at=? WHERE id=?", to, next.revision, now, bird.id), auditStatement(env, owner2, action, "parrot", bird.id, requestId, bird, next)] };
}
__name(simpleStatus, "simpleStatus");
async function closePair(env, owner2, pair, reason, requestId, now) {
  const male = await owned(env, "parrots", pair.male_id, owner2), female = await owned(env, "parrots", pair.female_id, owner2);
  return [statement(env, "UPDATE breeding_pairs SET status=?,ended_at=?,end_reason=?,revision=revision+1,updated_at=? WHERE id=?", "CLOSED", now, reason, now, pair.id), statement(env, "UPDATE parrots SET status=?,active_pair_id=NULL,paired_at=NULL,revision=revision+1,updated_at=? WHERE id IN (?,?)", STATUS.BREEDER, now, male.id, female.id), auditStatement(env, owner2, `breeding.${reason.toLowerCase()}`, "breedingPair", pair.id, requestId, pair, { status: "CLOSED", endReason: reason })];
}
__name(closePair, "closePair");
var commandHandlers = {
  "parrots.create": /* @__PURE__ */ __name(async (env, owner2, input, requestId) => {
    const value = validateParrot(input), media = await validateMedia(env, owner2, value.media), now = nowIso(), birdId = id();
    const data = { id: birdId, owner_open_id: owner2, species: value.species, ring_number: value.ringNumber, ring_number_normalized: value.ringNumberNormalized, gender: value.gender, status: STATUS.FOR_SALE, birth_date: value.birthDate, price_cents: value.priceCents, public_intro: value.publicIntro, private_notes: value.privateNotes, media_json: json(media), active_pair_id: null, paired_at: null, revision: 1, created_at: now, updated_at: now, deleted_at: null, deleted_by: null };
    return { data: { id: birdId, revision: 1 }, statements: [statement(env, "INSERT INTO parrots (id,owner_open_id,species,ring_number,ring_number_normalized,gender,status,birth_date,price_cents,public_intro,private_notes,media_json,active_pair_id,paired_at,revision,created_at,updated_at,deleted_at,deleted_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", ...Object.values(data)), auditStatement(env, owner2, "parrots.create", "parrot", birdId, requestId, null, data)] };
  }, "parrots.create"),
  "parrots.update": /* @__PURE__ */ __name(async (env, owner2, input, requestId) => {
    const bird = await owned(env, "parrots", text(input.id, "id", 80), owner2);
    revisionCheck(bird, input.revision);
    const value = validateParrot(input.updates || {}, true);
    ensure(Object.keys(value).length, "VALIDATION_ERROR", "\u6CA1\u6709\u53EF\u66F4\u65B0\u7684\u5B57\u6BB5");
    if (value.gender && value.gender !== bird.gender && bird.active_pair_id) throw new ApiError("INVALID_STATE", "\u6D3B\u52A8\u914D\u5BF9\u671F\u95F4\u4E0D\u80FD\u4FEE\u6539\u6027\u522B");
    const media = value.media ? await validateMedia(env, owner2, value.media) : rowMedia(bird);
    const next = { ...bird, species: value.species ?? bird.species, ring_number: value.ringNumber ?? bird.ring_number, ring_number_normalized: value.ringNumberNormalized ?? bird.ring_number_normalized, gender: value.gender ?? bird.gender, birth_date: value.birthDate ?? bird.birth_date, price_cents: value.priceCents ?? bird.price_cents, public_intro: value.publicIntro ?? bird.public_intro, private_notes: value.privateNotes ?? bird.private_notes, media_json: json(media), revision: bird.revision + 1, updated_at: nowIso() };
    return { data: { id: bird.id, revision: next.revision }, releasedAssetIds: value.media ? removedMediaIds(rowMedia(bird), media) : [], statements: [statement(env, "UPDATE parrots SET species=?,ring_number=?,ring_number_normalized=?,gender=?,birth_date=?,price_cents=?,public_intro=?,private_notes=?,media_json=?,revision=?,updated_at=? WHERE id=?", next.species, next.ring_number, next.ring_number_normalized, next.gender, next.birth_date, next.price_cents, next.public_intro, next.private_notes, next.media_json, next.revision, next.updated_at, bird.id), auditStatement(env, owner2, "parrots.update", "parrot", bird.id, requestId, bird, next)] };
  }, "parrots.update"),
  "parrots.delete": /* @__PURE__ */ __name(async (env, owner2, input, requestId) => {
    const bird = await owned(env, "parrots", text(input.id, "id", 80), owner2);
    revisionCheck(bird, input.revision);
    ensure(!bird.active_pair_id, "INVALID_STATE", "\u8BF7\u5148\u7ED3\u675F\u5F53\u524D\u914D\u5BF9\u6216\u5B75\u5316\u4EFB\u52A1");
    const sales = await all(env, "SELECT media_json FROM sales_records WHERE owner_open_id=? AND parrot_id=?", owner2, bird.id), releasedAssetIds = [...mediaIds(rowMedia(bird)), ...sales.flatMap((row) => mediaIds(rowMedia(row)))], statements = [statement(env, "DELETE FROM share_tokens WHERE owner_open_id=? AND parrot_id=?", owner2, bird.id), statement(env, "DELETE FROM hatching_records WHERE owner_open_id=? AND (male_id=? OR female_id=?)", owner2, bird.id, bird.id), statement(env, "DELETE FROM breeding_pairs WHERE owner_open_id=? AND (male_id=? OR female_id=?)", owner2, bird.id, bird.id), statement(env, "DELETE FROM sales_records WHERE owner_open_id=? AND parrot_id=?", owner2, bird.id), statement(env, "DELETE FROM parrots WHERE id=? AND owner_open_id=?", bird.id, owner2), auditStatement(env, owner2, "parrots.delete", "parrot", bird.id, requestId, bird, { deleted: true })];
    return { data: { id: bird.id, deleted: true }, releasedAssetIds, statements };
  }, "parrots.delete"),
  "parrots.setBreeder": /* @__PURE__ */ __name((env, owner2, input, requestId) => simpleStatus(env, owner2, input, requestId, STATUS.FOR_SALE, STATUS.BREEDER, "parrots.setBreeder"), "parrots.setBreeder"),
  "parrots.unsetBreeder": /* @__PURE__ */ __name((env, owner2, input, requestId) => simpleStatus(env, owner2, input, requestId, STATUS.BREEDER, STATUS.FOR_SALE, "parrots.unsetBreeder"), "parrots.unsetBreeder"),
  "breeding.pair": /* @__PURE__ */ __name(async (env, owner2, input, requestId) => {
    const male = await owned(env, "parrots", text(input.maleId, "maleId", 80), owner2), female = await owned(env, "parrots", text(input.femaleId, "femaleId", 80), owner2);
    revisionCheck(male, input.maleRevision);
    revisionCheck(female, input.femaleRevision);
    ensure(male.gender === "MALE" && female.gender === "FEMALE", "INVALID_STATE", "\u53EA\u80FD\u9009\u62E9\u516C\u9E1F\u548C\u6BCD\u9E1F\u914D\u5BF9");
    ensure(male.status === STATUS.BREEDER && female.status === STATUS.BREEDER, "INVALID_STATE", "\u53EA\u6709\u79CD\u9E1F\u53EF\u4EE5\u914D\u5BF9");
    const pairId = id(), now = nowIso(), pair = { id: pairId, owner_open_id: owner2, male_id: male.id, female_id: female.id, status: "ACTIVE", paired_at: now, ended_at: null, end_reason: null, revision: 1, created_at: now, updated_at: now, deleted_at: null };
    return { data: { id: pairId, revision: 1 }, statements: [statement(env, "INSERT INTO breeding_pairs (id,owner_open_id,male_id,female_id,status,paired_at,ended_at,end_reason,revision,created_at,updated_at,deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", ...Object.values(pair)), statement(env, "UPDATE parrots SET status=?,active_pair_id=?,paired_at=?,revision=revision+1,updated_at=? WHERE id IN (?,?)", STATUS.PAIRED, pairId, now, now, male.id, female.id), auditStatement(env, owner2, "breeding.pair", "breedingPair", pairId, requestId, null, pair)] };
  }, "breeding.pair"),
  "breeding.cancel": /* @__PURE__ */ __name(async (env, owner2, input, requestId) => {
    const pair = await owned(env, "breeding_pairs", text(input.pairId, "pairId", 80), owner2);
    revisionCheck(pair, input.revision);
    ensure(pair.status === "ACTIVE", "INVALID_STATE", "\u5B75\u5316\u4E2D\u7684\u914D\u5BF9\u4E0D\u80FD\u76F4\u63A5\u62C6\u9664");
    const now = nowIso();
    return { data: { id: pair.id, status: "CLOSED", revision: pair.revision + 1 }, statements: await closePair(env, owner2, pair, "CANCELLED", requestId, now) };
  }, "breeding.cancel"),
  "hatching.create": /* @__PURE__ */ __name(async (env, owner2, input, requestId) => createHatching(env, owner2, input, requestId), "hatching.create"),
  "hatching.updateProgress": /* @__PURE__ */ __name(async (env, owner2, input, requestId) => {
    const record = await owned(env, "hatching_records", text(input.id, "id", 80), owner2);
    revisionCheck(record, input.revision);
    ensure(record.status === "INCUBATING", "INVALID_STATE", "\u53EA\u80FD\u66F4\u65B0\u8FDB\u884C\u4E2D\u7684\u5B75\u5316\u4EFB\u52A1");
    const hatched = integer(input.hatched, "\u51FA\u58F3\u6570\u91CF", 0, record.eggs), now = nowIso(), next = { ...record, hatched, revision: record.revision + 1, updated_at: now };
    return { data: { id: record.id, revision: next.revision }, statements: [statement(env, "UPDATE hatching_records SET hatched=?,revision=?,updated_at=? WHERE id=?", hatched, next.revision, now, record.id), auditStatement(env, owner2, "hatching.updateProgress", "hatchingRecord", record.id, requestId, record, next)] };
  }, "hatching.updateProgress"),
  "hatching.complete": /* @__PURE__ */ __name(async (env, owner2, input, requestId) => finishHatching(env, owner2, input, requestId, false), "hatching.complete"),
  "hatching.delete": /* @__PURE__ */ __name(async (env, owner2, input, requestId) => finishHatching(env, owner2, input, requestId, true), "hatching.delete"),
  "sales.create": /* @__PURE__ */ __name(async (env, owner2, input, requestId) => {
    const bird = await owned(env, "parrots", text(input.parrotId, "parrotId", 80), owner2);
    revisionCheck(bird, input.parrotRevision);
    ensure(bird.status === STATUS.FOR_SALE, "INVALID_STATE", "\u53EA\u6709\u5F85\u552E\u6863\u6848\u53EF\u4EE5\u786E\u8BA4\u552E\u51FA");
    const buyer = text(input.buyer, "\u4E70\u5BB6\u59D3\u540D", 100), contact = text(input.buyerContact, "\u8054\u7CFB\u65B9\u5F0F", 200, false), saleDate = dateOnly(input.saleDate, "\u6210\u4EA4\u65E5\u671F"), price = integer(input.priceCents, "\u6210\u4EA4\u91D1\u989D", 0, 99999999900), saleId = id(), now = nowIso(), snap = snapshot(bird), sale = { id: saleId, owner_open_id: owner2, parrot_id: bird.id, species: snap.species, ring_number: snap.ringNumber, gender: snap.gender, birth_date: snap.birthDate, media_json: json(snap.media), buyer, buyer_contact: contact, sale_date: saleDate, price_cents: price, status: "COMPLETED", return_reason: "", returned_at: null, follow_up_status: "WAITING", revision: 1, created_at: now, updated_at: now, deleted_at: null };
    return { data: { id: saleId, revision: 1 }, statements: [statement(env, "INSERT INTO sales_records (id,owner_open_id,parrot_id,species,ring_number,gender,birth_date,media_json,buyer,buyer_contact,sale_date,price_cents,status,return_reason,returned_at,follow_up_status,revision,created_at,updated_at,deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", ...Object.values(sale)), statement(env, "UPDATE parrots SET status=?,revision=revision+1,updated_at=? WHERE id=?", STATUS.SOLD, now, bird.id), auditStatement(env, owner2, "sales.create", "saleRecord", saleId, requestId, null, sale)] };
  }, "sales.create"),
  "sales.return": /* @__PURE__ */ __name(async (env, owner2, input, requestId) => {
    const sale = await owned(env, "sales_records", text(input.id, "id", 80), owner2);
    revisionCheck(sale, input.revision);
    ensure(sale.status === "COMPLETED", "INVALID_STATE", "\u8BE5\u4EA4\u6613\u4E0D\u80FD\u91CD\u590D\u9000\u8D27");
    const bird = await owned(env, "parrots", sale.parrot_id, owner2);
    ensure(bird.status === STATUS.SOLD, "INVALID_STATE", "\u9E66\u9E49\u72B6\u6001\u4E0E\u9500\u552E\u8BB0\u5F55\u4E0D\u4E00\u81F4");
    const reason = text(input.reason, "\u9000\u8D27\u539F\u56E0", 500), now = nowIso(), next = { ...sale, status: "RETURNED", return_reason: reason, returned_at: now, revision: sale.revision + 1, updated_at: now };
    return { data: { id: sale.id, revision: next.revision }, statements: [statement(env, "UPDATE sales_records SET status=?,return_reason=?,returned_at=?,revision=?,updated_at=? WHERE id=?", "RETURNED", reason, now, next.revision, now, sale.id), statement(env, "UPDATE parrots SET status=?,revision=revision+1,updated_at=? WHERE id=?", STATUS.RETURNED, now, bird.id), auditStatement(env, owner2, "sales.return", "saleRecord", sale.id, requestId, sale, next)] };
  }, "sales.return"),
  "sales.updateFollowUp": /* @__PURE__ */ __name(async (env, owner2, input, requestId) => {
    const sale = await owned(env, "sales_records", text(input.id, "id", 80), owner2);
    revisionCheck(sale, input.revision);
    ensure(FOLLOW_UP.has(input.status), "VALIDATION_ERROR", "\u56DE\u8BBF\u72B6\u6001\u65E0\u6548");
    const now = nowIso(), next = { ...sale, follow_up_status: input.status, revision: sale.revision + 1, updated_at: now };
    return { data: { id: sale.id, revision: next.revision }, statements: [statement(env, "UPDATE sales_records SET follow_up_status=?,revision=?,updated_at=? WHERE id=?", input.status, next.revision, now, sale.id), auditStatement(env, owner2, "sales.updateFollowUp", "saleRecord", sale.id, requestId, sale, next)] };
  }, "sales.updateFollowUp"),
  "shares.create": /* @__PURE__ */ __name(async (env, owner2, input, requestId) => {
    const bird = await owned(env, "parrots", text(input.parrotId, "parrotId", 80), owner2), token = await deriveShareToken(owner2, requestId, env.SHARE_TOKEN_SECRET), tokenHash = await sha256(token), now = nowIso(), expiresAt = new Date(Date.now() + 6048e5).toISOString();
    const share = { token_hash: tokenHash, owner_open_id: owner2, parrot_id: bird.id, expires_at: expiresAt, revoked_at: null, revision: 1, created_at: now, updated_at: now, deleted_at: null };
    return { data: { token, parrotId: bird.id, expiresAt }, statements: [statement(env, "INSERT INTO share_tokens (token_hash,owner_open_id,parrot_id,expires_at,revoked_at,revision,created_at,updated_at,deleted_at) VALUES (?,?,?,?,?,?,?,?,?)", ...Object.values(share)), auditStatement(env, owner2, "shares.create", "shareToken", tokenHash, requestId, null, { ...share, token_hash: "[HASHED]" })] };
  }, "shares.create"),
  "shares.revoke": /* @__PURE__ */ __name(async (env, owner2, input, requestId) => {
    const tokenHash = input.token ? await sha256(text(input.token, "token", 200)) : text(input.id, "id", 100);
    const share = await first(env, "SELECT * FROM share_tokens WHERE token_hash=? AND owner_open_id=?", tokenHash, owner2);
    ensure(share, "NOT_FOUND", "\u5206\u4EAB\u4E0D\u5B58\u5728", 404);
    return { data: { id: tokenHash, revoked: true }, statements: [statement(env, "DELETE FROM share_tokens WHERE token_hash=? AND owner_open_id=?", tokenHash, owner2), auditStatement(env, owner2, "shares.revoke", "shareToken", tokenHash, requestId, share, { deleted: true })] };
  }, "shares.revoke")
};
async function createHatching(env, owner2, input, requestId) {
  const male = await owned(env, "parrots", text(input.maleId, "maleId", 80), owner2), female = await owned(env, "parrots", text(input.femaleId, "femaleId", 80), owner2);
  revisionCheck(male, input.maleRevision);
  revisionCheck(female, input.femaleRevision);
  ensure(male.gender === "MALE" && female.gender === "FEMALE", "INVALID_STATE", "\u5B75\u5316\u7236\u6BCD\u5FC5\u987B\u4E3A\u516C\u9E1F\u548C\u6BCD\u9E1F");
  const breeders = male.status === STATUS.BREEDER && female.status === STATUS.BREEDER, paired = male.status === STATUS.PAIRED && female.status === STATUS.PAIRED && male.active_pair_id && male.active_pair_id === female.active_pair_id;
  ensure(breeders || paired, "INVALID_STATE", "\u7236\u6BCD\u9E1F\u72B6\u6001\u4E0D\u5141\u8BB8\u542F\u52A8\u5B75\u5316");
  const duplicate = await first(env, "SELECT id FROM hatching_records WHERE owner_open_id=? AND male_id=? AND female_id=? AND status=? AND deleted_at IS NULL", owner2, male.id, female.id, "INCUBATING");
  ensure(!duplicate, "INVALID_STATE", "\u8BE5\u7EC4\u5408\u5DF2\u6709\u8FDB\u884C\u4E2D\u7684\u5B75\u5316\u4EFB\u52A1");
  const now = nowIso(), statements = [];
  let pairId, pairRevision = 1, pairedAt = now;
  if (paired) {
    const pair = await owned(env, "breeding_pairs", male.active_pair_id, owner2);
    ensure(pair.status === "ACTIVE", "INVALID_STATE", "\u914D\u5BF9\u72B6\u6001\u5F02\u5E38");
    if (input.pairRevision != null) revisionCheck(pair, input.pairRevision);
    pairId = pair.id;
    pairRevision = pair.revision + 1;
    pairedAt = pair.paired_at;
    statements.push(statement(env, "UPDATE breeding_pairs SET status=?,revision=?,updated_at=? WHERE id=?", "INCUBATING", pairRevision, now, pairId));
  } else {
    pairId = id();
    statements.push(statement(env, "INSERT INTO breeding_pairs (id,owner_open_id,male_id,female_id,status,paired_at,ended_at,end_reason,revision,created_at,updated_at,deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", pairId, owner2, male.id, female.id, "INCUBATING", now, null, null, 1, now, now, null));
  }
  const recordId = id(), eggs = integer(input.eggs, "\u86CB\u6570\u91CF", 1, 100), species = text(input.species, "\u54C1\u79CD", 60), startDate = dateOnly(input.startDate, "\u5F00\u59CB\u65E5\u671F"), record = { id: recordId, owner_open_id: owner2, pair_id: pairId, male_id: male.id, female_id: female.id, male_ring_number: male.ring_number, female_ring_number: female.ring_number, species, start_date: startDate, eggs, hatched: 0, status: "INCUBATING", completed_at: null, revision: 1, created_at: now, updated_at: now, deleted_at: null, deleted_by: null };
  statements.push(statement(env, "INSERT INTO hatching_records (id,owner_open_id,pair_id,male_id,female_id,male_ring_number,female_ring_number,species,start_date,eggs,hatched,status,completed_at,revision,created_at,updated_at,deleted_at,deleted_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", ...Object.values(record)));
  statements.push(statement(env, "UPDATE parrots SET status=?,active_pair_id=?,paired_at=?,revision=revision+1,updated_at=? WHERE id IN (?,?)", STATUS.INCUBATING, pairId, pairedAt, now, male.id, female.id));
  statements.push(auditStatement(env, owner2, "hatching.create", "hatchingRecord", recordId, requestId, null, record));
  return { data: { id: recordId, revision: 1 }, statements };
}
__name(createHatching, "createHatching");
async function finishHatching(env, owner2, input, requestId, deleting) {
  const record = await owned(env, "hatching_records", text(input.id, "id", 80), owner2);
  revisionCheck(record, input.revision);
  const now = nowIso(), statements = [];
  if (record.status === "INCUBATING") {
    const pair = await owned(env, "breeding_pairs", record.pair_id, owner2);
    ensure(pair.status === "INCUBATING", "INVALID_STATE", "\u914D\u5BF9\u72B6\u6001\u4E0E\u5B75\u5316\u4EFB\u52A1\u4E0D\u4E00\u81F4");
    statements.push(...await closePair(env, owner2, pair, deleting ? "HATCHING_CANCELLED" : "HATCHING_COMPLETED", requestId, now));
  } else if (!deleting) throw new ApiError("INVALID_STATE", "\u5B75\u5316\u4EFB\u52A1\u5DF2\u7ECF\u5B8C\u6210");
  if (deleting) {
    statements.push(statement(env, "DELETE FROM hatching_records WHERE id=? AND owner_open_id=?", record.id, owner2), auditStatement(env, owner2, "hatching.delete", "hatchingRecord", record.id, requestId, record, { deleted: true }));
    return { data: { id: record.id, deleted: true }, statements };
  }
  const next = { ...record, status: "COMPLETED", completed_at: now, revision: record.revision + 1, updated_at: now };
  statements.push(statement(env, "UPDATE hatching_records SET status=?,completed_at=?,revision=?,updated_at=? WHERE id=?", "COMPLETED", now, next.revision, now, record.id));
  statements.push(auditStatement(env, owner2, "hatching.complete", "hatchingRecord", record.id, requestId, record, next));
  return { data: { id: record.id, revision: next.revision }, statements };
}
__name(finishHatching, "finishHatching");
async function executeRead(env, owner2, action, input, baseUrl, sessionToken) {
  if (action === "parrots.list") {
    const rows = await all(env, "SELECT * FROM parrots WHERE owner_open_id=? AND deleted_at IS NULL ORDER BY created_at DESC", owner2);
    return { items: await Promise.all(rows.map((row) => serializeParrot(env, row, env.MEDIA_SIGNING_SECRET, baseUrl, sessionToken))), nextCursor: null };
  }
  if (action === "parrots.get") {
    return serializeParrot(env, await owned(env, "parrots", text(input.id, "id", 80), owner2), env.MEDIA_SIGNING_SECRET, baseUrl, sessionToken);
  }
  if (action === "breeding.listActive") {
    const pairs = await all(env, "SELECT * FROM breeding_pairs WHERE owner_open_id=? AND deleted_at IS NULL AND status IN ('ACTIVE','INCUBATING') ORDER BY paired_at DESC", owner2), result = [];
    for (const pair of pairs) {
      const male = await owned(env, "parrots", pair.male_id, owner2), female = await owned(env, "parrots", pair.female_id, owner2);
      result.push({ id: pair.id, maleId: pair.male_id, femaleId: pair.female_id, status: pair.status, pairedAt: pair.paired_at, revision: pair.revision, createdAt: pair.created_at, updatedAt: pair.updated_at, male: await serializeParrot(env, male, env.MEDIA_SIGNING_SECRET, baseUrl, sessionToken), female: await serializeParrot(env, female, env.MEDIA_SIGNING_SECRET, baseUrl, sessionToken) });
    }
    return result;
  }
  if (action === "hatching.list") {
    const rows = await all(env, "SELECT * FROM hatching_records WHERE owner_open_id=? AND deleted_at IS NULL ORDER BY start_date DESC,created_at DESC", owner2);
    return { items: rows.map((row) => ({ id: row.id, pairId: row.pair_id, maleId: row.male_id, femaleId: row.female_id, maleSnapshot: { ringNumber: row.male_ring_number }, femaleSnapshot: { ringNumber: row.female_ring_number }, species: row.species, startDate: row.start_date, eggs: row.eggs, hatched: row.hatched, status: row.status, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at })), nextCursor: null };
  }
  if (action === "sales.list") {
    const rows = await all(env, "SELECT * FROM sales_records WHERE owner_open_id=? AND deleted_at IS NULL ORDER BY sale_date DESC,created_at DESC", owner2), items = [];
    for (const row of rows) {
      items.push({ id: row.id, parrotId: row.parrot_id, parrotSnapshot: { species: row.species, ringNumber: row.ring_number, gender: row.gender, birthDate: row.birth_date, media: await mediaItems(env, parseJson(row.media_json, []), env.MEDIA_SIGNING_SECRET, baseUrl, sessionToken) }, buyer: row.buyer, buyerContact: row.buyer_contact, saleDate: row.sale_date, priceCents: row.price_cents, status: row.status, returnReason: row.return_reason, followUpStatus: row.follow_up_status, revision: row.revision, createdAt: row.created_at });
    }
    return { items, nextCursor: null };
  }
  if (action === "shares.list") return await all(env, "SELECT token_hash AS id,parrot_id AS parrotId,expires_at AS expiresAt,revoked_at AS revokedAt,created_at AS createdAt FROM share_tokens WHERE owner_open_id=? AND deleted_at IS NULL ORDER BY created_at DESC", owner2);
  if (action === "dashboard.get") return dashboard(env, owner2);
  throw new ApiError("NOT_FOUND", "\u63A5\u53E3\u4E0D\u5B58\u5728", 404);
}
__name(executeRead, "executeRead");
async function dashboard(env, owner2) {
  const parrots = await all(env, "SELECT status,species FROM parrots WHERE owner_open_id=? AND deleted_at IS NULL", owner2), sales = await all(env, "SELECT status,price_cents,sale_date FROM sales_records WHERE owner_open_id=? AND deleted_at IS NULL", owner2), stats = { total: parrots.length, forSale: 0, sold: 0, returned: 0, breeder: 0, paired: 0, incubating: 0, revenueCents: 0, salesTotal: sales.length, returnRate: 0 };
  const keys = { FOR_SALE: "forSale", SOLD: "sold", RETURNED: "returned", BREEDER: "breeder", PAIRED: "paired", INCUBATING: "incubating" };
  parrots.forEach((item) => {
    if (keys[item.status]) stats[keys[item.status]]++;
  });
  const valid = sales.filter((item) => item.status === "COMPLETED");
  stats.revenueCents = valid.reduce((sum, item) => sum + item.price_cents, 0);
  stats.returnRate = sales.length ? Math.round(sales.filter((item) => item.status === "RETURNED").length / sales.length * 100) : 0;
  const mix = {};
  parrots.forEach((item) => mix[item.species] = (mix[item.species] || 0) + 1);
  const species = Object.entries(mix).map(([name, count]) => ({ name, count, percent: parrots.length ? Math.round(count / parrots.length * 100) : 0 })).sort((a, b) => b.count - a.count).slice(0, 5);
  const now = /* @__PURE__ */ new Date(), trend = [];
  for (let offset = 5; offset >= 0; offset--) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1)), month = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`, monthSales = valid.filter((item) => item.sale_date.startsWith(month));
    trend.push({ month, revenueCents: monthSales.reduce((sum, item) => sum + item.price_cents, 0), volume: monthSales.length });
  }
  return { stats, species, trend };
}
__name(dashboard, "dashboard");

// src/media-security.js
function isUnsafeHostname(hostname) {
  const value = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (value === "localhost" || value.endsWith(".localhost") || value.endsWith(".local")) return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(value)) {
    const [a, b] = value.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a >= 224;
  }
  return value === "::1" || value === "::" || value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe8") || value.startsWith("fe9") || value.startsWith("fea") || value.startsWith("feb") || value.includes(":");
}
__name(isUnsafeHostname, "isUnsafeHostname");
function sniff(buffer, imageLimit, videoLimit) {
  const bytes2 = new Uint8Array(buffer);
  const ascii = /* @__PURE__ */ __name((start, end) => String.fromCharCode(...bytes2.slice(start, end)), "ascii");
  if (bytes2.length >= 3 && bytes2[0] === 255 && bytes2[1] === 216 && bytes2[2] === 255) return { type: "image", mime: "image/jpeg", extension: "jpg", limit: imageLimit };
  if (bytes2.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes2[i] === v)) return { type: "image", mime: "image/png", extension: "png", limit: imageLimit };
  if (bytes2.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return { type: "image", mime: "image/webp", extension: "webp", limit: imageLimit };
  if (bytes2.length >= 6 && ["GIF87a", "GIF89a"].includes(ascii(0, 6))) return { type: "image", mime: "image/gif", extension: "gif", limit: imageLimit };
  if (bytes2.length >= 12 && ascii(4, 8) === "ftyp") return { type: "video", mime: "video/mp4", extension: "mp4", limit: videoLimit };
  return null;
}
__name(sniff, "sniff");

// src/index.js
var IMAGE_LIMIT = 10 * 1024 * 1024;
var VIDEO_LIMIT = 80 * 1024 * 1024;
var URL_IMAGE_LIMIT = 4 * 1024 * 1024;
var URL_VIDEO_LIMIT = 20 * 1024 * 1024;
var PART_SIZE = 5 * 1024 * 1024;
var CommandCoordinator = class {
  static {
    __name(this, "CommandCoordinator");
  }
  constructor(_state, env) {
    this.env = env;
    this.queue = Promise.resolve();
  }
  fetch(request) {
    const work = this.queue.then(async () => {
      const body2 = await request.json();
      return apiResponse(await executeCommand(this.env, body2.owner, body2.action, body2.input, body2.requestId));
    });
    this.queue = work.catch(() => void 0);
    return work.catch((error) => errorResponse(error));
  }
};
function cors(env, request) {
  const origin = request.headers.get("origin") || "", configured = String(env.API_ALLOWED_ORIGIN || "").trim(), headers = { "access-control-allow-headers": "authorization,content-type", "access-control-allow-methods": "GET,POST,PATCH,DELETE,PUT,OPTIONS", "vary": "Origin" };
  if (!configured) headers["access-control-allow-origin"] = "*";
  else if (origin === configured) headers["access-control-allow-origin"] = origin;
  return headers;
}
__name(cors, "cors");
function withHeaders(response, headers) {
  const output = new Headers(response.headers);
  Object.entries(headers).forEach(([key, value]) => output.set(key, value));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: output });
}
__name(withHeaders, "withHeaders");
function htmlResponse(html, status = 200) {
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
__name(htmlResponse, "htmlResponse");
function escapeHtml(value) {
  return String(value || "").replace(/[&<>\"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}
__name(escapeHtml, "escapeHtml");
async function body(request) {
  try {
    return await request.json();
  } catch {
    throw new ApiError("VALIDATION_ERROR", "\u8BF7\u6C42\u6570\u636E\u683C\u5F0F\u65E0\u6548");
  }
}
__name(body, "body");
function bearer(request) {
  const value = request.headers.get("authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7) : "";
}
__name(bearer, "bearer");
async function owner(request, env) {
  const openId = await verifySession(bearer(request), env.SESSION_SECRET);
  ensure(env.OWNER_OPENID && openId === env.OWNER_OPENID, "UNAUTHORIZED", "\u5F53\u524D\u5FAE\u4FE1\u8D26\u53F7\u65E0\u7BA1\u7406\u6743\u9650", 403);
  return openId;
}
__name(owner, "owner");
async function login(request, env) {
  const input = await body(request), code = text(input.code, "\u767B\u5F55\u51ED\u8BC1", 200);
  ensure(env.WX_APP_ID && !env.WX_APP_ID.startsWith("replace-"), "CONFIGURATION_ERROR", "\u5FAE\u4FE1 AppID \u5C1A\u672A\u914D\u7F6E", 500);
  ensure(env.WX_APP_SECRET, "CONFIGURATION_ERROR", "\u5FAE\u4FE1 AppSecret \u5C1A\u672A\u914D\u7F6E", 500);
  const url = new URL("https://api.weixin.qq.com/sns/jscode2session");
  url.searchParams.set("appid", env.WX_APP_ID);
  url.searchParams.set("secret", env.WX_APP_SECRET);
  url.searchParams.set("js_code", code);
  url.searchParams.set("grant_type", "authorization_code");
  const response = await fetch(url.toString());
  const session = await response.json();
  ensure(session.openid, "UNAUTHORIZED", session.errmsg || "\u5FAE\u4FE1\u767B\u5F55\u5931\u8D25", 401);
  const configured = Boolean(env.OWNER_OPENID && !env.OWNER_OPENID.startsWith("replace-"));
  if (!configured) return { openId: session.openid, authorized: false, configured: false };
  if (session.openid !== env.OWNER_OPENID) return { openId: session.openid, authorized: false, configured: true };
  return { openId: session.openid, authorized: true, configured: true, token: await signSession(session.openid, env.SESSION_SECRET) };
}
__name(login, "login");
async function manage(request, env) {
  const currentOwner = await owner(request, env), input = await body(request), action = text(input.action, "action", 80);
  if (WRITE_ACTIONS.has(action)) {
    const durableId = env.COMMAND_COORDINATOR.idFromName(currentOwner), stub = env.COMMAND_COORDINATOR.get(durableId);
    const response = await stub.fetch("https://coordinator/command", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ owner: currentOwner, action, input: input.input || {}, requestId: input.requestId || "" }) });
    const value = await response.json();
    if (!value.ok) throw new ApiError(value.error.code, value.error.message, response.status, value.error.details);
    return value.data;
  }
  return executeRead(env, currentOwner, action, input.input || {}, new URL(request.url).origin, bearer(request));
}
__name(manage, "manage");
async function createUpload(request, env) {
  const currentOwner = await owner(request, env), input = await body(request), type = input.type;
  ensure(["image", "video"].includes(type), "VALIDATION_ERROR", "\u5A92\u4F53\u7C7B\u578B\u65E0\u6548");
  const limit = type === "video" ? VIDEO_LIMIT : IMAGE_LIMIT, size = Number(input.size);
  ensure(Number.isSafeInteger(size) && size > 0 && size <= limit, "VALIDATION_ERROR", "\u5A92\u4F53\u6587\u4EF6\u8D85\u8FC7\u5927\u5C0F\u9650\u5236");
  const requestId = text(input.requestId, "requestId", 100), assetId = (await sha256(`${currentOwner}:${requestId}:media`)).slice(0, 36), existing = await first(env, "SELECT * FROM media_assets WHERE id=? AND owner_open_id=?", assetId, currentOwner);
  if (existing) {
    ensure(existing.type === type && Number(existing.size) === size, "CONFLICT", "\u4E0A\u4F20\u8BF7\u6C42\u53F7\u5DF2\u7528\u4E8E\u5176\u4ED6\u5A92\u4F53", 409);
    return { assetId, uploadId: existing.upload_id, partSize: PART_SIZE, type: existing.type, size: existing.size };
  }
  const fileName = text(input.fileName, "\u6587\u4EF6\u540D", 200), extension = (fileName.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "bin", imageExtensions = /* @__PURE__ */ new Set(["jpg", "jpeg", "png", "webp", "gif"]), videoExtensions = /* @__PURE__ */ new Set(["mp4", "mov", "m4v"]);
  ensure(!(type === "image" && videoExtensions.has(extension)) && !(type === "video" && imageExtensions.has(extension)), "VALIDATION_ERROR", "\u5A92\u4F53\u7C7B\u578B\u4E0E\u6587\u4EF6\u6269\u5C55\u540D\u4E0D\u5339\u914D");
  const key = `private/${currentOwner}/${assetId}.${extension}`, mime = type === "video" ? extension === "mov" ? "video/quicktime" : "video/mp4" : { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" }[extension] || "application/octet-stream", uploadId = await r2CreateMultipartUpload(env, key, mime), now = nowIso();
  await env.DB.prepare("INSERT INTO media_assets (id,owner_open_id,type,size,file_name,object_key,upload_id,mime,source,status,revision,created_at,updated_at,deleted_at,deleted_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(assetId, currentOwner, type, size, fileName, key, uploadId, mime, "LOCAL_UPLOAD", "PENDING", 1, now, now, null, null).run();
  return { assetId, uploadId, partSize: PART_SIZE, type, size };
}
__name(createUpload, "createUpload");
async function uploadPart(request, env, assetId, partNumber) {
  const currentOwner = await owner(request, env), asset = await first(env, "SELECT * FROM media_assets WHERE id=? AND owner_open_id=? AND status=? AND deleted_at IS NULL", assetId, currentOwner, "PENDING");
  ensure(asset, "NOT_FOUND", "\u4E0A\u4F20\u4EFB\u52A1\u4E0D\u5B58\u5728", 404);
  const uploadId = new URL(request.url).searchParams.get("uploadId");
  ensure(uploadId && uploadId === asset.upload_id, "UNAUTHORIZED", "\u4E0A\u4F20\u4EFB\u52A1\u65E0\u6548", 403);
  const part = Number(partNumber);
  ensure(Number.isInteger(part) && part >= 1 && part <= 100, "VALIDATION_ERROR", "\u5206\u7247\u7F16\u53F7\u65E0\u6548");
  const chunk = await request.arrayBuffer();
  ensure(chunk.byteLength > 0 && chunk.byteLength <= PART_SIZE, "VALIDATION_ERROR", "\u5206\u7247\u5927\u5C0F\u65E0\u6548");
  const etag = await r2UploadPart(env, asset.object_key, uploadId, part, chunk);
  return { partNumber: part, etag };
}
__name(uploadPart, "uploadPart");
async function completeUpload(request, env, assetId) {
  const currentOwner = await owner(request, env), input = await body(request), asset = await first(env, "SELECT * FROM media_assets WHERE id=? AND owner_open_id=? AND deleted_at IS NULL", assetId, currentOwner);
  ensure(asset, "NOT_FOUND", "\u4E0A\u4F20\u4EFB\u52A1\u4E0D\u5B58\u5728", 404);
  if (asset.status === "COMMITTED") return mediaAssetView(request, env, asset);
  ensure(input.uploadId === asset.upload_id, "UNAUTHORIZED", "\u4E0A\u4F20\u4EFB\u52A1\u65E0\u6548", 403);
  const expectedParts = Math.ceil(asset.size / PART_SIZE);
  ensure(Array.isArray(input.parts) && input.parts.length === expectedParts, "VALIDATION_ERROR", "\u4E0A\u4F20\u5206\u7247\u6570\u91CF\u65E0\u6548");
  const parts = input.parts.map((item) => ({ partNumber: Number(item.partNumber), etag: text(item.etag, "etag", 200) })).sort((a, b) => a.partNumber - b.partNumber);
  ensure(parts.every((item, index) => item.partNumber === index + 1), "VALIDATION_ERROR", "\u4E0A\u4F20\u5206\u7247\u7F16\u53F7\u5FC5\u987B\u8FDE\u7EED");
  await r2CompleteMultipartUpload(env, asset.object_key, asset.upload_id, parts);
  const now = nowIso();
  await env.DB.prepare("UPDATE media_assets SET status=?,revision=revision+1,updated_at=? WHERE id=?").bind("COMMITTED", now, asset.id).run();
  return mediaAssetView(request, env, { ...asset, status: "COMMITTED", revision: asset.revision + 1, updated_at: now });
}
__name(completeUpload, "completeUpload");
async function mediaAssetView(request, env, asset) {
  const expires = Math.floor(Date.now() / 864e5) * 86400 + 86400, signature = await mediaSignature(asset.id, expires, env.MEDIA_SIGNING_SECRET);
  return { assetId: asset.id, type: asset.type, size: asset.size, fileID: `${new URL(request.url).origin}/api/media/${asset.id}?expires=${expires}&signature=${signature}` };
}
__name(mediaAssetView, "mediaAssetView");
async function mediaFile(request, env, assetId, ctx) {
  const url = new URL(request.url), expires = Number(url.searchParams.get("expires")), signature = url.searchParams.get("signature") || "", variant = url.searchParams.get("variant") || "", range = request.headers.get("range") || "";
  ensure(expires > Math.floor(Date.now() / 1e3) && expires < Math.floor(Date.now() / 1e3) + 86400, "UNAUTHORIZED", "\u5A92\u4F53\u5730\u5740\u5DF2\u5931\u6548", 401);
  ensure(constantTimeEqual(await mediaSignature(assetId, expires, env.MEDIA_SIGNING_SECRET), signature), "UNAUTHORIZED", "\u5A92\u4F53\u7B7E\u540D\u65E0\u6548", 401);
  ensure(!variant || variant === "thumbnail", "VALIDATION_ERROR", "\u5A92\u4F53\u89C4\u683C\u65E0\u6548");
  const cacheKey = new Request(`${url.origin}/_media-cache/${encodeURIComponent(assetId)}${variant ? `?variant=${variant}` : ""}`), cache = typeof caches === "undefined" || range ? null : caches.default;
  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  }
  const asset = await first(env, "SELECT * FROM media_assets WHERE id=? AND status=? AND deleted_at IS NULL", assetId, "COMMITTED");
  ensure(asset, "NOT_FOUND", "\u5A92\u4F53\u4E0D\u5B58\u5728", 404);
  const object = await r2GetObject(env, asset.object_key, range);
  const headers = new Headers();
  ["content-type", "content-length", "content-range", "etag", "last-modified"].forEach((name) => {
    const value = object.headers.get(name);
    if (value) headers.set(name, value);
  });
  headers.set("accept-ranges", "bytes");
  headers.set("cache-control", "public, max-age=86400");
  const response = new Response(object.body, { status: object.status, headers });
  if (cache && response.ok) {
    const task = cache.put(cacheKey, response.clone());
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(task);
    else await task;
  }
  return response;
}
__name(mediaFile, "mediaFile");
async function importMedia(request, env) {
  const currentOwner = await owner(request, env), input = await body(request), requestId = text(input.requestId, "requestId", 100), assetId = (await sha256(`${currentOwner}:${requestId}:url`)).slice(0, 36), existing = await first(env, "SELECT * FROM media_assets WHERE id=? AND owner_open_id=?", assetId, currentOwner);
  if (existing && existing.status === "COMMITTED") return mediaAssetView(request, env, existing);
  const downloaded = await downloadMedia(text(input.url, "URL", 2048)), key = `private/${currentOwner}/${assetId}.${downloaded.extension}`;
  await r2PutObject(env, key, downloaded.buffer, downloaded.mime);
  const now = nowIso();
  await env.DB.prepare("INSERT OR REPLACE INTO media_assets (id,owner_open_id,type,size,file_name,object_key,upload_id,mime,source,status,revision,created_at,updated_at,deleted_at,deleted_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(assetId, currentOwner, downloaded.type, downloaded.buffer.byteLength, `import.${downloaded.extension}`, key, null, downloaded.mime, "URL_IMPORT", "COMMITTED", 1, now, now, null, null).run();
  return mediaAssetView(request, env, { id: assetId, type: downloaded.type, size: downloaded.buffer.byteLength });
}
__name(importMedia, "importMedia");
async function downloadMedia(raw, redirects = 0) {
  ensure(redirects <= 3, "MEDIA_REJECTED", "\u91CD\u5B9A\u5411\u6B21\u6570\u8FC7\u591A");
  const url = new URL(raw);
  ensure(url.protocol === "https:" && !url.username && !url.password && !url.port && !isUnsafeHostname(url.hostname), "MEDIA_REJECTED", "\u5A92\u4F53\u5730\u5740\u4E0D\u5B89\u5168");
  const response = await fetch(url.toString(), { redirect: "manual", headers: { accept: "image/*,video/mp4", "user-agent": "ParrotPro/1.0" }, signal: AbortSignal.timeout(2e4) });
  if (response.status >= 300 && response.status < 400 && response.headers.get("location")) return downloadMedia(new URL(response.headers.get("location"), url).toString(), redirects + 1);
  ensure(response.ok, "MEDIA_REJECTED", "\u8FDC\u7A0B\u5A92\u4F53\u4E0D\u53EF\u7528");
  const declared = Number(response.headers.get("content-length") || 0);
  ensure(!declared || declared <= URL_VIDEO_LIMIT, "MEDIA_REJECTED", "URL\u5A92\u4F53\u6587\u4EF6\u8D85\u8FC7\u5927\u5C0F\u9650\u5236");
  const buffer = await response.arrayBuffer();
  const detected = sniff(buffer, URL_IMAGE_LIMIT, URL_VIDEO_LIMIT);
  ensure(detected && buffer.byteLength <= detected.limit, "MEDIA_REJECTED", "URL\u56FE\u7247\u9700\u5C0F\u4E8E4MB\uFF0C\u89C6\u9891\u9700\u5C0F\u4E8E20MB");
  return { buffer, ...detected };
}
__name(downloadMedia, "downloadMedia");
async function publicShare(request, env, token) {
  ensure(token && token.length >= 32, "NOT_FOUND", "\u5206\u4EAB\u5DF2\u5931\u6548", 404);
  const tokenHash = await sha256(token), share = await first(env, "SELECT * FROM share_tokens WHERE token_hash=? AND deleted_at IS NULL", tokenHash);
  ensure(share && !share.revoked_at && new Date(share.expires_at).getTime() > Date.now(), "NOT_FOUND", "\u5206\u4EAB\u5DF2\u5931\u6548", 404);
  const bird = await first(env, "SELECT * FROM parrots WHERE id=? AND owner_open_id=? AND deleted_at IS NULL", share.parrot_id, share.owner_open_id);
  ensure(bird, "NOT_FOUND", "\u5206\u4EAB\u5DF2\u5931\u6548", 404);
  return { valid: true, expiresAt: share.expires_at, parrot: { id: bird.id, species: bird.species, ringNumber: bird.ring_number, gender: bird.gender, birthDate: bird.birth_date, ageLabel: ageLabel(bird.birth_date), priceCents: bird.price_cents, publicIntro: bird.public_intro || "", media: await mediaItems(env, JSON.parse(bird.media_json || "[]"), env.MEDIA_SIGNING_SECRET, new URL(request.url).origin, "") } };
}
__name(publicShare, "publicShare");
async function route(request, env) {
  const url = new URL(request.url), path = url.pathname;
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  if (path === "/api/health") return apiResponse({ status: "ok" });
  if (path === "/api/auth/login" && request.method === "POST") return apiResponse(await login(request, env));
  if (path === "/api/session" && request.method === "GET") {
    const openId = await owner(request, env);
    return apiResponse({ openId, authorized: true, configured: true });
  }
  if (path === "/api/manage" && request.method === "POST") return apiResponse(await manage(request, env));
  if (path === "/api/media/multipart/create" && request.method === "POST") return apiResponse(await createUpload(request, env));
  let match = path.match(/^\/api\/media\/multipart\/([^/]+)\/parts\/(\d+)$/);
  if (match && request.method === "PUT") return apiResponse(await uploadPart(request, env, match[1], match[2]));
  match = path.match(/^\/api\/media\/multipart\/([^/]+)\/complete$/);
  if (match && request.method === "POST") return apiResponse(await completeUpload(request, env, match[1]));
  if (path === "/api/media/import" && request.method === "POST") return apiResponse(await importMedia(request, env));
  match = path.match(/^\/api\/media\/([^/]+)$/);
  if (match && request.method === "GET") return mediaFile(request, env, match[1]);
  match = path.match(/^\/share\/(.+)$/);
  if (match && request.method === "GET") return publicSharePageV3(request, env, decodeURIComponent(match[1]));
  match = path.match(/^\/api\/public\/shares\/(.+)$/);
  if (match && request.method === "GET") return apiResponse(await publicShare(request, env, decodeURIComponent(match[1])));
  throw new ApiError("NOT_FOUND", "\u63A5\u53E3\u4E0D\u5B58\u5728", 404);
}
__name(route, "route");
var src_default = { async fetch(request, env) {
  const headers = cors(env, request);
  try {
    return withHeaders(await route(request, env), headers);
  } catch (error) {
    console.error("[worker]", error);
    return withHeaders(errorResponse(error), headers);
  }
}, async scheduled(_event, env, ctx) {
  ctx.waitUntil(cleanup(env));
} };
async function cleanup(env) {
  const cutoff = new Date(Date.now() - 864e5).toISOString();
  await env.DB.prepare("DELETE FROM share_tokens WHERE expires_at<=? OR revoked_at IS NOT NULL OR deleted_at IS NOT NULL").bind(nowIso()).run();
  const assets = await all(env, "SELECT * FROM media_assets WHERE (status='PENDING' AND created_at<?) OR (status='COMMITTED' AND created_at<? AND NOT EXISTS (SELECT 1 FROM parrots,json_each(parrots.media_json) WHERE json_extract(json_each.value,'$.assetId')=media_assets.id) AND NOT EXISTS (SELECT 1 FROM sales_records,json_each(sales_records.media_json) WHERE json_extract(json_each.value,'$.assetId')=media_assets.id)) LIMIT 100", cutoff);
  for (const asset of assets) {
    try {
      if (asset.status === "PENDING" && asset.upload_id) await r2AbortMultipartUpload(env, asset.object_key, asset.upload_id);
      else await r2DeleteObject(env, asset.object_key);
      await env.DB.prepare("DELETE FROM media_assets WHERE id=?").bind(asset.id).run();
    } catch (error) {
      console.error("[cleanup]", asset.id, error);
    }
  }
}
__name(cleanup, "cleanup");
async function publicSharePageV3(request, env, token) {
  const data = await publicShare(request, env, token), parrot = data.parrot, media = Array.isArray(parrot.media) && parrot.media.length ? parrot.media : [{ type: "image", url: "" }], species = escapeHtml(parrot.species), ring = escapeHtml(parrot.ringNumber), price = escapeHtml(`\xA5${Number(parrot.priceCents || 0) / 100}`), age = escapeHtml(parrot.ageLabel), gender = escapeHtml({ MALE: "\u516C", FEMALE: "\u6BCD", UNKNOWN: "\u672A\u77E5" }[parrot.gender] || parrot.gender), intro = parrot.publicIntro ? escapeHtml(parrot.publicIntro).replace(/\n/g, "<br/>") : "\u6682\u65E0\u516C\u5F00\u4ECB\u7ECD";
  const slides = media.map((item, index) => item.type === "video" ? `<article class="media-slide"><video class="media-content" src="${escapeHtml(item.url || "")}" ${item.poster ? `poster="${escapeHtml(item.poster)}"` : ""} controls playsinline preload="metadata"></video><span class="media-label">\u89C6\u9891 ${index + 1}</span></article>` : item.url ? `<article class="media-slide"><img class="media-content" src="${escapeHtml(item.url)}" alt="${species} \xB7 \u56FE\u7247 ${index + 1}"/><span class="media-label">\u56FE\u7247 ${index + 1}</span></article>` : '<article class="media-slide media-empty">\u6682\u65E0\u516C\u5F00\u56FE\u7247\u6216\u89C6\u9891</article>').join("");
  const dots = media.length > 1 ? `<div class="media-dots">${media.map((_, index) => `<span class="media-dot${index === 0 ? " active" : ""}"></span>`).join("")}</div>` : "", script = media.length > 1 ? `<script>const track=document.getElementById('mediaTrack'),dots=[...document.querySelectorAll('.media-dot')];const sync=()=>{const index=Math.round(track.scrollLeft/(track.clientWidth||1));dots.forEach((dot,i)=>dot.classList.toggle('active',i===index));};track.addEventListener('scroll',()=>requestAnimationFrame(sync),{passive:true});window.addEventListener('resize',sync);<\/script>` : "";
  return htmlResponse(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${species} \xB7 \u5B98\u65B9\u6863\u6848</title><style>*{box-sizing:border-box}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Helvetica Neue","PingFang SC",sans-serif;background:#fdfbf9;color:#0f172a}main{max-width:680px;margin:0 auto;padding-bottom:40px}.media-gallery{position:relative;height:min(101vw,510px);overflow:hidden;background:#1e293b}.media-track{display:flex;width:100%;height:100%;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;touch-action:pan-x pan-y}.media-track::-webkit-scrollbar{display:none}.media-slide{position:relative;display:flex;flex:0 0 100%;height:100%;align-items:center;justify-content:center;scroll-snap-align:start;background:#1e293b}.media-content{display:block;width:100%;height:100%;object-fit:cover}.media-empty{color:#cbd5e1;font-size:16px;font-weight:800}.media-label{position:absolute;right:16px;bottom:16px;padding:7px 11px;border-radius:999px;background:rgba(15,23,42,.64);color:#fff;font-size:12px;font-weight:800}.media-dots{position:absolute;bottom:19px;left:0;right:0;display:flex;justify-content:center;gap:8px;pointer-events:none}.media-dot{width:7px;height:7px;border-radius:99px;background:rgba(255,255,255,.58)}.media-dot.active{width:30px;background:#fff}.profile{position:relative;margin:-52px 16px 0;padding:30px 25px 28px;border-radius:30px;background:#fff;box-shadow:0 18px 42px rgba(30,41,59,.14)}.identity{display:flex;align-items:flex-end;justify-content:space-between;gap:18px}.title{font-size:34px;font-weight:900;line-height:1.1}.ring{margin-top:8px;color:#64748b;font-size:15px;font-weight:800}.price{text-align:right}.price span{display:block;color:#64748b;font-size:12px;font-weight:800}.price strong{display:block;margin-top:5px;font-size:30px;font-weight:900;font-variant-numeric:tabular-nums}.facts{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:25px;padding-top:23px;border-top:1px solid #eef2f6}.fact{padding:18px;border-radius:20px;background:#f8fafc}.fact span{display:block;color:#64748b;font-size:13px;font-weight:800}.fact strong{display:block;margin-top:8px;font-size:22px;font-weight:900}.introduction{margin-top:25px;padding-top:23px;border-top:1px solid #eef2f6}.introduction h2{margin:0;color:#0f172a;font-size:13px;font-weight:900;letter-spacing:.1em}.introduction p{margin:12px 0 0;color:#64748b;font-size:16px;font-weight:700;line-height:1.7}@media(max-width:390px){.profile{margin-left:12px;margin-right:12px;padding:27px 22px}.title{font-size:31px}.price strong{font-size:28px}}</style></head><body><main><section class="media-gallery"><div class="media-track" id="mediaTrack">${slides}</div>${dots}</section><section class="profile"><div class="identity"><div><div class="title">${species}</div><div class="ring">ID: ${ring}</div></div><div class="price"><span>\u516C\u5F00\u62A5\u4EF7</span><strong>${price}</strong></div></div><div class="facts"><div class="fact"><span>\u6027\u522B</span><strong>${gender}</strong></div><div class="fact"><span>\u6708\u9F84</span><strong>${age}</strong></div></div><div class="introduction"><h2>\u6863\u6848\u4ECB\u7ECD \xB7 BACKGROUND</h2><p>${intro}</p></div></section></main>${script}</body></html>`);
}
__name(publicSharePageV3, "publicSharePageV3");

// node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-TNfjMQ/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-TNfjMQ/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  CommandCoordinator,
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
