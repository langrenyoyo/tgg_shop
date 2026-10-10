# 银豹收银系统接入与联调

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
