# 后台端修改 20261118：分析与实现记录

依据根目录《后台端修改20261118.docx》中的 5 项要求与 4 张截图，实现对象为运行中的后台网页 `dev/frontend/admin/` 和对应后台接口。

| 文档编号 | 原问题 | 实现结果 |
| --- | --- | --- |
| 1 | 财务审批页面没有查询条件 | 新增订单号、用户、退款单、提现单、审批单、动作、状态七项组合查询及重置。编号支持包含匹配，用户支持 ID、昵称、手机号，动作及状态精确匹配；条件之间取交集。查询关联业务单和审批单，不修改财务数据。 |
| 2 | 退款、提现、二级审批同时显示，表格拥挤 | 改为“退款审批 / 提现审批 / 二级审批”三个标签，每次展示一个完整宽度的表格，标签显示筛选后的数量。切换标签保留查询条件，原有提交复核、通过、驳回等操作继续使用原接口与权限。 |
| 3 | 商品不能自由调整展示位置 | 增加序号、行拖动和“调整位置”。拖到目标行上半部插入其前，下半部插入其后；也可输入全部商品中的目标序号，支持首位、中间、末位。后端保存排序，商城、分页商品、纯积分列表和首页推荐使用相同顺序。 |
| 4 | 缺少商品删除及二次确认 | “调整库存”之后增加“删除商品”。自定义弹窗按要求左侧“确定”、右侧“取消”；取消不请求删除。确认后商品从后台列表、全局搜索、商城和推荐中移除，禁止继续上架和新下单；保留商品记录、库存和历史订单/退款关联。 |
| 5 | 商品分类缺少删除入口 | 在新增商品表单前增加分类管理区，每类显示商品数和删除按钮；成功后从商品分类候选项、首页快捷分类中移除。存在未删除商品（含下架商品）时，提示先调整分类或删除商品；“买商品送会员”为现有业务专区，保留不可删除。 |

## 实现与数据规则

- 财务筛选针对当前管理员有权读取的已加载记录进行组合匹配，不新增财务写入入口；缺少用户读取权限时无法按未加载的昵称、手机号匹配，仍可用业务记录中的用户 ID。
- 状态对应当前表格记录自身状态。例如同一退款业务的退款单为“审核中”，对应二级审批单为“待处理 / 复核中”，筛选结果可能分别出现在不同标签。
- 商品排序使用 `sortOrder`；删除使用 `deletedAt` 并将销售状态置为下架。SQLite 的现有 `product_content` JSON 保存这两个字段，JSON、PostgreSQL 的整份状态保存也保留它们。
- 删除要求当前商品版本；排序要求当前商品版本及完整原始顺序。其他管理员已修改商品、列表或顺序时返回冲突，避免旧页面覆盖新结果。
- 商品操作要求 `product:write`，操作纯积分商品额外要求 `points_product:write`。分类删除要求 `product:write`。所有成功变更记录后台操作日志。
- 原生输入候选列表不支持嵌入交互按钮，因此分类删除入口放在独立分类管理区；候选项与管理区读取同一接口。

主要文件：

- `dev/frontend/admin/js/finance-filters.js`：财务关联查询与查询表单。
- `dev/frontend/admin/js/catalog-controls.js`：排序、拖动、确认弹窗、删除交互。
- `dev/frontend/admin/js/app.js`、`render.js`、`dev/frontend/admin/catalog.css`、`index.html`：页面接入、表格、分类区及布局。
- `dev/backend/src/services/product-catalog-admin.js`：排序和删除业务规则。
- `dev/backend/src/repositories/product-repository.js`：统一可见商品与排序读取。
- `dev/backend/src/services/product-admin-service.js`、`catalog-service.js`、`admin-search-service.js`、`admin-service.js`：删除后不可编辑/上架、分类校验、首页入口与统计过滤。
- `dev/backend/src/routes/admin-routes.js`、`dev/backend/src/data/sqlite-store.js`、`dev/backend/openapi.yaml`：接口、持久化与契约。

## 接口

| 方法 | 路径 | 请求 / 行为 |
| --- | --- | --- |
| GET | `/api/admin/product-categories` | 分类名称、商品数、是否固定业务专区 |
| DELETE | `/api/admin/product-categories` | `{ "name": "日用" }`；删除空分类 |
| PATCH | `/api/admin/products/{productId}/position` | `position`（从 1 开始）、`expectedOrder`（完整商品 ID 顺序）、`expectedRevision` |
| DELETE | `/api/admin/products/{productId}` | `expectedRevision`；移除销售与管理展示，保留历史引用 |

## 验证

- `npm run test:unit`：**661 / 661 通过**，包括新增后台查询、控制器、接口权限、排序、删除、历史订单保留、SQLite 重载验证。
- OpenAPI 检查、数据库迁移检查、修改的 JavaScript 语法检查、`git diff --check`：全部通过。
- Chromium 实际页面操作通过：输入目标位置、行拖动、删除取消及确认、弹窗左右按钮顺序、占用分类拒绝删除、空分类删除、三个标签切换、七项条件关联查询、查询重置、1024px 布局。无浏览器脚本错误。
- 商品操作在本地临时内存服务器上执行；财务查询浏览器验证使用拦截的模拟业务记录，未执行实际退款或提现。

截图保存在 `.codex-tmp/admin-20261118/`：`finance-filtered.png`（组合查询）、`delete-confirmation.png`（删除确认）、`products.png`（商品与分类）。

本地验证使用临时内存数据。发布时将后台网页和后端接口一起更新，并检查服务健康状态及新静态资源。
