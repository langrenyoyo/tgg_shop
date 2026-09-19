const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
process.env.TGG_STORE_MODE = "memory";
const { resetState } = require("../../src/data/store");
const { updateProfile } = require("../../src/services/profile-service");
const { routeApi } = require("../../src/routes/api-router");
const { saveSQLiteState, loadSQLiteState } = require("../../src/data/sqlite-store");

function avatar(t) {
  const name = `profile-test-${process.pid}-${Date.now()}.png`;
  const dir = path.resolve(__dirname, "../../data/uploads");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4XcAAAAASUVORK5CYII=", "base64"));
  t.after(() => fs.unlinkSync(file));
  return `/uploads/${name}`;
}

test("profile changes persist after SQLite reload without changing balances or identity", async t => {
  const state = resetState();
  const user = state.users[0], before = { ...user };
  const input = { nickname: "New nickname", avatarUrl: avatar(t) };
  const result = await updateProfile(user, input);
  assert.equal(result.ok, true);
  assert.deepEqual(user, { ...before, ...input });
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tgg-profile-")), "state.sqlite");
  saveSQLiteState(state, file);
  const restored = loadSQLiteState(file).users.find(row => row.id === user.id);
  assert.equal(restored.nickname, input.nickname);
  assert.equal(restored.avatarUrl, input.avatarUrl);
  assert.equal(restored.points, before.points);
});

test("profile rejects privilege fields, invalid names, temporary URLs, traversal and non-images without mutation", async t => {
  const state = resetState();
  const user = state.users[0], before = { ...user };
  const good = { nickname: "Alice", avatarUrl: avatar(t) };
  const cases = [null, [], {}, { ...good, userId: state.users[1].id }, { ...good, points: 999 },
    { ...good, role: "member" }, ...["", " ", "x".repeat(33), "<img>", "a\nb"].map(nickname => ({ ...good, nickname })),
    ...["wxfile://avatar.png", "https://other.example/a.png", "/uploads/../secret.png", "/uploads/missing.png", "/uploads/avatar.svg"].map(avatarUrl => ({ ...good, avatarUrl }))];
  const fake = good.avatarUrl.replace(".png", "-fake.png");
  const file = path.resolve(__dirname, "../../data", fake.slice(1));
  fs.writeFileSync(file, "<html>not an image</html>");
  t.after(() => fs.unlinkSync(file));
  cases.push({ ...good, avatarUrl: fake });
  for (const input of cases) {
    assert.equal((await updateProfile(user, input)).status, 400);
    assert.deepEqual(user, before);
  }
});

test("profile endpoint requires authentication before reading a request", async () => {
  resetState();
  let status;
  await routeApi({ method: "PATCH", headers: {}, async *[Symbol.asyncIterator]() { assert.fail("unauthenticated body read"); } },
    { writeHead(code) { status = code; }, end() {} }, new URL("http://localhost/api/me"));
  assert.equal(status, 401);
});

test("authenticated profile route updates only the token owner and exposes it on subsequent reads", async t => {
  const state = resetState();
  const [user, other] = state.users;
  const otherBefore = { ...other };
  const auth = require("../../src/services/auth-service");
  const session = auth.login(state, { userId: user.id, password: process.env.TGG_DEMO_PASSWORD || "123456" });
  assert.equal(session.ok, true);
  const input = { nickname: "Route name", avatarUrl: avatar(t) };
  let status, body;
  const res = { writeHead(code) { status = code; }, end(value) { body = JSON.parse(value); } };
  const headers = { authorization: `Bearer ${session.token}`, "content-type": "application/json" };
  await routeApi({ method: "PATCH", headers, async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(input)); } }, res, new URL("http://localhost/api/me"));
  assert.equal(status, 200); assert.equal(body.id, user.id); assert.equal(body.avatarUrl, input.avatarUrl);
  await routeApi({ method: "GET", headers }, res, new URL("http://localhost/api/me"));
  assert.equal(status, 200); assert.equal(body.nickname, input.nickname);
  assert.deepEqual(other, otherBefore);
});
