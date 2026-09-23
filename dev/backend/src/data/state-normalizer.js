const { createSeed } = require("./seed");

function normalizeState(nextState) {
  const seed = createSeed();
  nextState.config = { ...seed.config, ...(nextState.config || {}) };
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
  nextState.stationAccounts = Array.isArray(nextState.stationAccounts) && nextState.stationAccounts.length ? nextState.stationAccounts : seed.stationAccounts;
  nextState.stationAccounts = nextState.stationAccounts.map((account) => ({ wechatOpenid: "", ...account }));
  nextState.stationOrders = nextState.stationOrders || [];
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
