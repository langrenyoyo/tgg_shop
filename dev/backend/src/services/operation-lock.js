const active = new WeakSet();
async function exclusive(entity, operation) {
  if (active.has(entity)) return { ok: false, status: 409, error: "操作处理中，请稍后刷新" };
  active.add(entity);
  try { return await operation(); } finally { active.delete(entity); }
}
module.exports = { exclusive, isBusy: entity => active.has(entity) };
