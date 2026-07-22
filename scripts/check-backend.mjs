import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const root=process.cwd()
const files=['worker/src/core.js','worker/src/db.js','worker/src/service.js','worker/src/media-security.js','worker/src/r2.js','worker/src/access.js','worker/src/index.js']
const required=[...files,'worker/package.json','worker/wrangler.toml','worker/migrations/0001_initial.sql','worker/migrations/0002_access_control.sql','worker/migrations/0003_access_settings.sql','worker/.dev.vars.example']
for(const file of required)if(!fs.existsSync(path.join(root,file)))throw new Error(`Missing Worker file: ${file}`)
JSON.parse(fs.readFileSync(path.join(root,'worker/package.json'),'utf8'))
for(const file of files){const result=spawnSync(process.execPath,['--check',path.join(root,file)],{encoding:'utf8'});if(result.status!==0){process.stderr.write(result.stderr);process.exit(result.status||1)}}
const tests=fs.readdirSync(path.join(root,'worker/tests/backend')).filter(file=>file.endsWith('.test.mjs')).map(file=>path.join(root,'worker/tests/backend',file))
const result=spawnSync(process.execPath,['--test',...tests],{stdio:'inherit'});if(result.status!==0)process.exit(result.status||1)
const miniSource=fs.readFileSync(path.join(root,'miniprogram/utils/cloud.ts'),'utf8')
if(/wx\.cloud|callFunction/.test(miniSource))throw new Error('Miniapp still contains CloudBase calls')
console.log(`Cloudflare backend checks passed: ${files.length} Worker modules, ${tests.length} test files`)
