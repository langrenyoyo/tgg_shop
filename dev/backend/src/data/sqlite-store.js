const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const { createSeed } = require("./seed");

const MIGRATION_DIR = path.resolve(__dirname, "..", "..", "database", "migrations");
const DEFAULT_DB_FILE = path.resolve(__dirname, "..", "..", "data", "tgg-dev.sqlite");

let db;
let activeFile;

function loadSQLiteState(dbFile = process.env.TGG_SQLITE_FILE || DEFAULT_DB_FILE) {
  const database = openDatabase(dbFile);
  runMigrations(database);
  return readState(database);
}

function saveSQLiteState(state, dbFile = process.env.TGG_SQLITE_FILE || DEFAULT_DB_FILE) {
  const database = openDatabase(dbFile);
  runMigrations(database);
  writeState(database, state);
}

function openDatabase(dbFile) {
  if (db && activeFile === dbFile) return db;
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  db = new DatabaseSync(dbFile);
  activeFile = dbFile;
  db.exec("PRAGMA foreign_keys = ON;");
  return db;
}

function runMigrations(database) {
  const migrations = fs
    .readdirSync(MIGRATION_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const migration of migrations) {
    database.exec(fs.readFileSync(path.join(MIGRATION_DIR, migration), "utf8"));
  }
  ensureOperationTicketColumns(database);
  ensureAuthSessionColumns(database);
  ensurePaymentOrderColumns(database);
}

function ensureOperationTicketColumns(database) {
  const columns = new Set(database.prepare("PRAGMA table_info(operation_ticket)").all().map((column) => column.name));
  if (!columns.has("linked_type")) database.exec("ALTER TABLE operation_ticket ADD COLUMN linked_type TEXT;");
  if (!columns.has("linked_id")) database.exec("ALTER TABLE operation_ticket ADD COLUMN linked_id TEXT;");
  if (!columns.has("priority")) database.exec("ALTER TABLE operation_ticket ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent'));");
}

function ensureAuthSessionColumns(database) {
  const columns = new Set(database.prepare("PRAGMA table_info(auth_session)").all().map((column) => column.name));
  if (!columns.has("refresh_token_hash")) database.exec("ALTER TABLE auth_session ADD COLUMN refresh_token_hash TEXT;");
  if (!columns.has("refresh_expires_at")) database.exec("ALTER TABLE auth_session ADD COLUMN refresh_expires_at TEXT;");
}

function ensurePaymentOrderColumns(database) {
  const columns = new Set(database.prepare("PRAGMA table_info(payment_order)").all().map((column) => column.name));
  if (!columns.has("pay_no")) database.exec("ALTER TABLE payment_order ADD COLUMN pay_no TEXT;");
  if (!columns.has("metadata_json")) database.exec("ALTER TABLE payment_order ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}';");
  if (!columns.has("callback_time")) database.exec("ALTER TABLE payment_order ADD COLUMN callback_time TEXT;");
  if (!columns.has("updated_at")) database.exec("ALTER TABLE payment_order ADD COLUMN updated_at TEXT;");
}

function readState(database) {
  const seed = createSeed();
  const config = { ...seed.config };
  for (const row of database.prepare("SELECT config_key, config_value FROM app_config").all()) {
    config[row.config_key] = parseConfigValue(row.config_value);
  }

  const users = database
    .prepare(
      "SELECT id, nickname, phone, user_type, member_until, points, withdrawable_balance_cents, invite_code, signin_streak, status FROM app_user ORDER BY id"
    )
    .all()
    .map((row) => ({
      id: row.id,
      nickname: row.nickname,
      phone: row.phone,
      role: row.user_type,
      memberUntil: row.member_until,
      points: row.points,
      withdrawableBalance: centsToMoney(row.withdrawable_balance_cents),
      inviteCode: row.invite_code,
      signinStreak: row.signin_streak,
      status: row.status || "active"
    }));

  const products = database
    .prepare(
      "SELECT id, name, category, cash_price_cents, points_price, stock, tag, image_url, supports_cash, supports_points, pure_points_only, status FROM product ORDER BY id"
    )
    .all()
    .map((row) => ({
      id: row.id,
      name: row.name,
      category: row.category,
      cashPrice: row.cash_price_cents == null ? null : centsToMoney(row.cash_price_cents),
      pointsPrice: row.points_price,
      stock: row.stock,
      tag: row.tag,
      image: row.image_url,
      supportsCash: Boolean(row.supports_cash),
      supportsPoints: Boolean(row.supports_points),
      purePointsOnly: Boolean(row.pure_points_only),
      status: row.status
    }));

  const inventoryLedger = database
    .prepare(
      "SELECT id, product_id, change_type, quantity_delta, stock_before, stock_after, batch_no, reason, operator_role_id, created_at FROM inventory_ledger ORDER BY created_at DESC"
    )
    .all()
    .map((row) => ({
      id: row.id,
      productId: row.product_id,
      changeType: row.change_type,
      quantityDelta: row.quantity_delta,
      stockBefore: row.stock_before,
      stockAfter: row.stock_after,
      batchNo: row.batch_no || "",
      reason: row.reason || "",
      operatorRoleId: row.operator_role_id || "",
      createdAt: row.created_at
    }));

  const addresses = database
    .prepare(
      "SELECT id, user_id, receiver_name, mobile, province, city, district, detail, in_service_range, is_default, created_at, updated_at FROM user_address ORDER BY created_at DESC"
    )
    .all()
    .map((row) => ({
      id: row.id,
      userId: row.user_id,
      receiverName: row.receiver_name,
      mobile: row.mobile,
      province: row.province,
      city: row.city,
      district: row.district,
      detail: row.detail,
      inServiceRange: Boolean(row.in_service_range),
      isDefault: Boolean(row.is_default),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));

  const pickupSites = database
    .prepare("SELECT id, name, address, contact_name, contact_phone, enabled, verify_mode FROM pickup_site ORDER BY id")
    .all()
    .map((row) => ({
      id: row.id,
      name: row.name,
      address: row.address,
      contactName: row.contact_name,
      contactPhone: row.contact_phone,
      enabled: Boolean(row.enabled),
      verifyMode: row.verify_mode
    }));

  const deliveryTeams = database
    .prepare("SELECT id, name, service_area, enabled FROM delivery_team ORDER BY id")
    .all()
    .map((row) => ({ id: row.id, name: row.name, serviceArea: row.service_area, enabled: Boolean(row.enabled) }));

  const deliveryStaff = database
    .prepare("SELECT id, team_id, name, phone, enabled FROM delivery_staff ORDER BY id")
    .all()
    .map((row) => ({ id: row.id, teamId: row.team_id, name: row.name, phone: row.phone, enabled: Boolean(row.enabled) }));

  const inviteRelations = database
    .prepare("SELECT invitee_user_id, inviter_user_id, bound_at FROM invite_relation ORDER BY bound_at DESC")
    .all()
    .map((row) => ({
      inviteeUserId: row.invitee_user_id,
      inviterUserId: row.inviter_user_id,
      boundAt: row.bound_at
    }));

  const signinSessions = database
    .prepare(
      "SELECT session_id, user_id, signin_date, ad_groups, completed_groups, completed_ads, signed_today, lottery_ticket, lottery_used, created_at, updated_at FROM signin_session ORDER BY created_at DESC"
    )
    .all()
    .map((row) => ({
      sessionId: row.session_id,
      userId: row.user_id,
      date: row.signin_date,
      adGroups: row.ad_groups,
      completedGroups: row.completed_groups,
      completedAds: row.completed_ads,
      signedToday: Boolean(row.signed_today),
      lotteryTicket: row.lottery_ticket,
      lotteryUsed: Boolean(row.lottery_used),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));

  const tasks = database
    .prepare("SELECT id, title, category, reward_points, list_reward_hidden, status, submit_fields_json FROM task ORDER BY id")
    .all()
    .map((row) => ({
      id: row.id,
      title: row.title,
      category: row.category,
      rewardPoints: row.reward_points,
      listRewardHidden: Boolean(row.list_reward_hidden),
      status: row.status,
      submitFields: JSON.parse(row.submit_fields_json || "[]")
    }));

  const submissions = database
    .prepare("SELECT id, task_id, user_id, status, payload_json, created_at FROM task_submission ORDER BY created_at DESC")
    .all()
    .map((row) => ({
      id: row.id,
      taskId: row.task_id,
      userId: row.user_id,
      status: row.status,
      payload: JSON.parse(row.payload_json || "{}"),
      createdAt: row.created_at
    }));

  const orderItems = groupBy(
    database.prepare("SELECT order_id, product_id, title, quantity FROM order_item ORDER BY created_at").all(),
    "order_id"
  );
  const orders = database
    .prepare(
      "SELECT id, user_id, payment_mode, cash_amount_cents, point_amount, status, fulfillment_type, pickup_site_id, pickup_code, delivery_address, delivery_date, fulfillment_status, created_at FROM shop_order ORDER BY created_at DESC"
    )
    .all()
    .map((row) => ({
      id: row.id,
      userId: row.user_id,
      items: (orderItems[row.id] || []).map((item) => ({
        productId: item.product_id,
        quantity: item.quantity,
        title: item.title
      })),
      paymentMode: row.payment_mode,
      cashAmount: centsToMoney(row.cash_amount_cents),
      pointAmount: row.point_amount,
      status: row.status,
      fulfillmentType: row.fulfillment_type,
      pickupSiteId: row.pickup_site_id,
      pickupCode: row.pickup_code,
      deliveryAddress: row.delivery_address,
      deliveryDate: row.delivery_date,
      fulfillmentStatus: row.fulfillment_status,
      createdAt: row.created_at
    }));

  const pointLedger = database
    .prepare(
      "SELECT id, user_id, change_type, direction, points, balance_after, biz_no, idempotency_key, created_at FROM point_ledger ORDER BY created_at DESC"
    )
    .all()
    .map((row) => ({
      id: row.id,
      userId: row.user_id,
      changeType: row.change_type,
      direction: row.direction,
      points: row.points,
      balanceAfter: row.balance_after,
      bizNo: row.biz_no,
      idempotencyKey: row.idempotency_key,
      createdAt: row.created_at
    }));

  const paymentLedger = database
    .prepare(
      "SELECT id, pay_no, order_id, user_id, pay_scene, direction, amount_cents, point_amount, channel, status, third_trade_no, metadata_json, idempotency_key, callback_time, created_at, updated_at FROM payment_order ORDER BY created_at DESC"
    )
    .all()
    .map((row) => ({
      id: row.id,
      payNo: row.pay_no || row.id,
      orderId: row.order_id,
      userId: row.user_id,
      payScene: row.pay_scene || "goods_cash",
      direction: row.direction,
      amount: centsToMoney(row.amount_cents),
      pointAmount: row.point_amount || 0,
      channel: row.channel,
      status: row.status,
      thirdTradeNo: row.third_trade_no,
      metadata: JSON.parse(row.metadata_json || "{}"),
      idempotencyKey: row.idempotency_key,
      callbackTime: row.callback_time,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));

  const withdrawableLedger = database
    .prepare(
      "SELECT id, user_id, change_type, direction, amount_cents, balance_after_cents, biz_no, idempotency_key, created_at FROM withdrawable_ledger ORDER BY created_at DESC"
    )
    .all()
    .map((row) => ({
      id: row.id,
      userId: row.user_id,
      changeType: row.change_type,
      direction: row.direction,
      amount: centsToMoney(row.amount_cents),
      balanceAfter: centsToMoney(row.balance_after_cents),
      bizNo: row.biz_no,
      idempotencyKey: row.idempotency_key,
      createdAt: row.created_at
    }));

  const withdrawRequests = database
    .prepare(
      "SELECT id, user_id, amount_cents, fee_cents, arrival_amount_cents, channel, status, idempotency_key, created_at, updated_at FROM withdraw_request ORDER BY created_at DESC"
    )
    .all()
    .map((row) => ({
      id: row.id,
      userId: row.user_id,
      amount: centsToMoney(row.amount_cents),
      fee: centsToMoney(row.fee_cents),
      arrivalAmount: centsToMoney(row.arrival_amount_cents),
      channel: row.channel,
      status: row.status,
      idempotencyKey: row.idempotency_key,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));

  const refundOrders = database
    .prepare(
      "SELECT id, order_id, user_id, refund_cash_amount_cents, refund_point_amount, status, reason, idempotency_key, created_at, updated_at FROM refund_order ORDER BY created_at DESC"
    )
    .all()
    .map((row) => ({
      id: row.id,
      orderId: row.order_id,
      userId: row.user_id,
      refundCashAmount: centsToMoney(row.refund_cash_amount_cents),
      refundPointAmount: row.refund_point_amount,
      status: row.status,
      reason: row.reason,
      idempotencyKey: row.idempotency_key,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));

  const roles = database
    .prepare("SELECT id, name FROM admin_role ORDER BY id")
    .all()
    .map((role) => ({
      id: role.id,
      name: role.name,
      permissions: database
        .prepare("SELECT permission FROM admin_role_permission WHERE role_id = ? ORDER BY permission")
        .all(role.id)
        .map((item) => item.permission)
    }));

  const exceptions = database
    .prepare("SELECT id, exception_type, biz_no, action, status, payload_json, created_at FROM exception_compensation ORDER BY created_at DESC")
    .all()
    .map((row) => ({
      id: row.id,
      type: row.exception_type,
      bizNo: row.biz_no,
      action: row.action,
      status: row.status,
      payload: JSON.parse(row.payload_json || "{}"),
      createdAt: row.created_at
    }));

  const orderStatusLogs = database
    .prepare(
      "SELECT id, order_id, operator_type, operator_id, from_status, to_status, from_fulfillment_status, to_fulfillment_status, reason, created_at FROM order_status_log ORDER BY created_at DESC"
    )
    .all()
    .map((row) => ({
      id: row.id,
      orderId: row.order_id,
      operatorType: row.operator_type,
      operatorId: row.operator_id,
      fromStatus: row.from_status,
      toStatus: row.to_status,
      fromFulfillmentStatus: row.from_fulfillment_status,
      toFulfillmentStatus: row.to_fulfillment_status,
      reason: row.reason,
      createdAt: row.created_at
    }));

  const adminOperationLogs = database
    .prepare(
      "SELECT id, admin_id, role_id, action, target_type, target_id, before_json, after_json, ip, created_at FROM admin_operation_log ORDER BY created_at DESC"
    )
    .all()
    .map((row) => {
      const before = JSON.parse(row.before_json || "{}");
      const after = JSON.parse(row.after_json || "{}");
      return {
        id: row.id,
        adminId: row.admin_id,
        roleId: row.role_id,
        action: row.action,
        targetType: row.target_type,
        targetId: row.target_id,
        reason: after.reason || after.remarks || "",
        detail: after,
        idempotencyKey: after.idempotencyKey || "",
        before,
        after,
        ip: row.ip,
        createdAt: row.created_at
      };
    });

  const adminApprovalRequests = database
    .prepare(
      "SELECT id, request_type, action, target_type, target_id, status, request_reason, review_reason, requested_by_role_id, reviewed_by_role_id, payload_json, result_json, idempotency_key, created_at, updated_at FROM admin_approval_request ORDER BY created_at DESC"
    )
    .all()
    .map((row) => ({
      id: row.id,
      requestType: row.request_type,
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      status: row.status,
      requestReason: row.request_reason || "",
      reviewReason: row.review_reason || "",
      requestedByRoleId: row.requested_by_role_id || "",
      reviewedByRoleId: row.reviewed_by_role_id || "",
      payload: JSON.parse(row.payload_json || "{}"),
      result: JSON.parse(row.result_json || "{}"),
      idempotencyKey: row.idempotency_key,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));

  const operationTickets = database
    .prepare(
      "SELECT id, user_id, ticket_type, subject, content, contact_name, contact_phone, status, admin_reply, handled_by_role_id, linked_type, linked_id, priority, created_at, updated_at FROM operation_ticket ORDER BY created_at DESC"
    )
    .all()
    .map((row) => ({
      id: row.id,
      userId: row.user_id,
      type: row.ticket_type,
      subject: row.subject,
      content: row.content,
      contactName: row.contact_name,
      contactPhone: row.contact_phone,
      status: row.status,
      adminReply: row.admin_reply || "",
      handledByRoleId: row.handled_by_role_id || "",
      linkedType: row.linked_type || "",
      linkedId: row.linked_id || "",
      priority: row.priority || "normal",
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));

  const authSessions = database
    .prepare("SELECT id, subject_type, subject_id, token_id, issued_at, expires_at, revoked_at, last_seen_at, refresh_token_hash, refresh_expires_at FROM auth_session ORDER BY issued_at DESC")
    .all()
    .map((row) => ({
      id: row.id,
      subjectType: row.subject_type,
      subjectId: row.subject_id,
      tokenId: row.token_id,
      issuedAt: row.issued_at,
      expiresAt: row.expires_at,
      refreshTokenHash: row.refresh_token_hash || "",
      refreshExpiresAt: row.refresh_expires_at || "",
      revokedAt: row.revoked_at || "",
      lastSeenAt: row.last_seen_at || ""
    }));

  const authLoginAttempts = database
    .prepare("SELECT subject_type, subject_id, failed_count, locked_until, last_failed_at FROM auth_login_attempt ORDER BY subject_type, subject_id")
    .all()
    .map((row) => ({
      subjectType: row.subject_type,
      subjectId: row.subject_id,
      failedCount: row.failed_count,
      lockedUntil: row.locked_until || "",
      lastFailedAt: row.last_failed_at || ""
    }));

  return {
    config,
    currentUserId: config.currentUserId || seed.currentUserId,
    users,
    addresses,
    products,
    inventoryLedger,
    pickupSites,
    deliveryTeams,
    deliveryStaff,
    inviteRelations,
    signinSessions,
    tasks,
    submissions,
    orders,
    pointLedger,
    paymentLedger,
    withdrawableLedger,
    withdrawRequests,
    refundOrders,
    exceptions,
    orderStatusLogs,
    adminApprovalRequests,
    adminOperationLogs,
    operationTickets,
    authSessions,
    authLoginAttempts,
    roles
  };
}

function writeState(database, state) {
  database.exec("BEGIN IMMEDIATE;");
  try {
    deleteExistingRows(database);
    insertState(database, state);
    database.exec("COMMIT;");
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}

function deleteExistingRows(database) {
  for (const table of [
    "admin_role_permission",
    "auth_login_attempt",
    "auth_session",
    "admin_approval_request",
    "admin_operation_log",
    "operation_ticket",
    "order_status_log",
    "withdraw_request",
    "payment_order",
    "point_ledger",
    "withdrawable_ledger",
    "refund_order",
    "order_item",
    "shop_order",
    "task_submission",
    "invite_relation",
    "signin_session",
    "task",
    "delivery_staff",
    "delivery_team",
    "pickup_site",
    "inventory_ledger",
    "product",
    "user_address",
    "app_user",
    "exception_compensation",
    "admin_role",
    "app_config"
  ]) {
    database.exec(`DELETE FROM ${table};`);
  }
}

function insertState(database, state) {
  const insertConfig = database.prepare("INSERT INTO app_config (config_key, config_value) VALUES (?, ?)");
  for (const [key, value] of Object.entries({ ...state.config, currentUserId: state.currentUserId })) {
    insertConfig.run(key, JSON.stringify(value));
  }

  const insertUser = database.prepare(
    "INSERT INTO app_user (id, nickname, phone, user_type, member_until, points, withdrawable_balance_cents, invite_code, signin_streak, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  for (const user of state.users) {
    insertUser.run(
      user.id,
      user.nickname,
      user.phone || null,
      user.role || "normal",
      user.memberUntil || null,
      user.points || 0,
      moneyToCents(user.withdrawableBalance || 0),
      user.inviteCode,
      user.signinStreak || 0,
      user.status || "active"
    );
  }

  const insertAddress = database.prepare(
    "INSERT INTO user_address (id, user_id, receiver_name, mobile, province, city, district, detail, in_service_range, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  for (const address of state.addresses || []) {
    insertAddress.run(
      address.id,
      address.userId,
      address.receiverName,
      address.mobile || null,
      address.province || null,
      address.city || null,
      address.district || null,
      address.detail,
      address.inServiceRange === false ? 0 : 1,
      address.isDefault ? 1 : 0,
      address.createdAt || new Date().toISOString(),
      address.updatedAt || address.createdAt || new Date().toISOString()
    );
  }

  const insertProduct = database.prepare(
    "INSERT INTO product (id, name, category, cash_price_cents, points_price, stock, tag, image_url, supports_cash, supports_points, pure_points_only, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  for (const product of state.products) {
    insertProduct.run(
      product.id,
      product.name,
      product.category,
      product.cashPrice == null ? null : moneyToCents(product.cashPrice),
      product.pointsPrice || 0,
      product.stock || 0,
      product.tag || null,
      product.image || null,
      product.supportsCash ? 1 : 0,
      product.supportsPoints ? 1 : 0,
      product.purePointsOnly ? 1 : 0,
      product.status || "on"
    );
  }

  const insertInventory = database.prepare(
    "INSERT INTO inventory_ledger (id, product_id, change_type, quantity_delta, stock_before, stock_after, batch_no, reason, operator_role_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  for (const item of state.inventoryLedger || []) {
    insertInventory.run(
      item.id,
      item.productId,
      item.changeType || "adjust",
      Number(item.quantityDelta || 0),
      Number(item.stockBefore || 0),
      Number(item.stockAfter || 0),
      item.batchNo || null,
      item.reason || null,
      item.operatorRoleId || null,
      item.createdAt || new Date().toISOString()
    );
  }

  const insertPickup = database.prepare(
    "INSERT INTO pickup_site (id, name, address, contact_name, contact_phone, enabled, verify_mode) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  for (const site of state.pickupSites) {
    insertPickup.run(site.id, site.name, site.address, site.contactName || null, site.contactPhone || null, site.enabled ? 1 : 0, site.verifyMode || "pickup_code");
  }

  const insertTeam = database.prepare("INSERT INTO delivery_team (id, name, service_area, enabled) VALUES (?, ?, ?, ?)");
  for (const team of state.deliveryTeams) {
    insertTeam.run(team.id, team.name, team.serviceArea || null, team.enabled ? 1 : 0);
  }

  const insertStaff = database.prepare("INSERT INTO delivery_staff (id, team_id, name, phone, enabled) VALUES (?, ?, ?, ?, ?)");
  for (const staff of state.deliveryStaff) {
    insertStaff.run(staff.id, staff.teamId, staff.name, staff.phone || null, staff.enabled ? 1 : 0);
  }

  const insertInviteRelation = database.prepare("INSERT INTO invite_relation (invitee_user_id, inviter_user_id, bound_at) VALUES (?, ?, ?)");
  for (const relation of state.inviteRelations || []) {
    insertInviteRelation.run(relation.inviteeUserId, relation.inviterUserId, relation.boundAt || new Date().toISOString());
  }

  const insertSigninSession = database.prepare(
    "INSERT INTO signin_session (session_id, user_id, signin_date, ad_groups, completed_groups, completed_ads, signed_today, lottery_ticket, lottery_used, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  for (const session of state.signinSessions || []) {
    insertSigninSession.run(
      session.sessionId,
      session.userId,
      session.date,
      session.adGroups || 0,
      session.completedGroups || 0,
      session.completedAds || 0,
      session.signedToday ? 1 : 0,
      session.lotteryTicket || 0,
      session.lotteryUsed ? 1 : 0,
      session.createdAt || new Date().toISOString(),
      session.updatedAt || session.createdAt || new Date().toISOString()
    );
  }

  const insertTask = database.prepare(
    "INSERT INTO task (id, title, category, reward_points, list_reward_hidden, status, submit_fields_json) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  for (const task of state.tasks) {
    insertTask.run(task.id, task.title, task.category, task.rewardPoints || 0, task.listRewardHidden ? 1 : 0, task.status || "active", JSON.stringify(task.submitFields || []));
  }

  const insertSubmission = database.prepare(
    "INSERT INTO task_submission (id, task_id, user_id, status, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  );
  for (const submission of state.submissions) {
    insertSubmission.run(
      submission.id,
      submission.taskId,
      submission.userId,
      submission.status || "reviewing",
      JSON.stringify(submission.payload || {}),
      submission.createdAt || new Date().toISOString()
    );
  }

  const insertOrder = database.prepare(
    "INSERT INTO shop_order (id, user_id, payment_mode, cash_amount_cents, point_amount, status, fulfillment_type, pickup_site_id, pickup_code, delivery_address, delivery_date, fulfillment_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  const insertOrderItem = database.prepare(
    "INSERT INTO order_item (id, order_id, product_id, title, quantity, cash_price_cents, points_price) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  for (const order of state.orders) {
    insertOrder.run(
      order.id,
      order.userId,
      order.paymentMode,
      moneyToCents(order.cashAmount || 0),
      order.pointAmount || 0,
      order.status,
      order.fulfillmentType,
      order.pickupSiteId || null,
      order.pickupCode || null,
      order.deliveryAddress || null,
      order.deliveryDate || null,
      order.fulfillmentStatus,
      order.createdAt || new Date().toISOString()
    );
    for (const [index, item] of (order.items || []).entries()) {
      const product = state.products.find((candidate) => candidate.id === item.productId);
      insertOrderItem.run(`${order.id}_${index + 1}`, order.id, item.productId, item.title, item.quantity, product?.cashPrice == null ? null : moneyToCents(product.cashPrice), product?.pointsPrice || null);
    }
  }

  const insertPayment = database.prepare(
    "INSERT INTO payment_order (id, pay_no, order_id, user_id, pay_scene, direction, amount_cents, point_amount, channel, status, third_trade_no, metadata_json, idempotency_key, callback_time, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  for (const item of state.paymentLedger) {
    insertPayment.run(
      item.id,
      item.payNo || item.id,
      item.orderId || null,
      item.userId || null,
      item.payScene || "goods_cash",
      item.direction || "in",
      moneyToCents(item.amount || 0),
      item.pointAmount || 0,
      item.channel || "mock_pay",
      item.status,
      item.thirdTradeNo || null,
      JSON.stringify(item.metadata || {}),
      item.idempotencyKey,
      item.callbackTime || null,
      item.createdAt || new Date().toISOString(),
      item.updatedAt || item.createdAt || null
    );
  }

  const insertWithdrawableLedger = database.prepare(
    "INSERT INTO withdrawable_ledger (id, user_id, change_type, direction, amount_cents, balance_after_cents, biz_no, idempotency_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  for (const item of state.withdrawableLedger || []) {
    insertWithdrawableLedger.run(
      item.id,
      item.userId,
      item.changeType,
      item.direction,
      moneyToCents(item.amount || 0),
      moneyToCents(item.balanceAfter || 0),
      item.bizNo,
      item.idempotencyKey,
      item.createdAt || new Date().toISOString()
    );
  }

  const insertWithdrawRequest = database.prepare(
    "INSERT INTO withdraw_request (id, user_id, amount_cents, fee_cents, arrival_amount_cents, channel, status, idempotency_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  for (const item of state.withdrawRequests || []) {
    insertWithdrawRequest.run(
      item.id,
      item.userId,
      moneyToCents(item.amount || 0),
      moneyToCents(item.fee || 0),
      moneyToCents(item.arrivalAmount || 0),
      item.channel || "wechat",
      item.status || "pending_review",
      item.idempotencyKey,
      item.createdAt || new Date().toISOString(),
      item.updatedAt || item.createdAt || new Date().toISOString()
    );
  }

  const insertRefund = database.prepare(
    "INSERT INTO refund_order (id, order_id, user_id, refund_cash_amount_cents, refund_point_amount, status, reason, idempotency_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  for (const item of state.refundOrders) {
    insertRefund.run(
      item.id,
      item.orderId,
      item.userId,
      moneyToCents(item.refundCashAmount || 0),
      item.refundPointAmount || 0,
      item.status,
      item.reason || null,
      item.idempotencyKey,
      item.createdAt || new Date().toISOString(),
      item.updatedAt || item.createdAt || new Date().toISOString()
    );
  }

  const insertPoint = database.prepare(
    "INSERT INTO point_ledger (id, user_id, change_type, direction, points, balance_after, biz_no, idempotency_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  for (const item of state.pointLedger) {
    insertPoint.run(item.id, item.userId, item.changeType, item.direction, item.points, item.balanceAfter, item.bizNo, item.idempotencyKey, item.createdAt || new Date().toISOString());
  }

  const insertRole = database.prepare("INSERT INTO admin_role (id, name) VALUES (?, ?)");
  const insertPermission = database.prepare("INSERT INTO admin_role_permission (role_id, permission) VALUES (?, ?)");
  for (const role of state.roles) {
    insertRole.run(role.id, role.name);
    for (const permission of role.permissions) {
      insertPermission.run(role.id, permission);
    }
  }

  const insertException = database.prepare(
    "INSERT INTO exception_compensation (id, exception_type, biz_no, action, status, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  for (const item of state.exceptions) {
    insertException.run(
      item.id,
      item.exceptionType || item.type,
      item.bizNo,
      item.action,
      item.status || "pending",
      JSON.stringify(item.payload || {}),
      item.createdAt || new Date().toISOString()
    );
  }

  const insertOrderStatusLog = database.prepare(
    "INSERT INTO order_status_log (id, order_id, operator_type, operator_id, from_status, to_status, from_fulfillment_status, to_fulfillment_status, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  for (const item of state.orderStatusLogs || []) {
    insertOrderStatusLog.run(
      item.id,
      item.orderId,
      item.operatorType || "system",
      item.operatorId || null,
      item.fromStatus || null,
      item.toStatus || null,
      item.fromFulfillmentStatus || null,
      item.toFulfillmentStatus || null,
      item.reason || null,
      item.createdAt || new Date().toISOString()
    );
  }

  const insertAdminOperationLog = database.prepare(
    "INSERT INTO admin_operation_log (id, admin_id, role_id, action, target_type, target_id, before_json, after_json, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  for (const item of state.adminOperationLogs || []) {
    insertAdminOperationLog.run(
      item.id,
      item.adminId || null,
      item.roleId || null,
      item.action,
      item.targetType || null,
      item.targetId || null,
      JSON.stringify(item.before || {}),
      JSON.stringify(item.after || {}),
      item.ip || null,
      item.createdAt || new Date().toISOString()
    );
  }

  const insertOperationTicket = database.prepare(
    "INSERT INTO operation_ticket (id, user_id, ticket_type, subject, content, contact_name, contact_phone, status, admin_reply, handled_by_role_id, linked_type, linked_id, priority, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  for (const item of state.operationTickets || []) {
    insertOperationTicket.run(
      item.id,
      item.userId || null,
      item.type || "customer_service",
      item.subject || "用户咨询",
      item.content || "",
      item.contactName || null,
      item.contactPhone || null,
      item.status || "open",
      item.adminReply || null,
      item.handledByRoleId || null,
      item.linkedType || null,
      item.linkedId || null,
      item.priority || "normal",
      item.createdAt || new Date().toISOString(),
      item.updatedAt || item.createdAt || new Date().toISOString()
    );
  }

  const insertAdminApprovalRequest = database.prepare(
    "INSERT INTO admin_approval_request (id, request_type, action, target_type, target_id, status, request_reason, review_reason, requested_by_role_id, reviewed_by_role_id, payload_json, result_json, idempotency_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  for (const item of state.adminApprovalRequests || []) {
    insertAdminApprovalRequest.run(
      item.id,
      item.requestType || "sensitive_operation",
      item.action,
      item.targetType,
      item.targetId,
      item.status || "pending",
      item.requestReason || null,
      item.reviewReason || null,
      item.requestedByRoleId || null,
      item.reviewedByRoleId || null,
      JSON.stringify(item.payload || {}),
      JSON.stringify(item.result || {}),
      item.idempotencyKey,
      item.createdAt || new Date().toISOString(),
      item.updatedAt || item.createdAt || new Date().toISOString()
    );
  }

  const insertAuthSession = database.prepare(
    "INSERT INTO auth_session (id, subject_type, subject_id, token_id, issued_at, expires_at, revoked_at, last_seen_at, refresh_token_hash, refresh_expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  for (const item of state.authSessions || []) {
    insertAuthSession.run(
      item.id,
      item.subjectType,
      item.subjectId,
      item.tokenId,
      item.issuedAt,
      item.expiresAt,
      item.revokedAt || null,
      item.lastSeenAt || null,
      item.refreshTokenHash || null,
      item.refreshExpiresAt || null
    );
  }

  const insertAuthAttempt = database.prepare(
    "INSERT INTO auth_login_attempt (subject_type, subject_id, failed_count, locked_until, last_failed_at) VALUES (?, ?, ?, ?, ?)"
  );
  for (const item of state.authLoginAttempts || []) {
    insertAuthAttempt.run(
      item.subjectType,
      item.subjectId,
      item.failedCount || 0,
      item.lockedUntil || null,
      item.lastFailedAt || null
    );
  }
}

function parseConfigValue(value) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function groupBy(rows, key) {
  return rows.reduce((acc, row) => {
    acc[row[key]] ||= [];
    acc[row[key]].push(row);
    return acc;
  }, {});
}

function centsToMoney(cents) {
  return Math.round(Number(cents || 0)) / 100;
}

function moneyToCents(value) {
  return Math.round(Number(value || 0) * 100);
}

module.exports = {
  loadSQLiteState,
  saveSQLiteState
};
