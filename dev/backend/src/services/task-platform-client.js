const crypto = require("crypto");

function isConfigured() {
  return Boolean(process.env.TGG_TASK_PLATFORM_BASE_URL && process.env.TGG_TASK_PLATFORM_APPID && process.env.TGG_TASK_PLATFORM_KEY);
}

function buildSign(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: process.env.TGG_TASK_PLATFORM_TIME_ZONE || "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date).map(part => [part.type, part.value]));
  const { year: y, month: m, day: d } = parts;
  const raw = `${y}${m}${d}${process.env.TGG_TASK_PLATFORM_APPID}${process.env.TGG_TASK_PLATFORM_KEY}`;
  return crypto.createHash("md5").update(raw).digest("hex").toLowerCase();
}

async function post(endpoint, payload = {}) {
  if (!isConfigured()) return null;
  const url = new URL(endpoint.replace(/^\/+/, ""), process.env.TGG_TASK_PLATFORM_BASE_URL.endsWith("/") ? process.env.TGG_TASK_PLATFORM_BASE_URL : `${process.env.TGG_TASK_PLATFORM_BASE_URL}/`);
  const body = new URLSearchParams({
    ...Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined && value !== null)),
    appid: process.env.TGG_TASK_PLATFORM_APPID,
    sign: buildSign()
  });
  const timeoutMs = Number(process.env.TGG_TASK_PLATFORM_TIMEOUT_MS || 10000);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60000) throw Object.assign(new Error("任务平台请求超时配置无效"), { status: 503 });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method: "POST", body, signal: controller.signal, redirect: "error" });
    const data = await response.json();
    if (!response.ok || !data || typeof data !== "object" || Array.isArray(data) || data.code !== 0 || !Object.hasOwn(data, "data")) throw new Error("Invalid task platform response");
    return data.data;
  } catch (error) {
    throw Object.assign(new Error(controller.signal.aborted ? "任务平台请求超时，请稍后核对结果" : "任务平台请求失败，请稍后重试或核对结果"), { status: controller.signal.aborted ? 504 : 502 });
  } finally {
    clearTimeout(timer);
  }
}

function normalizeTaskType(row) {
  return {
    id: String(row.id),
    name: row.name,
    description: row.jieshao || "",
    image: row.image || "",
    statusText: row.status_text || ""
  };
}

function normalizeTaskListItem(row) {
  return {
    id: String(row.id),
    title: row.title,
    image: row.image || "",
    category: row.c_name || row.type_name || row.category || "",
    categoryId: row.c_id ? String(row.c_id) : undefined,
    tishi: row.tishi || "",
    option: normalizeOption(row.option),
    paused: Number(row.is_pause) === 1 || Number(row.is_stop) === 1,
    source: "platform"
  };
}

function normalizeTaskDetail(row) {
  const detail = normalizeTaskListItem(row);
  const rawReward = row.users_ratio ?? row.reward;
  const numericReward = typeof rawReward === "number" || (typeof rawReward === "string" && /^\d+(?:\.\d+)?$/.test(rawReward.trim())) ? Number(rawReward) : NaN;
  const points = Math.round(numericReward * 10);
  const rewardValid = Number.isFinite(numericReward) && numericReward >= 0 && Number.isSafeInteger(points);
  return {
    ...detail,
    reward: row.reward,
    usersRatio: row.users_ratio,
    rewardPoints: rewardValid ? points : null,
    rewardValid,
    content: Array.isArray(row.content) ? row.content.filter(block => block && typeof block === "object").map(block => ({ ...block, img_list: normalizeStepImages(block) })) : [],
    submitFields: normalizeOption(row.option),
    paused: Number(row.is_pause) === 1 || Number(row.is_stop) === 1
  };
}

function normalizeStepImages(block) {
  const raw = Array.isArray(block.img_list) && block.img_list.length ? block.img_list : block.img;
  const values = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/\s*,\s*(?=https?:\/\/|\/)/) : [];
  const images = values.flatMap(value => {
    if (typeof value !== "string" || !value.trim()) return [];
    try {
      const url = new URL(value.trim(), process.env.TGG_TASK_PLATFORM_BASE_URL || undefined);
      return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? [url.href] : [];
    } catch { return []; }
  });
  return [...new Set(images)];
}

function normalizeExamine(row) {
  return {
    id: String(row.id),
    externalOrderId: String(row.id),
    taskId: String(row.task_id || row.id),
    taskTitle: row.task_title || row.title || "",
    userId: row.sf_uid,
    status: normalizeStatus(row.status),
    reward: row.reward,
    reasons: row.reasons || "",
    payload: {
      name: row.name,
      mobile: row.mobile,
      images: row.images,
      text1: row.text1,
      text2: row.text2
    },
    createdAt: row.createtime,
    updatedAt: row.updatetime
  };
}

function normalizeOption(option) {
  if (Array.isArray(option)) return option.map(String);
  if (typeof option === "string") return option.split(",").map((item) => item.trim()).filter(Boolean);
  return [];
}

function normalizeStatus(status) {
  if (status === 0 || status === "0" || status === "reviewing") return "reviewing";
  if (status === 1 || status === "1" || status === "approved") return "approved";
  if (status === 2 || status === "2" || status === "rejected") return "rejected";
  return status || "reviewing";
}

module.exports = {
  buildSign,
  isConfigured,
  post,
  normalizeTaskType,
  normalizeTaskListItem,
  normalizeTaskDetail,
  normalizeExamine
};
