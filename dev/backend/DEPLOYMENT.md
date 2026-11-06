# Deployment Notes

## Environment

- `NODE_ENV=production`
- `PORT`
- `TGG_STORE_DRIVER=pg`
- `TGG_TRUST_PROXY=1` only when Nginx or another trusted reverse proxy overwrites `X-Forwarded-For` and the backend is private; leave it `0` for direct access.
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
- `HF_BASE_URL`, `HF_COM_KEY`, `HF_COM_SECRET`, `HF_MERCHANT_ID`, `HF_CALLBACK_URL`, and `HF_WECHAT_APPID` for the Huifu Bafang WeChat merchant-transfer withdrawal channel. `HF_TRANSFER_MODE` defaults to `AUTH`. `HF_MERCHANT_ID` is the bound WeChat Pay merchant ID for V3. Native AUTH passes that same ID to WeChat; if `HF_WECHAT_MCH_ID` is also configured it must match. Retain `HF_WECHAT_MCH_ID` for legacy confirmation orders. Other settings include `HF_USER_RECV_PERCEPTION` and `HF_USER_RECV_TYPE`. `HF_COM_KEY` must be 16 UTF-8 bytes and `HF_COM_SECRET` 32 UTF-8 bytes; the API uses AES-256-CBC with `comKey` as IV and `comSecret` as key, plus a Unix timestamp in seconds.
- `LFWIN_REFUND_NOTIFY_URL` (required before approving cash refunds in production)

## Run

Run these commands from `dev/backend`:

```bash
npm run config:init
npm run config:check
```

Before starting a persistent deployment, provision the bootstrap administrator
without putting a plaintext password in an argument, shell history or log:

```bash
printf '%s' 'a-new-password-from-a-secret-manager' | npm run admin:hash-password
```

Put the returned `scrypt:...` value in `TGG_ADMIN_PASSWORD_HASH` in the
root-owned environment file, set `TGG_ADMIN_USERNAME` and `TGG_ADMIN_NAME`,
then run `npm run admin:provision` once. The command activates only the
explicit super-admin account, disables shared seeded credentials, and never
prints the password or hash. Rotate the environment hash after provisioning
only if the account is reset through the authenticated admin workflow.

`config:init` creates the Git-ignored `.env.production` once. It generates independent random authentication/task/withdrawal callback secrets, copies existing provider fields for verification, syncs the mini-program AppID, and sets callback URLs from the approved release origin. It never overwrites an existing file or changes `.env`. Existing provider settings still require production verification; a local UAT payment endpoint cannot override the documented production gateway `https://api2.lfwin.com`.

The supplied payment material contains a test key only. Do not use it as the production API/signing key. On 2026-09-17, a credential-free GET to the production gateway returned HTTP 200 with TLS verification; this proves endpoint availability only. The shop health endpoint also reported `driver=pg`, `storeReady=true`, `pgReady=true`; reuse the deployed database settings once available instead of initializing another production database. Its connection string is not exposed by the health endpoint. Preserve deployed authentication/callback secrets when updating an existing deployment; newly generated local secrets are not evidence of what that deployment uses.

Fill `TGG_PG_URL`, `WECHAT_APPSECRET`, `LFWIN_BASE_URL`, `LFWIN_API_KEY`, and the provider-issued signing credentials in `.env.production`. RSA needs the merchant private key and provider verification public key; use literal `\n` for PEM line breaks. MD5 needs `LFWIN_SIGN_KEY` and `LFWIN_SIGN_TYPE=MD5` only if confirmed by the provider. Do not generate substitute provider keys.

For Huifu Bafang, use the production API origin `https://tfapi.huifubafang.com`, bind the mini-program AppID and WeChat merchant ID in the provider console, and configure the generated `HF_CALLBACK_URL` (it contains the generated callback token). New withdrawals default to `AUTH`; set `HF_TRANSFER_MODE=AUTH` explicitly in the deployed environment file as existing `CONFIRM` overrides still take precedence. The server records a payout only after an encrypted provider callback or a verified terminal query. Existing submitted orders without a mode snapshot retain the legacy `CONFIRM` behavior, and their confirmation entry remains available. Retain `HF_WECHAT_MCH_ID` until those orders are resolved.

### Native AUTH authorization (Apifox V3, updated 2026-11-06)

Use `HF_TRANSFER_MODE=AUTH`, `HF_AUTHORIZATION_PATH=/wx/auth/apply` (also the default), and the shop's `HF_WECHAT_APPID`. Do not put a mini-program page path in this setting. The selected flow does not navigate to a Huifu mini-program and does not use Chapter 4 batch payouts.

POST `/api/withdrawals/authorization` queries `/wx/auth/query` with the server-bound merchant/AppID/OpenID first. Existing pending/active authorization is reused; only a closed authorization or documented 1002 not-found response allows a new application. Other errors block the flow. The server persists a unique 5–32 character alphanumeric `authorization_no` before calling `/wx/auth/apply`, with `user_display_name`, `user_recv_perception` and `notify_url`. Network uncertainty retains that number. Pending applications expire after 24 hours; this is not the lifetime of effective consent.

The client uses the returned `mchId/appId/authorizationPackage` to call `wx.requestMerchantTransfer` in the current mini-program. Native success never activates consent. GET authorization, new withdrawal creation and provider submission query the provider; only `TAKING_EFFECT` with matching bindings is active. `WAIT_USER_CONFIRM` is pending and `CLOSED` revokes authorization (timeout closure is displayed as expired).

Set independent `HF_AUTHORIZATION_CALLBACK_TOKEN` and HTTPS `HF_AUTHORIZATION_CALLBACK_URL` containing that token. Configure all authorization changes at `/api/providers/huifu/authorization-callback`. The old revoked callback route is only an alias for this same encrypted protocol; it never forces a status. Callbacks require matching `comKey`, encrypted `data`, `timestamp`, `notify_type=wx_transfer_auth`, authorization number and full identity bindings; the server then queries current state to prevent replay restoring consent. Both payout and authorization callbacks ACK JSON `{"code":200,"message":"SUCCESS"}`.

V3 payout uses `/wx/transfer/pay` and `/wx/transfer/query`. The documented arrival limit is 10–20000 cents; the app conservatively caps the gross request at 200 yuan and enforces at least 0.1 yuan after fees. The configured daily count of 2 and daily limit of 500 remain; two 200-yuan requests mean the effective daily maximum is 400 yuan. Public config shows the effective single limit while the stored admin limit is preserved. Review any custom withdrawal notice in the admin for obsolete 500-yuan single-limit promises.

Before sending funds, the server saves the order ID, recipient, mode, amount and authorization snapshot. Uncertain/previous sends are queried instead of resubmitted. V3 results omit amounts: only a trusted query with both matching order IDs and a matching saved submission snapshot can settle such a success. Old orders without sufficient evidence require finance reconciliation; do not fabricate snapshots. Failures are unfrozen once, and terminal results cannot be reversed by delayed notifications. Page refresh queries up to three processing orders; finance can also query each order. Preserve the existing approval process.

Deployment still needs merchant AUTH capability, AppID binding, IP whitelist, callback reachability and real-device acceptance. Code and fixture tests do not establish those capabilities. Test first-time consent, cancellation, return, revocation, timeout, duplicate callbacks and actual settlement with the merchant. Provider real-name/risk limits still apply (e.g. codes 1013/1025/1026); the supplied docs conflict on monthly real-name thresholds, so do not invent a threshold or present this change as bypassing verification. No real transfers or server changes are performed by local verification.


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

Environment variables override file values; `TGG_LOAD_DOTENV=0` disables file loading. Production and every PostgreSQL deployment must set an explicit `TGG_ENV_FILE` (the supplied systemd unit uses `/etc/tgg-shop/tgg-shop.env`) and `TGG_LOAD_DOTENV=0`; the server refuses to fall back to a checkout-local `.env` for persistent storage. Production must run with `NODE_ENV=production`. Startup validates settings before importing storage or provider clients. A PostgreSQL URL does not migrate existing JSON data; back up and migrate/verify data before changing the running service.

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

## Isolated payment and withdrawal test bypass

For a local or isolated test server only, set `TGG_TEST_BYPASS_ENABLED=1` while keeping `NODE_ENV=development` (or another non-production value). The public config then exposes `testBypassEnabled`; the web client and mini-program skip the real payment prompt and settle the user's own test payment through `/api/test/payments/{payNo}/settle`. A submitted withdrawal can be completed through `/api/test/withdrawals/{withdrawalId}/complete`, which writes a `TEST_SUCCESS` payout record without contacting Huifu.

The bypass is rejected whenever `NODE_ENV=production`, even if the flag is accidentally left on. Do not enable it on a shared staging environment with real user data. Turn it off with `TGG_TEST_BYPASS_ENABLED=0` before any production deployment.

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
