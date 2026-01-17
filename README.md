# WP2Astro

WordPress 到 Astro 迁移工具集 - 将 WordPress 博客迁移到现代静态站点架构。

## 项目简介

本项目包含将 WordPress 博客迁移到 **Astro + Cloudflare (Workers + D1 + R2)** 架构所需的所有工具和文档。

### 技术栈

- **前端框架**: Astro (静态站点生成器)
- **内容存储**: Markdown / MDX (Git 管理)
- **数据库**: Cloudflare D1 (SQLite 兼容)
- **对象存储**: Cloudflare R2 (S3 兼容)
- **部署**: Cloudflare Workers

---

## 目录结构

```
wp2astro/
├── docs/               # 技术文档
├── design/             # 设计稿 (HTML 原型)
├── migrations/         # D1 数据库迁移文件
├── scripts/            # 迁移工具脚本
│   ├── comments/       # 评论内容处理
│   ├── data/           # 数据文件
│   ├── migration/      # 迁移/导入脚本
│   ├── sql-analysis/   # SQL 分析工具
│   └── utils/          # 工具辅助
├── wordpress/          # WordPress 导出数据
│   ├── assets/         # 静态资源 (图片、Logo 等)
│   ├── db/             # MySQL 数据库导出
│   ├── posts/          # 导出的文章 (pages/posts)
│   └── xml/            # WordPress XML 导出文件
└── README.md
```

---

## 文档说明

| 文档 | 说明 |
|------|------|
| [Wordpress to Astro.md](docs/Wordpress%20to%20Astro.md) | 完整迁移执行方案 |
| [Cloudflare Workers + D1 自建评论系统.md](docs/Cloudflare%20Workers%20+%20D1%20自建评论系统.md) | 评论系统设计与实现 |
| [Astro + Cloudflare D1 + Drizzle 最佳实践与迁移指南.md](docs/Astro%20+%20Cloudflare%20D1%20+%20Drizzle%20最佳实践与迁移指南.md) | Drizzle ORM 集成指南 |

---

## 数据库迁移

D1 数据库迁移文件位于 `migrations/` 目录：

| 文件 | 说明 |
|------|------|
| `0001_init.sql` | 创建 comments 表结构和索引 |
| `0002_import_comments.sql` | 导入 WordPress 文章评论 |
| `0003_import_page_comments.sql` | 导入 WordPress 页面评论 |

### 执行迁移

```bash
# 本地开发
wrangler d1 execute blog-comments --local --file=migrations/0001_init.sql

# 远程生产
wrangler d1 execute blog-comments --remote --file=migrations/0001_init.sql
```

---

## Scripts 脚本

### comments/ - 评论内容处理

| 脚本 | 说明 |
|------|------|
| `check-unconverted-comments.js` | 检查未转换为 Markdown 的评论 |
| `convert-html-to-markdown.js` | HTML 转 Markdown |
| `emoji.js` | Emoji 映射表 (export) |
| `replace-comments.js` | 字面字符串替换 |
| `replace-comments-regex.js` | 正则表达式替换 |
| `replace-emoji-in-comments.js` | 表情图片转 Emoji |
| `replace-emoji-in-comments.test.js` | 表情替换测试 |
| `replace-image-path-in-comments.js` | 图片路径修正 |
| `replace-link-in-comments.js` | @用户链接处理 |
| `replace-nbsp-in-comments.js` | NBSP 空格替换 |
| `search-comments-by-regex.js` | 正则搜索评论 |

### migration/ - 迁移导入

| 脚本 | 说明 |
|------|------|
| `import-wp-comments.js` | 导入 WordPress 文章评论 |
| `import-wp-page-comments.js` | 导入 WordPress 页面评论 |
| `extract-comments.sh` | 从 SQL 备份提取评论数据 |
| `extract-comment-agents-v2.js` | 提取评论 User Agent (v2) |
| `extract-comment-agents-v3.js` | 提取评论 User Agent (v3) |
| `extract-comment-user-agents.js` | 提取评论 User Agent |

### sql-analysis/ - SQL 分析

| 脚本 | 说明 |
|------|------|
| `analyze-sql.js` | 分析 SQL 文件结构 |
| `view-sql.js` | 查看 SQL 文件内容 |

### utils/ - 工具辅助

| 脚本 | 说明 |
|------|------|
| `count-matches.js` | 统计匹配数量 (JS) |
| `count_matches.py` | 统计匹配数量 (Python) |
| `update-blog-weather.js` | 更新博客天气信息 |
| `setup_deploy.sh` | 部署设置脚本 |

### data/ - 数据文件

| 文件 | 说明 |
|------|------|
| `emoji_map.json` | Emoji 映射表 |
| `weather_code.json` | 天气代码映射 |
| `id-weatherCode.json` | 文章 ID 与天气代码对应 |
| `comments_data.sql` | 评论数据 SQL |
| `comment-*.json/csv/sql` | 评论相关数据文件 |

---

## WordPress 导出数据

| 目录 | 说明 |
|------|------|
| `wordpress/assets/` | 静态资源文件 (favicon, logo, 图片, 音乐, 上传文件) |
| `wordpress/db/` | MySQL 数据库 SQL 导出文件 |
| `wordpress/posts/pages/` | 导出的页面 Markdown |
| `wordpress/posts/posts/` | 导出的文章 Markdown |
| `wordpress/xml/` | WordPress XML 导出文件 |

---

## 设计稿

`design/` 目录包含前端设计原型 (HTML)：

| 文件 | 说明 |
|------|------|
| `v1.html` - `v20.html` | 博客主页迭代版本 |
| `weather.html` | 天气组件设计 |
| `editor.html` | 编辑器设计 |
| `game.html` | 游戏页面设计 |
| `3d.html` | 3D 效果设计 |
| `88x31*.png` | 按钮徽章资源 |

---

## 使用示例

```bash
# 搜索评论中的正则匹配
node scripts/comments/search-comments-by-regex.js "icon_\\w+\\.gif" --flags i --context 40

# 替换评论内容
node scripts/comments/replace-comments.js "<old>" "<new>" --commit

# 导入 WordPress 评论
node scripts/migration/import-wp-comments.js

# 分析 SQL 结构
node scripts/sql-analysis/analyze-sql.js

# 更新博客天气数据
node scripts/utils/update-blog-weather.js
```

---

## 迁移流程概览

1. **导出 WordPress 数据** → XML 导出 + 数据库备份
2. **转换文章** → XML → Markdown (`wordpress-export-to-markdown`)
3. **迁移评论** → 解析 XML → 生成 SQL → 导入 D1
4. **处理评论内容** → HTML 转 Markdown、表情转 Emoji、路径修正
5. **上传资源** → 图片等静态资源上传至 R2
6. **部署 Astro** → Cloudflare Workers

详细步骤请参考 [Wordpress to Astro.md](docs/Wordpress%20to%20Astro.md)。

---

## License

MIT
