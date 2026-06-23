/**
 * TGG 签到看广告 + 抽奖 API（非悬赏平台）
 * 文档：需求文档 §3.2.4、§4.6
 */
const SigninApi = (() => {
  const cfg = () => window.TGG_CONFIG || { useMock: true };

  async function post(path, fields = {}) {
    const c = cfg();
    if (c.useMock) return mockResponse(path, fields);

    const body = new FormData();
    const params = { uid: c.sfUid, token: c.token || "", ...fields };
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") body.append(k, v);
    });

    const base = (c.tggApiUrl || c.baseUrl || "").replace(/\/$/, "");
    const url = `${base}/${path.replace(/^\//, "")}`;
    const res = await fetch(url, { method: "POST", body });
    const json = await res.json();
    if (json.code !== 0) throw new Error(json.msg || "请求失败");
    return json.data;
  }

  const getSigninStatus = () => post("api/signin/status");
  const startSignin = () => post("api/signin/start");
  const reportAdComplete = (payload) => post("api/signin/ad_complete", payload);
  const spinLottery = () => post("api/signin/lottery_spin");

  const MOCK_PRIZES = [
    { id: 1, label: "5 积分", value: 5, weight: 30 },
    { id: 2, label: "10 积分", value: 10, weight: 25 },
    { id: 3, label: "20 积分", value: 20, weight: 20 },
    { id: 4, label: "50 积分", value: 50, weight: 15 },
    { id: 5, label: "100 积分", value: 100, weight: 8 },
    { id: 6, label: "谢谢参与", value: 0, weight: 2 },
  ];

  let mockToday = null;

  function randomGroups(min, max) {
    return min + Math.floor(Math.random() * (max - min + 1));
  }

  function pickPrize(prizes) {
    const total = prizes.reduce((s, p) => s + p.weight, 0);
    let r = Math.random() * total;
    for (const p of prizes) {
      r -= p.weight;
      if (r <= 0) return p;
    }
    return prizes[0];
  }

  function mockResponse(path, fields) {
    if (path.includes("status")) {
      if (!mockToday) {
        mockToday = {
          group_count: randomGroups(3, 5),
          group_min: 3,
          group_max: 5,
          streak_days: 12,
          streak_reward_text: "签满 30 天送 100 积分",
          signed_today: false,
          lottery_available: false,
          prizes: MOCK_PRIZES,
        };
      }
      return Promise.resolve({ ...mockToday });
    }
    if (path.includes("start")) {
      if (!mockToday) mockResponse("api/signin/status");
      mockToday.signed_today = false;
      mockToday.lottery_available = false;
      mockToday.completed_groups = 0;
      mockToday.current_group = 1;
      mockToday.current_step = "ji"; // ji=激励, cha=插屏
      return Promise.resolve({
        group_count: mockToday.group_count,
        current_group: 1,
        current_step: "ji",
      });
    }
    if (path.includes("ad_complete")) {
      const { group_index, ad_type } = fields;
      if (!mockToday) mockResponse("api/signin/status");
      if (ad_type === "ji") {
        mockToday.current_step = "cha";
        return Promise.resolve({
          current_group: group_index,
          current_step: "cha",
          finished: false,
        });
      }
      mockToday.completed_groups = group_index;
      if (group_index >= mockToday.group_count) {
        mockToday.lottery_available = true;
        mockToday.signed_today = true;
        mockToday.streak_days += 1;
        return Promise.resolve({
          current_group: group_index,
          current_step: "done",
          finished: true,
          lottery_ticket: 1,
          streak_days: mockToday.streak_days,
        });
      }
      mockToday.current_group = group_index + 1;
      mockToday.current_step = "ji";
      return Promise.resolve({
        current_group: mockToday.current_group,
        current_step: "ji",
        finished: false,
      });
    }
    if (path.includes("lottery_spin")) {
      const prize = pickPrize(MOCK_PRIZES);
      mockToday.lottery_available = false;
      return Promise.resolve({
        prize_id: prize.id,
        prize_label: prize.label,
        prize_value: prize.value,
        prizes: MOCK_PRIZES,
      });
    }
    return Promise.resolve({});
  }

  return { getSigninStatus, startSignin, reportAdComplete, spinLottery, AD_LABELS: { ji: "激励视频", cha: "插屏广告" } };
})();
