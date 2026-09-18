# 真实任务平台接入与验收

依据：根目录 `api接口文档.txt` 的 1.2、2.1 至 2.7 节。

## 协议与实现

| 环节 | 平台接口 | 本站接口及处理 |
| --- | --- | --- |
| 分类、列表、详情 | task_type / task_list / task_info | GET /api/task-types、/api/tasks、/api/tasks/{id} |
| 交单 | task_register | POST /api/tasks/{id}/submit；先持久化交单与奖励快照；sf_uid 使用当前登录用户 ID |
| 审核记录 | get_examine_list | GET /api/submissions；已关联记录导航到本站交单详情，保留本地入账状态 |
| 审核核对 | get_examine_list | POST /api/submissions/{id}/sync；核对用户、任务和唯一平台订单，再幂等入账 |
| 回调 | 文档 2.7 | POST /api/task/callback；id、sf_uid、status、remarks；独立回调 token；成功返回 status=success |

服务端使用日期 + appid + key 的小写 MD5 签名，凭据只配置在服务端。提交字段 `images` 对应详情必填字段 `imgea`。平台返回 `data: {}` 时不能猜测审核单号，需通过审核列表唯一关联。提交超时保留原单，禁止自动重新交单。

文档 2.6 的 get_examine_info 参数说明为任务 ID，示例也是任务详情，没有可靠审核单状态。本站查询未关联的远程审核单详情时改为按用户审核列表定位，不把缺失状态默认为审核通过。

## 本次验证

- 2026-09-17 真实只读接口：5 个分类、首屏 10 条任务、详情必填 imgea/mobile、4 个步骤、10 张归一化图片，奖励字段有效。
- 2026-09-17 目标测试站 `https://shoptest.taoguoguo.cc/api/task-platform/status` 返回 HTTP 200、`mode: local_mock`。小程序默认连接该站，本机配置成功不代表目标站已接入；需要服务器部署入口以启用真实平台。
- 本次全量单元测试 247 项通过，JSON/SQLite/PG 冒烟通过。赚积分 Web 脚本编码损坏已修复，保留签到会话改动并通过 JavaScript 语法检查。
- 本地专项覆盖提交结果不确定、空响应关联、重复通知不重复奖励、用户隔离、列表到本站详情及奖励快照。
- 未据此宣称已完成真实提交、人工审核、公网回调或真实奖励入账验收。

## 真实交单验收条件

1. 指定本站测试用户、平台任务 ID、符合任务要求的真实凭证，或指定已有交单进行核对。不得用文档示例手机号或伪造截图制造真实交单。
2. 服务端配置 TGG_TASK_PLATFORM_BASE_URL、TGG_TASK_PLATFORM_APPID、TGG_TASK_PLATFORM_KEY；公网回调使用 HTTPS，并配置独立 TGG_TASK_CALLBACK_TOKEN。
3. 在平台登记 https://业务域名/api/task/callback?token=独立随机值，或由平台发送 x-task-callback-token。文档没有说明回调签名协议，因此需确认平台支持 URL query 或请求头，不能假设平台会发送本站自定义签名。
4. 用户从小程序交单，保存本站交单编号；网络不确定时使用原幂等键重试或同步核对，不另造新单。
5. 平台人工审核后检查回调与查单结果，本站积分流水、余额及邀请提成应与原快照一致。重复回调和重复同步不能重复入账；驳回不能发积分。
6. 通过持久化重启验证同一交单不重复入账，并检查异常工单是否关闭。

当前需要补充的是可用真实交单数据、平台回调登记和人工审核结果，不是重新索要文档已有的提交与查询接口。
