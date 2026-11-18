// Official unlimited mini-program codes. Credentials and access tokens stay server-side.
function createInviteCodeService({ env = process.env, fetchImpl = (...args) => fetch(...args), now = Date.now } = {}) {
  const cache = new Map(), pending = new Map();
  let token, tokenPending;
  const page = "pages/home/index";
  async function accessToken(appid, secret) {
    const key = `${appid}:${secret}`;
    if (token?.key === key && token.expiresAt > now()) return token.value;
    if (tokenPending?.key === key) return tokenPending.promise;
    const promise = (async () => {
      const response = await fetchImpl("https://api.weixin.qq.com/cgi-bin/stable_token", {
        method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(10000),
        body: JSON.stringify({ grant_type: "client_credential", appid, secret, force_refresh: false })
      });
      const body = await response.json();
      if (!response.ok || body.errcode || !body.access_token) throw new Error("微信小程序码服务暂不可用，请稍后重试");
      token = { key, value: body.access_token, expiresAt: now() + Math.max(0, Number(body.expires_in || 7200) - 120) * 1000 };
      return token.value;
    })();
    tokenPending = { key, promise };
    try { return await promise; } finally { if (tokenPending?.promise === promise) tokenPending = null; }
  }
  async function generate(appid, secret, code, version) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const access = await accessToken(appid, secret);
      const response = await fetchImpl("https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token=" + encodeURIComponent(access), {
        method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(15000),
        body: JSON.stringify({ scene: code, page, check_path: true, env_version: version, width: 430, auto_color: false, line_color: { r: 0, g: 158, b: 96 }, is_hyaline: false })
      });
      const bytes = Buffer.from(await response.arrayBuffer());
      const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
      if (response.ok && (png || jpeg) && bytes.length > 32 && bytes.length <= 1024 * 1024) {
        return { inviteCode: code, page, envVersion: version, mimeType: png ? "image/png" : "image/jpeg", imageBase64: bytes.toString("base64") };
      }
      let error = {};
      try { error = JSON.parse(bytes.toString("utf8")); } catch { /* Never forward binary or provider responses to users. */ }
      if ([40001, 40014, 42001].includes(Number(error.errcode)) && attempt === 0) { token = null; continue; }
      if (Number(error.errcode) === 41030) throw new Error("邀请入口尚未发布，请联系管理员发布小程序后重试");
      if (Number(error.errcode) === 45009) throw new Error("微信小程序码生成额度暂时不足，请稍后重试");
      throw new Error("微信小程序码生成失败，请稍后重试");
    }
  }
  return async function getInviteCode(user) {
    if (!user || user.status !== "active") return { status: 401, body: { error: "请先登录" } };
    const code = user.inviteCode;
    if (typeof code !== "string" || !/^[a-zA-Z0-9_-]{1,32}$/.test(code)) return { status: 409, body: { error: "邀请码格式异常，请联系管理员" } };
    const appid = env.WECHAT_APPID, secret = env.WECHAT_APPSECRET;
    const version = env.WECHAT_INVITE_CODE_ENV || "release";
    if (!appid || !secret || !["release", "trial", "develop"].includes(version)) return { status: 503, body: { error: "小程序码服务未配置，请联系管理员" } };
    const key = `${appid}:${version}:${code}`;
    let work = pending.get(key);
    if (!work) {
      const existing = cache.get(key);
      if (existing && existing.expiresAt > now()) return { status: 200, body: { ...existing.value, userId: user.id } };
      if (pending.size >= 32) return { status: 503, body: { error: "小程序码生成繁忙，请稍后重试" } };
      work = generate(appid, secret, code, version).then(value => {
        cache.delete(key);
        while (cache.size >= 64) cache.delete(cache.keys().next().value);
        cache.set(key, { value, expiresAt: now() + 86400000 });
        return value;
      }).finally(() => pending.delete(key));
      pending.set(key, work);
    }
    try {
      const value = await work;
      if (user.status !== "active" || user.inviteCode !== code) return { status: 409, body: { error: "账号信息已变化，请重新打开邀请页" } };
      return { status: 200, body: { ...value, userId: user.id } };
    } catch (error) {
      return { status: 502, body: { error: /^(微信|邀请入口)/.test(error.message) ? error.message : "小程序码生成暂不可用，请稍后重试" } };
    }
  };
}
module.exports = { createInviteCodeService, getInviteCode: createInviteCodeService() };
