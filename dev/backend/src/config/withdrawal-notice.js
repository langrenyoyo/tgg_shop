// Remove retired platform minimums from historical notices while preserving
// fees, daily caps, authorization requirements and other operational terms.
function withdrawalNotice(value) {
  return String(value || "")
    .replace(/单笔提现\s*[¥￥]?\s*\d+(?:\.\d+)?\s*[-—–~～至]\s*(\d+(?:\.\d+)?)\s*元/g, "单笔提现上限 $1 元")
    .split(/([，,。；;\n])/)
    .reduce((result, part, index, parts) => {
      if (index % 2) return result;
      if (/(?:最低提现|提现最低|最低金额|提现门槛|\d+(?:\.\d+)?\s*元起(?:提|提现)?|(?:满|达到)\s*\d+(?:\.\d+)?\s*元.*(?:可|能)提现)/.test(part)) return result;
      return result + part + (parts[index + 1] || "");
    }, "")
    .trim();
}

module.exports = { withdrawalNotice };
