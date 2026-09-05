import { ApiError, STATUS, ensure, parseJson, text } from './core.js'
import { owned } from './db.js'

const SENSENOVA_URL = 'https://token.sensenova.cn/v1/chat/completions'
const DEFAULT_TEXT_MODEL = 'deepseek-v4-flash'
const FALLBACK_MODEL = 'sensenova-6.7-flash-lite'
const STYLES = new Set(['PROFESSIONAL', 'CONCISE', 'COLLOQUIAL', 'STORY', 'HUMOR'])
const TRAITS = {
  tameness: new Set(['TAME', 'SHY']),
  raisingMethod: new Set(['HAND_RAISED', 'CAGE_RAISED']),
  independentFeeding: new Set(['INDEPENDENT', 'LEARNING', 'ASSISTED']),
  featherCondition: new Set(['CLEAN', 'MIXED', 'BALD'])
}

const SELLER_PROFILE = Object.freeze({
  pickup: '仅支持自提。',
  viewingHours: '周一至周五晚上 7 点半之后可以上门看鸟，周末全天都可以提前约时间看鸟。',
  location: '位置在通州马驹桥旧邮局附近，具体位置私聊确认。',
  closing: '都是自家养的，希望给它找一个认真负责的好主人。'
})

const STYLE_LABELS = Object.freeze({
  PROFESSIONAL: '专业',
  CONCISE: '简洁',
  COLLOQUIAL: '口语',
  STORY: '故事',
  HUMOR: '幽默'
})

const STYLE_INSTRUCTIONS = Object.freeze({
  PROFESSIONAL: '【风格硬规则】正文必须以专业个人繁育者口吻组织为 3 个短自然段：基础资料、已确认饲养状态、看鸟交接。用准确克制的词，不卖萌、不讲故事、不用“宝子”“捡漏”等口语；读起来要明显像专业介绍而非普通聊天。',
  CONCISE: '【风格硬规则】正文必须压成 3 至 4 条短句，每条不超过 35 个中文字符，换行呈现但不要加小标题。只留买家决策信息，删掉情绪铺垫与重复描述；读起来要明显比其他风格更干练工整。',
  COLLOQUIAL: '【风格硬规则】正文必须以第一人称自然聊天口吻写，至少出现一次“我家”或“自己养”，像养鸟人把情况当面讲给同好听。语气亲切、自然，带一点自养人的感情，但不矫情、不像广告、不用 AI 腔。',
  STORY: '【风格硬规则】正文必须以第一人称讲一个生活化转让小故事，且第一段除基础资料外必须明确写出一个转让缘由：照料精力有限、家里鸟多空间紧张、想尝试别的品种三选一。必须出现“我”或“家里”，并写出希望找新主人的情绪；不能退化成普通的三段资料介绍。不得虚构医疗、血统、交易承诺或具体家庭成员。',
  HUMOR: '【风格硬规则】正文开头必须有一句轻松俏皮的自创短句或顺口溜，再自然落到真实资料；至少有一处让人会心一笑的表达。不能写低俗梗、不能贬低鸟、不能夸大健康或互动能力；读起来必须明显不同于口语风格。'
})

const TRAIT_LABELS = Object.freeze({
  tameness: { TAME: '亲人', SHY: '不亲人，性格偏慢热' },
  raisingMethod: { HAND_RAISED: '手养', CAGE_RAISED: '笼养' },
  independentFeeding: { INDEPENDENT: '独立吃食', LEARNING: '正在学吃食', ASSISTED: '还需辅助喂养' },
  featherCondition: { CLEAN: '没有杂毛', MIXED: '有杂毛，羽况以实拍为准', BALD: '秃头，羽况以实拍为准' }
})

export function parseSaleCopy(value) {
  const raw = String(value || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  if (!raw) throw new ApiError('AI_RESPONSE_INVALID', 'AI 未返回正文，请换一版重试', 502)
  const jsonStart = raw.indexOf('{'), jsonEnd = raw.lastIndexOf('}')
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    try {
      const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1))
      if (parsed && parsed.title && parsed.content) return parsed
    } catch { /* Fall through to the text format below. */ }
  }
  const titleIndex = raw.lastIndexOf('【标题】'), contentIndex = raw.lastIndexOf('【正文】')
  if (titleIndex >= 0 && contentIndex > titleIndex) {
    const title = raw.slice(titleIndex + 4, contentIndex).trim().split('\n').map(line => line.trim()).find(Boolean) || ''
    const content = raw.slice(contentIndex + 4).trim()
    if (title && content) return { title, content }
  }
  throw new ApiError('AI_RESPONSE_INVALID', 'AI 返回格式异常，请换一版重试', 502)
}

function normalizeTraits(input) {
  const source = input && typeof input === 'object' ? input : {}
  const output = {}
  for (const [key, allowed] of Object.entries(TRAITS)) {
    const value = String(source[key] || '')
    ensure(!value || allowed.has(value), 'VALIDATION_ERROR', '售卖条件无效')
    if (value) output[key] = value
  }
  return output
}

function profileTraits(bird) {
  const source = parseJson(bird.traits_json, {})
  return { tameness: source.tameness || '', raisingMethod: source.raisingMethod || '', independentFeeding: source.feeding || '', featherCondition: source.featherCondition || '' }
}

function saleAge(birthDate) {
  const start = new Date(`${birthDate}T00:00:00+08:00`).getTime()
  const days = Math.max(0, Math.floor((Date.now() - start) / 86400000))
  if (days < 31) return `${days}天`
  return `${Math.floor(days / 30)}个月`
}

function saleCategory(bird) {
  const name = String(bird.species || '').trim()
  // “名称”可填具体类（原始灰玄凤），也可能只是管理编号（244）。
  const breed = String(bird.breed || '').trim()
  if (!/[\p{Script=Han}A-Za-z]/u.test(name)) return breed
  if (!breed || name.includes(breed) || breed.includes(name)) return name.length >= breed.length ? name : breed
  return `${name}${breed}`
}

function parentInfo(value, label) {
  try {
    const parent = JSON.parse(value || '')
    const species = String(parent && parent.species || '').trim()
    if (!species) return ''
    return `${label}为${species}`
  } catch { return '' }
}

export function saleCopyPrompt(bird, input) {
  const style = String(input.style || 'PROFESSIONAL')
  ensure(STYLES.has(style), 'VALIDATION_ERROR', '文案风格无效')
  const suppliedTraits = input.traits && typeof input.traits === 'object' ? input.traits : {}
  const traits = normalizeTraits(Object.keys(suppliedTraits).length ? suppliedTraits : profileTraits(bird))
  const note = text(input.note, '备注', 300, false)
  const facts = {
    售卖类别: saleCategory(bird),
    性别: ({ MALE: '公', FEMALE: '母', UNKNOWN: '性别待确认' })[bird.gender] || '性别待确认',
    出生日期: bird.birth_date,
    当前年龄: saleAge(bird.birth_date),
    售价: `¥${Number(bird.price_cents || 0) / 100}`,
    公开介绍: bird.public_intro || '未填写',
    父母信息: [parentInfo(bird.father_snapshot_json, '父鸟'), parentInfo(bird.mother_snapshot_json, '母鸟')].filter(Boolean).join('，') || '未填写',
    已确认卖点: Object.entries(traits).map(([key, value]) => TRAIT_LABELS[key][value]),
    补充备注: note || '未填写'
  }
  return [
    `你是北京个人养鸟人。写一则${STYLE_LABELS[style]}风格、可直接发布的鹦鹉转让文案。${STYLE_INSTRUCTIONS[style]}`,
    '只写给定事实，不猜测或补充健康、温顺、活泼、手养、亲人、血统、疫苗等信息。不要写脚环、鸟的管理编号、手机号、精确门牌或思考过程。',
    '标题直接给买家最关心的信息，使用 3 至 5 个“｜”分隔的短标签，不超过 36 个中文字符，固定顺序：{售卖类别}鹦鹉｜{性别（母的/公的）}｜{已确认饲养方式+亲人状态}｜{已确认羽况（无杂毛/杂毛）}｜{当前年龄}。只保留已有资料，绝不写“羽况以实拍为准”这种解释型标签，也不要在标题写进食情况。示例：虎皮鹦鹉｜母的｜笼养亲人｜杂毛｜2天。',
    '正文不要使用【基本信息】、【饲养状态】、【看鸟方式】等小标题。基础资料必须清楚表达“{售卖类别}鹦鹉，{性别（母的/公的）}，{出生日期}出生，目前{当前年龄}，售价{售价}。自家繁殖。”公开介绍仅在已填写时才自然补充，未填写时绝不能出现“未填公开介绍”。',
    '接着单独一段自然描述已确认特点：亲人时可写“性格温和、比较亲人，愿意和人互动”；不亲人时只可写“性格温和、偏安静，性格较独立”，不得暗示亲人或互动。要如实写笼养/手养、独立吃食/正在学吃食/辅助喂养及杂毛情况；有杂毛时自然写“有杂毛，羽况以实拍为准”。若“父母信息”已填写，在特点段最后自然加入该信息；未填写时绝不能提父母。最后单独一段写看鸟方式。',
    `正文必须原样表达以下固定卖家资料：${SELLER_PROFILE.pickup}${SELLER_PROFILE.viewingHours}${SELLER_PROFILE.location}${SELLER_PROFILE.closing}`,
    '“正在学吃食”或“辅助喂养”必须如实保留。不要编造健康、活泼、可互动等卖点，也不要把管理编号当成类别或名字。',
    `再次确认：当前选择的是“${STYLE_LABELS[style]}”。必须逐条执行上面的【风格硬规则】，不能输出成其他风格或默认资料介绍。`,
    '只输出最终文案，不解释、不分析、不复述规则、不使用代码块。必须严格使用：\n【标题】\n一行标题\n【正文】\n正文。',
    `鸟档案和已确认资料：${JSON.stringify(facts)}`
  ].join('\n')
}

export async function saleCopyBird(env, owner, input) {
  const bird = await owned(env, 'parrots', text(input.id, '鹦鹉', 80), owner)
  const saleReady = bird.status === STATUS.FOR_SALE && (bird.record_source !== 'INTRODUCTION' || bird.introduction_stage === 'FOR_SALE')
  ensure(saleReady, 'INVALID_STATE', '仅待售鹦鹉可以生成售卖文案')
  return bird
}

// Flash-Lite currently rejects the optional thinking switch.  It can reason by
// default, so leave enough completion budget for the final public copy too.
// This model spends part of the completion budget on hidden reasoning.  8K is
// the provider's safe lower bound when thinking cannot be disabled.
const TEXT_COMPLETION_TOKENS = 8192
const AI_REQUEST_TIMEOUT_MS = 300000

async function requestCopy(env, model, prompt) {
  let response
  try {
    response = await fetch(SENSENOVA_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.SENSENOVA_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model, temperature: 0.7, top_p: 0.8, max_tokens: TEXT_COMPLETION_TOKENS, messages: [{ role: 'user', content: prompt }] }),
      signal: AbortSignal.timeout(AI_REQUEST_TIMEOUT_MS)
    })
  } catch (error) {
    if (error && error.name === 'TimeoutError') throw new ApiError('AI_TIMEOUT', 'AI 生成超时，请换一版或稍后重试', 504)
    throw new ApiError('AI_UNAVAILABLE', 'AI 服务暂时不可用，请稍后重试', 502)
  }
  if (response.status === 404) return { missingModel: true }
  if (response.status === 400) return { invalidRequest: true }
  if (response.status === 429) return { rateLimited: true }
  if (!response.ok) {
    const message = response.status === 401 ? 'AI 密钥认证失败，请检查 Cloudflare Secret' : response.status === 403 ? 'AI 服务当前无调用权限，请检查模型权限' : 'AI 服务暂时不可用，请稍后重试'
    throw new ApiError('AI_UNAVAILABLE', message, 502)
  }
  let payload
  try { payload = await response.json() } catch { throw new ApiError('AI_RESPONSE_INVALID', 'AI 返回格式异常，请换一版重试', 502) }
  return { message: payload && payload.choices && payload.choices[0] && payload.choices[0].message }
}

export async function generateSaleCopy(env, owner, input) {
  ensure(env.SENSENOVA_API_KEY, 'CONFIGURATION_ERROR', 'AI 服务尚未配置，请先在 Cloudflare Worker 中添加 SENSENOVA_API_KEY', 500)
  const bird = await saleCopyBird(env, owner, input)
  const prompt = saleCopyPrompt(bird, input || {})
  const configuredModel = String(env.SENSENOVA_SALE_COPY_MODEL || DEFAULT_TEXT_MODEL).trim() || DEFAULT_TEXT_MODEL
  let response = await requestCopy(env, configuredModel, prompt)
  if (response.invalidRequest) throw new ApiError('AI_UNAVAILABLE', 'AI 文本模型不接受当前请求参数，请检查模型权限', 502)
  if (response.rateLimited && configuredModel !== FALLBACK_MODEL) response = await requestCopy(env, FALLBACK_MODEL, prompt)
  if (response.rateLimited) throw new ApiError('AI_UNAVAILABLE', 'AI 服务繁忙，请稍后重试', 502)
  if (response.missingModel && configuredModel !== FALLBACK_MODEL) response = await requestCopy(env, FALLBACK_MODEL, prompt)
  if (response.missingModel) throw new ApiError('AI_UNAVAILABLE', 'AI 文本模型当前不可用，请检查模型权限', 502)
  let result
  try {
    result = parseSaleCopy((response.message || {}).content)
  } catch (error) {
    // Some DeepSeek-compatible endpoints return only a reasoning field. It must
    // never become public copy, so retry once with the lightweight text model.
    if (!(error instanceof ApiError) || error.code !== 'AI_RESPONSE_INVALID' || configuredModel === FALLBACK_MODEL) throw error
    response = await requestCopy(env, FALLBACK_MODEL, prompt)
    if (response.invalidRequest || response.missingModel) throw new ApiError('AI_UNAVAILABLE', 'AI 文本模型当前不可用，请检查模型权限', 502)
    result = parseSaleCopy((response.message || {}).content)
  }
  // A verbose model title should not discard an otherwise usable sales document.
  const title = text(String(result.title || '').trim().slice(0, 60), 'AI 标题', 60)
  const content = text(String(result.content || '').trim().slice(0, 3000), 'AI 正文', 3000)
  return { title, content, style: String(input.style || 'PROFESSIONAL') }
}

export async function streamSaleCopy(env, owner, input, onDelta) {
  ensure(env.SENSENOVA_API_KEY, 'CONFIGURATION_ERROR', 'AI 服务尚未配置，请先在 Cloudflare Worker 中添加 SENSENOVA_API_KEY', 500)
  const bird = await saleCopyBird(env, owner, input)
  const configuredModel = String(env.SENSENOVA_SALE_COPY_MODEL || DEFAULT_TEXT_MODEL).trim() || DEFAULT_TEXT_MODEL
  const payload = { model: configuredModel, temperature: 0.7, top_p: 0.8, max_tokens: TEXT_COMPLETION_TOKENS, stream: true, messages: [{ role: 'user', content: saleCopyPrompt(bird, input || {}) }] }
  let response = await fetch(SENSENOVA_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.SENSENOVA_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(AI_REQUEST_TIMEOUT_MS)
  })
  if ((response.status === 404 || response.status === 429) && configuredModel !== FALLBACK_MODEL) {
    payload.model = FALLBACK_MODEL
    response = await fetch(SENSENOVA_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.SENSENOVA_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(AI_REQUEST_TIMEOUT_MS)
    })
  }
  if (!response.ok || !response.body) throw new ApiError('AI_UNAVAILABLE', 'AI 服务暂时不可用，请稍后重试', 502)
  const reader = response.body.getReader(), decoder = new TextDecoder()
  let buffer = '', output = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const events = buffer.split(/\r?\n\r?\n/)
    buffer = events.pop() || ''
    for (const event of events) {
      const data = event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('')
      if (!data || data === '[DONE]') continue
      try {
        const delta = JSON.parse(data)?.choices?.[0]?.delta?.content
        if (typeof delta === 'string' && delta) { output += delta; onDelta(delta) }
      } catch { /* Ignore incomplete or non-text upstream events. */ }
    }
  }
  buffer += decoder.decode()
  if (buffer) {
    const data = buffer.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('')
    if (data && data !== '[DONE]') try { const delta = JSON.parse(data)?.choices?.[0]?.delta?.content; if (typeof delta === 'string' && delta) { output += delta; onDelta(delta) } } catch { /* Ignore final non-text event. */ }
  }
  const result = parseSaleCopy(output)
  return { title: text(String(result.title || '').trim().slice(0, 60), 'AI 标题', 60), content: text(String(result.content || '').trim().slice(0, 3000), 'AI 正文', 3000), style: String(input.style || 'PROFESSIONAL') }
}
