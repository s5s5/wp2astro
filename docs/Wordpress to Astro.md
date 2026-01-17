# Wordpress to Astro

**📝 WordPress 到现代 Node.js 架构迁移执行方案**

这份文档旨在指导你从 **WordPress** 迁移到 **现代 Node.js 静态架构 (Astro)**，同时结合 **Cloudflare Serverless (Workers + D1 + R2)** 能力，并确保架构具备 **100% 的可迁移性**（未来可随时切换回自建服务器）。

## **1. 架构总览**

- **核心框架 (Frontend):** **Astro** (Node.js 驱动的静态站点生成器)。
- **内容存储 (Content):** **Markdown / MDX** 文件 (Git 管理)。
- **媒体存储 (Assets):** **Cloudflare R2** (兼容 S3 协议的对象存储)。
- **评论系统 (Comments):** **自建 Workers + D1**（支持导入历史评论与交互）。
- **搜索方案 (Search):** **Pagefind** (静态索引，无需后端)。
- **部署托管 (Hosting):** **Cloudflare Workers** (Astro 完整应用，包含前端与后端)。

---

**2. 准备工作**

在开始之前，请确保你拥有：

- **Node.js 环境:** 本地安装 Node.js v22+ (推荐 v24 LTS)。
- **Cloudflare 账号:** 开通 R2 和 D1（免费额度足够个人博客使用）。
- **GitHub 仓库:** 用于存放博客源码和 Markdown 内容。
- **域名:** 托管在 Cloudflare DNS 上。

---

**3. 执行步骤 (Phase 1 - Phase 5)**

### **Phase 1: 数据导出与清洗**

**目标：** 将 WordPress XML 转换为 Markdown，并提取所有图片。

1. **导出 XML:** 在 WordPress 后台 工具 -> 导出 -> 所有内容，下载 .xml 文件。
2. **转换工具:** 使用开源工具 wordpress-export-to-markdown。  
   Bash  
   npx wordpress-export-to-markdown

   _运行向导时，开启 "Download Images" 选项，这会将文章插图下载到本地 images 文件夹。_

3. **图片处理 (防锁定关键点):**
   - 不要将图片放在 Git 仓库里（会拖慢仓库）。
   - 使用 S3 客户端（如 S3 Browser 或 rclone）将下载好的 images 文件夹上传到 **Cloudflare R2** bucket 中。
   - **重要设置:** 在 Cloudflare R2 后台，绑定一个自定义域名 (如 assets.yourdomain.com)。
4. **批量替换链接:**
   - 使用 VS Code 打开生成的 Markdown 文件夹。
   - 全局搜索替换：将 images/ (本地路径) 替换为 https://assets.yourdomain.com/ (你的 R2 域名)。

### **Phase 2: 构建 Astro 博客系统**

**目标:** 搭建一个基于文件的、高性能博客前端。

1. **初始化项目:**  
   Bash  
   npm create astro@latest my-blog  
   \# 推荐选择 "Blog" 模板，不含 TypeScript 或 宽松 TypeScript

2. **内容迁移:**
   - 将清洗好的 Markdown 文件放入 src/content/blog/ 目录。
   - 配置 src/content/config.ts 以匹配你 Markdown 的 Frontmatter (标题、日期、标签、分类)。
3. **集成搜索 (Pagefind):**  
   Bash  
   npx astro add astro-pagefind

   _这将自动在构建时生成索引，并在前端提供搜索组件。_

4. **处理重定向 (SEO):**
   - 如果在 WP 的链接是 /2023/01/post-name，而 Astro 是 /blog/post-name。
   - 在 public/ 目录下创建 \_redirects 文件 (Cloudflare 格式)：  
     Plaintext  
     /2023/\* /blog/:splat 301

### **Phase 3: 评论系统实现（Cloudflare Workers + D1）**

**目标:** 构建一个自定义评论系统，支持 WordPress 评论导入与管理。

**为什么不用第三方评论系统：**

- **Waline**：Cloudflare Workers 部署可行性受限，且对 **D1** 支持不完善，导入 WordPress 评论困难。
- **Twikoo**：Cloudflare 部署后不能导入 WordPress 评论。
- **Disqus**：可正常接入，但导入 WordPress 评论失败（常见因 WXR 格式/队列/审核等问题）。

---

#### 1) 自建方案：Cloudflare Workers + D1 + Astro Actions

**优势：**

- 完全掌控评论数据，支持 WordPress 评论导入
- Astro Actions 集成，统一代码库，无需独立部署
- 100% 可迁移性：将来可轻松迁移到自建 VPS
- 类型安全的前后端交互

**核心流程：**

1. **数据库设计（D1 / SQLite）**

   部署到 D1 的数据库 Schema：

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

   **字段说明：**
   - `post_slug`: 文章 slug（用于分组查询）
   - `parent_id`: 父评论 ID（支持嵌套回复）
   - `legacy_id`: WordPress 原 comment_id（用于校对与导入）
   - `status`: 评论状态（`pending` 待审、`public` 已发布、`spam` 垃圾、`deleted` 已删除）
   - 所有 IP 和 User-Agent 字段仅后台可见，用于风控分析

2. **Astro Actions 实现**

   在 `src/actions/index.ts` 中定义以下 Actions：

   **getComments（公开）**
   - 获取某篇文章的全部公开评论
   - 参数：`{ postSlug: string }`
   - 响应：评论列表（按时间升序排列，支持嵌套结构）

   **submitComment（公开）**
   - 提交新评论
   - 参数：`{ postSlug, content, authorName, authorEmail, authorWebsite?, parentId? }`
   - 响应：`{ id, status: 'pending' }`（新评论默认待审）

   **moderateComment（管理员）**
   - 审核单条评论
   - 参数：`{ id, action: 'approve' | 'reject' | 'spam' | 'delete' }`
   - 需要 Bearer Token 验证

   **getAdminComments（管理员）**
   - 查询全部评论（含待审/垃圾/删除），支持过滤与分页
   - 参数：`{ page?, pageSize?, status?, postSlug? }`
   - 响应：分页的评论列表（包含 IP 和 User-Agent）

3. **WordPress 评论导入**

   从 WordPress WXR 文件解析并导入评论：
   - **第一阶段**：插入顶级评论（`parent_id = 0`）
   - **第二阶段**：插入子评论（利用第一阶段的 ID 映射填充 `parent_id`）

   字段映射：
   - `legacy_id` ← WordPress comment_id
   - `post_slug` ← 文章 slug
   - `author_name` ← WordPress comment_author
   - `author_email` ← WordPress comment_author_email
   - `author_website` ← WordPress comment_author_url
   - `author_ip` ← WordPress comment_author_IP
   - `content` ← WordPress comment_content（基础 XSS 过滤）
   - `status` ← WordPress comment_approved 映射（1 → `public`，0 → `pending`）
   - `created_at` ← WordPress comment_date_gmt 转 ISO 8601 UTC

4. **部署步骤**

   ```bash
   # 创建 D1 数据库
   wrangler d1 create blog-comments

   # 更新 wrangler.jsonc，添加 Database ID 和环境变量
   # 设置 ADMIN_TOKENS（长字符串，逗号分隔多个 token）

   # 执行迁移（创建表和索引）
   wrangler d1 execute blog-comments --file ./migrations/0001_init.sql

   # 导入 WordPress 评论（可选）
   wrangler d1 execute blog-comments --file ./generated.sql

   # 部署 Worker 和前端到 Cloudflare
   npm run build
   wrangler deploy
   ```

5. **前端集成**

   在 `src/layouts/BlogPost.astro` 中集成评论组件：
   - 调用 `getComments` 加载该文章的评论
   - 展示评论列表及嵌套回复
   - 提供 `submitComment` 表单供访客评论
   - 头像使用 Gravatar：`https://www.gravatar.com/avatar/${md5(email)}?s=64&d=identicon`

6. **安全与维护**
   - **Token 管理**：Token 存环境变量，不可硬编码；长度 ≥ 32 字节；定期轮换
   - **速率限制**：配合 Cloudflare 内置限流，防止垃圾评论与暴力破解
   - **XSS 防护**：入库前移除 `<script>` 等危险标签；前端渲染时使用 HTML 转义
   - **HTTPS 强制**：Token 验证必须 HTTPS

更多详细信息（包括代码示例、错误处理、迁移方案）请见：《[Cloudflare Workers + D1 自建评论系统](./Cloudflare%20Workers%20+%20D1%20自建评论系统.md)》。

### **Phase 4: 上线部署**

1. **推送代码:** 将 Astro 项目推送到 GitHub。
2. **配置 Astro 适配器:**
   - 安装 Cloudflare Workers 适配器：`npm install @astrojs/cloudflare`
   - 在 `astro.config.mjs` 中配置适配器：
     ```javascript
     import cloudflare from "@astrojs/cloudflare";

     export default defineConfig({
       adapter: cloudflare(),
       output: "hybrid" // 支持静态生成和动态 SSR
     });
     ```
3. **配置 Wrangler:**
   - 在项目根目录创建 `wrangler.jsonc`，配置：
     - D1 数据库绑定
     - 环境变量（`ADMIN_TOKENS` 等）
     - 构建配置（build command: `npm run build`）
4. **部署到 Cloudflare Workers:**
   - 运行 `wrangler deploy` 发布整个应用
   - Astro 前端页面和评论 API 都运行在同一个 Workers 实例上
5. **DNS 设置:**
   - 将你的主域名指向 Cloudflare Workers 路由
   - 或在 Cloudflare 后台配置自定义域名路由

---

**4. 以后如何“逃离” Cloudflare (自建服务器方案)**

如果未来你想转回 VPS 自建，以下是无缝迁移路径：

| 组件            | Cloudflare 方案 | 自建服务器 (VPS/Docker) 替代方案                                                       | 迁移难度             |
| :-------------- | :-------------- | :------------------------------------------------------------------------------------- | :------------------- |
| **前端 + 后端** | CF Workers      | **Nginx / Node.js** 运行 Astro SSR 应用（或导出静态文件用 Nginx 服务）。               | 🟢 极低              |
| **评论数据库**  | D1 (SQLite)     | **SQLite 文件 / MySQL** 从 D1 导出 SQL，导入 VPS 上的数据库。                          | 🟡 中等 (需导数据)   |
| **图片存储**    | R2              | **MinIO / 本地文件** 下载 R2 所有图片到 VPS，配置 Nginx 拦截 assets 域名指向本地目录。 | 🟡 中等 (需搬运文件) |
| **SSL证书**     | 自动            | **Let's Encrypt** 使用 acme.sh 或 Nginx Proxy Manager 自动申请。                       | 🟢 低                |

---

**5. 常见问题备忘 (FAQ)**

- **Q: 评论系统如何管理？**
  - **A:** 通过 Cloudflare Workers + D1 自建。使用 Bearer Token 鉴权访问管理员接口（如 `moderateComment`、`getAdminComments`），支持评论审核、删除、垃圾分类。Token 存环境变量，定期轮换。

- **Q: 如何导入 WordPress 历史评论？**
  - **A:** 从 WordPress WXR 导出中解析评论，按两阶段导入：先导入顶级评论并建立新旧 ID 映射表，再导入子评论并使用映射表填充父评论 ID。支持保留原始 `legacy_id` 用于校对与回滚。

- **Q: 头像怎么显示？**
  - **A:** 使用 Gravatar：对访客邮箱做 `md5(lowercase(trim(email)))` 得到 `email_md5`，头像链接 `https://www.gravatar.com/avatar/{email_md5}?s=64&d=identicon`。

- **Q: 能显示访客 IP 吗？**
  - **A:** 不建议公开显示。可在后端保存原始 IP（仅管理员可见），用于风控统计与分析。公开展示会有隐私与合规风险。

- **Q: 如何防垃圾评论？**
  - **A:** 建议配合 Cloudflare **Turnstile** 验证码 + 后端速率限制。评论状态默认为 `pending`（待审），管理员需主动审核后才会在前端公开展示。
