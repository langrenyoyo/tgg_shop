const Code128 = require("../vendor/jsbarcode/CODE128/CODE128_AUTO").default;

function encode(number) {
  if (typeof number !== "string" || !/^[\x21-\x7e]{1,32}$/.test(number)) throw new Error("会员卡号格式不支持");
  const encoder = new Code128(number, {});
  if (!encoder.valid()) throw new Error("会员卡号格式不支持");
  return encoder.encode().data;
}

function draw(canvas, number, width, height, pixelRatio) {
  const bits = encode(number);
  canvas.width = Math.floor(width * pixelRatio);
  canvas.height = Math.floor(height * pixelRatio);
  // Ten-module quiet zones on each side; integer physical pixels avoid blurred edges.
  const moduleWidth = Math.floor(canvas.width / (bits.length + 20));
  if (moduleWidth < 2) throw new Error("卡号较长，请将下方卡号交给收银员录入");
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000000";
  const start = Math.floor((canvas.width - bits.length * moduleWidth) / 2);
  const top = Math.round(12 * pixelRatio);
  for (let i = 0; i < bits.length; i++) {
    if (bits[i] === "1") ctx.fillRect(start + i * moduleWidth, top, moduleWidth, canvas.height - top * 2);
  }
}
module.exports = { encode, draw };
