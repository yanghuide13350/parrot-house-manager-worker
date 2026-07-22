import fs from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createD1 } from './helpers/d1-adapter.mjs'
import { mediaSignature } from '../../src/core.js'
import { mediaItems } from '../../src/db.js'
import worker from '../../src/index.js'

const migration=fs.readFileSync(new URL('../../migrations/0001_initial.sql',import.meta.url),'utf8')
const secret='media-secret-that-is-longer-than-thirty-two'

function imageObject() {
  const bytes=new TextEncoder().encode('jpeg-bytes')
  return {
    body:new Blob([bytes]).stream(),
    httpEtag:'image-etag',
    uploaded:new Date('2026-07-20T00:00:00Z'),
    size:bytes.byteLength,
    range:{offset:0,length:bytes.byteLength},
    writeHttpMetadata(headers){headers.set('content-type','image/jpeg')}
  }
}

test('image and thumbnail URLs return the R2 image with its MIME type',async()=>{
  const DB=createD1(migration),now=new Date().toISOString(),assetId='image-asset'
  const env={DB,MEDIA_SIGNING_SECRET:secret,MEDIA_BUCKET:{get:async key=>{assert.equal(key,'private/owner/image.jpg');return imageObject()}}}
  const cacheStore=new Map()
  globalThis.caches={default:{
    async match(request){const cached=cacheStore.get(request.url);return cached?cached.clone():undefined},
    async put(request,response){if(response.status===206||response.headers.get('content-range'))throw new TypeError('Cannot cache response to a range request (206 Partial Content).');cacheStore.set(request.url,response)}
  }}
  try {
    await DB.prepare('INSERT INTO media_assets (id,owner_open_id,type,size,file_name,object_key,upload_id,mime,source,status,revision,created_at,updated_at,deleted_at,deleted_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(assetId,'owner','image',10,'image.jpg','private/owner/image.jpg',null,'image/jpeg','LOCAL_UPLOAD','COMMITTED',1,now,now,null,null).run()
    const expires=Math.floor(Date.now()/1000)+3600,signature=await mediaSignature(assetId,expires,secret),base=`https://api.example.com/api/media/${assetId}?expires=${expires}&signature=${signature}`
    for (const url of [base,`${base}&variant=thumbnail`]) {
      const response=await worker.fetch(new Request(url),env)
      assert.equal(response.status,200)
      assert.equal(response.headers.get('content-type'),'image/jpeg')
      assert.equal(await response.text(),'jpeg-bytes')
    }
    const cached=await worker.fetch(new Request(base),env)
    assert.equal(cached.status,200)
    assert.equal(await cached.text(),'jpeg-bytes')
  } finally { DB.close(); delete globalThis.caches }
})

test('image list thumbnails use the original signed R2 URL',async()=>{
  const [image]=await mediaItems({},[{assetId:'image-asset',type:'image',key:'private/owner/image.jpg'}],secret,'https://api.example.com','')
  assert.equal(image.thumbnailFileID,image.fileID)
})
