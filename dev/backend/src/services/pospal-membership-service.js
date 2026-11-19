const { getState, saveState } = require("../data/store");
const { createPospalClient, isConfigured } = require("../integrations/pospal/pospal-client");
const { enqueueMembershipSync } = require("../domain/pospal-membership");
const { verifiedPhone } = require("./phone-binding-service");
const { provisionMember } = require("./member-provision-service");

function failure(code, message) { return Object.assign(new Error(message), { code }); }

async function syncMember(state, user, job, client, save) {
  if (!isConfigured(client.config)) throw failure("not_configured", "银豹接口未配置");
  const integration = state.config.pospalIntegration;
  if (job.account && job.account !== client.config.account) throw failure("account_changed", "银豹门店配置已变更，请人工核对");
  const provision = integration.memberProvisions?.[user.id];
  const mapping = integration.customerMappings?.find(row => row.tggUserId === user.id);
  if ((provision?.account && provision.account !== client.config.account)
    || (integration.account && integration.account !== client.config.account)
    || (mapping?.account && mapping.account !== client.config.account)) throw failure("account_changed", "银豹会员归属门店不一致，请人工核对");
  const phone = verifiedPhone(state, user)?.phone
    || (provision?.verifiedAt && provision.phone === user.phone ? user.phone : null);
  if (!phone || !/^1\d{10}$/.test(phone)) throw failure("waiting_phone", "等待用户授权微信手机号");
  if (state.users.some(other => other.id !== user.id && other.phone === phone)) throw failure("identity_conflict", "手机号关联多个本地账号，请人工核对");
  job.account = client.config.account;
  await save();

  if (!user.pospalUid && !user.pospalNumber && !mapping) {
    // A refund may have removed an entitlement before the first external write.
    if (!(Date.parse(user.memberUntil) > Date.now())) return { skipped: true };
    const result = await provisionMember(state, user, {}, { client, save });
    if (!result.body.available) {
      const error = failure("provision_failed", "银豹会员建档失败，等待重试");
      if (result.body.error === "门店会员服务额度不足，请联系管理员处理后重试") error.errorCode = 4021;
      throw error;
    }
  }
  const uid = String(user.pospalUid || ""), number = user.pospalNumber;
  if (!uid || !number) throw failure("identity_conflict", "银豹会员关联不完整，请人工核对");
  const linked = integration.customerMappings?.find(row => row.tggUserId === user.id);
  if (!linked || linked.pospalUid !== uid || linked.number !== number || linked.phone !== phone
    || state.users.some(other => other.id !== user.id && (other.pospalUid === uid || other.pospalNumber === number))
    || integration.customerMappings.some(row => row.tggUserId !== user.id && (row.pospalUid === uid || row.number === number || row.phone === phone))) {
    throw failure("identity_conflict", "银豹会员关联冲突，请人工核对");
  }
  async function query() {
    const response = await client.queryCustomers({ number, lastId: 0, limit: 100, needCustomerExt: true });
    const list = response?.result?.list;
    if (!Array.isArray(list) || response.result.hasMore || list.length !== 1) throw failure("identity_conflict", "银豹会员查询结果不唯一或不完整");
    const row = list[0];
    if (String(row.uid) !== uid || row.number !== number || row.tel !== phone
      || Number(row.enable) !== 1 || Number(row.isLoss || 0) !== 0
      || (row.active != null && Number(row.active) !== 0)) throw failure("identity_conflict", "银豹会员身份或状态不一致，请人工核对");
    const currentMapping = integration.customerMappings.find(item => item.tggUserId === user.id);
    if (user.phone !== phone || String(user.pospalUid || "") !== uid || user.pospalNumber !== number
      || currentMapping?.pospalUid !== uid || currentMapping?.number !== number || currentMapping?.phone !== phone) {
      throw failure("identity_conflict", "同步期间会员身份已变更，请人工核对");
    }
    return row;
  }
  await query();
  // Membership may change while a lookup or persistence operation is in flight.
  // Abandon stale work before writing; a replacement job will send the latest end.
  if (integration.membershipSyncJobs[user.id] !== job || user.memberUntil !== job.memberUntil || user.status !== "active") return { superseded: true };
  const body = { number, updateMask: ["expiryDate"], expiryDate: job.expiryDate };
  if (user.nickname) {
    body.updateMask.push("customerExt.nickName");
    body.customerExt = { nickName: String(user.nickname).slice(0, 64) };
  }
  await client.updateCustomer(body);
  const confirmed = await query();
  if (confirmed.expiryDate !== job.expiryDate) throw failure("unconfirmed", "银豹会员期限尚未确认，等待重试");
  linked.account = client.config.account;
  linked.lastSyncAt = new Date().toISOString();
  user.pospalLastSyncAt = linked.lastSyncAt;
  return { ok: true };
}

function membershipSyncStatus(state) {
  const jobs = Object.values(state.config?.pospalIntegration?.membershipSyncJobs || {});
  return {
    counts: jobs.reduce((counts, job) => { counts[job.status] = (counts[job.status] || 0) + 1; return counts; }, {}),
    jobs: jobs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 50)
  };
}

function createMembershipWorker({ state = getState, save = saveState, client = createPospalClient(), now = Date.now } = {}) {
  let running = null, stopped = false;
  async function sweep() {
    const current = state();
    const jobs = Object.values(current.config?.pospalIntegration?.membershipSyncJobs || {})
      .filter(job => !["synced", "skipped"].includes(job.status) && (!job.nextAttemptAt || Date.parse(job.nextAttemptAt) <= now()))
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)).slice(0, 10);
    for (const job of jobs) {
      if (stopped) break;
      if (current.config.pospalIntegration.membershipSyncJobs[job.userId] !== job) continue;
      const user = current.users.find(item => item.id === job.userId);
      // Persist intent before every attempt, including retries after a restart.
      job.status = "sending"; job.attempts++; job.updatedAt = new Date(now()).toISOString();
      await save();
      let result, error;
      // Persistence failures must stop the worker, never become business retries.
      let storageFailure;
      const durableSave = async () => {
        try { await save(); } catch (cause) { storageFailure = cause; throw cause; }
      };
      try {
        if (!user || user.status !== "active") throw failure("user_unavailable", "用户不存在或已停用，请人工核对");
        if ((user.memberUntil || null) !== job.memberUntil) {
          enqueueMembershipSync(current, user, "latest_expiry", now());
          await durableSave();
          continue;
        }
        result = await syncMember(current, user, job, client, durableSave);
      } catch (cause) { error = cause; }
      if (storageFailure) throw storageFailure;
      if (current.config.pospalIntegration.membershipSyncJobs[job.userId] !== job) continue;
      if (error) {
        job.status = error.code === "waiting_phone" ? "waiting_phone" : "retry";
        // Do not persist provider exception text or request payloads (credentials/PII).
        const messages = {
          not_configured: "银豹接口未配置", account_changed: "银豹门店配置已变更，请人工核对",
          waiting_phone: "等待用户授权微信手机号", identity_conflict: "银豹会员关联冲突，请人工核对",
          user_unavailable: "用户不存在或已停用，请人工核对", unconfirmed: "银豹会员期限尚未确认，等待重试",
          provision_failed: "银豹会员建档未完成，等待重试"
        };
        const code = messages[error.code] ? error.code : "provider_error";
        job.lastError = { code, message: Number(error.errorCode) === 4021 ? "银豹 Token 额度不足，请充值后重试" : messages[code] || "银豹同步失败，请核对配置、额度及网络", at: new Date(now()).toISOString() };
        const delay = Number(error.errorCode) === 4021 ? 3600000 : Math.min(3600000, 30000 * 2 ** Math.min(job.attempts - 1, 7));
        job.nextAttemptAt = new Date(now() + delay).toISOString();
      } else {
        job.status = result.superseded ? "pending" : result.skipped ? "skipped" : "synced";
        job.lastError = null; job.nextAttemptAt = null;
        if (result.ok) job.lastSyncedAt = new Date(now()).toISOString();
      }
      job.updatedAt = new Date(now()).toISOString();
      await save();
    }
  }
  return {
    run() {
      if (stopped) return Promise.resolve();
      if (!running) running = sweep().catch(error => { stopped = true; throw error; }).finally(() => { running = null; });
      return running;
    },
    async stop() { stopped = true; if (running) await running; }
  };
}

module.exports = { createMembershipWorker, membershipSyncStatus };
