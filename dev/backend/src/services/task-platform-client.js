const crypto = require("crypto");

function isConfigured() {
  return Boolean(process.env.TGG_TASK_PLATFORM_BASE_URL && process.env.TGG_TASK_PLATFORM_APPID && process.env.TGG_TASK_PLATFORM_KEY);
}

function buildSign(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const raw = `${y}${m}${d}${process.env.TGG_TASK_PLATFORM_APPID}${process.env.TGG_TASK_PLATFORM_KEY}`;
  return crypto.createHash("md5").update(raw).digest("hex").toLowerCase();
}

async function post(endpoint, payload = {}) {
  if (!isConfigured()) return null;
  const url = new URL(endpoint.replace(/^\/+/, ""), process.env.TGG_TASK_PLATFORM_BASE_URL.endsWith("/") ? process.env.TGG_TASK_PLATFORM_BASE_URL : `${process.env.TGG_TASK_PLATFORM_BASE_URL}/`);
  const body = new URLSearchParams({
    appid: process.env.TGG_TASK_PLATFORM_APPID,
    sign: buildSign(),
    ...Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined && value !== null))
  });
  const response = await fetch(url, { method: "POST", body });
  const data = await response.json();
  if (!response.ok || data.code !== 0) {
    const error = new Error(data.msg || `Task platform request failed: ${endpoint}`);
    error.status = response.status || 502;
    throw error;
  }
  return data.data;
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
    paused: row.is_pause === 1 || row.is_stop === 1,
    source: "platform"
  };
}

function normalizeTaskDetail(row) {
  const detail = normalizeTaskListItem(row);
  return {
    ...detail,
    reward: row.reward,
    usersRatio: row.users_ratio,
    rewardPoints: Math.max(1, Math.round(Number(row.users_ratio || row.reward || 0) * 10)),
    content: Array.isArray(row.content) ? row.content : [],
    submitFields: normalizeOption(row.option),
    paused: row.is_pause === 1 || row.is_stop === 1
  };
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
  isConfigured,
  post,
  normalizeTaskType,
  normalizeTaskListItem,
  normalizeTaskDetail,
  normalizeExamine
};
