const now = new Date().toISOString();

function daysFromNow(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function createSeed() {
  return {
    config: {
      membershipMonthlyPrice: 19.9,
      pickupEnabled: true,
      deliveryEnabled: true,
      deliveryFeeEnabled: true,
      deliveryFee: 3,
      deliveryCutoffHour: 5,
      deliveryTimeSlots: ["09:00-12:00", "14:00-18:00", "18:00-21:00"],
      rankingRefreshMinutes: 5,
      inviteRewardPoints: 3,
      inviteCommissionRate: 0.1,
      signinStreakRewardText: "签满 30 天送 100 积分",
      signinAdGroupMin: 3,
      signinAdGroupMax: 5,
      signinStreakDays: 30,
      lotteryDailyLimit: 1,
      lotteryPrizes: [
        { id: "lottery_5", label: "5 积分", value: 5, weight: 30 },
        { id: "lottery_10", label: "10 积分", value: 10, weight: 25 },
        { id: "lottery_20", label: "20 积分", value: 20, weight: 15 },
        { id: "lottery_none", label: "谢谢参与", value: 0, weight: 30 }
      ],
      homeBannerTitle: "时令鲜果季",
      homeBannerSubtitle: "新鲜到站，会员现金购物更优惠",
      homeBannerProductId: "p_strawberry",
      homeServiceBadges: ["自建配送", "坏果包赔", "低价会员购"],
      homePromotionEntries: [
        { title: "新人礼包", text: "首单配送券", tone: "green", page: "membership" },
        { title: "会员专享", text: "现金购权益", tone: "orange", page: "membership" },
        { title: "纯积分兑", text: "无需现金", tone: "blue", page: "pointsExchange" }
      ],
      homeDeliveryPromise: {
        title: "最快 30 分钟送达",
        subtitle: "TGG 自建配送队 · 师大周边 5km",
        cutoffText: "今日 18:00 前可送",
        deliveryFeeText: "满 39 元免配送费",
        serviceAreaText: "当前地址在服务范围内"
      },
      signinAdMaterials: [
        { id: "ad_reward_video", name: "签到激励视频", type: "reward_video", enabled: true, position: "签到第 1 步" },
        { id: "ad_interstitial", name: "签到插屏广告", type: "interstitial", enabled: true, position: "签到第 2 步" }
      ],
      purePointsNoCashTopup: true,
      withdrawMinAmount: 1,
      withdrawFeeRate: 0.01,
      splashAdEnabled: true
    },
    currentUserId: "u_1001",
    users: [
      {
        id: "u_1001",
        nickname: "James",
        phone: "138****6688",
        role: "member",
        memberUntil: daysFromNow(18),
        status: "active",
        points: 2580,
        withdrawableBalance: 128.5,
        inviteCode: "TGG6688",
        signinStreak: 12
      },
      {
        id: "u_1002",
        nickname: "小陈",
        phone: "139****8821",
        role: "normal",
        memberUntil: null,
        status: "active",
        points: 360,
        withdrawableBalance: 12,
        inviteCode: "TGG8821",
        signinStreak: 4
      }
    ],
    addresses: [
      {
        id: "addr_001",
        userId: "u_1001",
        receiverName: "James",
        mobile: "138****6688",
        province: "江苏省",
        city: "南京市",
        district: "栖霞区",
        detail: "师大东门宿舍 3 栋 1201",
        inServiceRange: true,
        isDefault: true,
        createdAt: now
      }
    ],
    products: [
      {
        id: "p_apple",
        name: "山东京富士苹果",
        category: "水果",
        cashPrice: 12.8,
        pointsPrice: 368,
        stock: 126,
        tag: "今日特惠",
        image: "/assets/apple.jpg",
        supportsCash: true,
        supportsPoints: true,
        purePointsOnly: false,
        status: "on"
      },
      {
        id: "p_grapes",
        name: "阳光玫瑰青提",
        category: "水果",
        cashPrice: 8.5,
        pointsPrice: 188,
        stock: 86,
        tag: "热销",
        image: "/assets/grapes.jpg",
        supportsCash: true,
        supportsPoints: true,
        purePointsOnly: false,
        status: "on"
      },
      {
        id: "p_banana",
        name: "精品香蕉 2斤",
        category: "纯积分",
        cashPrice: null,
        pointsPrice: 188,
        stock: 220,
        tag: "兑换",
        image: "/assets/banana.jpg",
        supportsCash: false,
        supportsPoints: true,
        purePointsOnly: true,
        status: "on"
      },
      {
        id: "p_bokchoy",
        name: "有机青菜 1份",
        category: "纯积分",
        cashPrice: null,
        pointsPrice: 99,
        stock: 18,
        tag: "新鲜",
        image: "/assets/bokchoy.jpg",
        supportsCash: false,
        supportsPoints: true,
        purePointsOnly: true,
        status: "on"
      },
      {
        id: "p_strawberry",
        name: "丹东草莓 500g",
        category: "水果",
        cashPrice: 29.9,
        pointsPrice: 299,
        stock: 42,
        tag: "热门",
        image: "/assets/strawberry.jpg",
        supportsCash: true,
        supportsPoints: true,
        purePointsOnly: false,
        status: "on"
      }
    ],
    pickupSites: [
      {
        id: "site_001",
        name: "师大自提站",
        address: "师大东门生活服务中心 1 楼",
        contactName: "站点代理",
        contactPhone: "13800001111",
        enabled: true,
        verifyMode: "pickup_code"
      }
    ],
    deliveryTeams: [
      {
        id: "team_001",
        name: "TGG 自建配送队",
        serviceArea: "师大周边 5km",
        enabled: true
      }
    ],
    signinSessions: [],
    deliveryStaff: [
      {
        id: "staff_001",
        teamId: "team_001",
        name: "配送员 A",
        phone: "13800002222",
        enabled: true
      }
    ],
    inviteRelations: [
      {
        inviteeUserId: "u_1002",
        inviterUserId: "u_1001",
        boundAt: now
      }
    ],
    tasks: [
      {
        id: "task_001",
        title: "小红书高价版",
        category: "悬赏任务",
        rewardPoints: 119,
        listRewardHidden: true,
        status: "active",
        submitFields: ["手机号", "截图凭证"]
      },
      {
        id: "task_002",
        title: "方块兽注册体验",
        category: "悬赏任务",
        rewardPoints: 48,
        listRewardHidden: true,
        status: "active",
        submitFields: ["账号", "完成截图"]
      }
    ],
    submissions: [],
    orders: [
      {
        id: "TGG20260705001",
        userId: "u_1001",
        items: [{ productId: "p_apple", quantity: 1, title: "山东京富士苹果" }],
        paymentMode: "cash",
        cashAmount: 12.8,
        pointAmount: 0,
        status: "paid",
        fulfillmentType: "pickup",
        pickupSiteId: "site_001",
        pickupCode: "829166",
        fulfillmentStatus: "pending_pickup",
        createdAt: now
      }
    ],
    pointLedger: [
      {
        id: "pt_seed_001",
        userId: "u_1001",
        changeType: "task_reward",
        direction: "in",
        points: 119,
        balanceAfter: 2580,
        bizNo: "task_001",
        idempotencyKey: "seed_task_001",
        createdAt: now
      }
    ],
    paymentLedger: [],
    inventoryLedger: [],
    withdrawableLedger: [],
    withdrawRequests: [],
    refundOrders: [],
    exceptions: [],
    orderStatusLogs: [
      {
        id: "osl_seed_001",
        orderId: "TGG20260705001",
        operatorType: "system",
        operatorId: "seed",
        fromStatus: null,
        toStatus: "paid",
        fromFulfillmentStatus: null,
        toFulfillmentStatus: "pending_pickup",
        reason: "种子订单初始化",
        createdAt: now
      }
    ],
    adminApprovalRequests: [],
    adminOperationLogs: [],
    operationTickets: [],
    authSessions: [],
    authLoginAttempts: [],
    roles: [
      { id: "super_admin", name: "超级管理员", permissions: ["*"] },
      { id: "operation_admin", name: "运营管理员", permissions: ["config:read", "config:write", "product:read", "ranking:read", "signin:config"] },
      { id: "product_admin", name: "商品管理员", permissions: ["product:read", "product:write", "points_product:write", "stock:write"] },
      { id: "order_admin", name: "订单管理员", permissions: ["order:read", "order:fulfillment"] },
      { id: "delivery_dispatcher", name: "配送调度", permissions: ["order:read", "order:fulfillment", "delivery:dispatch"] },
      { id: "finance_admin", name: "财务管理员", permissions: ["refund:approve", "withdraw:approve", "ledger:read", "exception:read", "exception:write", "approval:request"] },
      { id: "customer_service", name: "客服", permissions: ["ticket:write", "order:read", "customer:read"] },
      { id: "agent_admin", name: "代理管理员", permissions: ["agent:write", "pickup_site:write", "order:read"] },
      { id: "audit_ops", name: "审核运维", permissions: ["task:review", "exception:read", "approval:request", "approval:review", "ledger:read", "refund:approve", "withdraw:approve"] }
    ]
  };
}

module.exports = { createSeed };
