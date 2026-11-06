const { createSeed } = require("./seed");

function normalizeState(nextState) {
  const seed = createSeed();
  nextState.printing ||= { printers: [], jobs: [] };
  nextState.coinSignin ||= { sessions: [], ledger: [] };
  nextState.config = { ...seed.config, ...(nextState.config || {}) };
  const legacyWithdrawNotice = "单笔提现 1-500 元，每人每日最多 2 次，每日 00:00 重置。\n全天 24 小时均可提交，正常情况下申请受理后 10 分钟内到账至已绑定的微信零钱。\n提现手续费为 1%，实际到账金额以提交页面展示为准。提现失败后，金额会退回可提现余额。";
  // Migrate only the exact old default; preserve notices edited by finance.
  if (nextState.config.withdrawNotice === legacyWithdrawNotice) nextState.config.withdrawNotice = seed.config.withdrawNotice;
  if (Array.isArray(nextState.config.homePromotionEntries)) {
    nextState.config.homePromotionEntries = nextState.config.homePromotionEntries.map(item =>
      item.page === "dailySignin" && item.title === "签到领积分"
        ? { ...item, title: "签到领金币", text: "完成签到领固定金币" } : item);
  }
  nextState.roles = mergeRoles(nextState.roles || [], seed.roles, nextState.config.rolePermissionOverrides || {});
  require("../domain/admin-accounts").ensureAdminUsers(nextState);
  nextState.inviteRelations = nextState.inviteRelations || seed.inviteRelations;
  nextState.addresses = nextState.addresses || seed.addresses;
  nextState.signinSessions = nextState.signinSessions || seed.signinSessions;
  nextState.paymentLedger = nextState.paymentLedger || seed.paymentLedger;
  nextState.inventoryLedger = nextState.inventoryLedger || seed.inventoryLedger;
  nextState.withdrawableLedger = nextState.withdrawableLedger || seed.withdrawableLedger;
  nextState.withdrawRequests = nextState.withdrawRequests || seed.withdrawRequests;
  nextState.orderStatusLogs = nextState.orderStatusLogs || seed.orderStatusLogs;
  nextState.adminApprovalRequests = nextState.adminApprovalRequests || seed.adminApprovalRequests;
  nextState.adminOperationLogs = nextState.adminOperationLogs || seed.adminOperationLogs;
  nextState.operationTickets = nextState.operationTickets || seed.operationTickets;
  nextState.monthlyPointRewardSettlements = nextState.monthlyPointRewardSettlements || seed.monthlyPointRewardSettlements;
  nextState.authSessions = nextState.authSessions || seed.authSessions;
  nextState.authLoginAttempts = nextState.authLoginAttempts || seed.authLoginAttempts;
  nextState.huifuAuthorizationSessions = Array.isArray(nextState.huifuAuthorizationSessions) ? nextState.huifuAuthorizationSessions : [];
  for (const session of nextState.huifuAuthorizationSessions) {
    session.status ||= "pending";
    session.createdAt ||= new Date().toISOString();
  }
  nextState.stationAccounts = Array.isArray(nextState.stationAccounts) ? nextState.stationAccounts : seed.stationAccounts;
  nextState.stationAccounts = nextState.stationAccounts.map((account) => ({ wechatOpenid: "", ...account }));
  nextState.stationOrders = nextState.stationOrders || [];
  nextState.stationPickupAttempts = nextState.stationPickupAttempts || [];
  nextState.stationOperationLogs = nextState.stationOperationLogs || [];
  nextState.users = (nextState.users || seed.users).map((user) => ({ status: "active", ...user }));
  return nextState;
}

function mergeRoles(currentRoles, seedRoles, permissionOverrides) {
  const rolesById = new Map(currentRoles.map((role) => [role.id, { ...role, permissions: [...role.permissions] }]));
  for (const seedRole of seedRoles) {
    const current = rolesById.get(seedRole.id);
    if (!current) {
      rolesById.set(seedRole.id, { ...seedRole, permissions: [...seedRole.permissions] });
      continue;
    }
    current.name = current.name || seedRole.name;
    if (Object.prototype.hasOwnProperty.call(permissionOverrides, current.id)) {
      current.permissions = [...permissionOverrides[current.id]];
    } else {
      current.permissions = Array.from(new Set([...current.permissions, ...seedRole.permissions]));
    }
  }
  return Array.from(rolesById.values());
}

module.exports = {
  normalizeState
};
