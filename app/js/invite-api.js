/**
 * TGG 閭€璇?鎷夋柊 API 瀹㈡埛绔紙闈炴偓璧忓钩鍙帮級
 * 鏂囨。锛氶渶姹傛枃妗?搂3.2.4銆伮?.6
 */
const InviteApi = (() => {
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
    if (Object.prototype.hasOwnProperty.call(json, "code")) {
      if (json.code !== 0) throw new Error(json.msg || "请求失败");
      return json.data;
    }
    return json;
  }

  const getInviteInfo = () => post("api/invite/info");
  const getInviteList = (page = 1, count = 20) =>
    post("api/invite/list", { page, count });
  const getInviteStats = () => post("api/invite/stats");

  function mockResponse(path, fields) {
    if (path.includes("info")) {
      return Promise.resolve({
        invite_code: "TGG8K2M",
        share_url: "https://tgg.shop/invite?code=TGG8K2M",
        share_title: "閭€璇蜂綘鍔犲叆 TGG Shop锛屾敞鍐屽嵆閫?1 涓湀浼氬憳",
        reward_invite: 3,
        reward_ratio: 10,
        total_invited: 5,
        total_commission: 28,
      });
    }
    if (path.includes("list")) {
      return Promise.resolve([
        { uid: 101, nickname: "鐢ㄦ埛A", avatar: "", bind_time: "2026-06-01 10:20", contributed: 12 },
        { uid: 102, nickname: "鐢ㄦ埛B", avatar: "", bind_time: "2026-06-10 14:05", contributed: 8 },
        { uid: 103, nickname: "鐢ㄦ埛C", avatar: "", bind_time: "2026-06-18 09:30", contributed: 5 },
        { uid: 104, nickname: "鐢ㄦ埛D", avatar: "", bind_time: "2026-06-20 16:00", contributed: 3 },
        { uid: 105, nickname: "鐢ㄦ埛E", avatar: "", bind_time: "2026-06-22 11:15", contributed: 0 },
      ]);
    }
    if (path.includes("stats")) {
      return Promise.resolve({
        month_invited: 2,
        month_commission: 15,
        lifetime_invited: 5,
        lifetime_commission: 28,
      });
    }
    return Promise.resolve({});
  }

  return { getInviteInfo, getInviteList, getInviteStats };
})();


