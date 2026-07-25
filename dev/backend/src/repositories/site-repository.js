function findEnabledPickupSite(state) {
  return state.pickupSites.find((site) => site.enabled);
}

module.exports = {
  findEnabledPickupSite
};
