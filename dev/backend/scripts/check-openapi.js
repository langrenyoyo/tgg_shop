const fs = require("fs");
const path = require("path");
const YAML = require("yaml");

const openapiPath = path.resolve(__dirname, "..", "openapi.yaml");
const content = fs.readFileSync(openapiPath, "utf8");
const document = YAML.parseDocument(content, { uniqueKeys: true });
if (document.errors.length) throw new Error(document.errors.map(error => error.message).join("\n"));
const spec = document.toJS();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function resolveReference(reference) {
  assert(reference.startsWith("#/"), `Unsupported external reference: ${reference}`);
  const value = reference.slice(2).split("/").reduce((node, key) => node?.[key.replace(/~1/g, "/").replace(/~0/g, "~")], spec);
  assert(value !== undefined, `Unresolved reference: ${reference}`);
  return value;
}
function checkReferences(node) {
  if (!node || typeof node !== "object") return;
  if (node.$ref) resolveReference(node.$ref);
  Object.values(node).forEach(checkReferences);
}
assert(/^3\./.test(spec.openapi), "Expected OpenAPI 3 document");
checkReferences(spec);
for (const [route, item] of Object.entries(spec.paths || {})) {
  for (const method of ["get", "post", "put", "patch", "delete", "options", "head"]) {
    const operation = item[method];
    if (!operation) continue;
    assert(operation.responses && Object.keys(operation.responses).length, `Missing responses: ${method} ${route}`);
    const parameters = [...(item.parameters || []), ...(operation.parameters || [])].map(parameter => parameter.$ref ? resolveReference(parameter.$ref) : parameter);
    for (const match of route.matchAll(/\{([^}]+)\}/g)) {
      assert(parameters.some(parameter => parameter.in === "path" && parameter.name === match[1] && parameter.required === true), `Missing required path parameter ${match[1]}: ${method} ${route}`);
    }
  }
}

const requiredPaths = [
  "/api/health",
  "/api/common/upload",
  "/api/auth/me",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/refresh",
  "/api/admin/auth/login",
  "/api/admin/auth/logout",
  "/api/admin/auth/refresh",
  "/api/station/auth/login",
  "/api/station/auth/logout",
  "/api/station/auth/refresh",
  "/api/station/me",
  "/api/station/dashboard",
  "/api/station/orders",
  "/api/station/orders/{orderId}",
  "/api/station/orders/{orderId}/receive",
  "/api/station/orders/{orderId}/pickup-verify",
  "/api/station/orders/{orderId}/exceptions",
  "/api/station/operation-logs",
  "/api/me",
  "/api/config",
  "/api/home",
  "/api/products",
  "/api/products/{productId}",
  "/api/points-exchange",
  "/api/member/subscribe",
  "/api/auth/wechat-login",
  "/api/member/payments",
  "/api/orders/{orderId}",
  "/api/orders/{orderId}/cancel",
  "/api/orders/{orderId}/receive",
  "/api/refunds/{refundId}",
  "/api/orders",
  "/api/orders/{orderId}/pay",
  "/api/payments",
  "/api/orders/{orderId}/payments",
  "/api/payments/{payNo}/mock-callback",
  "/api/payments/{payNo}/lfwin",
  "/api/payments/{payNo}/lfwin/query",
  "/api/payments/{payNo}/lfwin/close",
  "/api/payment-providers/lfwin/notify",
  "/api/orders/{orderId}/refunds",
  "/api/tasks",
  "/api/task-types",
  "/api/task-platform/status",
  "/api/tasks/{taskId}",
  "/api/tasks/{taskId}/submit",
  "/api/submissions",
  "/api/submissions/{submissionId}",
  "/api/task/callback",
  "/api/invite/info",
  "/api/invite/list",
  "/api/invite/stats",
  "/api/signin/status",
  "/api/signin/start",
  "/api/signin/ad_complete",
  "/api/signin/lottery_spin",
  "/api/pickup-sites",
  "/api/delivery/teams",
  "/api/addresses",
  "/api/addresses/{addressId}",
  "/api/withdrawals",
  "/api/points-ledger",
  "/api/ranking",
  "/api/tickets",
  "/api/admin/auth/me",
  "/api/admin/summary",
  "/api/admin/orders",
  "/api/admin/orders/{orderId}/pickup-verify",
  "/api/admin/orders/{orderId}/ship",
  "/api/admin/orders/{orderId}/deliver",
  "/api/admin/products",
  "/api/admin/products/{productId}",
  "/api/admin/inventory-ledger",
  "/api/admin/config",
  "/api/admin/task-submissions",
  "/api/admin/task-submissions/{submissionId}/approve",
  "/api/admin/task-submissions/{submissionId}/reject",
  "/api/admin/users",
  "/api/admin/addresses",
  "/api/admin/invites",
  "/api/admin/users/{userId}",
  "/api/admin/tickets",
  "/api/admin/tickets/{ticketId}",
  "/api/admin/pickup-sites",
  "/api/admin/pickup-sites/{siteId}",
  "/api/admin/delivery-teams",
  "/api/admin/delivery-teams/{teamId}",
  "/api/admin/withdrawals",
  "/api/admin/withdrawals/{withdrawalId}/approve",
  "/api/admin/withdrawals/{withdrawalId}/reject",
  "/api/admin/order-status-logs",
  "/api/admin/operation-logs",
  "/api/admin/approval-requests",
  "/api/admin/approval-requests/{approvalId}/approve",
  "/api/admin/approval-requests/{approvalId}/reject",
  "/api/admin/ledger",
  "/api/admin/payments/cancel-timeouts",
  "/api/admin/delivery/scan-exceptions",
  "/api/admin/permissions",
  "/api/admin/exceptions",
  "/api/admin/exceptions/{exceptionId}/resolve",
  "/api/admin/refunds",
  "/api/admin/refunds/{refundId}/approve"
];

for (const apiPath of requiredPaths) {
  assert(content.includes(`  ${apiPath}:`), `OpenAPI missing path: ${apiPath}`);
}

const requiredTerms = [
  "openapi: 3.0.3",
  "multipart/form-data",
  "UserBearerAuth",
  "AdminBearerAuth",
  "bearerFormat: HMAC",
  "scheme: bearer",
  "/api/auth/logout",
  "/api/admin/auth/logout",
  "session revoked",
  "pure_points",
  "points_plus_cash",
  "pay_scene",
  "payment_order",
  "member_open",
  "goods_cash",
  "cash_diff",
  "payNo",
  "payment_timeout_cancelled",
  "payment_callback_failed",
  "LFWIN",
  "paymentStatus",
  "cancelled",
  "CreateOrderRequest",
  "RefundId",
  "ExceptionId",
  "exception:write",
  "config:write",
  "product:write",
  "task:review",
  "withdraw:approve",
  "approval:request",
  "approval:review",
  "TGG_TASK_PLATFORM",
  "task_callback",
  "invite_commission",
  "order:fulfillment"
  ,
  "operation_ticket",
  "ticket:write",
  "customer:read"
];

for (const term of requiredTerms) {
  assert(content.includes(term), `OpenAPI missing term: ${term}`);
}

console.log("OpenAPI checks passed");
