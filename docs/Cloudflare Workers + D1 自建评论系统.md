# Cloudflare Workers + D1 自建评论系统

## 数据库（D1 / SQLite）

### Schema 定义

```sql
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  legacy_id INTEGER,
  post_slug TEXT NOT NULL,
  parent_id INTEGER,
  legacy_parent_id INTEGER,
  author_name TEXT NOT NULL,
  author_email TEXT NOT NULL,
  author_website TEXT,
  author_ip TEXT,
  user_agent TEXT,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_comments_post ON comments (post_slug, status, created_at);

CREATE INDEX IF NOT EXISTS idx_comments_legacy ON comments (legacy_id);
```

### 字段说明（与 WordPress 导出字段一致）

| 字段             | 类型    | 允许空 | 说明                                                                                                                                                      |
| ---------------- | ------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id               | INTEGER | NO     | 主键，自增；新系统内的唯一标识                                                                                                                            |
| legacy_id        | INTEGER | YES    | WordPress 原 comment_id；导入时保留，用于校对、回滚或与历史链接对应                                                                                       |
| post_slug        | TEXT    | NO     | 文章 slug；来自 WordPress `<link>` 末尾路径或 `<wp:post_name>` URL 解码后（例如 `4234`）；用于按文章分组                                                  |
| parent_id        | INTEGER | YES    | 父评论 id（指向本表 id）；用于嵌套展示回复；导入时由 `legacy_parent_id` 通过映射填充                                                                      |
| legacy_parent_id | INTEGER | YES    | WordPress 原 `<wp:comment_parent>`；导入阶段用于建立新旧 ID 映射，映射完成后不再更新                                                                      |
| author_name      | TEXT    | NO     | 评论者昵称；来自 `<wp:comment_author>`；必填，保证列表可读                                                                                                |
| author_email     | TEXT    | NO     | 评论者邮箱（明文）；来自 `<wp:comment_author_email>`；必填，用于 Gravatar 头像与邮件通知                                                                  |
| author_website   | TEXT    | YES    | 评论者个人网站 URL；来自 `<wp:comment_author_url>`；可选                                                                                                  |
| author_ip        | TEXT    | YES    | 评论者 IP 地址（明文）；来自 `<wp:comment_author_IP>` 或在线提交时从请求头 `cf-connecting-ip` 读取；仅后台可见，用于风控统计                              |
| user_agent       | TEXT    | YES    | 评论者浏览器 UA；WordPress WXR 通常无此字段，在线提交时从请求头读取；辅助风控与兼容性分析                                                                 |
| content          | TEXT    | NO     | 评论正文；来自 `<wp:comment_content>`；必填，入库前做基础 XSS 过滤（移除 `<script>` 等）                                                                  |
| status           | TEXT    | NO     | 评论状态；取值 `pending`（待审）`public`（已发布）`spam`（垃圾）`deleted`（已删除）；默认 `pending`；来自 `<wp:comment_approved>`（1→public，0→pending）  |
| created_at       | TEXT    | NO     | 评论创建时间，ISO 8601 UTC 字符串格式（例如 `2024-12-03T10:59:13Z`）；来自 WordPress `<wp:comment_date_gmt>` 转换，或在线提交时服务端生成；用于排序与展示 |

### 索引说明

- `idx_comments_post(post_slug, status, created_at)`
  - 复合索引，覆盖文章页面最常见查询：某篇文章的公开评论按时间排序
  - 查询类型：`WHERE post_slug=? AND status='public' ORDER BY created_at ASC`
- `idx_comments_legacy(legacy_id)`
  - 辅助导入与校对；快速查询原 WordPress 评论的新系统 id

### WordPress 评论导入

#### 导入流程

1. **解析 WXR**：用 XML 解析器读取 `wordpress/xml/item.xml`
   - 提取文章标识：`<link>` 末尾路径或 `<wp:post_name>` URL 解码 → `post_slug`
   - 遍历 `<wp:comment>` 列表
2. **两阶段插入**
   - **第一阶段**：插入顶级评论（`<wp:comment_parent>=0`）
     - 字段映射：`legacy_id` ← `<wp:comment_id>`，`legacy_parent_id` ← 0，`parent_id` ← NULL（稍后填充）
     - 记录映射表：`map[legacy_id] = new_inserted_id`
   - **第二阶段**：插入子评论（`<wp:comment_parent>!=0`）
     - 查 `map[legacy_parent_id]` 得到父的新 `id`，填充 `parent_id`
3. **字段转换**
   - `author_name` ← `<wp:comment_author>`
   - `author_email` ← `<wp:comment_author_email>`
   - `author_website` ← `<wp:comment_author_url>`（可能为空）
   - `author_ip` ← `<wp:comment_author_IP>`（可能为空）
   - `user_agent` ← NULL（WXR 无此字段）
   - `content` ← `<wp:comment_content>`（基础清洗，移除 `<script>` 等）
   - `status` ← 若 `<wp:comment_approved>=1` 则 `'public'`，否则 `'pending'`
   - `created_at` ← `<wp:comment_date_gmt>` 转 ISO 8601 UTC 字符串（格式 `YYYY-MM-DDTHH:MM:SSZ`）
   - `post_slug` ← 文章 slug

#### 导入示例（基于 item.xml）

```json
// 第一阶段：插入顶级评论
INSERT INTO comments (legacy_id, post_slug, parent_id, legacy_parent_id, author_name, author_email, author_website, author_ip, user_agent, content, status, created_at)
VALUES (190186, '4234', NULL, 0, 'ip-detail', 'ip-detail@gmail.com', NULL, '122.246.30.31', NULL, '哈哈，都卷得厉害。。。', 'public', '2024-11-20T04:25:38Z');
// 返回 new_id = 101，记录 map[190186] = 101

INSERT INTO comments (legacy_id, post_slug, parent_id, legacy_parent_id, author_name, author_email, author_website, author_ip, user_agent, content, status, created_at)
VALUES (190187, '4234', NULL, 0, 'temp_newbie_t', 'unavailable@yahoo.cn', NULL, '219.144.89.113', NULL, '第一种可能：...', 'public', '2024-11-22T01:42:04Z');
// 返回 new_id = 102，记录 map[190187] = 102

// 第二阶段：插入子评论
INSERT INTO comments (legacy_id, post_slug, parent_id, legacy_parent_id, author_name, author_email, author_website, author_ip, user_agent, content, status, created_at)
VALUES (190188, '4234', 102, 190187, 's5s5', 's5s5cn@gmail.com', 'https://s5s5.me/', '219.144.89.40', NULL, '班主任是个有经验的。。。', 'public', '2024-12-03T10:59:13Z');
// parent_id = map[190187] = 102
```

### 部署到 D1

#### 1. 创建 D1 数据库

```bash
wrangler d1 create blog-comments
```

输出示例：

```
✓ Created database blog-comments
Database ID: 4567890a-bcde-f012-3456-789abcdef012
```

#### 2. 获取 Database ID，更新 wrangler.jsonc

```json
{
  "name": "blog-comments-worker",
  "main": "src/index.ts",
  "type": "service",
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "blog-comments",
      "database_id": "4567890a-bcde-f012-3456-789abcdef012"
    }
  ],
  "env": {
    "production": {
      "vars": {
        "ADMIN_TOKENS": "your-long-random-token-here"
      }
    }
  }
}
```

#### 3. 创建 SQL 迁移文件

在项目根目录创建 `migrations/0001_init.sql`：

```sql
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  legacy_id INTEGER,
  post_slug TEXT NOT NULL,
  parent_id INTEGER,
  legacy_parent_id INTEGER,
  author_name TEXT NOT NULL,
  author_email TEXT NOT NULL,
  author_website TEXT,
  author_ip TEXT,
  user_agent TEXT,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_comments_post ON comments (post_slug, status, created_at);

CREATE INDEX IF NOT EXISTS idx_comments_legacy ON comments (legacy_id);
```

#### 4. 执行迁移

```bash
wrangler d1 execute blog-comments --file ./migrations/0001_init.sql
```

#### 5. 导入 WordPress 评论（可选）

生成导入 SQL（使用脚本解析 `item.xml` 并生成 INSERT 语句到 `generated.sql`），然后执行：

```bash
wrangler d1 execute blog-comments --file ./generated.sql
```

#### 6. 部署 Worker

```bash
wrangler deploy
```

#### 验证部署

```bash
# 本地测试（可选）
wrangler d1 execute blog-comments --command "SELECT COUNT(*) FROM comments"

# 或测试 API
curl https://your-worker-domain.workers.dev/api/comments?post_slug=4234
```

## Astro Actions（集成在主项目中）

### 实现方式说明

相比独立部署 Worker API，使用 **Astro Actions** 有以下优势：

- **统一代码库**：评论逻辑与前端集成在同一 Astro 项目，无需额外部署
- **类型安全**：通过 Zod 自动校验输入，TypeScript 自动推断类型
- **简化部署**：与前端一起部署到 Cloudflare Pages，无维护负担
- **易于迁移**：将来若迁移到自建服务器，只需改为 Express/Fastify 端点，鉴权逻辑不变

### Action 定义

在 `src/actions/index.ts` 中定义以下 Actions：

#### getComments（公开）

**用途**：获取某篇文章的全部公开评论

**调用方式**

```typescript
import { actions } from "astro:actions";

const result = await actions.getComments({ postSlug: "4234" });
```

| 参数     | 类型   | 必填 | 说明                            |
| -------- | ------ | ---- | ------------------------------- |
| postSlug | string | ✓    | 文章 slug，用于查询该文章的评论 |

**响应格式**

```typescript
{
  postSlug: "4234",
  items: [
    {
      id: 101,
      parent_id: null,
      author_name: "ip-detail",
      author_email: "ip-detail@gmail.com",
      author_website: null,
      content: "哈哈，都卷得厉害。。。",
      status: "public",
      created_at: "2024-11-20T04:25:38Z"
    },
    // ... 更多评论
  ]
}
```

**字段说明**

| 字段                   | 类型           | 说明                                |
| ---------------------- | -------------- | ----------------------------------- |
| postSlug               | string         | 请求的文章 slug                     |
| items                  | array          | 评论列表（按 created_at 升序排列）  |
| items[].id             | number         | 评论新系统 ID                       |
| items[].parent_id      | number \| null | 父评论 ID（null 表示顶级评论）      |
| items[].author_name    | string         | 评论者昵称                          |
| items[].author_email   | string         | 评论者邮箱（明文）                  |
| items[].author_website | string \| null | 评论者网站 URL                      |
| items[].content        | string         | 评论正文（已 XSS 过滤）             |
| items[].status         | string         | 始终为 `public`（仅显示已发布评论） |
| items[].created_at     | string         | ISO 8601 UTC 时间字符串             |

---

### 管理员接口（需要 Bearer Token 验证）

#### 鉴权方式

所有管理员 Actions 都需要通过 Astro 中间件验证 Bearer Token。

在 `src/middleware.ts` 中添加：

```typescript
import { defineMiddleware } from "astro:middleware";

export const onRequest = defineMiddleware(async (context, next) => {
  const url = new URL(context.request.url);

  // 拦截所有管理员接口
  if (
    url.pathname.startsWith("/_actions/") &&
    ["moderateComment", "getAdminComments"].some((name) =>
      url.pathname.includes(name)
    )
  ) {
    const authHeader = context.request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" }
      });
    }

    const token = authHeader.slice(7);
    const validTokens = context.locals.runtime.env.ADMIN_TOKENS.split(",");
    if (!validTokens.includes(token)) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" }
      });
    }

    context.locals.isAdmin = true;
  }

  return next();
});
```

**Token 安全建议**

- 必须 HTTPS；不可 HTTP
- Token 长度 ≥ 32 字节，含大小写、数字、特殊符号
- 不可存代码库，仅存环境变量 `ADMIN_TOKENS`
- 定期轮换（每 3-6 个月）；支持逗号分隔的多个 token 并行过渡
- 监控 401 错误率；大量 401 可能表示被爆破

---

#### moderateComment

**用途**：管理员审核单条评论（改变状态）

**调用方式**

```typescript
const result = await actions.moderateComment(
  {
    id: 103,
    action: "approve"
  },
  {
    headers: {
      Authorization: "Bearer your-token-here"
    }
  }
);
// result: { ok: true }
```

| 参数   | 类型   | 必填 | 说明                                                                            |
| ------ | ------ | ---- | ------------------------------------------------------------------------------- |
| id     | number | ✓    | 要审核的评论 ID                                                                 |
| action | string | ✓    | 审核操作：`approve`（发布）、`reject`（打回）、`spam`（垃圾）、`delete`（删除） |

**状态转换表**

| action  | 结果状态 | 说明                           |
| ------- | -------- | ------------------------------ |
| approve | public   | 评论发布，前端可见             |
| reject  | pending  | 打回待审                       |
| spam    | spam     | 标记为垃圾，不在公开列表显示   |
| delete  | deleted  | 软删除，保留数据但标记为已删除 |

**响应格式**

```typescript
{
  ok: true;
}
```

---

#### getAdminComments

**用途**：管理员查询全部评论（含待审/垃圾/删除），支持过滤与分页

**调用方式**

```typescript
const result = await actions.getAdminComments(
  {
    page: 1,
    pageSize: 50,
    status: "pending",
    postSlug: "4234"
  },
  {
    headers: {
      Authorization: "Bearer your-token-here"
    }
  }
);
```

| 参数     | 类型   | 必填 | 说明                                                           |
| -------- | ------ | ---- | -------------------------------------------------------------- |
| page     | number | ✗    | 页码，从 1 开始；默认 1                                        |
| pageSize | number | ✗    | 每页条数；默认 50，最大 200                                    |
| status   | string | ✗    | 状态过滤：`public`、`pending`、`spam`、`deleted`；不传返回全部 |
| postSlug | string | ✗    | 文章 slug 过滤；不传返回全部文章                               |

**响应格式**

```typescript
{
  page: 1,
  pageSize: 50,
  total: 123,
  items: [
    {
      id: 105,
      post_slug: "4234",
      parent_id: null,
      author_name: "moderator",
      author_email: "mod@example.com",
      author_website: null,
      author_ip: "203.0.113.9",
      user_agent: "Mozilla/5.0 ...",
      content: "测试评论",
      status: "pending",
      created_at: "2024-12-04T08:00:00Z"
    }
  ]
}
```

| 字段说明   | 说明                           |
| ---------- | ------------------------------ |
| author_ip  | **仅管理员可见**，用于风控分析 |
| user_agent | 浏览器 UA，帮助识别来源设备    |

---

#### submitComment（公开）

**用途**：提交新评论

**调用方式**

```typescript
import { actions } from "astro:actions";

const result = await actions.submitComment({
  postSlug: "4234",
  content: "这是一条新评论",
  authorName: "张三",
  authorEmail: "zhangsan@example.com",
  authorWebsite: "https://example.com",
  parentId: 102
});
// result: { id: 104, status: "pending" }
```

| 参数          | 类型   | 必填 | 说明                                                               |
| ------------- | ------ | ---- | ------------------------------------------------------------------ |
| postSlug      | string | ✓    | 文章 slug                                                          |
| content       | string | ✓    | 评论正文；长度 1-5000 字符；入库前移除 `<script>` 等危险 HTML 标签 |
| authorName    | string | ✓    | 评论者昵称；长度 1-128 字符                                        |
| authorEmail   | string | ✓    | 评论者邮箱；必须是有效邮箱格式                                     |
| authorWebsite | string | ✗    | 评论者网站 URL；可选，若提供需为有效 URL                           |
| parentId      | number | ✗    | 父评论 ID；若为空表示顶级评论                                      |

**响应格式**

```typescript
{
  id: 104,
  status: "pending"
}
```

**自动捕获字段**（无需客户端提供）

- `author_ip`：从请求头 `cf-connecting-ip` 读取
- `user_agent`：从请求头 `user-agent` 读取
- `created_at`：服务端生成（ISO 8601 UTC）
- `status`：固定为 `pending`（待审）

**错误处理**（Zod 自动验证失败时抛出错误）

- `postSlug` 必填
- `content` 长度必须 1-5000 字符
- `authorName` 长度必须 1-128 字符
- `authorEmail` 必须是有效邮箱格式
- `authorWebsite`（可选）必须是有效 URL

## 后端逻辑

### 实现架构

**Astro Actions 的设计**：

- **公开 Actions**（无需鉴权）：
  - `getComments` - SSR 或客户端获取文章评论
  - `submitComment` - 提交新评论（默认 pending）
- **管理员 Actions**（需要 Bearer Token）：
  - `moderateComment` - 改变单条评论状态
  - `getAdminComments` - 分页查询全部评论

### 工作流程

1. **用户浏览文章**
   - 文章页面 SSR 时：调用 `getComments` 查询 D1，在服务端渲染评论列表
   - 或客户端：用 `actions.getComments()` 动态加载评论

2. **用户提交评论**
   - 前端表单调用 `actions.submitComment()`
   - 服务端验证、清洗、插入数据库，状态为 `pending`
   - 前端可用"乐观更新"立即显示待审评论（带待审标记）

3. **管理员审核**
   - 访问管理后台，调用 `getAdminComments` 获取待审列表
   - 逐条审核，调用 `moderateComment` 改状态为 `public` / `spam` / `delete`
   - 用户下次加载页面时看到已发布的评论

### 数据流和安全

| 端         | 操作        | 验证         | 校验                 | 输出      |
| ---------- | ----------- | ------------ | -------------------- | --------- |
| **客户端** | 填表单      | 前端基础校验 | HTML5 规则           | JSON 请求 |
| **服务端** | 处理 Action | Zod 自动验证 | 长度、邮箱、XSS 过滤 | JSON 响应 |
| **数据库** | 持久化      | N/A          | SQL 参数化查询       | 数据表    |

## 运维与部署

### 项目结构

```
blog/                          # 主 Astro 项目
├── src/
│   ├── actions/
│   │   └── index.ts           # 定义所有 Astro Actions（评论逻辑）
│   ├── middleware.ts          # 中间件，验证管理员 Bearer Token
│   ├── pages/
│   │   ├── blog/[slug].astro  # 文章页面，SSR 时调用 getComments
│   │   ├── admin/comments.astro # 管理后台页面
│   │   └── ...
│   └── components/
│       ├── CommentForm.astro
│       ├── CommentList.astro
│       └── ...
├── wrangler.jsonc             # D1 数据库绑定
├── astro.config.mjs           # Astro 配置（输出 Node.js）
└── package.json
```

### 环境变量配置

在 `wrangler.jsonc` 中配置：

```json
{
  "name": "blog",
  "main": "src/index.ts",
  "type": "service",
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "blog-comments",
      "database_id": "4567890a-bcde-f012-3456-789abcdef012"
    }
  ],
  "env": {
    "production": {
      "vars": {
        "ADMIN_TOKENS": "token1-32-chars-min,token2-32-chars-min"
      }
    }
  }
}
```

### 部署流程

#### 1. 本地开发

```bash
npm install
wrangler d1 execute blog-comments --command "SELECT COUNT(*) FROM comments"
npm run dev
```

#### 2. 预发布测试

```bash
npm run build
npm run preview
```

#### 3. 部署到 Cloudflare Pages + Workers

```bash
# 连接 GitHub 仓库或手动部署
wrangler deploy
```

#### 4. 验证部署

```bash
# 测试公开接口
curl https://blog.yourdomain.com/blog/4234

# 测试管理员接口
curl -X POST https://blog.yourdomain.com/_actions/getAdminComments \
  -H "Authorization: Bearer your-token" \
  -H "Content-Type: application/json" \
  -d '{"page": 1, "pageSize": 50}'
```

### 备份与导出

#### 导出 D1 数据

```bash
# 导出为 SQL 脚本
wrangler d1 export blog-comments --output comments.sql

# 或导出为 SQLite 文件
wrangler d1 execute blog-comments --command ".backup ./backup.db"
```

#### 导入到自建服务器

```bash
# 迁移到本地 SQLite
sqlite3 local.db < comments.sql

# 或迁移到 PostgreSQL（需要字段类型转换）
psql -d blog_db -f comments.sql
```

### 监控与维护

#### Token 轮换

```bash
# 环境变量中同时配置新旧 token（逗号分隔）
ADMIN_TOKENS="old-token,new-token"

# 更新所有客户端后，移除旧 token
ADMIN_TOKENS="new-token"
```

#### 错误监控

- 监控 `401 Unauthorized` 频率，大量 401 可能表示被爆破
- 监控 D1 查询超时
- 监控评论提交速率（可配置 rate limiting）

#### 定期维护

- 每月导出备份一次
- 定期检查 spam 评论并硬删除
- 清理已删除的评论（可选 `DELETE FROM comments WHERE status='deleted' AND created_at < date('-90 days')`）

### 迁移到自建服务器的步骤

1. **导出数据**

   ```bash
   wrangler d1 export blog-comments > backup.sql
   ```

2. **部署 VPS（例如 Hetzner €4.5/月）**
   - 安装 Node.js、SQLite 或 PostgreSQL
   - 导入数据库：`sqlite3 comments.db < backup.sql`

3. **改造 Astro 项目**
   - 修改 `src/actions/index.ts`，从本地数据库读取而非 `env.DB`
   - 或改为 Express/Fastify 服务器

4. **部署前端**
   - 使用 PM2 运行 Astro SSR 服务
   - Nginx 反向代理到 `localhost:4321`

5. **配置域名**
   - 更新 DNS 指向 VPS
   - 申请 SSL 证书（Let's Encrypt 免费）

6. **验证与回退**
   - 测试所有功能正常
   - 如有问题，DNS 改回 Cloudflare（无损回退）
