# TGG Shop 微信小程序端

## 说明

当前已注册 17 个页面，覆盖：

- 登录
- 首页
- 任务列表 / 任务详情 / 任务提交
- 签到
- 邀请
- 我的 / 订单 / 积分
- 商城 / 商品详情 / 购物车 / 结算 / 订单详情 / 会员

## 接口

开发版、体验版和正式版地址集中在 `config/environments.js`，通过 CommonJS 导出供小程序加载。已确认使用：

```text
https://shop.taoguoguo.cc
```

仅开发版可通过存储 `tgg_config` 覆盖为其他 HTTPS 地址。体验版和正式版忽略缓存地址：

```js
wx.setStorageSync("tgg_config", {
  tggApiUrl: "https://shop.taoguoguo.cc"
});
```

## 发布配置

1. 用微信开发者工具导入 `wechat-miniprogram/`，AppID 为 `wx7cdc387f27520de8`。
2. 微信公众平台的 request、uploadFile 和 downloadFile 合法域名添加 `https://shop.taoguoguo.cc`；其他实际使用的素材域名按资源来源登记。正式项目配置 `project.config.json` 保持 `urlCheck: true`；本地私有配置允许开发者工具暂时跳过域名校验，避免域名配置缓存阻塞本地联调。
3. 后端配置见 `../dev/backend/DEPLOYMENT.md`，在该目录运行 `npm run config:check`。此命令仅检查离线配置，不验证真实凭证或宣布业务可上线。
4. 真机验收微信登录、上传、支付与查单，以及任务提交、审核回调和积分入账。

现金退款及广告奖励在生产环境仍被保护性禁用，需要完成真实通道及服务端验证，不能通过补配置直接开放。完整历史验收记录见 `CLOSURE-AUDIT.md`。
