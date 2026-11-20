# 微信订单管理接入说明

## 文档分析与接入范围

根目录《微信小程序订单管理.md》实际描述的是微信支付 API v3 普通商户 JSAPI 下单接口 `POST /v3/pay/transactions/jsapi`，不是微信订单发货管理接口。它要求收款商户号、与小程序绑定的 AppID、商户请求签名等。若要改为微信支付直连，还需配套商户私钥、证书序列号、平台验签证书或公钥、API v3 Key，以及查单、关单、支付通知验签解密和退款。现有 `HF_MERCHANT_ID` 属于提现渠道，不能据此推定它就是 LFWin 商品收款商户。

本次针对前文付款限制排查所需的订单发货管理接入：继续使用已验证的 LFWin `comm.mini.pay` 收款，通过小程序 AppID/AppSecret 调用微信订单管理服务。未把上述 JSAPI 下单文档当作发货接口，也没有以接入代码代替后台商户授权。

2026-11-20 的微信官方接口查询结果：`is_trade_managed=true`，`is_trade_management_confirmation_completed.completed=false`。这证明小程序已开通发货信息管理服务，但关联商户的交易结算管理确认未全部完成；不能仅凭这两个状态断定此前付款限制的全部原因。

## 业务行为

| 业务节点 | 接入行为 |
| --- | --- |
| LFWin 小程序预下单 | 在服务端私有配置中保存本次付款的 AppID/OpenID 快照，不返回客户端 |
| 已验签的付款通知或付款查询 | 校验本地单号及金额后记录 `trade_no`，仅作为待向微信核实的交易号；不拿 LFWin 的 `orderid` 充当微信支付交易号 |
| 自建配送员发货 | 订单进入配送中后入持久化队列，按微信同城配送 `logistics_type=2`、统一发货上报 |
| 自提站点收齐商品 | 到站确认可提货后入队，按用户自提 `logistics_type=4` 上报；核销也会补充入队 |
| 历史订单 | 定时扫描已真实付款且实际履约的订单补入队；仅在有上游交易号且微信身份/金额回查一致时上报 |
| 未支付、纯积分、取消或退款完成 | 不上传发货信息；处理中退款暂停上报，驳回后可恢复 |
| 用户确认收货 | 订单详情调起 `wx.openBusinessView({ businessType: 'weappOrderConfirm' })`；返回后服务端重新查询微信订单 |
| 微信确认收货回查 | 交易号、付款用户和金额均匹配，且状态为 3 或 4，才记录微信确认收货；配送订单还需本地确已送达，才完成本地订单 |

微信发货上传前也必须回查支付单，验证真实交易号、付款用户、金额和既有发货方式。不会伪造快递公司、运单号、物流或收货状态。微信已有不同发货方式时保留原数据并提示核查。

站点核销表示实物已交付，与用户在微信确认收货分别记录。启用后的真实微信配送订单不再由本地七天定时任务代替微信确认；纯积分和其他渠道继续沿用现有确认方式。小程序返回的成功回调仅作为触发查单的信号，不作为收货凭证。

## 配置与后台操作

```dotenv
WECHAT_APPID=<当前小程序 AppID>
WECHAT_APPSECRET=<当前小程序 AppSecret，仅服务端保存>
WECHAT_ORDER_MANAGEMENT_ENABLED=1
```

配置示例默认关闭自动同步。启用后每 30 秒检查队列，每批最多 10 单；微信授权状态缓存最多五分钟。无需复用提现商户号或收款签名 Key。

只读核查命令：`npm run wechat-orders:check`。服务器可指定 `TGG_ENV_FILE=/etc/tgg-shop/tgg-shop.env` 读取实际配置；输出仅包含配置标记、开通及授权布尔值和安全错误码，不读取或修改业务库。

1. 在微信公众平台的订单管理/交易结算管理页面完成确认；核对所有关联商户号，完成订单管理授权，或核实后解绑不用的商户号。LFWin 收款商户/子商户号需向收款服务商确认。
2. 后台“订单管理”页点击“检查微信授权状态”，确认已开通、确认已完成；该操作需要 `integration:read`。查看同步摘要需要 `order:read`。
3. 在服务器环境文件设置开关并重启。若授权尚未完成，队列显示等待授权，系统不会上传。
4. 小程序的微信确认收货入口需要上传新版并完成微信审核、发布。旧版客户端会收到明确提示，不能通过旧 `/receive` 接口绕过微信确认。
5. 使用真实微信付款，随后按实际业务发货/到站，查看“微信订单同步”列；用户实际领取或收到商品后通过微信确认收货，最后核查微信与本地状态。

原生确认收货组件要求支持 `wx.openBusinessView` 的微信版本，低版本显示升级提示。测试开关、客户端自报付款成功或人工改订单状态均不能代替付款证据。

## 失败与恢复

队列保存在 `state.config.wechatOrders`，包含支付身份私有快照、订单任务和授权状态，沿用现有 JSON/SQLite/PostgreSQL 存储，不新增数据库表。对外接口仅返回允许公开的状态字段，不返回 AppSecret、access_token、OpenID 或原始微信响应。

- 上传意图必须先成功保存。存储失败会停止 worker，修复并重启后先查单核实。
- 上传超时或进程在发送后中断，任务进入结果待核查；自动重试仅查询微信，不自动重发，避免消耗微信每笔订单唯一一次重新发货机会。
- 微信明确拒绝请求时按退避时间重试；授权、交易身份或既有发货方式冲突会显示明确原因。
- 有 `integration:write` 权限的后台人员可核查后重试，必须填写原因。结果不明的上传必须先核查微信后台确实未发货、距离上次上传至少一分钟，并由服务端再次查单确认后才允许重新排队。
- 已同步任务不会重复上传。定期查单跟进微信收货状态；退款完成后停止跟进，不改变支付、积分、赠会员或退款账务。

## 接口

| 接口 | 用途 |
| --- | --- |
| `GET /api/admin/integrations/wechat-orders/status` | 查看安全配置标记、授权缓存及队列数量 |
| `POST /api/admin/integrations/wechat-orders/check` | 回查微信订单管理开通及交易结算确认状态 |
| `POST /api/admin/integrations/wechat-orders/orders/:orderId/retry` | 核查后重新排队，必填 `reason`；不明结果另需 `confirmUnshipped=true` |
| `GET /api/orders/:orderId/wechat-receipt` | 本人订单的原生确认收货参数，核验实物已交付及发货已同步 |
| `POST /api/orders/:orderId/wechat-receipt` | 服务端查询微信收货结果，忽略客户端提交的收货状态 |

所有用户端接口按登录账号校验订单归属；后台接口分别校验读取和集成操作权限，并限制请求频率。接口详情见 `openapi.yaml`。

官方参考：

- [微信发货信息管理服务](https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/business-capabilities/order-shipping/order-shipping.html)
- [发货信息录入](https://developers.weixin.qq.com/miniprogram/dev/server/API/order_shipping/api_uploadshippinginfo.html)
- [查询订单发货状态](https://developers.weixin.qq.com/miniprogram/dev/server/API/order_shipping/api_getorder.html)
- [交易结算管理确认查询](https://developers.weixin.qq.com/miniprogram/dev/server/API/order_shipping/api_istrademanagementconfirmationcompleted.html)
- [小程序确认收货组件](https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/business-capabilities/order-shipping/order-shipping-half.html)
