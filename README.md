# Parrot Pro Cloudflare 后端部署

## 架构

- Cloudflare Workers：HTTPS API 和微信登录。
- D1：业务数据、幂等回执和审计。
- Cloudflare R2：私有图片与视频存储。
- Durable Objects：串行化单主账号写命令；D1 `batch` 原子提交多表变更。
- Cron Triggers：每天清理超过 24 小时的未完成上传和孤儿媒体。

小程序不再使用 CloudBase。正式请求路径是 `小程序 -> 自定义 HTTPS 域名 -> Worker -> D1/R2`。

## 1. 准备账号与域名

准备一个已接入 Cloudflare 的域名，例如 `api.huidecode.com`。中国大陆真机访问标准 Cloudflare 网络可能存在延迟，发布前必须分别使用移动、联通、电信网络测试。

在微信公众平台取得当前小程序 `wx013459f02ef0288c` 的 AppSecret。AppSecret 只写入 Wrangler Secret，不能提交到仓库。

## 2. 创建资源

```bash
cd worker
npm install
npx wrangler login
npx wrangler d1 create parrot-pro-dev
npx wrangler r2 bucket create parrot-pro-media
```

把 D1 命令返回的 `database_id` 填入 `worker/wrangler.toml`；`[[r2_buckets]]` 的 `bucket_name` 必须与刚创建的 R2 桶一致。R2 通过 Worker binding 授权，不需要 access key。

应用数据库迁移：

```bash
npx wrangler d1 migrations apply parrot-pro-dev --remote
```

## 3. 配置 Secrets

依次执行：

```bash
npx wrangler secret put WX_APP_SECRET
npx wrangler secret put SESSION_SECRET
npx wrangler secret put SHARE_TOKEN_SECRET
npx wrangler secret put MEDIA_SIGNING_SECRET
```

`SESSION_SECRET`、`SHARE_TOKEN_SECRET` 和 `MEDIA_SIGNING_SECRET` 分别使用独立随机值，可通过 `openssl rand -base64 48` 生成。不要复用微信 AppSecret。

首次部署时不要配置 `OWNER_OPENID`，然后执行：

```bash
npx wrangler deploy
```

Durable Object 的 `v1` migration 会在首次部署时创建。

## 4. 绑定自定义域名

在 Cloudflare Dashboard 的 Worker 设置中添加 Custom Domain，例如：

```text
api.example.com
```

访问 `https://api.example.com/api/health`，应返回：

```json
{"ok":true,"data":{"status":"ok"}}
```

将该地址填入 `miniprogram/config.ts`：

```typescript
export const API_BASE_URL = 'https://api.example.com'
```

然后执行 `npm run build:miniapp` 并重新编译小程序。

## 5. 绑定主账号

首次从开发者工具打开小程序时，后端会完成 `wx.login -> code2Session`，页面显示当前微信的 OpenID。点击 OpenID 可复制。

使用 `npx wrangler secret put OWNER_OPENID` 写入复制的 OpenID。此后只有这个微信账号能进入管理端，其他账号只能访问有效分享页。

## 6. 微信合法域名

在微信公众平台的“开发管理 -> 开发设置 -> 服务器域名”中配置：

- request 合法域名：`https://api.example.com`
- downloadFile 合法域名：`https://api.example.com`

媒体分片使用 `wx.request`，因此不需要单独配置 uploadFile 域名。开发者工具中关闭域名校验只能用于本地调试，真机和体验版必须配置合法域名。

## 7. 开发种子

开发环境需要演示数据时，将 `worker/seed/dev.sql` 中的 `OWNER_OPENID_REPLACE_ME` 替换成主账号 OpenID，再执行：

```bash
cd worker
npx wrangler d1 execute parrot-pro-dev --remote --file seed/dev.sql
```

正式环境禁止执行种子文件。

## 8. 正式环境

正式环境单独创建 D1 和 R2 桶，使用独立 `wrangler` environment 和正式 API 域名。不要让开发与正式环境共用数据库、R2 bucket 或会话密钥。

部署前执行：

```bash
npm run build:miniapp
npm run check:backend
npm run check:miniapp
npx tsc --noEmit
npm run build
```

## 运维

- 图片上限 10 MB，本地视频上限 80 MB，以 5 MB 分片上传；URL 视频导入上限 20 MB。
- 媒体读取使用一小时签名 URL，支持视频 Range 请求。
- 每天 03:00 UTC 清理未完成上传和孤儿媒体。
- 定期执行 D1 导出，并监控 Worker 错误率、D1 操作量和 R2 存储量。
- 如果中国大陆真机网络不稳定，应将 API 迁移到大陆合规节点，不要通过关闭超时或无限重试掩盖问题。
