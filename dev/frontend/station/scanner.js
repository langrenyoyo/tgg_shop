// Scan contents are treated only as form data, never as navigation or executable code.
export function parseScan(raw, target, selectedOrderId = "") {
  const text = String(raw || "").trim();
  if (!text || text.length > 1024) throw new Error("无法识别此码，请扫描订单码或取货码");
  let value = { [target]: text };
  if (text.startsWith("{")) {
    try { value = JSON.parse(text); } catch { throw new Error("二维码内容格式不正确"); }
  }
  const orderId = typeof (value.orderId || value.orderNo || value.orderCode) === "string" ? String(value.orderId || value.orderNo || value.orderCode).trim() : "";
  const pickupCode = typeof (value.pickupCode || value.code) === "string" ? String(value.pickupCode || value.code).trim() : "";
  if (orderId && !/^[A-Za-z0-9_-]{1,100}$/.test(orderId)) throw new Error("订单码格式不正确");
  if (selectedOrderId && orderId && selectedOrderId !== orderId) throw new Error("此码不属于当前订单，请核对后重新扫描");
  if (target === "orderId" && !orderId) throw new Error("请扫描包含订单号的订单码");
  if (target === "pickupCode" && !/^\d{6}$/.test(pickupCode)) throw new Error("请扫描包含六位取货码的二维码或条码");
  return target === "orderId" ? { orderId } : { orderId, pickupCode };
}

export function createCameraScanner({ onError }) {
  let active = null;

  function stop() {
    const session = active;
    if (!session) return;
    active = null;
    clearTimeout(session.timer);
    clearTimeout(session.deadline);
    session.stream?.getTracks().forEach(track => track.stop());
    session.video.pause();
    session.video.srcObject = null;
    session.overlay.remove();
    document.removeEventListener("keydown", session.onKey);
    if (session.previousFocus?.isConnected) session.previousFocus.focus();
  }

  async function start({ target, selectedOrderId, onResult }) {
    stop();
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      onError("摄像头需要 HTTPS 或本机 localhost，请使用安全地址访问，也可手动输入");
      return;
    }
    if (!window.BarcodeDetector) {
      onError("此浏览器暂不支持摄像头识码，请更换支持扫码的浏览器或手动输入");
      return;
    }

    const overlay = document.createElement("div");
    overlay.className = "dialog scanner-dialog";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "scannerTitle");
    overlay.innerHTML = `<section class="dialog-card"><h2 id="scannerTitle">${target === "pickupCode" ? "扫描取货码" : "扫描订单码"}</h2><video class="scanner-video" autoplay muted playsinline></video><p class="scanner-status" role="status">正在请求摄像头权限…</p><p class="muted">将二维码或条码放入画面，识别后请核对并确认提交。</p><button type="button" class="secondary">关闭摄像头，手动输入</button></section>`;
    const video = overlay.querySelector("video");
    video.muted = true;
    const status = overlay.querySelector(".scanner-status");
    const close = overlay.querySelector("button");
    const session = { overlay, video, previousFocus: document.activeElement };
    session.onKey = event => {
      if (event.key === "Escape") stop();
      if (event.key === "Tab") { event.preventDefault(); close.focus(); }
    };
    active = session;
    document.body.append(overlay);
    close.onclick = stop;
    close.focus();
    document.addEventListener("keydown", session.onKey);
    session.deadline = setTimeout(() => {
      if (active !== session) return;
      stop();
      onError("扫码超时，摄像头已关闭。请重新扫码或手动输入");
    }, 60000);

    try {
      const supported = await window.BarcodeDetector.getSupportedFormats();
      if (active !== session) return;
      const formats = ["qr_code", "code_128", "code_39", "ean_13", "ean_8"].filter(format => supported.includes(format));
      if (!formats.length) throw new Error("当前浏览器不支持所需码制，请手动输入");
      const detector = new window.BarcodeDetector({ formats });
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" } } });
      // Permission may be granted after the operator has closed the scanner.
      if (active !== session) { stream.getTracks().forEach(track => track.stop()); return; }
      session.stream = stream;
      video.srcObject = stream;
      await video.play();
      if (active !== session) return;
      status.textContent = "请对准二维码或条码";
      const detect = async () => {
        if (active !== session) return;
        try {
          const codes = await detector.detect(video);
          if (active !== session) return;
          for (const code of codes) {
            let result;
            try { result = parseScan(code.rawValue, target, selectedOrderId); }
            catch (error) { status.textContent = error.message; continue; }
            stop();
            onResult(result);
            return;
          }
        } catch {
          if (active !== session) return;
          stop();
          onError("摄像头识别失败，请重新扫码或手动输入");
          return;
        }
        session.timer = setTimeout(detect, 200);
      };
      session.timer = setTimeout(detect, 200);
    } catch (error) {
      if (active !== session) return;
      stop();
      const messages = {
        NotAllowedError: "摄像头权限被拒绝，请在浏览器设置中允许访问或手动输入",
        NotFoundError: "未找到摄像头，请连接摄像头或手动输入",
        NotReadableError: "摄像头被占用或无法打开，请关闭其他摄像头应用后重试"
      };
      onError(messages[error.name] || error.message || "无法打开摄像头，请手动输入");
    }
  }

  window.addEventListener("pagehide", stop);
  document.addEventListener("visibilitychange", () => { if (document.hidden) stop(); });
  return { start, stop };
}
