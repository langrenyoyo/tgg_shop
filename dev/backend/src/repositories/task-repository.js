function listAll(state) {
  return state.tasks;
}

function listTypes(state) {
  const byName = new Map();
  for (const task of state.tasks) {
    const name = task.category || "默认分类";
    if (!byName.has(name)) {
      byName.set(name, {
        id: String(task.categoryId || name),
        name,
        description: "",
        image: "",
        statusText: ""
      });
    }
  }
  return Array.from(byName.values());
}

function listForUser(state, query = {}) {
  let tasks = state.tasks;
  if (query.search) {
    const keyword = String(query.search).toLowerCase();
    tasks = tasks.filter((task) => `${task.title} ${task.category} ${task.tishi || ""}`.toLowerCase().includes(keyword));
  }
  if (query.c_id || query.category) {
    const category = String(query.c_id || query.category);
    tasks = tasks.filter((task) => String(task.categoryId || task.category) === category || task.category === category);
  }
  const page = Math.max(1, Number(query.page || 1));
  const count = Math.max(1, Math.min(50, Number(query.count || tasks.length || 10)));
  return tasks
    .slice((page - 1) * count, page * count)
    .map(({ rewardPoints, reward, usersRatio, ...task }) => ({
      ...task,
      submitFields: task.submitFields || task.option || []
    }));
}

function findById(state, taskId) {
  return state.tasks.find((item) => item.id === taskId);
}

function addSubmission(state, submission) {
  state.submissions.unshift(submission);
}

function findSubmissionById(state, submissionId) {
  return state.submissions.find((item) => item.id === submissionId);
}

function findSubmissionByExternalId(state, externalOrderId, userId) {
  return state.submissions.find((item) => String(item.externalOrderId) === String(externalOrderId) && (!userId || String(item.userId) === String(userId)));
}

function findSubmission(state, submissionId, userId) {
  return findSubmissionById(state, submissionId) || findSubmissionByExternalId(state, submissionId, userId);
}

function listSubmissionsByUser(state, userId, query = {}) {
  let submissions = state.submissions.filter((item) => item.userId === userId);
  if (query.status && query.status !== "All") submissions = submissions.filter((item) => item.status === normalizeStatus(query.status));
  return submissions;
}

function normalizeStatus(status) {
  if (status === "0") return "reviewing";
  if (status === "1") return "approved";
  if (status === "2") return "rejected";
  return status;
}

module.exports = {
  listAll,
  listTypes,
  listForUser,
  findById,
  addSubmission,
  findSubmissionById,
  findSubmissionByExternalId,
  findSubmission,
  listSubmissionsByUser
};
