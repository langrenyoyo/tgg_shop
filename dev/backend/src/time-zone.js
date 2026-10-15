function getTimeZoneParts(value = new Date(), timeZone = "Asia/Shanghai") {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(value));
  return Object.fromEntries(parts.filter((item) => item.type !== "literal").map((item) => [item.type, item.value]));
}

function zonedTimeToUtc(year, month, day, hour = 0, minute = 0, second = 0, timeZone = "Asia/Shanghai") {
  let utc = Date.UTC(year, month - 1, day, hour, minute, second, 0);
  // Recalculate once after applying the zone offset so DST transitions are handled.
  for (let index = 0; index < 3; index += 1) {
    const parts = getTimeZoneParts(new Date(utc), timeZone);
    const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    utc -= represented - utc;
  }
  return new Date(utc);
}

function getMonthRange(monthKey, timeZone = "Asia/Shanghai") {
  const [year, month] = String(monthKey).split("-").map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) throw new Error("invalid month key");
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return {
    start: zonedTimeToUtc(year, month, 1, 0, 0, 0, timeZone),
    end: zonedTimeToUtc(nextYear, nextMonth, 1, 0, 0, 0, timeZone)
  };
}

function toMonthKey(value, timeZone = "Asia/Shanghai") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = getTimeZoneParts(date, timeZone);
  return `${parts.year}-${parts.month}`;
}

function getPreviousMonthKey(value = new Date(), timeZone = "Asia/Shanghai") {
  const parts = getTimeZoneParts(value, timeZone);
  const current = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, 1));
  current.setUTCMonth(current.getUTCMonth() - 1);
  return `${current.getUTCFullYear()}-${String(current.getUTCMonth() + 1).padStart(2, "0")}`;
}

function getLocalTime(value = new Date(), timeZone = "Asia/Shanghai") {
  const parts = getTimeZoneParts(value, timeZone);
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second)
  };
}

module.exports = { getTimeZoneParts, zonedTimeToUtc, getMonthRange, toMonthKey, getPreviousMonthKey, getLocalTime };
