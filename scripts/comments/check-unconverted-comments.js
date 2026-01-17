/**
 * 检查还有哪些评论没有成功转换为 Markdown（仍包含 HTML 标签）
 * 使用方法：node scripts/comments/check-unconverted-comments.js
 */
import { execSync } from "child_process";

// 检测内容是否包含 HTML 标签
function hasHtmlTags(content) {
  // 匹配常见 HTML 标签：<tag> 或 <tag attr="value"> 或 </tag> 或 <tag/>
  // 排除 Markdown 中可能出现的 < 和 > 符号（如数学公式 a < b）
  return /<(?:a|p|br|div|span|strong|b|em|i|u|code|pre|blockquote|img|ul|ol|li|h[1-6]|table|tr|td|th)[\s>\/]/i.test(
    content
  );
}

async function main() {
  const dbName = "blog-comments";

  // 获取所有评论（本地运行）
  console.log("正在获取评论...");
  const result = execSync(
    `wrangler d1 execute ${dbName} --local --json --command="SELECT id, content, author_name, post_slug FROM comments"`,
    { encoding: "utf-8", maxBuffer: 50 * 1024 * 1024 }
  );

  const data = JSON.parse(result);
  const comments = data[0]?.results || [];
  console.log(`共找到 ${comments.length} 条评论\n`);

  const unconverted = [];

  for (const comment of comments) {
    if (hasHtmlTags(comment.content)) {
      unconverted.push(comment);
    }
  }

  if (unconverted.length === 0) {
    console.log("✓ 所有评论都已成功转换为 Markdown，没有残留的 HTML 标签！");
  } else {
    console.log(`✗ 发现 ${unconverted.length} 条评论仍包含 HTML 标签：\n`);
    console.log("=".repeat(80));

    for (const comment of unconverted) {
      console.log(`\nID: ${comment.id}`);
      console.log(`Post ID: ${comment.post_id}`);
      console.log(`Author: ${comment.author_name}`);
      console.log(`Content:\n${comment.content}`);
      console.log("-".repeat(80));
    }
  }

  console.log(`\n统计：`);
  console.log(`  总评论数: ${comments.length}`);
  console.log(`  已转换: ${comments.length - unconverted.length}`);
  console.log(`  未转换: ${unconverted.length}`);
}

main().catch(console.error);
