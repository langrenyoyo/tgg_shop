/**
 * 赚积分页：做任务（API 对接）+ 签到
 */
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  let state = {
    mainTab: "tasks",
    taskView: "list", // list | detail | submit | examine | invite
    categories: [],
    currentCid: "",
    page: 1,
    tasks: [],
    currentTask: null,
    uploadedImages: [],
    examineStatus: "All",
  };

  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.hidden = false;
    setTimeout(() => (t.hidden = true), 2000);
  }

  function setTitle(title) {
    $("#pageTitle").textContent = title;
  }

  function showTaskView(view) {
    state.taskView = view;
    $$("#panelTasks .view").forEach((v) => v.classList.remove("active"));
    const map = {
      list: "#viewTaskList",
      detail: "#viewTaskDetail",
      submit: "#viewTaskSubmit",
      examine: "#viewMyExamine",
      invite: "#viewInvite",
    };
    $(map[view]).classList.add("active");

    const back = $("#btnBack");
    const myBtn = $("#btnMyTasks");
    const mainTabs = $("#mainTabs");

    if (view === "list") {
      back.hidden = true;
      myBtn.hidden = false;
      mainTabs.hidden = false;
      setTitle("赚积分 · 做任务");
    } else {
      back.hidden = false;
      myBtn.hidden = true;
      mainTabs.hidden = true;
      const titles = { detail: "任务详情", submit: "提交任务", examine: "我的提交", invite: "我的邀请码" };
      setTitle(titles[view] || "赚积分");
    }
  }

  function switchMainTab(tab) {
    state.mainTab = tab;
    $$(".main-tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    $$(".panel").forEach((p) => p.classList.remove("active"));
    $("#panelTasks").classList.add("active");
    $("#btnMyTasks").hidden = tab !== "tasks";
    if (tab === "tasks") showTaskView("list");

  }

  // —— 做任务：分类 ——
  async function loadCategories() {
    try {
      const data = await TaskApi.getTaskTypes();
      state.categories = data || [];
      const scroll = $("#catScroll");
      scroll.innerHTML = `<button class="cat-chip active" data-cid="">全部</button>`;
      state.categories.forEach((c) => {
        const btn = document.createElement("button");
        btn.className = "cat-chip";
        btn.dataset.cid = c.id;
        btn.textContent = c.name;
        scroll.appendChild(btn);
      });
      scroll.addEventListener("click", (e) => {
        const chip = e.target.closest(".cat-chip");
        if (!chip) return;
        $$(".cat-chip", scroll).forEach((c) => c.classList.remove("active"));
        chip.classList.add("active");
        state.currentCid = chip.dataset.cid;
        state.page = 1;
        loadTasks(true);
      });
    } catch (e) {
      toast(e.message);
    }
  }

  // —— 做任务：列表（列表不展示奖励金额，符合 PRD）——
  async function loadTasks(reset = false) {
    try {
      const search = $("#taskSearch").value.trim();
      const opts = {};
      if (state.currentCid) opts.c_id = state.currentCid;
      if (search) opts.search = search;
      const data = await TaskApi.getTaskList(state.page, 10, opts);
      if (reset) state.tasks = data || [];
      else state.tasks.push(...(data || []));
      renderTaskList();
      $("#loadMore").hidden = !(data && data.length >= 10);
    } catch (e) {
      toast(e.message);
    }
  }

  function renderTaskList() {
    const list = $("#taskList");
    if (!state.tasks.length) {
      list.innerHTML = '<div class="empty">暂无任务</div>';
      return;
    }
    list.innerHTML = state.tasks
      .map(
        (t) => `
      <div class="task-card" data-id="${t.id}">
        <img src="${t.image || ""}" alt="" onerror="this.style.background='#eee'">
        <div class="info">
          <div class="title">${esc(t.title)}</div>
          <div class="meta">
            <span class="tag">${esc(t.c_name || t.type_name || "任务")}</span>
            ${t.tishi ? `<span class="tag">${esc(t.tishi)}</span>` : ""}
          </div>
        </div>
        <div class="action">去完成 ›</div>
      </div>`
      )
      .join("");
    list.onclick = (e) => {
      const card = e.target.closest(".task-card");
      if (card) openTaskDetail(Number(card.dataset.id));
    };
  }

  // —— 任务详情（详情页展示奖励，对接 users_ratio / reward）——
  async function openTaskDetail(id) {
    try {
      const data = await TaskApi.getTaskInfo(id);
      state.currentTask = data;
      if (data.is_pause) {
        toast("任务已暂停");
        return;
      }
      renderTaskDetail(data);
      showTaskView("detail");
    } catch (e) {
      toast(e.message);
    }
  }

  function renderTaskDetail(task) {
    const el = $("#detailContent");
    const steps = (task.content || [])
      .map(
        (step, i) => `
      <div class="step-block">
        <h4>步骤 ${i + 1}</h4>
        <div class="html-content">${step.txt || ""}</div>
        ${(step.img_list || []).length ? `<div class="step-imgs">${step.img_list.map((u) => `<img src="${u}" alt="">`).join("")}</div>` : ""}
      </div>`
      )
      .join("");

    el.innerHTML = `
      <div class="detail-hero">
        <img src="${task.image || ""}" alt="">
        <h2>${esc(task.title)}</h2>
        <div class="reward">会员可得 ¥${task.users_ratio || task.reward || "0"}</div>
        <div class="reward-sub">任务金额 ¥${task.reward || "0"} · ${esc(task.type_name || "")}</div>
        ${task.tishi ? `<div class="tishi">⚠ ${esc(task.tishi)}</div>` : ""}
      </div>
      ${steps || '<div class="step-block"><p class="hint">请按任务要求完成后提交</p></div>'}
    `;
    $("#btnAcceptTask").onclick = () => openSubmitForm(task);
  }

  // —— 提交任务（按 option 动态表单）——
  function openSubmitForm(task) {
    state.uploadedImages = [];
    const options = Array.isArray(task.option)
      ? task.option
      : String(task.option || "").split(",").filter(Boolean);

    const form = $("#submitForm");
    form.innerHTML = options
      .map((opt) => {
        const label = TaskApi.OPTION_LABELS[opt.trim()] || opt;
        if (opt.trim() === "imgea") {
          return `
          <div class="form-group" data-opt="imgea">
            <label>${label} *</label>
            <input type="file" accept="image/*" multiple id="imgInput">
            <div class="upload-preview" id="imgPreview"></div>
          </div>`;
        }
        return `
        <div class="form-group" data-opt="${opt.trim()}">
          <label>${label}</label>
          <input name="${opt.trim()}" type="${opt.trim() === "mobile" ? "tel" : "text"}" placeholder="请输入${label}">
        </div>`;
      })
      .join("");

    const imgInput = $("#imgInput", form);
    if (imgInput) {
      imgInput.onchange = async (e) => {
        for (const file of e.target.files) {
          try {
            toast("上传中…");
            const res = await TaskApi.upload(file);
            state.uploadedImages.push(res.path || res.url);
            renderImgPreview();
          } catch (err) {
            toast(err.message);
          }
        }
      };
    }

    form.onsubmit = async (e) => {
      e.preventDefault();
      await submitTaskForm(task, options);
    };
    showTaskView("submit");
  }

  function renderImgPreview() {
    const box = $("#imgPreview");
    if (!box) return;
    box.innerHTML = state.uploadedImages.map((u) => `<img src="${u}" alt="">`).join("");
  }

  async function submitTaskForm(task, options) {
    const payload = { task_id: task.id };
    options.forEach((opt) => {
      const key = opt.trim();
      if (key === "imgea") {
        payload.images = state.uploadedImages.join(",");
      } else {
        const input = $(`[name="${key}"]`, $("#submitForm"));
        if (input) payload[key] = input.value.trim();
      }
    });
    try {
      await TaskApi.submitTask(payload);
      toast("提交成功，等待审核");
      showTaskView("examine");
      loadExamineList();
    } catch (e) {
      toast(e.message);
    }
  }

  // —— 拉新任务 ——
  async function openInvitePage() {
    try {
      const [info, list] = await Promise.all([
        InviteApi.getInviteInfo(),
        InviteApi.getInviteList(),
      ]);
      renderInvitePage(info, list || []);
      showTaskView("invite");
    } catch (e) {
      toast(e.message);
    }
  }

  function renderInvitePage(info, list) {
    const el = $("#inviteContent");
    el.innerHTML = `
      <div class="invite-hero">
        <div class="invite-label">我的邀请码</div>
        <div class="invite-code" id="inviteCode">${esc(info.invite_code)}</div>
        <div class="invite-actions">
          <button class="btn-outline" id="btnCopyCode">复制邀请码</button>
          <button class="btn-primary" id="btnShare">分享给好友</button>
        </div>
      </div>
      <div class="card">
        <h3>奖励规则</h3>
        <ul class="rule-list">
          <li>好友通过你的邀请码注册，你获得 <strong>${info.reward_invite ?? 3} 积分</strong></li>
          <li>好友做任务所得积分的 <strong>${info.reward_ratio ?? 10}%</strong> 持续奖励给你</li>
          <li>新用户注册即赠送 <strong>1 个月会员</strong></li>
        </ul>
        <p class="hint muted">以上数值可在后台配置</p>
      </div>
      <div class="invite-stats">
        <div class="stat-item">
          <div class="stat-num">${info.total_invited ?? 0}</div>
          <div class="stat-label">累计邀请</div>
        </div>
        <div class="stat-item">
          <div class="stat-num">${info.total_commission ?? 0}</div>
          <div class="stat-label">累计提成(积分)</div>
        </div>
      </div>
      <div class="card">
        <h3>我邀请的好友</h3>
        <div class="invite-list" id="inviteList">${renderInviteList(list)}</div>
      </div>
    `;

    $("#btnCopyCode").onclick = () => {
      copyText(info.invite_code);
      toast("邀请码已复制");
    };
    $("#btnShare").onclick = () => shareInvite(info);
  }

  function renderInviteList(list) {
    if (!list.length) return '<div class="empty">暂无邀请记录，快去分享吧</div>';
    return list
      .map(
        (u) => `
      <div class="invite-item">
        <div class="avatar">${esc((u.nickname || "?")[0])}</div>
        <div class="body">
          <div class="title">${esc(u.nickname || "用户")}</div>
          <div class="meta">${u.bind_time || ""} 注册</div>
        </div>
        <div class="contrib">+${u.contributed ?? 0} 积分</div>
      </div>`
      )
      .join("");
  }

  function copyText(text) {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text);
      return;
    }
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }

  function shareInvite(info) {
    const text = `${info.share_title || "邀请你加入 TGG Shop"}\n邀请码：${info.invite_code}\n${info.share_url || ""}`;
    if (navigator.share) {
      navigator.share({ title: "TGG Shop 邀请", text, url: info.share_url }).catch(() => copyText(text));
    } else {
      copyText(text);
      toast("分享文案已复制，可粘贴到微信");
    }
  }

  // —— 我的提交 ——
  async function loadExamineList() {
    try {
      const data = await TaskApi.getExamineList(1, state.examineStatus);
      renderExamineList(data || []);
    } catch (e) {
      toast(e.message);
    }
  }

  function renderExamineList(items) {
    const list = $("#examineList");
    if (!items.length) {
      list.innerHTML = '<div class="empty">暂无提交记录</div>';
      return;
    }
    list.innerHTML = items
      .map((item) => {
        const st = TaskApi.STATUS_MAP[item.status] || item.status;
        const cls = `status-${item.status}`;
        const img = item.task_image?.startsWith("http") ? item.task_image : (window.TGG_CONFIG?.baseUrl || "") + item.task_image;
        return `
        <div class="examine-item">
          <img src="${img}" alt="" onerror="this.style.background='#eee'">
          <div class="body">
            <div class="title">${esc(item.task_title)}</div>
            <div class="meta">${item.createtime} · ¥${item.reward}</div>
            <div class="meta ${cls}">${st}${item.reasons ? " · " + esc(item.reasons) : ""}</div>
          </div>
        </div>`;
      })
      .join("");
  }

  function esc(s) {
    if (!s) return "";
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // —— 事件绑定 ——
  $$(".main-tab").forEach((b) => (b.onclick = () => switchMainTab(b.dataset.tab)));

  $("#btnBack").onclick = () => {
    if (state.taskView === "submit") showTaskView("detail");
    else if (state.taskView === "detail" || state.taskView === "invite") showTaskView("list");
    else showTaskView("list");
  };

  $("#inviteEntry").onclick = () => openInvitePage();

  $("#btnMyTasks").onclick = () => {
    showTaskView("examine");
    loadExamineList();
  };

  $("#taskSearch").addEventListener(
    "input",
    debounce(() => {
      state.page = 1;
      loadTasks(true);
    }, 400)
  );

  $("#loadMore").onclick = () => {
    state.page++;
    loadTasks(false);
  };

  $$(".ex-tab").forEach((b) => {
    b.onclick = () => {
      $$(".ex-tab").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      state.examineStatus = b.dataset.status;
      loadExamineList();
    };
  });

  function debounce(fn, ms) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  // 初始化
  switchMainTab("tasks");
  loadCategories();
  loadTasks(true);
})();
