# 金币签到接入说明（2026-11-03）

## 当前交付范围

已实现小程序签到页面、后台配置、服务端会话/整轮进度、独立金币流水、幂等领取及持久化。用户尚未开通流量主，默认关闭，不包含已经联调完成的真实广告渠道。没有广告位或独立验证服务时，页面说明暂不可用，不以倒计时、前端传参或模拟广告发奖。金币不关联积分、会员、排行榜、提现或邀请分成。

入口：首页签到活动和任务页“签到领金币” → /pages/coin-signin/index；后台导航“签到设置”，读取需 config:read、修改需 config:write，保存沿用操作原因及审计。

## 后台规则

通过 PATCH /api/admin/config 提交完整 coinSignin 对象：

| 字段 | 范围及默认值 |
| --- | --- |
| enabled | 布尔，默认 false |
| minRounds / maxRounds | 1～10 的整数，min ≤ max，默认 2 / 4，两端均可取到 |
| intervalSeconds | 0～300 整数秒，默认 5 |
| rewardCoins | 1～100000 整数，默认 10 |
| sequence | 1～6 个 interstitial / rewarded，至少一个 rewarded；默认插屏、激励、插屏 |
| bannerAdUnitId / feedAdUnitId | 可选横幅/信息流广告位，不参与轮次奖励验证 |
| interstitialAdUnitId / rewardedAdUnitId | 启用时须配置 sequence 使用的广告位 |

允许关闭状态下保存空广告位。服务器快照首次开始时的规则，修改影响新会话；活动关闭立即阻止新开始及继续广告。当天已完成全部轮次仍可领取。coinSigninVerificationReady 仅表示服务端 HTTPS 地址及凭据已配置，不代表微信已开通、网关可用或真实广告核验已通过。密钥不返回前端。

## 用户流程与异常

1. 登录读取状态；按北京时间划分签到日期，每用户每天一会话。
2. 开始时以 crypto.randomInt(minRounds,maxRounds+1) 固定轮数。
3. 获取轮次请求携带幂等键；同键重试复用同一次尝试，新键重启未完成组；整轮保留。尝试有效期 30 分钟。
4. 原生 SDK 按配置顺序展示；激励视频必须明确 isEnded===true 才请求核对。插屏关闭也只触发服务端核对。
5. 服务端核验身份、会话、尝试、顺序和唯一完成凭据；全部步骤通过才加一轮，再开始服务器计时的轮间倒计时。
6. 广告响应/网络异常不增加奖励。页面内支持核对丢失响应，重复核对不会重复加轮；退出、切后台或离开页面会取消当前本地流程，重新进入读取已完成整轮。
7. 完成全部轮数后点击“完成签到”，唯一流水键 coin-signin:<userId>:<北京时间日期>，数据库写入成功才返回成功；重试不重复发奖。
8. 进入次日后旧会话不可继续或补领，历史已领取金币保留。

旧 /api/daily-signin/claim 返回 410，不能绕过广告流程；旧转盘接口继续关闭。旧签到查询仅用于历史兼容，不作为新金币状态。

## 真实广告接入边界

src/services/signin-ad-verifier.js 提供项目自有验证网关协议，**不是微信官方接口，也不是已完成的微信服务端验证适配器**。当前 SDK 仅能触发本地生命周期事件，尚未对接渠道可信回执及其与 stepId 的绑定。实际能否对激励和插屏分别获取独立可信凭据，须根据开通后的官方能力确认；若某类型不能可靠核验，不能伪造完成结果或仅凭关闭事件启用它，应调整支持的广告序列和交互后再上线。

环境变量留空直到正式联调：

    SIGNIN_AD_VERIFIER_URL=
    SIGNIN_AD_VERIFIER_TOKEN=

配置 HTTPS 网关后，后端使用 Bearer token 发送 POST（8 秒超时、禁止重定向）：

    {
      "userId": "...", "wechatOpenid": "...", "sessionId": "...",
      "attemptId": "...", "stepId": "...", "stepIndex": 0,
      "adUnitId": "...", "adType": "rewarded", "startedAt": 1793678400000
    }

网关必须独立核验渠道签名/可信回执、广告实例、用户、完成时间和本次尝试，并将该事件绑定到准确步骤；仅返回调用方提交的字段或基于过去播放记录推测完成均不符合协议。未收到可信凭据时返回 verified:false。通过时返回：

    { "verified": true, "userId": "...", "attemptId": "...", "stepId": "...", "adUnitId": "...", "receiptId": "provider-unique-event-id" }

receiptId 须为稳定、全局唯一的非空字符串（最长 200 字符），重试同事件返回同一 ID，禁止把一个播放凭据分配给多个步骤或用户。后端验证身份字段完全一致、禁止凭据重放，拒绝不可验证或异常结果。测试注入仅存在于 Node 测试调用中，HTTP 请求不能传入验证器或 verified:true 来替代核验。

上线前需完成真实广告位配置、官方允许的展示次数/间隔核对、渠道可信回执绑定、真机播放与页面生命周期联调。只有完成这些实际接入工作，才可开启发奖；本次不保证审核结果。

## 存储及验证

JSON / PostgreSQL 的原有状态快照保存 coinSignin.sessions 和 coinSignin.ledger；SQLite 使用 coin_signin_state 单行快照，由原有事务共同保存。当前使用既有单写实例架构与进程内互斥，PostgreSQL 沿用状态写冲突保护，不适用于未经改造的多写实例部署。

测试命令：node --no-warnings --test test/unit/coin-signin*.test.js test/unit/miniprogram-coin-signin.test.js。测试验证器只在测试隔离状态中提供确定回执；不能证明真实微信广告已联通。后台浏览器测试位于 test/e2e/frontend-cdp.test.js。
