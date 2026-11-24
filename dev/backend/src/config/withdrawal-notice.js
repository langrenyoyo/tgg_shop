// New requests charge 10%; historical requests keep their saved fee and net amount.
const withdrawalPolicy = Object.freeze({ withdrawFeeRate: 0.1, withdrawDailyCountLimit: 0, withdrawDailyAmountLimit: 0 });

// Retire obsolete business rules without hiding channel/authorization requirements.
function withdrawalNotice(value) {
  return String(value || "")
    .replace(/实际到账金额以提交页面展示为准/g, "提交页面展示预计到账金额，实际金额以到账记录为准")
    .replace(/单笔提现(?:金额)?\s*(?:为|是|：|:)?\s*[¥￥]?\s*\d+(?:\.\d+)?\s*元?\s*[-—–~～至到]\s*[¥￥]?\s*(\d+(?:\.\d+)?)\s*元/g, "单笔提现上限 $1 元")
    .split(/([，,。；;\n])/)
    .reduce((result, part, index, parts) => {
      if (index % 2) return result;
      if (/单笔(?:提现)?(?:金额)?\s*(?:上限|最多|最高|不超过|不能超过)/.test(part) && /\d/.test(part)) return result + "提现金额须符合支付渠道要求" + (parts[index + 1] || "");
      if (/(?:最低提现|提现最低|最低金额|提现门槛|\d+(?:\.\d+)?\s*元起(?:提|提现)?|(?:满|达到)\s*\d+(?:\.\d+)?\s*元.*(?:可|能)提现)/.test(part)) return result;
      if (/(?:每日|每天|单日|日累计).*(?:提现|次|限额|额度|上限|重置|最多|不得超过|不能超过)/.test(part)) return result;
      if (/手续费/.test(part) && /\d+(?:\.\d+)?\s*[%％]|不收取|免收|免费|不收|手续费(?:为|[：:])\s*0(?:元|\s|$)/.test(part)) return result + "平台提现手续费为 10%" + (parts[index + 1] || "");
      if (/\d+\s*分钟内到账/.test(part)) return result + "审核通过后由支付渠道处理，到账时间以实际处理结果为准" + (parts[index + 1] || "");
      return result + part + (parts[index + 1] || "");
    }, "")
    .trim()
    .replace(/[，,；;][ \t]*(?=\r?\n|$)/g, "。");
}

module.exports = { withdrawalNotice, withdrawalPolicy };
