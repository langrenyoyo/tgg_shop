/**
 * 悬赏平台 API 客户端
 * 文档：api接口文档 (4).pdf
 */
const TaskApi = (() => {
  const cfg = () => window.TGG_CONFIG || { useMock: true };

  function ymd() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}${m}${day}`;
  }

  function makeSign(appid, key) {
    return hex_md5(ymd() + appid + key);
  }

  function baseParams(extra = {}) {
    const c = cfg();
    const params = { appid: c.appid, ...extra };
    if (!c.useMock && c.key && c.key !== "your_key_here") {
      params.sign = makeSign(c.appid, c.key);
    } else {
      params.sign = "mock_sign";
    }
    return params;
  }

  async function post(path, fields = {}) {
    const c = cfg();
    if (c.useMock) return mockResponse(path, fields);

    const body = new FormData();
    const params = baseParams(fields);
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") body.append(k, v);
    });

    const url = `${c.baseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
    const res = await fetch(url, { method: "POST", body });
    const json = await res.json();
    if (json.code !== 0) throw new Error(json.msg || "请求失败");
    return json.data;
  }

  async function upload(file) {
    const c = cfg();
    if (c.useMock) return { path: "https://via.placeholder.com/200", url: "/mock/upload.png" };

    const body = new FormData();
    body.append("file", file);
    const url = `${c.baseUrl.replace(/\/$/, "")}/api/common/upload`;
    const res = await fetch(url, { method: "POST", body });
    const json = await res.json();
    if (json.code !== 0) throw new Error(json.msg || "上传失败");
    return json.data[0];
  }

  // —— 业务接口 ——
  const getTaskTypes = () => post("index/index/task_type");
  const getTaskList = (page = 1, count = 10, opts = {}) =>
    post("index/index/task_list", { page, count, ...opts });
  const getTaskInfo = (id) => post("index/index/task_info", { id });
  const submitTask = (payload) =>
    post("index/index/task_register", { ...payload, sf_uid: cfg().sfUid });
  const getExamineList = (page = 1, status = "All") =>
    post("index/index/get_examine_list", { page, status, sf_uid: cfg().sfUid });
  const getExamineInfo = (id) =>
    post("index/index/get_examine_info", { id, sf_uid: cfg().sfUid });

  // —— Mock 数据 ——
  const MOCK_TYPES = [
    { id: 0, name: "全部", jieshao: "", image: "" },
    { id: 1, name: "简单注册", jieshao: "流程简单", image: "" },
    { id: 4, name: "证券金融", jieshao: "完成任务", image: "" },
  ];
  const MOCK_TASKS = [
    { id: 526, title: "小红书高价版", image: "https://baojia.fengxiangsc.com/uploads/20240902/280626d4075bf05b0468ba8e4b2c2213.png", reward: "17.00", c_name: "简单注册", users_ratio: "11.90", tishi: "必须新用户", option: "text1,imgea,mobile" },
    { id: 487, title: "立返-工行一拖15", image: "https://baojia.fengxiangsc.com/uploads/20240808/bdb490c20cd04fb44493e229b0e8a7ec.png", reward: "8.00", c_name: "证券金融", users_ratio: "5.60", tishi: "", option: "text1,imgea,mobile,name" },
    { id: 436, title: "方块兽", image: "https://baojia.fengxiangsc.com/uploads/20240722/4a47d5bdf6c4b3b227d3e46d84e3c088.png", reward: "4.50", c_name: "简单注册", users_ratio: "3.15", tishi: "", option: "imgea,mobile" },
  ];
  const MOCK_DETAIL = {
    id: 526,
    title: "小红书高价版",
    image: MOCK_TASKS[0].image,
    reward: "17.00",
    users_ratio: "11.90",
    type_name: "简单注册",
    tishi: "必须是新用户，老用户直接不合格",
    is_pause: 0,
    option: ["text1", "imgea", "mobile"],
    content: [
      { txt: "<p><strong>步骤一：</strong>扫码填手机号，下载并登录最新版 App。</p>", img_list: [] },
      { txt: "<p><strong>步骤二：</strong>完成连续两天签到后，按示例交单。</p>", img_list: [] },
    ],
  };

  function mockResponse(path, fields) {
    return new Promise((resolve) => {
      setTimeout(() => {
        if (path.includes("task_type")) resolve(MOCK_TYPES.slice(1));
        else if (path.includes("task_list")) {
          let list = MOCK_TASKS;
          if (fields.c_id) list = list.filter((t) => String(t.c_name).includes(fields.c_id === "1" ? "简单" : "证券"));
          if (fields.search) list = list.filter((t) => t.title.includes(fields.search));
          resolve(list);
        } else if (path.includes("task_info")) resolve({ ...MOCK_DETAIL, id: Number(fields.id) });
        else if (path.includes("task_register")) resolve({});
        else if (path.includes("get_examine_list")) {
          resolve([
            { id: 11767, task_id: 526, task_title: "小红书高价版", status: 0, reward: "17.00", createtime: "2024-09-07 15:29:21", task_image: MOCK_TASKS[0].image, type_name: "简单注册" },
            { id: 11748, task_id: 487, task_title: "立返-工行一拖15", status: 1, reward: "8.00", createtime: "2024-09-06 10:00:00", task_image: MOCK_TASKS[1].image, type_name: "证券金融", reasons: "" },
            { id: 11700, task_id: 436, task_title: "方块兽", status: 2, reward: "4.50", createtime: "2024-09-05 09:00:00", task_image: MOCK_TASKS[2].image, type_name: "简单注册", reasons: "截图不清晰" },
          ].filter((r) => fields.status === "All" || String(r.status) === String(fields.status)));
        } else if (path.includes("get_examine_info")) resolve(MOCK_DETAIL);
        else resolve({});
      }, 300);
    });
  }

  const STATUS_MAP = { 0: "审核中", 1: "审核通过", 2: "审核失败", All: "全部" };
  const OPTION_LABELS = {
    name: "姓名",
    mobile: "手机号",
    text1: "备注1",
    text2: "备注2",
    imgea: "截图",
  };

  return {
    getTaskTypes,
    getTaskList,
    getTaskInfo,
    submitTask,
    getExamineList,
    getExamineInfo,
    upload,
    STATUS_MAP,
    OPTION_LABELS,
    makeSign,
  };
})();
