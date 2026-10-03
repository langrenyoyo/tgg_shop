const crypto = require("node:crypto");

function config(env = process.env) {
  return { user: String(env.XPYUN_USER || "").trim(), key: String(env.XPYUN_USER_KEY || "").trim(), enabled: env.XPYUN_ENABLED === "1" };
}
function configured(env = process.env) { const c = config(env); return Boolean(c.user && c.key); }
class PrintError extends Error {
  constructor(message, uncertain = false, code = "") { super(message); this.uncertain = uncertain; this.code = code; }
}
function createClient({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const c = config(env);
  async function call(method, body) {
    if (!c.user || !c.key) throw new PrintError("芯烨云账号尚未配置");
    const timestamp = String(Math.floor(Date.now() / 1000));
    const sign = crypto.createHash("sha1").update(c.user + c.key + timestamp).digest("hex");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetchImpl(`https://open.xpyun.net/api/openapi/xprinter/${method}`, {
        method: "POST", redirect: "error", signal: controller.signal,
        headers: { "Content-Type": "application/json;charset=UTF-8" },
        body: JSON.stringify({ ...body, user: c.user, timestamp, sign, debug: "0" })
      });
      if (!response.ok) throw new PrintError("芯烨云响应异常，请核对任务状态", true);
      const data = await response.json();
      if (!Number.isInteger(data?.code)) throw new PrintError("芯烨云响应格式异常", true);
      if (data.code !== 0) throw new PrintError(`芯烨云拒绝请求（代码 ${data.code}）`, false, data.code);
      return data.data;
    } catch (error) {
      if (error instanceof PrintError) throw error;
      // Do not expose provider bodies, credentials or raw transport errors.
      throw new PrintError("芯烨云请求中断，结果待核对", true);
    } finally { clearTimeout(timeout); }
  }
  return {
    async register(printer) {
      const result = await call("addPrinters", { items: [{ sn: printer.sn, name: printer.name }] });
      if (!Array.isArray(result?.success) || !result.success.includes(printer.sn)) throw new PrintError("设备注册未确认，请在芯烨云设备管理核对归属后重新检查");
      return true;
    },
    async status(sn) {
      const result = await call("queryPrinterStatus", { sn });
      if (![0, 1, 2].includes(result)) throw new PrintError("设备状态响应异常", true);
      return result;
    },
    async print(job) {
      const id = await call("print", { sn: job.sn, content: job.content, copies: job.copies, mode: 1, expiresIn: job.expiresIn, voice: 1, attached: job.id });
      if (typeof id !== "string" || !id || id.length > 150) throw new PrintError("打印任务号未确认", true);
      return id;
    },
    async query(id) {
      const result = await call("queryOrderState", { orderId: id });
      if (typeof result !== "boolean") throw new PrintError("打印状态响应异常", true);
      return result;
    }
  };
}
module.exports = { createClient, config, configured, PrintError };
