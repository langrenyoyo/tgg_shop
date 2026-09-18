const { AsyncLocalStorage } = require("node:async_hooks");

const scopes = new AsyncLocalStorage();

function trackSave(promise) {
  const scope = scopes.getStore();
  // Attach the rejection handler immediately, including legacy sync callers.
  const observed = promise.then(() => null, error => ({ error }));
  if (scope) scope.push(observed);
  else observed.then(result => {
    if (result) console.error("State persistence failed:", result.error.message);
  });
  return promise;
}

async function withPersistence(work) {
  const saves = [];
  return scopes.run(saves, async () => {
    let result;
    let failure;
    try { result = await work(); } catch (error) { failure = error; }
    // Drain saves added by asynchronous continuations while earlier saves finish.
    for (let offset = 0; offset < saves.length;) {
      const batch = saves.slice(offset);
      offset += batch.length;
      for (const outcome of await Promise.all(batch)) {
        if (outcome && !failure) failure = outcome.error;
      }
    }
    if (failure) throw failure;
    return result;
  });
}

module.exports = { trackSave, withPersistence };
