process.env.TGG_STORE_MODE = "memory";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { createSeed } = require("../../src/data/seed");
const { execFileSync } = require("node:child_process");
const { createInviteIdentityService } = require("../../src/services/invite-identity-service");

test("legacy invitation assignment is unique, concurrent-safe and durable without rewards or rebinding", async t => {
  const state = createSeed(), user = state.users[0]; delete user.inviteCode;
  state.users[1].inviteCode = "AAAAAAAAAAAA";
  const before = JSON.stringify({ points: state.users.map(u => u.points), relations: state.inviteRelations, ledger: state.pointLedger });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "invite-identity-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "state.sqlite"); let writes = 0, draws = 0;
  let restoredCode;
  const ensure = createInviteIdentityService({ persist: () => {
    writes++;
    // SQLite connections are cached; isolate them so Windows can release the file.
    restoredCode = execFileSync(process.execPath, ["--no-warnings", "-e", `
      const fs = require('node:fs');
      const { saveSQLiteState, loadSQLiteState } = require('./src/data/sqlite-store');
      const { state, file, id } = JSON.parse(fs.readFileSync(0, 'utf8'));
      saveSQLiteState(state, file);
      process.stdout.write(loadSQLiteState(file).users.find(u => u.id === id).inviteCode);
    `], { cwd: path.resolve(__dirname, "../.."), input: JSON.stringify({ state, file, id: user.id }), encoding: "utf8" });
  }, randomBytes: () => Buffer.alloc(6, ++draws === 1 ? 0xaa : 0xbb) });
  const codes = await Promise.all([ensure(state, user), ensure(state, user)]);
  assert.deepEqual(codes, ["BBBBBBBBBBBB", "BBBBBBBBBBBB"]); assert.equal(writes, 1);
  assert.equal(restoredCode, codes[0]);
  assert.equal(await ensure(state, user), codes[0]); assert.equal(writes, 1);
  assert.equal(await ensure(state, state.users[1]), "AAAAAAAAAAAA");
  assert.equal(JSON.stringify({ points: state.users.map(u => u.points), relations: state.inviteRelations, ledger: state.pointLedger }), before);
});

test("failed legacy code persistence is not exposed and can be retried", async () => {
  const state = createSeed(), user = state.users[0]; delete user.inviteCode;
  let fail = true;
  const ensure = createInviteIdentityService({ persist: () => { if (fail) throw Error("storage offline"); } });
  const results = await Promise.allSettled([ensure(state, user), ensure(state, user)]);
  assert.ok(results.every(r => r.status === "rejected")); assert.equal(user.inviteCode, undefined);
  fail = false; assert.match(await ensure(state, user), /^[A-F0-9]{12}$/);
  user.status = "disabled"; await assert.rejects(ensure(state, user), /登录/);
});
