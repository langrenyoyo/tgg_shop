const assert = require("node:assert/strict");

async function runStationClosure({ userPage, adminPage, CDPPage, base }) {
  const orders = await userPage.evaluate(`fetch('/api/orders', {headers:{Authorization:'Bearer '+localStorage.getItem('tggUserToken')}}).then(r=>r.json())`);
  const order = orders.find(o => o.paymentMode === "pure_points" && o.status === "paid" && o.fulfillmentType === "pickup");
  assert.ok(order, "use the actual pure-points order placed through the storefront");
  const station = await CDPPage.create(`${base}/station`);
  try {
    await station.waitForText("站点工作人员登录");
    await station.fillFormAndSubmit("#loginForm", { username: "station001", password: "123456" });
    await station.waitForText("现场操作");
    await station.click('[data-view="receive"]');
    await station.click(`[data-action="receive"][data-id="${order.id}"]`);
    await station.fillFormAndSubmit("#actionForm", { shelfCode: "E2E-A-01", condition: "normal" });
    await station.waitForText("收货成功");
    await station.waitForExpression(`!document.querySelector('#actionForm')`);
    await station.click('[data-view="pickup"]');
    await station.waitForText(order.id);
    await station.waitForText("E2E-A-01");

    await userPage.goto(`${base}/user?skipSplash=1`);
    await userPage.waitForText("热门推荐");
    await userPage.click('[data-tab="profile"]');
    await userPage.click('[data-page="orders"]');
    await userPage.click(`[data-order-open="${order.id}"]`);
    await userPage.waitForText("已到站待提货");
    await adminPage.goto(`${base}/admin`);
    await adminPage.waitForText("最近订单");
    await adminPage.waitForText("已到站待提货");

    await station.click(`[data-action="pickup"][data-id="${order.id}"]`);
    await station.fillFormAndSubmit("#actionForm", { pickupCode: "wrong-code" });
    await station.waitForText("取货码不正确");
    assert.equal(await station.evaluate(`document.querySelector('#actionForm button.primary').disabled`), false, "wrong code must allow retry without closing the form");
    await station.fillFormAndSubmit("#actionForm", { pickupCode: order.pickupCode });
    await station.waitForText("提货核验成功");
    await station.waitForExpression(`!document.querySelector('#actionForm')`);
    await station.click('[data-view="logs"]');
    await station.waitForText(order.id);
    assert.equal(await station.evaluate(`document.body.innerText.includes('[object Object]')`), false);

    await userPage.goto(`${base}/user?skipSplash=1`);
    await userPage.waitForText("热门推荐");
    await userPage.click('[data-tab="profile"]');
    await userPage.click('[data-page="orders"]');
    await userPage.click(`[data-order-open="${order.id}"]`);
    await userPage.waitForText("已完成");
    await userPage.waitForText("已提货");
    const final = await userPage.evaluate(`fetch('/api/orders/${order.id}',{headers:{Authorization:'Bearer '+localStorage.getItem('tggUserToken')}}).then(r=>r.json())`);
    assert.equal(final.status, "completed");
    assert.equal(final.fulfillmentStatus, "picked_up");
    await adminPage.goto(`${base}/admin`);
    await adminPage.waitForText("最近订单");
    const adminOrder = await adminPage.evaluate(`fetch('/api/admin/orders',{headers:{Authorization:'Bearer '+localStorage.getItem('tggAdminToken')}}).then(r=>r.json()).then(rows=>rows.find(o=>o.id==='${order.id}'))`);
    assert.equal(adminOrder.status, "completed");
    assert.equal(adminOrder.stationStatus, "picked_up");
    const token = await station.evaluate(`localStorage.getItem('tggStationToken')`);
    await station.click('[data-action="logout"]');
    await station.waitForText("站点工作人员登录");
    const revoked = await fetch(`${base}/api/station/me`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(revoked.status, 401);
    assert.deepEqual(station.runtimeErrors(), []);
  } finally {
    station.close();
  }
}

module.exports = { runStationClosure };
