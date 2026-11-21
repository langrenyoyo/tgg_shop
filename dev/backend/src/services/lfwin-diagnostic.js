// Never persist or expose provider prose: it can contain signing keys, payer
// identity or an echoed request. Only recognized codes get fixed explanations.
const messages = {
  '-5039': ['settlement_configuration', '微信小程序资金受控交易必须实时清算，请联系收款服务商调整清算配置'],
  '-4006': ['upstream_order_missing', '支付通道未查询到该订单，请联系客服核对，请勿重复付款'],
  '0024': ['merchant_registration', '商户报备未成功，请联系收款服务商处理'],
  '1030': ['channel_configuration', '支付渠道未配置，请联系收款服务商处理']
};

function diagnostic(error) {
  const response = error?.providerResponse;
  const status = String(response?.status ?? '');
  const match = typeof response?.message === 'string'
    ? response.message.match(/^\s*:?[\s]*(-?\d{4,6})\s*[,，:：]/) : null;
  const code = match?.[1] || null;
  const known = messages[code];
  return {
    providerStatus: /^[A-Za-z0-9_-]{1,32}$/.test(status) ? status : null,
    code,
    category: known?.[0] || 'provider_error',
    message: known?.[1] || '支付接口返回异常，请按支付单号联系收款服务商核查'
  };
}

module.exports = { diagnostic };
