# Deployment Notes

## Environment

- `NODE_ENV=production`
- `PORT`
- `TGG_STORE_DRIVER=pg`
- `TGG_PG_URL`
- `TGG_PG_SCHEMA`
- `TGG_PG_STATE_ID`
- `TGG_AUTH_SECRET`
- `TGG_AUTH_TOKEN_TTL_SECONDS`
- `TGG_TASK_CALLBACK_TOKEN` (at least 24 random characters)
- `TGG_TASK_PLATFORM_BASE_URL`, `TGG_TASK_PLATFORM_APPID`, `TGG_TASK_PLATFORM_KEY` (provider connection credentials)
- `TGG_TASK_PLATFORM_TIME_ZONE` (default `Asia/Shanghai`; confirm with the provider because the supplied `date("Ymd")` signing specification does not name a time zone)
- `TGG_TASK_PLATFORM_TIMEOUT_MS` (default `10000`, integer from `100` to `60000`; covers response headers and body, with no automatic retry of registration writes)
- `WECHAT_APPID`, `WECHAT_APPSECRET`
- `LFWIN_BASE_URL`, `LFWIN_API_KEY`, `LFWIN_SIGN_TYPE`, signing key/private key, `LFWIN_NOTIFY_URL`
- `HF_CALLBACK_TOKEN` (at least 24 random characters when the Huifu withdrawal provider is enabled; sent as `x-huifu-callback-token` or callback URL `token`)
- `HF_BASE_URL`, `HF_COM_KEY`, `HF_COM_SECRET`, `HF_MERCHANT_ID`, `HF_CALLBACK_URL` and optional `HF_WECHAT_APPID`, `HF_TRANSFER_MODE`, `HF_USER_RECV_PERCEPTION`, `HF_USER_RECV_TYPE` for the Huifu Bafang WeChat merchant-transfer withdrawal channel. `HF_COM_KEY` must be 16 UTF-8 bytes and `HF_COM_SECRET` 32 UTF-8 bytes; the API uses AES-256-CBC with `comKey` as IV and `comSecret` as key, plus a Unix timestamp in seconds.
- `LFWIN_REFUND_NOTIFY_URL` (required before approving cash refunds in production)

## Run

Run these commands from `dev/backend`:

```bash
npm run config:init
npm run config:check
```

`config:init` creates the Git-ignored `.env.production` once. It generates independent random authentication/task/withdrawal callback secrets, copies existing provider fields for verification, syncs the mini-program AppID, and sets callback URLs from the approved release origin. It never overwrites an existing file or changes `.env`. Existing provider settings still require production verification; a local UAT payment endpoint cannot override the documented production gateway `https://api2.lfwin.com`.

The supplied payment material contains a test key only. Do not use it as the production API/signing key. On 2026-09-17, a credential-free GET to the production gateway returned HTTP 200 with TLS verification; this proves endpoint availability only. The shop health endpoint also reported `driver=pg`, `storeReady=true`, `pgReady=true`; reuse the deployed database settings once available instead of initializing another production database. Its connection string is not exposed by the health endpoint. Preserve deployed authentication/callback secrets when updating an existing deployment; newly generated local secrets are not evidence of what that deployment uses.

Fill `TGG_PG_URL`, `WECHAT_APPSECRET`, `LFWIN_BASE_URL`, `LFWIN_API_KEY`, and the provider-issued signing credentials in `.env.production`. RSA needs the merchant private key and provider verification public key; use literal `\n` for PEM line breaks. MD5 needs `LFWIN_SIGN_KEY` and `LFWIN_SIGN_TYPE=MD5` only if confirmed by the provider. Do not generate substitute provider keys.

For Huifu Bafang, use the production API origin `https://tfapi.huifubafang.com`, bind the mini-program AppID and WeChat merchant ID in the provider console, and configure the generated `HF_CALLBACK_URL` (it contains the generated callback token). The default `CONFIRM` transfer mode returns `package_info` and requires the mini-program to invoke WeChat's `requestMerchantTransfer`; provider acceptance is required before enabling real withdrawals. The server records a payout only after an encrypted provider callback or a verified terminal query.

`config:check` exits nonzero on missing/invalid production settings, mismatched AppIDs or callback domains, disabled domain checking, or missing trial/release API origins. It prints field names, never credential values. Passing means offline configuration is valid, not that credentials, database access, refunds, ad verification or real-device acceptance have passed.

The approved mini-program API origin is `https://shop.taoguoguo.cc`. Register it in WeChat request/uploadFile/downloadFile legal domains, confirm HTTPS certificate validity, and configure platform callbacks using the generated independent tokens. The committed project configuration keeps `urlCheck=true`; the developer-tool private configuration may disable the local check while the tool refreshes its cached domain list. Do not put server secrets in the mini-program package.

After configuration checks pass, explicitly select the production file. PowerShell:

```powershell
$env:TGG_ENV_FILE = ".env.production"
npm start
```

Linux/macOS:

```bash
TGG_ENV_FILE=.env.production npm start
```

Environment variables override file values; `TGG_LOAD_DOTENV=0` disables file loading. Without `TGG_ENV_FILE`, the server retains its existing `.env` behavior. Production must run with `NODE_ENV=production`. Startup validates settings before importing storage or provider clients. A PostgreSQL URL does not migrate existing JSON data; back up and migrate/verify data before changing the running service.

Production requires all three task platform connection settings. Missing credentials prevent startup rather than enabling local mock tasks. Partially configured connections are rejected in development too. The supplied provider documentation permits HTTP; use HTTPS when supported by the provider.

For an explicit read-only connectivity check, run `node scripts/check-task-platform-live.js`. It reads `.env` unless `TGG_LOAD_DOTENV=0`, queries only categories, the first task page and one task detail, and prints counts and schema checks without credentials. It does not submit tasks or verify callbacks and rewards.

```bash
npm start
```

## Mini-program profile authorization

Deploy the backend with `PATCH /api/me` before releasing the updated mini-program login page. Login requires an explicit consent selection and uses WeChat privacy authorization when available. New accounts can select an avatar with `chooseAvatar`, enter a nickname with `type="nickname"`, or skip profile completion. Existing accounts can edit their profile from the account page. Configure the real user privacy protection guidelines in the WeChat console, including the use of avatar/nickname for profile display; the mini-program opens these guidelines through `wx.openPrivacyContract`.

Avatars use the existing authenticated upload endpoint and store a relative `/uploads/` path. Persist `dev/backend/data/uploads` across deployments and serve it from the mini-program HTTPS origin. Multiple backend instances must share the upload directory. SQLite adds the avatar column automatically; JSON and PostgreSQL retain the profile in their existing state snapshots. Verify consent refusal, avatar selection, nickname entry and relogin on a real device before release.

## Health

- `GET /api/health`
- Returns driver and readiness state.

## Notes

- The backend serves `/admin` and `/user` statically.
- PG is the production store driver.
- SQLite and JSON remain available for dev and smoke tests.
- Production startup requires PostgreSQL and validates authentication, WeChat, task platform, payment signing/verification keys, callbacks and configured withdrawal credentials.
- Production cash refund approval and ad rewards remain disabled in code. Completing this environment file does not implement their provider protocols or replace business acceptance.

## Task callback integration

- Configure a separate random `TGG_TASK_CALLBACK_TOKEN` on the server and the task platform callback URL: `https://YOUR_DOMAIN/api/task/callback?token=YOUR_CALLBACK_TOKEN`. If the provider supports headers, prefer `x-task-callback-token` instead. Exclude the token query value from proxy access logs.
- User Bearer tokens are not accepted as callback credentials. Missing configuration returns 503; an invalid callback token returns 401. The route awaits persistence before responding; PostgreSQL persistence error propagation still requires the remaining storage audit before production acceptance.
- Production cash refund approval is intentionally rejected until a real provider refund operation and signed refund callback are configured; development uses `mock_refund` only.
- The documented `task_register` response may contain `{}`. TGG saves the submission before calling the provider. An unmapped callback queries the platform examine list, comparing user, task, fields and creation time (five-minute tolerance; provider naive dates interpreted as Asia/Shanghai). Ambiguous matches return 409 and create a compensation record instead of issuing points.
- Verify provider response schema, pagination and timestamps with a real submission. Unmatched records beyond the bounded 20-page search require reconciliation; do not acknowledge them as settled.
- Failed/uncertain submissions are retained for investigation. Do not automatically resubmit a request whose provider outcome is unknown.
- Test servers use `TGG_LOAD_DOTENV=0` and explicit blank platform credentials. Regular smoke tests must never inherit production integration settings.
# 任务审核自动核对

提现服务商回调 `/api/providers/huifu/withdraw-callback` 必须携带独立的 `HF_CALLBACK_TOKEN`（请求头 `x-huifu-callback-token` 或 URL `token`），不能使用用户或后台 Bearer Token。未知状态返回 502；成功与失败终态互相拒绝，重复同向终态幂等，不会重复写流水。

后台主动查单与回调共用同一状态机；查单返回未知状态或逆向终态时不修改本地提现记录。3 项提现专项测试通过。

用户刷新、定时核对和平台回调成功处理关联结果后，会同步关闭对应的交单不确定/关联歧义异常及关联工单；平台仍审核中时仅解除关联不确定性，不发积分。奖励处理失败不会关闭这些工单，其他异常类型仍需各自补偿流程处理。

配置任务平台后，服务开始监听时执行一次核对，之后每 15 分钟执行一次。默认启用，TGG_TASK_SWEEP_ENABLED=0 可关闭；多实例部署应仅在一个实例启用。每轮最多轮换处理 20 条平台待审核交单，复用用户刷新接口的可信查询、唯一关联、奖励快照和幂等流水规则。不会自动重新交单；关联不唯一、平台仍审核中或查询失败时保留记录供后续核对。每条查询仍受 20 页上限约束，超出范围需管理员人工关联。

API 外部服务超时会保留 504，协议或响应格式异常会保留 502；未明确分类的内部异常统一返回通用 500 文案，避免把堆栈或内部路径返回给客户端。

同一进程的轮次不会重叠；关闭服务会停止后续记录并等待当前记录及持久化结束。日志仅记录处理计数或通用失败提示，不打印提交凭据。队列游标保存在进程内，重启会重新从队首开始；目前没有跨实例调度租约，多实例可能重复读取平台，需使用单个应用实例运行此定时任务。数据库现有并发冲突保护与幂等流水仍是最终保护，不能将此任务视为完整账务对账或分布式事务。
