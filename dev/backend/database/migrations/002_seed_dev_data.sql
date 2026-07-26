-- Development seed data aligned with src/data/seed.js.

INSERT OR IGNORE INTO app_config (config_key, config_value) VALUES
  ('membershipMonthlyPrice', '19.9'),
  ('pickupEnabled', 'true'),
  ('deliveryEnabled', 'true'),
  ('deliveryFeeEnabled', 'true'),
  ('deliveryFee', '3'),
  ('deliveryCutoffHour', '5'),
  ('rankingRefreshMinutes', '5'),
  ('inviteRewardPoints', '3'),
  ('inviteCommissionRate', '0.1'),
  ('signinStreakRewardText', '"签满 30 天送 100 积分"'),
  ('purePointsNoCashTopup', 'true');

INSERT OR IGNORE INTO app_user (
  id, nickname, phone, user_type, member_until, points, withdrawable_balance_cents, invite_code, signin_streak
) VALUES
  ('u_1001', 'James', '138****6688', 'member', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+18 days'), 2580, 12850, 'TGG6688', 12),
  ('u_1002', '小陈', '139****8821', 'normal', NULL, 360, 1200, 'TGG8821', 4);

INSERT OR IGNORE INTO product (
  id, name, category, cash_price_cents, points_price, stock, tag, image_url, supports_cash, supports_points, pure_points_only, status
) VALUES
  ('p_apple', '山东京富士苹果', '水果', 10, 368, 126, '今日特惠', '/assets/apple.jpg', 1, 1, 0, 'on'),
  ('p_grapes', '阳光玫瑰青提', '水果', 10, 188, 86, '热销', '/assets/grapes.jpg', 1, 1, 0, 'on'),
  ('p_banana', '精品香蕉 2斤', '纯积分', NULL, 188, 220, '兑换', '/assets/banana.jpg', 0, 1, 1, 'on'),
  ('p_bokchoy', '有机青菜 1份', '纯积分', NULL, 99, 18, '新鲜', '/assets/bokchoy.jpg', 0, 1, 1, 'on'),
  ('p_strawberry', '丹东草莓 500g', '水果', 10, 299, 42, '热门', '/assets/strawberry.jpg', 1, 1, 0, 'on');

INSERT OR IGNORE INTO pickup_site (id, name, address, contact_name, contact_phone, enabled, verify_mode) VALUES
  ('site_001', '师大自提站', '师大东门生活服务中心 1 楼', '站点代理', '13800001111', 1, 'pickup_code');

INSERT OR IGNORE INTO delivery_team (id, name, service_area, enabled) VALUES
  ('team_001', 'TGG 自建配送队', '师大周边 5km', 1);

INSERT OR IGNORE INTO delivery_staff (id, team_id, name, phone, enabled) VALUES
  ('staff_001', 'team_001', '配送员 A', '13800002222', 1);

INSERT OR IGNORE INTO task (id, title, category, reward_points, list_reward_hidden, status, submit_fields_json) VALUES
  ('task_001', '小红书高价版', '悬赏任务', 119, 1, 'active', '["手机号","截图凭证"]'),
  ('task_002', '方块兽注册体验', '悬赏任务', 48, 1, 'active', '["账号","完成截图"]');

INSERT OR IGNORE INTO shop_order (
  id, user_id, payment_mode, cash_amount_cents, point_amount, status, fulfillment_type, pickup_site_id, pickup_code, fulfillment_status, created_at
) VALUES
  ('TGG20260705001', 'u_1001', 'cash', 1280, 0, 'paid', 'pickup', 'site_001', '829166', 'pending_pickup', CURRENT_TIMESTAMP);

INSERT OR IGNORE INTO order_item (id, order_id, product_id, title, quantity, cash_price_cents, points_price) VALUES
  ('oi_seed_001', 'TGG20260705001', 'p_apple', '山东京富士苹果', 1, 1280, 368);

INSERT OR IGNORE INTO point_ledger (
  id, user_id, change_type, direction, points, balance_after, biz_no, idempotency_key, created_at
) VALUES
  ('pt_seed_001', 'u_1001', 'task_reward', 'in', 119, 2580, 'task_001', 'seed_task_001', CURRENT_TIMESTAMP);

INSERT OR IGNORE INTO admin_role (id, name) VALUES
  ('super_admin', '超级管理员'),
  ('product_admin', '商品管理员'),
  ('order_admin', '订单管理员'),
  ('finance_admin', '财务管理员'),
  ('customer_service', '客服');

INSERT OR IGNORE INTO admin_role_permission (role_id, permission) VALUES
  ('super_admin', '*'),
  ('product_admin', 'product:read'),
  ('product_admin', 'product:write'),
  ('product_admin', 'points_product:write'),
  ('product_admin', 'stock:write'),
  ('order_admin', 'order:read'),
  ('order_admin', 'order:fulfillment'),
  ('finance_admin', 'ledger:read'),
  ('finance_admin', 'refund:approve'),
  ('finance_admin', 'withdraw:approve'),
  ('finance_admin', 'exception:read'),
  ('finance_admin', 'exception:write'),
  ('customer_service', 'order:read'),
  ('customer_service', 'ticket:write');
