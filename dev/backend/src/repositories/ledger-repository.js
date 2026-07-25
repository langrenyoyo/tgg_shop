function addPointEntry(state, entry) {
  state.pointLedger.unshift(entry);
}

function addPaymentEntry(state, entry) {
  state.paymentLedger.unshift(entry);
}

function addWithdrawableEntry(state, entry) {
  state.withdrawableLedger.unshift(entry);
}

function getLedger(state) {
  return {
    pointLedger: state.pointLedger,
    paymentLedger: state.paymentLedger,
    withdrawableLedger: state.withdrawableLedger
  };
}

module.exports = {
  addPointEntry,
  addPaymentEntry,
  addWithdrawableEntry,
  getLedger
};
