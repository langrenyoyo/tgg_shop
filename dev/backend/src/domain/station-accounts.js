const STATION_PERMISSIONS = ["station:receive", "station:pickup", "station:exception"];

// Accounts created before explicit permissions retain their existing operations.
function stationPermissions(account) {
  return Array.isArray(account?.permissions) ? account.permissions.filter(value => STATION_PERMISSIONS.includes(value)) : [...STATION_PERMISSIONS];
}

function canStation(account, permission) {
  return account?.status !== "disabled" && stationPermissions(account).includes(permission);
}

function publicStation(account) {
  return { id: account.id, username: account.username, name: account.name, role: account.role,
    siteIds: [...(account.siteIds || [])], permissions: stationPermissions(account) };
}

function publicStationAccount(account) {
  return { ...publicStation(account), status: account.status, wechatBound: Boolean(account.wechatOpenid),
    passwordConfigured: Boolean(account.passwordHash), createdAt: account.createdAt || "", updatedAt: account.updatedAt || "" };
}

module.exports = { STATION_PERMISSIONS, stationPermissions, canStation, publicStation, publicStationAccount };
