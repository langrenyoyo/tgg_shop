# 银豹收银系统接入与联调

2026-11-18 更新：按要求移除小程序「我的」会员码入口、展示页面及条码绘制代码。后端会员码 GET / POST 接口、银豹会员关联和建档逻辑及已有数据继续保留。下文的小程序出示流程为历史接入说明，新版小程序不再提供该入口，也不再从该页面触发建档。界面变更需上传并发布小程序新版本后生效。

## 小程序门店会员码

入口：小程序「我的 → 会员码」。`GET /api/me/member-code` 仅向登录本人返回已同步的银豹 `number`（Code 128），保留前导零。GET 不产生外部写入；POST 自动建档/关联，均不扣款、不调整两端会员等级、积分或余额。

已开通会员首次进入会员码页，点击「授权手机号，获取会员码」。小程序将微信 `getPhoneNumber` 的一次性 code 提交至 `POST /api/me/member-code`，后端通过微信官方接口取得并校验手机号及 appid，不信任客户端手填号码。已有唯一启用的银豹会员按手机号关联；没有则用固定卡号建档，查询确认后持久化身份映射再展示条码。微信登录本身不包含手机号，因此需要这一次用户授权；后续打开页面自动恢复未完成流程。支付回调不等待外部建档，自动建档触发点为会员首次出示会员码。

2026-11-16 核对官方文档：https://platform.pospal.cn/openapi-doc/customer.html#customer-add 。V3 `/customer/add` 的 `number` 和 `tel` 均必填；`number` 在连锁内唯一，`validateTelUnique: true` 启用手机号查重。查询使用 `/customer/increment-page` 的 `number` 或 `tel` 筛选，完整且唯一才关联。手机号目前限定微信授权返回的中国大陆号码。

建档前将手机号授权结果、门店账号、固定卡号和归属标记持久化到 `config.pospalIntegration.memberProvisions`，不保存微信 code/access_token。每次重试先查回原卡号与手机号，不换卡号；超时后即使银豹已建档也能恢复。查询不完整、重复会员、停用会员、卡号冲突、其他用户已关联、门店账号变化均阻止自动绑定。服务端同账号请求合并；PG 状态 CAS 写入成功后才调用新增接口。失败后等待 30 秒再重试，未完成状态跨重启保留。

上线要求：后端配置 `WECHAT_APPID/WECHAT_APPSECRET` 和 `POSPAL_APP_ID/APP_KEY/ACCOUNT`；微信小程序已具备手机号快速验证能力，并在隐私保护指引中说明用于门店会员建档/关联和向银豹提供手机号。微信和银豹调用额度需可用。首次授权必须在微信真机完成，不用虚构号码在生产建档。银豹默认会员等级为 0，本功能只补齐身份识别；本地会员到期、折扣等级与门店权益同步不在此流程内。

2026-11-16 线上只读验证：使用部署环境凭据按固定测试卡号查询，银豹返回 `4021`（Token 额度不足）。未创建任何测试会员；需充值银豹额度并由真实用户在更新后的小程序中授权手机号，再完成门店验收。

纯激光扫码枪可能无法读取手机屏幕，需要使用支持屏幕识读及 Code 128 的扫描器；也可以手动输入显示的卡号。

门店验收：收银员先聚焦会员识别输入框，扫描小程序条形码，确认返回的是同一会员；测试含前导零的卡号、普通卡号、无关联账号和退回页面后重新进入。建议关闭扫码枪自动添加的前缀，按收银软件需要设置回车后缀。扫码只识别会员，不代表付款授权。

## 配置来源及协议

`shouyin.md` 提供银豹账号、商户名称、appId、appKey 和官方文档地址，不包含业务接口字段。商户为“小鹿生钱会员超市”，行业为零售。账号和凭据已写入本机 `dev/backend/.env`，由后端启动时加载；原始凭据文件与 `.env` 已加入 Git 忽略规则。

官方文档：https://platform.pospal.cn/openapi-doc/index.html

复用现有 `src/integrations/pospal/pospal-client.js` V3 适配器：JSON POST、秒级时间戳、唯一 UUID 请求号，签名为 `MD5(appId|requestId|timestamp|appKey)` 的大写值。总部凭据可通过请求体 `account` 指定门店。

## 复测

在 `dev/backend` 执行：

```sh
npm run pospal:check
node --test test/unit/pospal-integration.test.js
```

联调脚本加载与后端相同的环境配置，依次查询商品、门店、库存、会员、销售单、网单、支付方式；每个接口只请求一页，仅输出条数和状态。遇到余额不足或网络故障停止后续请求，失败退出码为 1。不会向银豹写入订单、库存、积分或余额。接口调用按银豹规则消耗 Token。

后台现有接口（需管理员登录及 integration 权限）：

- `GET /api/admin/integrations/pospal/status`：配置和最近同步结果。
- `POST /api/admin/integrations/pospal/sync`：同步商品、库存、会员、销售单、网单。
- `POST /api/admin/integrations/pospal/orders/{orderId}/push`：推送已支付现金订单，要求商品条码映射。

首次商品同步可用 `{"resources":["products"],"maxPages":1,"limit":10,"autoCreate":true,"resetCursor":true}`。导入商品默认为下架，需审核后发布。同步会更新本地映射及游标；库存同步默认覆盖本地库存，需预览时传 `apply:false`。会员同步只建立关联，不导入银豹余额或积分。

## 2026-10-09 实测结果

真实商品查询到达银豹平台，返回业务错误 `4021`：`当前账户 Token 余额不足，请充值后再调用正式服务`。尚未获得真实商品数据，其余资源查询及真实订单推送未验收。签名字段和算法已与当前官方 V3 文档核对；成功查询仍需充值后复测。

处理入口：https://platform.pospal.cn/openapi-doc/console.html 。账号补充开放平台 Token 后重新运行 `npm run pospal:check`，再执行所需后台同步。若后端已在运行，需重启以加载新增配置。此次仅配置本地 `.env`，未改动部署环境 `.env.production`。
