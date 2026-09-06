const taskService = require("../services/task-service");

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
    return send(ctx.res, 200, await taskService.listUserSubmissions(state, user.id, Object.fromEntries(url.searchParams.entries())));
  }

  const submissionMatch = url.pathname.match(/^\/api\/submissions\/([^/]+)$/);
  if (req.method === "GET" && submissionMatch) {
    const submission = await taskService.getSubmissionDetail(state, user.id, submissionMatch[1]);
    return submission ? send(ctx.res, 200, submission) : send(ctx.res, 404, { error: "提交记录不存在" });
  }

  if (req.method === "POST" && url.pathname === "/api/task/callback") {
    const result = taskService.processTaskCallback(state, await readBody(req));
    return send(ctx.res, result.ok ? 200 : result.status, result.ok ? { status: "success", submission: result.submission, idempotent: Boolean(result.idempotent) } : { error: result.error });
  }

  return false;
}

module.exports = {
  handleTaskRoutes
};
