import fs from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createD1 } from './helpers/d1-adapter.mjs'
import { executeCommand, executeRead, purgeExpiredParrots } from '../../src/service.js'
import { deleteAllNotifications, deleteNotification, enqueueSaleCopy, getSaleCopy, listNotifications, readAllNotifications, readNotification, setNotificationRead } from '../../src/sale-copy-jobs.js'
import { streamSaleCopy } from '../../src/sale-copy.js'

const migration=['0001_initial.sql','0002_access_control.sql','0003_access_settings.sql','0004_lineage_and_clutches.sql','0005_clutch_offspring.sql','0006_parrot_breed.sql','0007_sales_record_breed.sql','0008_feeding_plans.sql','0009_feeding_plan_food_types.sql','0010_feeding_plan_age_days.sql','0011_feeding_plan_enabled.sql','0012_introductions.sql','0013_supply_records.sql','0014_sale_copy_documents.sql','0015_sale_copy_streaming.sql','0016_notifications.sql','0017_parrot_recycle_bin.sql','0018_parrot_traits.sql'].map(name=>fs.readFileSync(new URL(`../../migrations/${name}`,import.meta.url),'utf8')).join('\n')
function setup(){return{DB:createD1(migration),SHARE_TOKEN_SECRET:'share-secret-that-is-longer-than-thirty-two',MEDIA_SIGNING_SECRET:'media-secret-that-is-longer-than-thirty-two'}}
const bird=(gender,ringNumber)=>({breed:'测试品种',species:'测试鹦鹉',ringNumber,gender,birthDate:'2025-01-01',priceCents:100000,publicIntro:'公开',privateNotes:'内部',media:[]})

test('D1 schema and command receipts enforce idempotent unique rings',async()=>{const env=setup();try{const first=await executeCommand(env,'owner','parrots.create',bird('MALE','r- 001'),'create:1');const repeated=await executeCommand(env,'owner','parrots.create',bird('MALE','r- 001'),'create:1');assert.equal(repeated.id,first.id);await assert.rejects(executeCommand(env,'owner','parrots.create',bird('MALE','R-001'),'create:2'),error=>error.code==='DUPLICATE_RING');const rows=await env.DB.prepare('SELECT COUNT(*) AS count FROM parrots').first();assert.equal(rows.count,1)}finally{env.DB.close()}})

test('parrots receive distinct internal IDs even without a ring number',async()=>{const env=setup();try{const first=await executeCommand(env,'owner','parrots.create',bird('MALE',''),'blank:1'),second=await executeCommand(env,'owner','parrots.create',bird('FEMALE',''),'blank:2');assert.ok(first.id);assert.notEqual(first.id,second.id);const rows=await env.DB.prepare("SELECT COUNT(*) AS count FROM parrots WHERE ring_number='' ").first();assert.equal(rows.count,2)}finally{env.DB.close()}})

test('parrot traits persist, update, and reject invalid combinations', async () => {
  const env = setup()
  try {
    const traits = { tameness: 'TAME', raisingMethod: 'HAND_RAISED', feeding: 'INDEPENDENT', featherCondition: 'CLEAN' }
    const created = await executeCommand(env, 'owner', 'parrots.create', { ...bird('FEMALE', 'TRAIT-1'), traits }, 'traits:create')
    let item = (await executeRead(env, 'owner', 'parrots.list', {}, 'https://api.example.com', '')).items[0]
    assert.deepEqual(item.traits, traits)
    const updatedTraits = { tameness: 'SHY', raisingMethod: 'CAGE_RAISED', feeding: 'LEARNING', featherCondition: 'BALD' }
    await executeCommand(env, 'owner', 'parrots.update', { id: created.id, revision: created.revision, updates: { traits: updatedTraits } }, 'traits:update')
    item = (await executeRead(env, 'owner', 'parrots.list', {}, 'https://api.example.com', '')).items[0]
    assert.deepEqual(item.traits, updatedTraits)
    await assert.rejects(executeCommand(env, 'owner', 'parrots.update', { id: created.id, revision: 2, updates: { traits: { tameness: 'TAME', featherCondition: 'UNKNOWN' } } }, 'traits:invalid'), error => error.code === 'VALIDATION_ERROR')
  } finally { env.DB.close() }
})

test('notifications retain unread sale-copy completion messages and mark only the selected message read', async () => {
  const env = setup()
  try {
    await env.DB.prepare('INSERT INTO notifications (id,owner_open_id,type,title,content,target_type,target_id,read_at,created_at) VALUES (?,?,?,?,?,?,?,?,?)').bind('notice-new', 'owner', 'SALE_COPY', 'AI 售卖文案已完成', '点击查看', 'PARROT_DETAIL', 'parrot-1', null, '2026-08-22T01:00:00.000Z').run()
    await env.DB.prepare('INSERT INTO notifications (id,owner_open_id,type,title,content,target_type,target_id,read_at,created_at) VALUES (?,?,?,?,?,?,?,?,?)').bind('notice-old', 'owner', 'SALE_COPY', 'AI 售卖文案已完成', '点击查看', 'PARROT_DETAIL', 'parrot-2', '2026-08-22T00:30:00.000Z', '2026-08-22T00:00:00.000Z').run()
    const before = await listNotifications(env, 'owner')
    assert.equal(before.unreadCount, 1)
    assert.equal(before.items[0].id, 'notice-new')
    assert.equal(before.items[0].targetId, 'parrot-1')
    const read = await readNotification(env, 'owner', 'notice-new')
    assert.equal(read.read, true)
    const after = await listNotifications(env, 'owner')
    assert.equal(after.unreadCount, 0)
  } finally { env.DB.close() }
})

test('notifications support owner-scoped read state and real deletion', async () => {
  const env = setup()
  try {
    await env.DB.prepare('INSERT INTO notifications (id,owner_open_id,type,title,content,target_type,target_id,read_at,created_at) VALUES (?,?,?,?,?,?,?,?,?)').bind('notice-a', 'owner', 'SALE_COPY', '完成', '内容', 'PARROT_DETAIL', 'parrot-1', null, '2026-08-22T01:00:00.000Z').run()
    await env.DB.prepare('INSERT INTO notifications (id,owner_open_id,type,title,content,target_type,target_id,read_at,created_at) VALUES (?,?,?,?,?,?,?,?,?)').bind('notice-b', 'owner', 'SALE_COPY', '完成', '内容', 'PARROT_DETAIL', 'parrot-2', null, '2026-08-22T01:01:00.000Z').run()
    await env.DB.prepare('INSERT INTO notifications (id,owner_open_id,type,title,content,target_type,target_id,read_at,created_at) VALUES (?,?,?,?,?,?,?,?,?)').bind('notice-other', 'other', 'SALE_COPY', '完成', '内容', 'PARROT_DETAIL', 'parrot-3', null, '2026-08-22T01:02:00.000Z').run()
    assert.equal((await setNotificationRead(env, 'owner', 'notice-a', true)).read, true)
    assert.equal((await setNotificationRead(env, 'owner', 'notice-a', false)).read, false)
    assert.equal((await readAllNotifications(env, 'owner')).updated, 2)
    assert.equal((await deleteNotification(env, 'owner', 'notice-a')).deleted, true)
    assert.equal((await deleteAllNotifications(env, 'owner')).deleted, 1)
    assert.equal((await listNotifications(env, 'owner')).items.length, 0)
    assert.equal((await listNotifications(env, 'other')).items.length, 1)
  } finally { env.DB.close() }
})

test('sale-copy jobs retain the initiating user as the notification recipient', async () => {
  const env = { ...setup(), SALE_COPY_COORDINATOR: { idFromName: name => name, get: () => ({ fetch: async () => new Response(null, { status: 204 }) }) } }
  try {
    const created = await executeCommand(env, 'owner', 'parrots.create', bird('FEMALE', 'NOTICE-RECIPIENT'), 'notice-recipient:create')
    await enqueueSaleCopy(env, 'owner', { id: created.id }, 'user-a')
    const row = await env.DB.prepare('SELECT request_json FROM sale_copy_documents WHERE parrot_id=?').bind(created.id).first()
    assert.equal(JSON.parse(row.request_json).notificationRecipient, 'user-a')
  } finally { env.DB.close() }
})

test('sale-copy generation uses only the selected traits and only permits sale-ready parrots', async () => {
  const env = { ...setup(), SENSENOVA_API_KEY: 'test-key' }
  const originalFetch = globalThis.fetch
  try {
    const created = await executeCommand(env, 'owner', 'parrots.create', { ...bird('FEMALE', 'AI-SALE-1'), privateNotes: '敏感私密内容' }, 'ai-sale:create')
    let requestBody
    globalThis.fetch = async (_url, options) => {
      requestBody = JSON.parse(options.body)
      return { ok: true, json: async () => ({ choices: [{ message: { content: '【标题】\n自养测试鹦鹉母鸟｜亲人可自提\n【正文】\n【基本情况】测试文案\n\n仅支持自提。' } }] }) }
    }
    const result = await executeRead(env, 'owner', 'ai.saleCopy.generate', { id: created.id, style: 'COLLOQUIAL', traits: { tameness: 'TAME', raisingMethod: 'HAND_RAISED' }, note: '可提前预约' }, 'https://api.example.com', '')
    assert.equal(result.title, '自养测试鹦鹉母鸟｜亲人可自提')
    assert.match(result.content, /仅支持自提/)
    assert.equal(requestBody.model, 'deepseek-v4-flash')
    assert.match(requestBody.messages[0].content, /已确认卖点/)
    assert.match(requestBody.messages[0].content, /售卖类别/)
    assert.match(requestBody.messages[0].content, /风格硬规则/)
    assert.doesNotMatch(requestBody.messages[0].content, /敏感私密内容/)
    assert.equal(requestBody.max_tokens, 8192)
    assert.equal(requestBody.chat_template_kwargs, undefined)
    const breeder = await executeCommand(env, 'owner', 'parrots.setBreeder', { id: created.id, revision: created.revision }, 'ai-sale:breeder')
    await assert.rejects(executeRead(env, 'owner', 'ai.saleCopy.generate', { id: breeder.id }, 'https://api.example.com', ''), error => error.code === 'INVALID_STATE')
  } finally {
    globalThis.fetch = originalFetch
    env.DB.close()
  }
})

test('sale-copy generation keeps a usable document when a model returns an overly long title', async () => {
  const env = { ...setup(), SENSENOVA_API_KEY: 'test-key', SENSENOVA_SALE_COPY_MODEL: 'deepseek-v4-flash' }
  const originalFetch = globalThis.fetch
  try {
    const created = await executeCommand(env, 'owner', 'parrots.create', bird('FEMALE', 'AI-SALE-LONG'), 'ai-sale:long')
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: `【标题】\n${'自养鹦鹉'.repeat(30)}\n【正文】\n正文仍然可以正常发布。` } }] }) })
    const result = await executeRead(env, 'owner', 'ai.saleCopy.generate', { id: created.id }, 'https://api.example.com', '')
    assert.equal(result.title.length, 60)
    assert.equal(result.content, '正文仍然可以正常发布。')
  } finally { globalThis.fetch = originalFetch; env.DB.close() }
})

test('sale-copy uses breed when the name is only a numeric management label', async () => {
  const env = { ...setup(), SENSENOVA_API_KEY: 'test-key' }
  const originalFetch = globalThis.fetch
  try {
    const created = await executeCommand(env, 'owner', 'parrots.create', { ...bird('FEMALE', 'AI-CATEGORY'), breed: '虎皮', species: '244' }, 'ai-sale:category')
    let requestBody
    globalThis.fetch = async (_url, options) => {
      requestBody = JSON.parse(options.body)
      return { ok: true, json: async () => ({ choices: [{ message: { content: '【标题】\n虎皮鹦鹉｜2天\n【正文】\n【基本信息】这是一只虎皮鹦鹉。' } }] }) }
    }
    await executeRead(env, 'owner', 'ai.saleCopy.generate', { id: created.id }, 'https://api.example.com', '')
    assert.match(requestBody.messages[0].content, /"售卖类别":"虎皮"/)
    assert.doesNotMatch(requestBody.messages[0].content, /"售卖类别":"244"/)
  } finally { globalThis.fetch = originalFetch; env.DB.close() }
})

test('sale-copy never publishes a model reasoning field as listing content', async () => {
  const env = { ...setup(), SENSENOVA_API_KEY: 'test-key' }
  const originalFetch = globalThis.fetch
  try {
    const created = await executeCommand(env, 'owner', 'parrots.create', bird('FEMALE', 'AI-REASONING'), 'ai-sale:reasoning')
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '', reasoning_content: '【标题】\n内部分析\n【正文】\n不应向用户展示。' } }] }) })
    await assert.rejects(executeRead(env, 'owner', 'ai.saleCopy.generate', { id: created.id }, 'https://api.example.com', ''), error => error.code === 'AI_RESPONSE_INVALID')
  } finally { globalThis.fetch = originalFetch; env.DB.close() }
})

test('sale-copy retries the lightweight text model when DeepSeek has no final content', async () => {
  const env = { ...setup(), SENSENOVA_API_KEY: 'test-key', SENSENOVA_SALE_COPY_MODEL: 'deepseek-v4-flash' }
  const originalFetch = globalThis.fetch
  try {
    const created = await executeCommand(env, 'owner', 'parrots.create', bird('FEMALE', 'AI-FALLBACK'), 'ai-sale:fallback')
    const requestedModels = []
    globalThis.fetch = async (_url, options) => {
      const body = JSON.parse(options.body)
      requestedModels.push(body.model)
      const message = body.model === 'deepseek-v4-flash'
        ? { content: '', reasoning_content: '不能公开的推理过程' }
        : { content: '【标题】\n虎皮鹦鹉｜2天\n【正文】\n【基本信息】这是一只虎皮鹦鹉。' }
      return { ok: true, json: async () => ({ choices: [{ message }] }) }
    }
    const result = await executeRead(env, 'owner', 'ai.saleCopy.generate', { id: created.id }, 'https://api.example.com', '')
    assert.equal(result.title, '虎皮鹦鹉｜2天')
    assert.deepEqual(requestedModels, ['deepseek-v4-flash', 'sensenova-6.7-flash-lite'])
  } finally { globalThis.fetch = originalFetch; env.DB.close() }
})

test('sale-copy streaming forwards only final text deltas and parses the completed document', async () => {
  const env = { ...setup(), SENSENOVA_API_KEY: 'test-key' }
  const originalFetch = globalThis.fetch
  try {
    const created = await executeCommand(env, 'owner', 'parrots.create', bird('FEMALE', 'AI-STREAM'), 'ai-sale:stream')
    const encoder = new TextEncoder()
    globalThis.fetch = async (_url, options) => {
      assert.equal(JSON.parse(options.body).stream, true)
      return new Response(new ReadableStream({ start(controller) { const event = value => `data: ${JSON.stringify(value)}\n\n`; controller.enqueue(encoder.encode([event({ choices: [{ delta: { reasoning: '不展示' } }] }), event({ choices: [{ delta: { content: '【标题】\n虎皮鹦鹉｜2天\n【正文】\n' } }] }), event({ choices: [{ delta: { content: '【基本信息】这是一只虎皮鹦鹉。' } }] }), 'data: [DONE]\n\n'].join(''))); controller.close() } }), { status: 200 })
    }
    const chunks = []
    const result = await streamSaleCopy(env, 'owner', { id: created.id }, value => chunks.push(value))
    assert.equal(chunks.join(''), '【标题】\n虎皮鹦鹉｜2天\n【正文】\n【基本信息】这是一只虎皮鹦鹉。')
    assert.equal(result.title, '虎皮鹦鹉｜2天')
  } finally { globalThis.fetch = originalFetch; env.DB.close() }
})

test('sale-copy jobs overwrite the prior version and mark a completed copy read only after opening it', async () => {
  const env = { ...setup(), SALE_COPY_COORDINATOR: { idFromName: name => name, get: () => ({ fetch: async () => new Response(null, { status: 204 }) }) } }
  try {
    const created = await executeCommand(env, 'owner', 'parrots.create', bird('FEMALE', 'AI-JOB-1'), 'ai-job:create')
    await enqueueSaleCopy(env, 'owner', { id: created.id, style: 'WARM_HOME', traits: { tameness: 'TAME' } })
    let row = await env.DB.prepare('SELECT status,title,content FROM sale_copy_documents WHERE parrot_id=?').bind(created.id).first()
    assert.equal(row.status, 'PENDING')
    await env.DB.prepare("UPDATE sale_copy_documents SET status='READY',title='旧标题',content='旧正文',expires_at=? WHERE parrot_id=?").bind('2026-08-24T00:00:00.000Z', created.id).run()
    await enqueueSaleCopy(env, 'owner', { id: created.id, style: 'CLEAR_INFO', traits: { independentFeeding: 'INDEPENDENT' } })
    row = await env.DB.prepare('SELECT status,title,content FROM sale_copy_documents WHERE parrot_id=?').bind(created.id).first()
    assert.equal(row.status, 'PENDING')
    assert.equal(row.title, '')
    assert.equal(row.content, '')
    await env.DB.prepare("UPDATE sale_copy_documents SET status='READY',title='新标题',content='新正文',expires_at=? WHERE parrot_id=?").bind('2026-08-24T00:00:00.000Z', created.id).run()
    assert.equal((await getSaleCopy(env, 'owner', created.id)).unread, true)
    assert.equal((await getSaleCopy(env, 'owner', created.id, true)).unread, false)
  } finally { env.DB.close() }
})

test('introduced birds keep their source through growing, breeder, and sale transitions',async()=>{const env=setup();try{const introduced=await executeCommand(env,'owner','introductions.create',{...bird('FEMALE','INTRO-1'),purchaseDate:'2026-08-01'},'introduction:create');let row=await env.DB.prepare('SELECT record_source,purchase_date,introduction_stage,status FROM parrots WHERE id=?').bind(introduced.id).first();assert.equal(row.record_source,'INTRODUCTION');assert.equal(row.purchase_date,'2026-08-01');assert.equal(row.introduction_stage,'GROWING');assert.equal(row.status,'FOR_SALE');await assert.rejects(executeCommand(env,'owner','sales.create',{parrotId:introduced.id,parrotRevision:introduced.revision,buyer:'买家',buyerContact:'',saleDate:'2026-08-02',priceCents:90000},'introduction:no-sale'),error=>error.code==='INVALID_STATE');const breeder=await executeCommand(env,'owner','parrots.setBreeder',{id:introduced.id,revision:introduced.revision},'introduction:breeder');assert.equal((await env.DB.prepare('SELECT status FROM parrots WHERE id=?').bind(introduced.id).first()).status,'BREEDER');const growing=await executeCommand(env,'owner','parrots.unsetBreeder',{id:introduced.id,revision:breeder.revision},'introduction:unset');row=await env.DB.prepare('SELECT record_source,introduction_stage FROM parrots WHERE id=?').bind(introduced.id).first();assert.equal(row.record_source,'INTRODUCTION');assert.equal(row.introduction_stage,'GROWING');const forSale=await executeCommand(env,'owner','introductions.markForSale',{id:introduced.id,revision:growing.revision},'introduction:for-sale');row=await env.DB.prepare('SELECT record_source,introduction_stage FROM parrots WHERE id=?').bind(introduced.id).first();assert.equal(row.record_source,'INTRODUCTION');assert.equal(row.introduction_stage,'FOR_SALE');const sale=await executeCommand(env,'owner','sales.create',{parrotId:introduced.id,parrotRevision:forSale.revision,buyer:'买家',buyerContact:'',saleDate:'2026-08-02',priceCents:90000},'introduction:sale');assert.ok(sale.id)}finally{env.DB.close()}})

test('supplies separate daily supplies from medicine, retain purchase details, and are physically deletable',async()=>{const env=setup();try{const supply=await executeCommand(env,'owner','supplies.create',{category:'SUPPLY',name:'小米',amountCents:3200,weight:'2kg',purchaseDate:'2026-08-20',notes:'本月口粮'},'supply:create'),medicine=await executeCommand(env,'owner','supplies.create',{category:'MEDICINE',name:'电解质',amountCents:2500,weight:'100g',purchaseDate:'2026-08-21',notes:''},'medicine:create');assert.ok(supply.id);assert.ok(medicine.id);let items=await executeRead(env,'owner','supplies.list',{},'https://api.example.com','');assert.equal(items.length,2);assert.equal(items[0].category,'MEDICINE');assert.equal(items[0].amountCents,2500);assert.equal(items[1].weight,'2kg');await executeCommand(env,'owner','supplies.delete',{id:supply.id},'supply:delete');const row=await env.DB.prepare('SELECT COUNT(*) AS count FROM supply_records WHERE id=?').bind(supply.id).first();assert.equal(row.count,0);items=await executeRead(env,'owner','supplies.list',{},'https://api.example.com','');assert.equal(items.length,1);assert.equal(items[0].id,medicine.id);await assert.rejects(executeCommand(env,'owner','supplies.create',{category:'OTHER',name:'无效',amountCents:1,purchaseDate:'2026-08-20'},'supply:invalid'),error=>error.code==='VALIDATION_ERROR')}finally{env.DB.close()}})

test('command receipts reject reusing a request id for another action',async()=>{const env=setup();try{await executeCommand(env,'owner','parrots.create',bird('MALE','RECEIPT-1'),'receipt:reuse');await assert.rejects(executeCommand(env,'owner','parrots.setBreeder',{id:'missing',revision:1},'receipt:reuse'),error=>error.code==='CONFLICT')}finally{env.DB.close()}})

test('completion keeps the pair active and only manual cancellation separates parents',async()=>{const env=setup();try{const male=await executeCommand(env,'owner','parrots.create',bird('MALE','M-1'),'create:m'),female=await executeCommand(env,'owner','parrots.create',bird('FEMALE','F-1'),'create:f');const mb=await executeCommand(env,'owner','parrots.setBreeder',{id:male.id,revision:1},'breeder:m'),fb=await executeCommand(env,'owner','parrots.setBreeder',{id:female.id,revision:1},'breeder:f');const hatch=await executeCommand(env,'owner','hatching.create',{maleId:male.id,femaleId:female.id,maleRevision:mb.revision,femaleRevision:fb.revision,species:'测试鹦鹉',startDate:'2026-07-18',eggs:3},'hatch:create');let rows=await env.DB.prepare('SELECT status FROM parrots ORDER BY id').all();assert.deepEqual(rows.results.map(row=>row.status),['INCUBATING','INCUBATING']);await executeCommand(env,'owner','hatching.complete',{id:hatch.id,revision:hatch.revision},'hatch:complete');const pair=await env.DB.prepare('SELECT id,status,revision FROM breeding_pairs').first();assert.equal(pair.status,'ACTIVE');rows=await env.DB.prepare('SELECT status,active_pair_id FROM parrots').all();assert.equal(rows.results.every(row=>row.status==='PAIRED'&&row.active_pair_id===pair.id),true);await executeCommand(env,'owner','breeding.cancel',{pairId:pair.id,revision:pair.revision},'pair:cancel');rows=await env.DB.prepare('SELECT status,active_pair_id FROM parrots').all();assert.equal(rows.results.every(row=>row.status==='BREEDER'&&row.active_pair_id===null),true)}finally{env.DB.close()}})

test('active breeding list exposes camelCase relations for the miniapp',async()=>{const env=setup();try{const male=await executeCommand(env,'owner','parrots.create',bird('MALE','M-2'),'create:m2'),female=await executeCommand(env,'owner','parrots.create',bird('FEMALE','F-2'),'create:f2');const mb=await executeCommand(env,'owner','parrots.setBreeder',{id:male.id,revision:1},'breeder:m2'),fb=await executeCommand(env,'owner','parrots.setBreeder',{id:female.id,revision:1},'breeder:f2');const pair=await executeCommand(env,'owner','breeding.pair',{maleId:male.id,femaleId:female.id,maleRevision:mb.revision,femaleRevision:fb.revision},'pair:m2');const active=await executeRead(env,'owner','breeding.listActive',{},'https://api.example.com','');assert.equal(active[0].maleId,male.id);assert.equal(active[0].femaleId,female.id);assert.equal(typeof active[0].pairedAt,'string');assert.equal('paired_at' in active[0],false);assert.equal(active[0].revision,pair.revision)}finally{env.DB.close()}})

test('paired parrots may update media without changing gender',async()=>{const env=setup();try{const male=await executeCommand(env,'owner','parrots.create',bird('MALE','M-3'),'create:m3'),female=await executeCommand(env,'owner','parrots.create',bird('FEMALE','F-3'),'create:f3');const mb=await executeCommand(env,'owner','parrots.setBreeder',{id:male.id,revision:1},'breeder:m3'),fb=await executeCommand(env,'owner','parrots.setBreeder',{id:female.id,revision:1},'breeder:f3');await executeCommand(env,'owner','breeding.pair',{maleId:male.id,femaleId:female.id,maleRevision:mb.revision,femaleRevision:fb.revision},'pair:m3');const now=new Date().toISOString();await env.DB.prepare('INSERT INTO media_assets (id,owner_open_id,type,size,file_name,object_key,upload_id,mime,source,status,revision,created_at,updated_at,deleted_at,deleted_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind('asset-m3','owner','image',1024,'m3.jpg','private/owner/m3.jpg',null,'image/jpeg','LOCAL_UPLOAD','COMMITTED',1,now,now,null,null).run();const current=await env.DB.prepare('SELECT revision FROM parrots WHERE id=?').bind(male.id).first();const updated=await executeCommand(env,'owner','parrots.update',{id:male.id,revision:current.revision,updates:{gender:'MALE',media:[{assetId:'asset-m3',type:'image'}]}},'update:m3-media');assert.equal(updated.revision,current.revision+1);const saved=await env.DB.prepare('SELECT gender,media_json FROM parrots WHERE id=?').bind(male.id).first();assert.equal(saved.gender,'MALE');assert.match(saved.media_json,/asset-m3/);await assert.rejects(executeCommand(env,'owner','parrots.update',{id:male.id,revision:updated.revision,updates:{gender:'FEMALE'}},'update:m3-gender'),error=>error.code==='INVALID_STATE')}finally{env.DB.close()}})

test('sale return removes revenue and produces terminal returned state',async()=>{const env=setup();try{const created=await executeCommand(env,'owner','parrots.create',bird('FEMALE','SALE-1'),'create:sale'),sale=await executeCommand(env,'owner','sales.create',{parrotId:created.id,parrotRevision:1,buyer:'张先生',buyerContact:'13800000000',saleDate:'2026-07-18',priceCents:120000},'sale:create'),sales=await executeRead(env,'owner','sales.list',{},'https://api.example.com','');assert.equal(sales.items[0].parrotSnapshot.breed,'测试品种');let dashboard=await executeRead(env,'owner','dashboard.get',{},'https://api.example.com','');assert.equal(dashboard.stats.revenueCents,120000);await executeCommand(env,'owner','sales.return',{id:sale.id,revision:sale.revision,reason:'健康复检未通过'},'sale:return');dashboard=await executeRead(env,'owner','dashboard.get',{},'https://api.example.com','');assert.equal(dashboard.stats.revenueCents,0);assert.equal(dashboard.stats.returnRate,100);assert.equal(dashboard.stats.returned,1)}finally{env.DB.close()}})

test('parrot deletion enters a 15-day recycle bin, records the actor, and can be restored',async()=>{const env=setup();try{const birdRecord=await executeCommand(env,'owner','parrots.create',bird('MALE','DELETE-1'),'delete:create'),share=await executeCommand(env,'owner','shares.create',{parrotId:birdRecord.id},'delete:share');await executeCommand(env,'owner','shares.revoke',{token:share.token},'delete:share-revoke');let row=await env.DB.prepare('SELECT COUNT(*) AS count FROM share_tokens').first();assert.equal(row.count,0);await executeCommand(env,'owner','sales.create',{parrotId:birdRecord.id,parrotRevision:birdRecord.revision,buyer:'测试买家',buyerContact:'',saleDate:'2026-07-19',priceCents:100000},'delete:sale');const deleted=await executeCommand(env,'owner','parrots.delete',{id:birdRecord.id,revision:2},'delete:parrot','admin-open-id');assert.ok(deleted.purgeAt);row=await env.DB.prepare('SELECT deleted_at,deleted_by FROM parrots WHERE id=?').bind(birdRecord.id).first();assert.ok(row.deleted_at);assert.equal(row.deleted_by,'admin-open-id');assert.equal((await executeRead(env,'owner','parrots.list',{},'https://api.example.com','')).items.length,0);const recycle=await executeRead(env,'owner','parrots.recycleBin',{},'https://api.example.com','');assert.equal(recycle.items.length,1);assert.equal(recycle.items[0].id,birdRecord.id);const audit=await env.DB.prepare("SELECT actor_open_id FROM audit_logs WHERE action='parrots.delete' AND target_id=?").bind(birdRecord.id).first();assert.equal(audit.actor_open_id,'admin-open-id');await executeCommand(env,'owner','parrots.restore',{id:birdRecord.id},'restore:parrot','owner-open-id');row=await env.DB.prepare('SELECT deleted_at,deleted_by FROM parrots WHERE id=?').bind(birdRecord.id).first();assert.equal(row.deleted_at,null);assert.equal(row.deleted_by,null);assert.equal((await executeRead(env,'owner','parrots.list',{},'https://api.example.com','')).items.length,1)}finally{env.DB.close()}})

test('expired recycle-bin entries are physically purged while their audit history remains',async()=>{const env=setup();try{const birdRecord=await executeCommand(env,'owner','parrots.create',bird('MALE','PURGE-1'),'purge:create');await executeCommand(env,'owner','parrots.delete',{id:birdRecord.id,revision:birdRecord.revision},'purge:delete','owner-open-id');const expired=new Date(Date.now()-16*86400000).toISOString();await env.DB.prepare('UPDATE parrots SET deleted_at=? WHERE id=?').bind(expired,birdRecord.id).run();assert.equal(await purgeExpiredParrots(env),1);const row=await env.DB.prepare('SELECT COUNT(*) AS count FROM parrots WHERE id=?').bind(birdRecord.id).first();assert.equal(row.count,0);const audit=await env.DB.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE target_id=? AND action='parrots.purge'").bind(birdRecord.id).first();assert.equal(audit.count,1)}finally{env.DB.close()}})

test('removing a completed hatching record physically removes its row',async()=>{const env=setup();try{const male=await executeCommand(env,'owner','parrots.create',bird('MALE','HARD-HATCH-M'),'hard-hatch:create-m'),female=await executeCommand(env,'owner','parrots.create',bird('FEMALE','HARD-HATCH-F'),'hard-hatch:create-f'),maleBreeder=await executeCommand(env,'owner','parrots.setBreeder',{id:male.id,revision:1},'hard-hatch:breeder-m'),femaleBreeder=await executeCommand(env,'owner','parrots.setBreeder',{id:female.id,revision:1},'hard-hatch:breeder-f'),hatching=await executeCommand(env,'owner','hatching.create',{maleId:male.id,femaleId:female.id,maleRevision:maleBreeder.revision,femaleRevision:femaleBreeder.revision,species:'测试鹦鹉',startDate:'2026-07-19',eggs:2},'hard-hatch:create'),completed=await executeCommand(env,'owner','hatching.complete',{id:hatching.id,revision:hatching.revision},'hard-hatch:complete');await executeCommand(env,'owner','hatching.delete',{id:hatching.id,revision:completed.revision},'hard-hatch:delete');const row=await env.DB.prepare('SELECT COUNT(*) AS count FROM hatching_records WHERE id=?').bind(hatching.id).first();assert.equal(row.count,0)}finally{env.DB.close()}})

test('sync.snapshot aggregates all datasets in a single read',async()=>{const env=setup();try{const created=await executeCommand(env,'owner','parrots.create',bird('MALE','SNAP-1'),'create:snap');const snapshot=await executeRead(env,'owner','sync.snapshot',{},'https://api.example.com','');assert.equal(snapshot.parrots.items.length,1);assert.equal(snapshot.parrots.items[0].id,created.id);assert.equal(snapshot.parrots.items[0].breed,'测试品种');assert.deepEqual(snapshot.pairs,[]);assert.equal(snapshot.hatching.items.length,0);assert.equal(snapshot.sales.items.length,0);assert.equal(snapshot.dashboard.stats.total,1)}finally{env.DB.close()}})

test('lineage keeps manual snapshots, validates library parent gender, and protects referenced parents',async()=>{const env=setup();try{const father=await executeCommand(env,'owner','parrots.create',bird('MALE','LINEAGE-F'),'lineage:father'),mother=await executeCommand(env,'owner','parrots.create',bird('FEMALE','LINEAGE-M'),'lineage:mother'),child=await executeCommand(env,'owner','parrots.create',{...bird('UNKNOWN','LINEAGE-C'),father:{source:'LIBRARY',id:father.id},mother:{source:'MANUAL',species:'外部母鸟',ringNumber:'EXT-1'}},'lineage:child');const loaded=await executeRead(env,'owner','parrots.get',{id:child.id},'https://api.example.com','');assert.deepEqual(loaded.father,{source:'LIBRARY',id:father.id,species:'测试鹦鹉',ringNumber:'LINEAGE-F'});assert.deepEqual(loaded.mother,{source:'MANUAL',id:null,species:'外部母鸟',ringNumber:'EXT-1'});await assert.rejects(executeCommand(env,'owner','parrots.update',{id:child.id,revision:child.revision,updates:{father:{source:'LIBRARY',id:mother.id}}},'lineage:wrong-gender'),error=>error.code==='VALIDATION_ERROR');await assert.rejects(executeCommand(env,'owner','parrots.delete',{id:father.id,revision:father.revision},'lineage:delete-parent'),error=>error.code==='INVALID_STATE')}finally{env.DB.close()}})

test('hatching preserves multiple offspring varieties and historical pair details for a clutch',async()=>{const env=setup();try{const male=await executeCommand(env,'owner','parrots.create',bird('MALE','CLUTCH-M'),'clutch:male'),female=await executeCommand(env,'owner','parrots.create',{...bird('FEMALE','CLUTCH-F'),species:'母系玄凤'},'clutch:female'),mb=await executeCommand(env,'owner','parrots.setBreeder',{id:male.id,revision:male.revision},'clutch:mb'),fb=await executeCommand(env,'owner','parrots.setBreeder',{id:female.id,revision:female.revision},'clutch:fb'),hatch=await executeCommand(env,'owner','hatching.create',{maleId:male.id,femaleId:female.id,maleRevision:mb.revision,femaleRevision:fb.revision,species:'玄凤',startDate:'2026-08-01',eggs:3},'clutch:create'),updated=await executeCommand(env,'owner','hatching.updateProgress',{id:hatch.id,revision:hatch.revision,hatched:3,offspringGroups:[{species:'珍珠',count:2},{species:'黄化',count:1}]},'clutch:update'),items=await executeRead(env,'owner','hatching.list',{},'https://api.example.com','');assert.equal(updated.revision,2);assert.deepEqual(items.items[0].offspringGroups,[{species:'珍珠',count:2},{species:'黄化',count:1}]);assert.equal(items.items[0].femaleSnapshot.species,'母系玄凤');assert.match(items.items[0].pairingDate,/^\d{4}-\d{2}-\d{2}T/)}finally{env.DB.close()}})

test('batch clutch intake creates every chick with locked parents, birth date, and optional rings',async()=>{const env=setup();try{const male=await executeCommand(env,'owner','parrots.create',bird('MALE','INTAKE-M'),'intake:male'),female=await executeCommand(env,'owner','parrots.create',bird('FEMALE','INTAKE-F'),'intake:female'),mb=await executeCommand(env,'owner','parrots.setBreeder',{id:male.id,revision:male.revision},'intake:mb'),fb=await executeCommand(env,'owner','parrots.setBreeder',{id:female.id,revision:female.revision},'intake:fb'),hatch=await executeCommand(env,'owner','hatching.create',{maleId:male.id,femaleId:female.id,maleRevision:mb.revision,femaleRevision:fb.revision,species:'玄凤',startDate:'2026-08-02',eggs:2},'intake:create'),progress=await executeCommand(env,'owner','hatching.updateProgress',{id:hatch.id,revision:hatch.revision,hatched:2,offspringGroups:[{species:'珍珠',count:1},{species:'黄化',count:1}]},'intake:progress'),done=await executeCommand(env,'owner','hatching.complete',{id:hatch.id,revision:progress.revision},'hatch:complete'),created=await executeCommand(env,'owner','parrots.createFromClutch',{hatchingRecordId:hatch.id,revision:done.revision,chicks:[{breed:'玄凤',species:'珍珠',ringNumber:'',gender:'UNKNOWN',priceCents:0,privateNotes:'未戴环'},{breed:'玄凤',species:'黄化',ringNumber:'CHICK-2',gender:'FEMALE',priceCents:88000,privateNotes:'已验卡'}]},'intake:batch');assert.equal(created.ids.length,2);const chicks=await env.DB.prepare('SELECT breed,species,ring_number,birth_date,father_id,mother_id,birth_hatching_record_id FROM parrots WHERE birth_hatching_record_id=? ORDER BY species').bind(hatch.id).all();assert.equal(chicks.results.length,2);assert.equal(chicks.results.every(row=>row.breed==='玄凤'),true);assert.equal(chicks.results[0].birth_hatching_record_id,hatch.id);assert.equal(chicks.results.every(row=>row.father_id===male.id&&row.mother_id===female.id),true);const listed=await executeRead(env,'owner','hatching.list',{},'https://api.example.com','');assert.equal(listed.items[0].offspringRegistered,2);assert.deepEqual(listed.items[0].offspring.map(item=>item.ringNumber).sort(),['','CHICK-2']);const parrots=await executeRead(env,'owner','parrots.list',{},'https://api.example.com','');assert.equal(parrots.items.filter(item=>item.birthHatchingRecordId===hatch.id).length,2);await assert.rejects(executeCommand(env,'owner','parrots.createFromClutch',{hatchingRecordId:hatch.id,revision:done.revision,chicks:[]},'intake:repeat'),error=>error.code==='INVALID_STATE');await assert.rejects(executeCommand(env,'owner','hatching.delete',{id:hatch.id,revision:done.revision},'intake:delete'),error=>error.code==='INVALID_STATE')}finally{env.DB.close()}})

test('feeding plans support formula, mixed and solid food types',async()=>{const env=setup();try{const input={name:'玄凤过渡期',species:'玄凤',stage:'断奶过渡',ageFromMonths:0,ageFromDays:7,ageToMonths:2,ageToDays:3,feedingType:'MIXED',formulaName:'A21',waterMl:30,powderScoops:'3 平勺',temperatureMin:38,temperatureMax:40,feedingsPerDay:3,amountMl:'8ml',feedingMethod:'针管',temperatureCheck:'温度计',preparationNotes:'现配现喂',seedFoodName:'泡软小米',seedFoodAmount:'早晚各 1 小勺',seedFoodNotes:'先少量搭配，保证饮水',feedingNotes:'慢喂',fullnessNotes:'观察嗉囊',warningNotes:'呛食即停'};const created=await executeCommand(env,'owner','feedingPlans.create',input,'feeding:mixed'),plans=await executeRead(env,'owner','feedingPlans.list',{},'https://api.example.com','');assert.equal(created.revision,1);assert.equal(plans[0].feedingType,'MIXED');assert.equal(plans[0].ageFromDays,7);assert.equal(plans[0].seedFoodName,'泡软小米');const solid=await executeCommand(env,'owner','feedingPlans.create',{...input,name:'虎皮断奶',feedingType:'SOLID',formulaName:'',waterMl:0,powderScoops:'',temperatureMin:0,temperatureMax:0,seedFoodName:'带壳小米',seedFoodAmount:'自由采食'},'feeding:solid');assert.ok(solid.id);await assert.rejects(executeCommand(env,'owner','feedingPlans.create',{...input,name:'错误类型',feedingType:'INVALID'},'feeding:invalid'),error=>error.code==='VALIDATION_ERROR');await assert.rejects(executeCommand(env,'owner','feedingPlans.create',{...input,name:'年龄倒置',ageFromMonths:1,ageFromDays:1,ageToMonths:0,ageToDays:30},'feeding:age'),error=>error.code==='VALIDATION_ERROR')}finally{env.DB.close()}})

test('enabled feeding plans reject overlapping ages for the same breed only',async()=>{const env=setup();try{const base={species:'虎皮',stage:'雏鸟',ageFromMonths:0,ageFromDays:0,ageToMonths:0,ageToDays:30,feedingType:'FORMULA',formulaName:'A21',waterMl:30,powderScoops:'3',temperatureMin:38,temperatureMax:40,feedingsPerDay:3,amountMl:'8ml',feedingMethod:'针管',temperatureCheck:'温度计',preparationNotes:'现配',seedFoodName:'',seedFoodAmount:'',seedFoodNotes:'',feedingNotes:'慢喂',fullnessNotes:'观察',warningNotes:'异常联系'};const first=await executeCommand(env,'owner','feedingPlans.create',{...base,name:'虎皮 0-30 天'},'enabled:first'),adjacent=await executeCommand(env,'owner','feedingPlans.create',{...base,name:'虎皮 31-60 天',ageFromMonths:1,ageFromDays:0,ageToMonths:1,ageToDays:29},'enabled:adjacent'),overlap=await executeCommand(env,'owner','feedingPlans.create',{...base,name:'虎皮 25-55 天',ageFromMonths:0,ageFromDays:25,ageToMonths:1,ageToDays:24},'enabled:overlap'),otherBreed=await executeCommand(env,'owner','feedingPlans.create',{...base,name:'玄凤 25-55 天',species:'玄凤',ageFromMonths:0,ageFromDays:25,ageToMonths:1,ageToDays:24},'enabled:other-breed');const active=await executeCommand(env,'owner','feedingPlans.setEnabled',{id:first.id,revision:first.revision,enabled:true},'enabled:on');assert.equal(active.isEnabled,true);const adjacentEnabled=await executeCommand(env,'owner','feedingPlans.setEnabled',{id:adjacent.id,revision:adjacent.revision,enabled:true},'enabled:adjacent-on');assert.equal(adjacentEnabled.isEnabled,true);await assert.rejects(executeCommand(env,'owner','feedingPlans.setEnabled',{id:overlap.id,revision:overlap.revision,enabled:true},'enabled:conflict'),error=>error.code==='CONFLICT');const otherBreedEnabled=await executeCommand(env,'owner','feedingPlans.setEnabled',{id:otherBreed.id,revision:otherBreed.revision,enabled:true},'enabled:other-breed-on');assert.equal(otherBreedEnabled.isEnabled,true)}finally{env.DB.close()}})

test('enabled feeding plans cannot be edited or deleted, while disabled plans are physically deleted',async()=>{const env=setup();try{const input={name:'可管理方案',species:'玄凤',stage:'雏鸟',ageFromMonths:0,ageFromDays:0,ageToMonths:1,ageToDays:0,feedingType:'FORMULA',formulaName:'A21',waterMl:30,powderScoops:'3',temperatureMin:38,temperatureMax:40,feedingsPerDay:3,amountMl:'8ml',feedingMethod:'针管',temperatureCheck:'温度计',preparationNotes:'现配',seedFoodName:'',seedFoodAmount:'',seedFoodNotes:'',feedingNotes:'慢喂',fullnessNotes:'观察',warningNotes:'异常联系'},plan=await executeCommand(env,'owner','feedingPlans.create',input,'feeding:lock-create'),birdRecord=await executeCommand(env,'owner','parrots.create',bird('MALE','FEED-LOCK-1'),'feeding:lock-bird'),linked=await executeCommand(env,'owner','parrots.setFeedingPlan',{id:birdRecord.id,revision:birdRecord.revision,feedingPlanId:plan.id},'feeding:lock-link'),enabled=await executeCommand(env,'owner','feedingPlans.setEnabled',{id:plan.id,revision:plan.revision,enabled:true},'feeding:lock-enable');await assert.rejects(executeCommand(env,'owner','feedingPlans.update',{...input,id:plan.id,revision:enabled.revision,name:'不可修改'},'feeding:lock-update'),error=>error.code==='INVALID_STATE');await assert.rejects(executeCommand(env,'owner','feedingPlans.delete',{id:plan.id,revision:enabled.revision},'feeding:lock-delete'),error=>error.code==='INVALID_STATE');const disabled=await executeCommand(env,'owner','feedingPlans.setEnabled',{id:plan.id,revision:enabled.revision,enabled:false},'feeding:lock-disable');await executeCommand(env,'owner','feedingPlans.delete',{id:plan.id,revision:disabled.revision},'feeding:lock-hard-delete');const row=await env.DB.prepare('SELECT COUNT(*) AS count FROM feeding_plans WHERE id=?').bind(plan.id).first(),linkedBird=await env.DB.prepare('SELECT feeding_plan_id FROM parrots WHERE id=?').bind(linked.id).first();assert.equal(row.count,0);assert.equal(linkedBird.feeding_plan_id,null)}finally{env.DB.close()}})

test('deleting an accidental sale restores inventory and statistics and permits resale', async () => {
  const env = setup()
  try {
    const created = await executeCommand(env, 'owner', 'parrots.create', bird('FEMALE', 'UNDO-SALE'), 'undo:create')
    const input = { parrotId: created.id, parrotRevision: 1, buyer: '误操作买家', saleDate: '2026-09-05', priceCents: 39800 }
    const sale = await executeCommand(env, 'owner', 'sales.create', input, 'undo:sale')
    const deleted = await executeCommand(env, 'owner', 'sales.delete', { id: sale.id, revision: 1 }, 'undo:delete')
    assert.equal(deleted.deleted, true)
    assert.deepEqual(await executeCommand(env, 'owner', 'sales.delete', { id: sale.id, revision: 1 }, 'undo:delete'), deleted)
    assert.equal((await executeRead(env, 'owner', 'sales.list', {}, '', '')).items.length, 0)
    const stats = (await executeRead(env, 'owner', 'dashboard.get', {}, '', '')).stats
    assert.equal(stats.forSale, 1)
    assert.equal(stats.sold, 0)
    assert.equal(stats.salesTotal, 0)
    assert.equal(stats.revenueCents, 0)
    assert.equal(stats.returnRate, 0)
    const restored = await env.DB.prepare('SELECT * FROM parrots WHERE id=?').bind(created.id).first()
    assert.equal(restored.status, 'FOR_SALE')
    assert.equal(restored.price_cents, bird('FEMALE', 'UNDO-SALE').priceCents)
    const resale = await executeCommand(env, 'owner', 'sales.create', { ...input, parrotRevision: restored.revision }, 'undo:resale')
    assert.notEqual(resale.id, sale.id)
    await assert.rejects(executeCommand(env, 'owner', 'sales.delete', { id: sale.id, revision: 1 }, 'undo:old'), error => error.code === 'NOT_FOUND')
    assert.equal((await env.DB.prepare('SELECT status FROM parrots WHERE id=?').bind(created.id).first()).status, 'SOLD')
  } finally { env.DB.close() }
})

test('sale deletion rejects another owner, stale revisions and returned sales', async () => {
  const env = setup()
  try {
    const created = await executeCommand(env, 'owner', 'parrots.create', bird('MALE', 'UNDO-GUARDS'), 'guard:create')
    const sale = await executeCommand(env, 'owner', 'sales.create', { parrotId: created.id, parrotRevision: 1, buyer: '买家', saleDate: '2026-09-05', priceCents: 100 }, 'guard:sale')
    await assert.rejects(executeCommand(env, 'other', 'sales.delete', { id: sale.id, revision: 1 }, 'guard:other'), error => error.code === 'NOT_FOUND')
    await assert.rejects(executeCommand(env, 'owner', 'sales.delete', { id: sale.id, revision: 2 }, 'guard:stale'), error => error.code === 'CONFLICT')
    await executeCommand(env, 'owner', 'sales.return', { id: sale.id, revision: 1, reason: '实际退货' }, 'guard:return')
    await assert.rejects(executeCommand(env, 'owner', 'sales.delete', { id: sale.id, revision: 2 }, 'guard:returned'), error => error.code === 'INVALID_STATE')
    assert.equal((await executeRead(env, 'owner', 'sales.list', {}, '', '')).items.length, 1)
    assert.equal((await env.DB.prepare('SELECT status FROM parrots WHERE id=?').bind(created.id).first()).status, 'RETURNED')
  } finally { env.DB.close() }
})

test('deleting an accidental sale restores a bird from the active recycle window', async () => {
  const env = setup()
  try {
    const created = await executeCommand(env, 'owner', 'parrots.create', bird('FEMALE', 'UNDO-RECYCLE'), 'undo-recycle:create')
    const sale = await executeCommand(env, 'owner', 'sales.create', { parrotId: created.id, parrotRevision: 1, buyer: '买家', saleDate: '2026-09-05', priceCents: 100 }, 'undo-recycle:sale')
    await executeCommand(env, 'owner', 'parrots.delete', { id: created.id, revision: 2 }, 'undo-recycle:delete-bird', 'admin-open-id')
    const result = await executeCommand(env, 'owner', 'sales.delete', { id: sale.id, revision: 1 }, 'undo-recycle:delete-sale', 'admin-open-id')
    assert.equal(result.restoredFromRecycleBin, true)
    const birdRecord = await env.DB.prepare('SELECT status,deleted_at,deleted_by FROM parrots WHERE id=?').bind(created.id).first()
    assert.equal(birdRecord.status, 'FOR_SALE')
    assert.equal(birdRecord.deleted_at, null)
    assert.equal(birdRecord.deleted_by, null)
    assert.equal((await executeRead(env, 'owner', 'sales.list', {}, '', '')).items.length, 0)
    const audit = await env.DB.prepare("SELECT actor_open_id FROM audit_logs WHERE action='parrots.restoreFromSaleDelete' AND target_id=?").bind(created.id).first()
    assert.equal(audit.actor_open_id, 'admin-open-id')
  } finally { env.DB.close() }
})
