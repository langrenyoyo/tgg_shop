const taskService = require("../services/task-service");
const { authenticateCallback } = require("../services/callback-auth");
const { saveState } = require("../data/store");

async function handleTaskRoutes(ctx) {
  const { req, url, state, user, send, readBody } = ctx;

  if (req.method === "GET" && url.pathname === "/api/task-platform/status") {
    return send(ctx.res, 200, taskService.getPlatformStatus());
  }

  if (req.method === "GET" && url.pathname === "/api/task-types") {
    return send(ctx.res, 200, await taskService.listTaskTypes(state));
  }

  if (req.method === "GET" && url.pathname === "/api/tasks") {
    return send(ctx.res, 200, await taskService.listTasksForUser(state, Object.fromEntries(url.searchParams.entries())));
  }

  const taskMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)$/);
  if (req.method === "GET" && taskMatch) {
    const task = await taskService.getTaskDetail(state, taskMatch[1]);
    return task ? send(ctx.res, 200, task) : send(ctx.res, 404, { error: "任务不存在" });
  }

  const submitMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/submit$/);
  if (req.method === "POST" && submitMatch) {
    const result = await taskService.submitTask(state, user, submitMatch[1], await readBody(req));
    return send(ctx.res, result.ok ? 201 : result.status, result.ok ? result.submission : { error: result.error });
  }

  if (req.method === "GET" && url.pathname === "/api/submissions") {
    const status = url.searchParams.get("status");
    const page = url.searchParams.get("page");
    if (status && !["All", "reviewing", "approved", "rejected", "0", "1", "2"].includes(status)) return send(ctx.res, 400, { error: "无效审核状态" });
    if (page !== null && (!/^\d+$/.test(page) || !Number.isSafeInteger(Number(page)) || Number(page) < 1)) return send(ctx.res, 400, { error: "页码必须为正整数" });
    return send(ctx.res, 200, await taskService.listUserSubmissions(state, user.id, Object.fromEntries(url.searchParams.entries())));
  }

  const syncMatch = url.pathname.match(/^\/api\/submissions\/([^/]+)\/sync$/);
  if (req.method === "POST" && syncMatch) {
    const result = await taskService.syncSubmission(state, user.id, syncMatch[1]);
    return send(ctx.res, result.ok ? 200 : result.status, result.ok ? result.submission : { error: result.error });
  }

  const submissionMatch = url.pathname.match(/^\/api\/submissions\/([^/]+)$/);
  if (req.method === "GET" && submissionMatch) {
    const submission = await taskService.getSubmissionDetail(state, user.id, submissionMatch[1]);
    return submission ? send(ctx.res, 200, submission) : send(ctx.res, 404, { error: "提交记录不存在" });
  }

  if (req.method === "POST" && url.pathname === "/api/task/callback") {
    const auth = authenticateCallback(req, url, "TGG_TASK_CALLBACK_TOKEN", "x-task-callback-token");
    if (!auth.ok) return send(ctx.res, auth.status, { error: auth.error });
    const body = await readBody(req);
    if (!body || typeof body !== "object" || Array.isArray(body) || body.id == null || body.sf_uid == null || String(body.sf_uid).trim() === "" || body.status == null || typeof body.remarks !== "string") {
      return send(ctx.res, 400, { error: "回调必须包含 id、sf_uid、status 和 remarks" });
    }
    const result = await taskService.processTaskCallback(state, body);
    await saveState();
    return send(ctx.res, result.ok ? 200 : result.status, result.ok ? { status: "success" } : { error: result.error });
  }

  return false;
}

module.exports = {
  handleTaskRoutes
};
