/**
 * 将评论内容从 HTML 转换为 Markdown
 * 使用方法：node scripts/comments/convert-html-to-markdown.js
 */
import { execSync } from "child_process";

import TurndownService from "turndown";

// 创建 Turndown 实例
const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-"
});

// 保留换行符
turndown.addRule("lineBreak", {
  filter: "br",
  replacement: () => "\n"
});

// 检测内容是否包含 HTML 标签
function hasHtmlTags(content) {
  // 匹配常见 HTML 标签：<tag> 或 <tag attr="value"> 或 </tag> 或 <tag/>
  // 排除 Markdown 中可能出现的 < 和 > 符号（如数学公式 a < b）
  return /<(?:a|p|br|div|span|strong|b|em|i|u|code|pre|blockquote|img|ul|ol|li|h[1-6]|table|tr|td|th)[\s>\/]/i.test(
    content
  );
}

// 转换 HTML 到 Markdown
function htmlToMarkdown(content) {
  if (!content) return content;

  // 只有包含 HTML 标签才需要转换，纯文本和已经是 Markdown 的内容直接跳过
  // 这样可以避免 Turndown 对 Markdown 语法字符（如 [ ] 等）进行转义
  if (!hasHtmlTags(content)) {
    return content;
  }

  try {
    return turndown.turndown(content).trim();
  } catch (err) {
    console.error("转换失败:", err.message);
    return content;
  }
}

async function main() {
  const dbName = "blog-comments";

  // 获取所有评论（本地运行）
  console.log("正在获取评论...");
  const result = execSync(
    `wrangler d1 execute ${dbName} --local --json --command="SELECT id, content FROM comments"`,
    { encoding: "utf-8", maxBuffer: 50 * 1024 * 1024 }
  );

  const data = JSON.parse(result);
  const comments = data[0]?.results || [];
  console.log(`共找到 ${comments.length} 条评论`);

  let updated = 0;
  let skipped = 0;

  for (const comment of comments) {
    const originalContent = comment.content;
    const markdownContent = htmlToMarkdown(originalContent);

    if (markdownContent !== originalContent) {
      // 转义单引号
      const escaped = markdownContent.replace(/'/g, "''");
      const sql = `UPDATE comments SET content = '${escaped}' WHERE id = ${comment.id}`;

      try {
        execSync(
          `npx wrangler d1 execute ${dbName} --local --command="${sql}"`,
          {
            encoding: "utf-8"
          }
        );
        updated++;
        console.log(`✓ 已更新评论 ID: ${comment.id}`);
        console.log(`  原内容: ${originalContent.substring(0, 50)}...`);
        console.log(`  新内容: ${markdownContent.substring(0, 50)}...`);
      } catch (err) {
        console.error(`✗ 更新评论 ID ${comment.id} 失败:`, err.message);
      }
    } else {
      skipped++;
    }
  }

  console.log(
    `\n完成！共更新 ${updated} 条评论，跳过 ${skipped} 条（无需转换）`
  );
}

main().catch(console.error);
