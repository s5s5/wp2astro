/**
 * 批量将 comments 表中 content 字段的 [@用户名](#comment-xxx) 链接替换为纯 @用户名
 * 使用方法：node scripts/comments/replace-link-in-comments.js
 */
import { execSync } from "child_process";

function replaceLink(str) {
  if (!str) return str;
  if (!str.includes("](#comment-")) {
    return str;
  }
  return str.replace(/\[@([^\]]+)\]\(#comment-[^)]+\)/g, "@$1");
}

async function main() {
  const dbName = "blog-comments";

  // 获取所有评论
  console.log("正在获取评论...");
  const result = execSync(
    `wrangler d1 execute ${dbName} --local --json --command="SELECT id, content FROM comments"`,
    { encoding: "utf-8", maxBuffer: 50 * 1024 * 1024 }
  );

  const data = JSON.parse(result);
  const comments = data[0]?.results || [];
  console.log(`共找到 ${comments.length} 条评论\n`);

  let updated = 0;
  for (const comment of comments) {
    const newContent = replaceLink(comment.content);
    if (newContent !== comment.content) {
      // 执行 UPDATE
      const safeContent = newContent.replace(/'/g, "''"); // SQL 转义单引号
      const updateSql = `UPDATE comments SET content = '${safeContent}' WHERE id = ${comment.id}`;
      try {
        execSync(
          `wrangler d1 execute ${dbName} --local --command=\"${updateSql}\"`,
          { encoding: "utf-8" }
        );
        updated++;
        console.log(`✓ 已更新评论 ID: ${comment.id}`);
        console.log(`  原内容: ${comment.content.substring(0, 50)}...`);
        console.log(`  新内容: ${newContent.substring(0, 50)}...\n`);
      } catch (err) {
        console.error(`✗ 更新评论 ID ${comment.id} 失败:`, err.message);
      }
    }
  }

  console.log(`\n处理完成。共更新 ${updated} 条评论。`);
}

main().catch(console.error);
