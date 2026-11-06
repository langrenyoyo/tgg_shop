(() => {
  "use strict";
  const message = document.getElementById("status");
  const button = document.getElementById("open-wechat");
  let ticket;
  const invalid = () => {
    button.disabled = true;
    message.textContent = "授权链接无效或已过期，请返回小程序重新复制授权链接。";
  };
  try {
    const fragment = window.location.hash.slice(1);
    if (!fragment || fragment.length > 16384) throw new Error("Invalid link");
    ticket = JSON.parse(decodeURIComponent(fragment));
    // Keep the authorization ticket out of subsequent browser history entries.
    window.history.replaceState(null, "", window.location.pathname);
    if (!ticket || typeof ticket.scheme !== "string" || ticket.scheme.length > 4096
      || !/^weixin:\/\/dl\/business\/\?t=[a-zA-Z0-9_%+\-=]+$/.test(ticket.scheme)
      || !Number.isSafeInteger(ticket.expireTime) || ticket.expireTime < -1 || ticket.expireTime > 8640000000000) throw new Error("Invalid link");
  } catch { invalid(); return; }
  const expired = () => ticket.expireTime !== -1 && ticket.expireTime * 1000 <= Date.now();
  if (expired()) { invalid(); return; }
  if (/MicroMessenger/i.test(navigator.userAgent)) {
    message.textContent = "请在手机系统浏览器打开刚才复制的完整链接，再点击“打开微信授权”。";
    return;
  }
  message.textContent = "点击下方按钮前往微信完成收款授权。如系统询问是否打开微信，请选择允许。";
  button.disabled = false;
  button.addEventListener("click", () => {
    if (expired()) { invalid(); return; }
    try {
      window.location.assign(ticket.scheme);
      message.textContent = "请在微信完成授权。如未打开微信，请确认已安装微信并允许浏览器打开应用，再点击按钮重试。";
    } catch {
      message.textContent = "浏览器未能打开微信，请使用手机系统浏览器，并允许打开应用后重试。";
    }
  });
})();
