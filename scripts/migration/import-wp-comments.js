#!/usr/bin/env node

/**
 * WordPress 评论导入脚本
 *
 * 使用方法:
 *   node scripts/migration/import-wp-comments.js
 *
 * 环境变量:
 *   - DATABASE_URL: D1 数据库连接 URL (可选，默认使用 wrangler d1 execute)
 *   - DRY_RUN: 设置为 'true' 时只生成 SQL 不执行
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

import { XMLParser } from "fast-xml-parser";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WXR_FILE = join(
  __dirname,
  "../wordpress/xml/s5s5.WordPress.2025-12-13.xml"
);

// XML 解析器配置
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  cdataPropName: "__cdata",
  trimValues: true,
  parseTagValue: false,
  isArray: (name) => {
    // 这些标签可能出现多次，需要始终当数组处理
    return ["item", "wp:comment"].includes(name);
  }
});

/**
 * 从 CDATA 或文本节点提取值
 */
function extractText(node) {
  if (node === null || node === undefined) return "";
  if (typeof node === "string") return node;
  if (typeof node === "object") {
    if ("__cdata" in node) return node.__cdata || "";
    if ("#text" in node) return node["#text"] || "";
  }
  return String(node);
}

/**
 * 从 WordPress link 或 post_name 提取 post_slug
 * link 格式: https://s5s5.me/4234 -> 4234
 * post_name 可能是 URL 编码的中文
 */
function extractPostSlug(item) {
  const link = extractText(item.link);
  const postName = extractText(item["wp:post_name"]);

  // 优先从 link 提取 (末尾数字)
  const linkMatch = link.match(/\/(\d+)(?:\/[^/]*)?$/);
  if (linkMatch) {
    return linkMatch[1];
  }

  // 备选：解码 post_name
  if (postName) {
    try {
      return decodeURIComponent(postName);
    } catch {
      return postName;
    }
  }

  return null;
}

/**
 * 清理评论内容，移除危险标签
 */
function sanitizeContent(content) {
  if (!content) return "";

  // 移除 script, style, iframe 等危险标签
  let cleaned = content
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
    .replace(/<iframe\b[^>]*>.*?<\/iframe>/gi, "")
    .replace(/<object\b[^>]*>.*?<\/object>/gi, "")
    .replace(/<embed\b[^>]*>/gi, "")
    .replace(/on\w+\s*=\s*["'][^"']*["']/gi, "") // 移除事件处理器
    .replace(/javascript:/gi, ""); // 移除 javascript: 协议

  return cleaned.trim();
}

/**
 * 将 WordPress 日期格式转换为 ISO 8601 UTC
 * 输入: "2024-11-20 04:25:38" (GMT)
 * 输出: "2024-11-20T04:25:38Z"
 */
function toISODate(wpDate) {
  if (!wpDate) return new Date().toISOString();
  const date = extractText(wpDate).trim();
  // WordPress GMT 日期格式: YYYY-MM-DD HH:MM:SS
  return date.replace(" ", "T") + "Z";
}

/**
 * 转换评论状态
 * approved = 1 -> 'public'
 * approved = 0 或其他 -> 'pending'
 */
function mapStatus(approved) {
  return extractText(approved) === "1" ? "public" : "pending";
}

/**
 * 转义 SQL 字符串
 */
function escapeSql(str) {
  if (str === null || str === undefined) return "NULL";
  return "'" + String(str).replace(/'/g, "''") + "'";
}

/**
 * 解析 WXR 文件并提取评论
 */
function parseWXR(filePath) {
  console.log(`📖 读取文件: ${filePath}`);
  const xml = readFileSync(filePath, "utf-8");

  console.log("🔍 解析 XML...");
  const result = parser.parse(xml);

  const channel = result.rss?.channel;
  if (!channel) {
    throw new Error("无效的 WXR 文件格式");
  }

  const items = channel.item || [];
  console.log(`📦 找到 ${items.length} 个项目`);

  const comments = [];
  let skippedItems = 0;

  for (const item of items) {
    const postType = extractText(item["wp:post_type"]);

    // 只处理 post 类型
    if (postType !== "post") {
      skippedItems++;
      continue;
    }

    const postSlug = extractPostSlug(item);
    if (!postSlug) {
      console.warn(`⚠️ 无法提取 post_slug: ${extractText(item.title)}`);
      continue;
    }

    // 获取评论列表
    let itemComments = item["wp:comment"];
    if (!itemComments) continue;

    // 确保是数组
    if (!Array.isArray(itemComments)) {
      itemComments = [itemComments];
    }

    for (const comment of itemComments) {
      const commentType = extractText(comment["wp:comment_type"]);
      // 只处理普通评论，跳过 pingback、trackback
      if (commentType && commentType !== "comment") {
        continue;
      }

      comments.push({
        legacy_id: parseInt(extractText(comment["wp:comment_id"]), 10),
        legacy_parent_id:
          parseInt(extractText(comment["wp:comment_parent"]), 10) || 0,
        post_slug: postSlug,
        author_name: extractText(comment["wp:comment_author"]),
        author_email: extractText(comment["wp:comment_author_email"]),
        author_website: extractText(comment["wp:comment_author_url"]) || null,
        author_ip: extractText(comment["wp:comment_author_IP"]) || null,
        content: sanitizeContent(extractText(comment["wp:comment_content"])),
        status: mapStatus(comment["wp:comment_approved"]),
        created_at: toISODate(comment["wp:comment_date_gmt"])
      });
    }
  }

  console.log(`⏭️ 跳过 ${skippedItems} 个非 post 项目`);
  console.log(`💬 找到 ${comments.length} 条评论`);

  // 调试：统计有父评论的数量
  const withParent = comments.filter((c) => c.legacy_parent_id > 0);
  console.log(`🔗 有父评论的: ${withParent.length} 条`);
  if (withParent.length > 0) {
    console.log(
      `   示例: legacy_id=${withParent[0].legacy_id}, legacy_parent_id=${withParent[0].legacy_parent_id}`
    );
  }

  return comments;
}

/**
 * 按层级排序子评论，确保父评论先插入
 */
function sortChildComments(childComments, allComments) {
  // 构建 legacy_id -> comment 映射
  const commentMap = new Map();
  for (const c of allComments) {
    commentMap.set(c.legacy_id, c);
  }

  // 计算每个评论的层级深度
  function getDepth(comment, visited = new Set()) {
    if (comment.legacy_parent_id === 0) return 0;
    if (visited.has(comment.legacy_id)) return 0; // 防止循环引用
    visited.add(comment.legacy_id);

    const parent = commentMap.get(comment.legacy_parent_id);
    if (!parent) return 1;
    return 1 + getDepth(parent, visited);
  }

  // 按深度排序，浅层的先插入
  return [...childComments].sort((a, b) => getDepth(a) - getDepth(b));
}

/**
 * 多阶段插入：先插入顶级评论，再按层级插入子评论
 */
function generateSQL(comments) {
  // 分离顶级评论和子评论
  const topLevel = comments.filter((c) => c.legacy_parent_id === 0);
  const childLevel = comments.filter((c) => c.legacy_parent_id !== 0);

  // 按层级排序子评论
  const sortedChildren = sortChildComments(childLevel, comments);

  console.log(`📝 顶级评论: ${topLevel.length} 条`);
  console.log(`📝 子评论: ${sortedChildren.length} 条`);

  const sqlStatements = [];

  // 开始事务
  sqlStatements.push("-- WordPress 评论导入");
  sqlStatements.push("-- 生成时间: " + new Date().toISOString());
  sqlStatements.push("");
  sqlStatements.push("BEGIN TRANSACTION;");
  sqlStatements.push("");

  // 第一阶段：插入顶级评论
  sqlStatements.push("-- ========== 第一阶段：插入顶级评论 ==========");
  for (const comment of topLevel) {
    sqlStatements.push(generateInsertSQL(comment));
  }
  sqlStatements.push("");

  // 第二阶段：按层级插入子评论
  sqlStatements.push(
    "-- ========== 第二阶段：插入子评论（按层级排序）=========="
  );
  for (const comment of sortedChildren) {
    sqlStatements.push(generateInsertSQL(comment));
  }
  sqlStatements.push("");

  // 提交事务
  sqlStatements.push("COMMIT;");
  sqlStatements.push("");
  sqlStatements.push("-- 导入完成");

  return sqlStatements.join("\n");
}

/**
 * 生成单条 INSERT 语句
 */
function generateInsertSQL(comment) {
  // 如果有父评论，使用子查询查找 parent_id
  const parentIdExpr =
    comment.legacy_parent_id > 0
      ? `(SELECT id FROM comments WHERE legacy_id = ${comment.legacy_parent_id})`
      : "NULL";

  return `INSERT INTO comments (legacy_id, post_slug, parent_id, legacy_parent_id, author_name, author_email, author_website, author_ip, user_agent, content, status, created_at)
VALUES (
  ${comment.legacy_id},
  ${escapeSql(comment.post_slug)},
  ${parentIdExpr},
  ${comment.legacy_parent_id},
  ${escapeSql(comment.author_name)},
  ${escapeSql(comment.author_email)},
  ${comment.author_website ? escapeSql(comment.author_website) : "NULL"},
  ${comment.author_ip ? escapeSql(comment.author_ip) : "NULL"},
  NULL,
  ${escapeSql(comment.content)},
  ${escapeSql(comment.status)},
  ${escapeSql(comment.created_at)}
);`;
}

/**
 * 主函数
 */
async function main() {
  console.log("🚀 WordPress 评论导入工具");
  console.log("========================\n");

  try {
    // 解析 WXR 文件
    const comments = parseWXR(WXR_FILE);

    if (comments.length === 0) {
      console.log("❌ 没有找到评论");
      return;
    }

    // 生成 SQL
    const sql = generateSQL(comments);

    // 输出或执行
    const outputFile = join(
      __dirname,
      "../migrations/0002_import_comments.sql"
    );
    const { writeFileSync } = await import("fs");
    writeFileSync(outputFile, sql);

    console.log(`\n✅ SQL 已生成: ${outputFile}`);
    console.log("\n要执行导入，请运行:");
    console.log(`  npx wrangler d1 execute <DB_NAME> --file=${outputFile}`);
  } catch (error) {
    console.error("❌ 错误:", error.message);
    process.exit(1);
  }
}

main();
