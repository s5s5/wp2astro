/**
 * 将 comments 表中 content 字段的表情图片替换为对应的 emoji
 * 支持的图片格式示例：
 *   ![](/assets/images/smilies/icon_wink.gif)
 *   ![alt](/assets/images/smilies/icon_wink.gif)
 *   <img src="/assets/images/smilies/icon_wink.gif" alt="..." />
 *
 * 使用方法（默认不写回数据库，仅打印预览）：
 *   node scripts/comments/replace-emoji-in-comments.js
 * 真正写回数据库：
 *   node scripts/comments/replace-emoji-in-comments.js --apply
 */
import { execFileSync, execSync } from "child_process";
import { fileURLToPath } from "url";

import { emojiMap } from "./emoji.js";

// 模块级正则，供 replaceSmilies 和 main 中的扫描复用
const mdRegex = /!\[[^\]]*\]\((\/?assets\/images\/smilies\/([^\)\s]+))\)/g;
const imgRegex =
  /<img\s+[^>]*src=["'](\/?assets\/images\/smilies\/([^"'>\s]+))["'][^>]*>/g;

export function replaceSmilies(str) {
  if (!str) return str;

  let changed = false;

  // 替换 Markdown 图片语法：![alt](/assets/images/smilies/icon_xxx.gif)
  str = str.replace(mdRegex, (match, fullPath, filename) => {
    const emoji = emojiMap[filename];
    if (emoji) {
      changed = true;
      return emoji;
    }
    return match; // 未知文件名，保留原图
  });

  // 替换 HTML <img ... src="/assets/images/smilies/icon_xxx.gif" />
  str = str.replace(imgRegex, (match, fullPath, filename) => {
    const emoji = emojiMap[filename];
    if (emoji) {
      changed = true;
      return emoji;
    }
    return match;
  });

  // 如果将来需要处理 HTML 转义或 Code Block 排除，可在这里扩展

  return str;
}

async function main() {
  const dbName = "blog-comments";
  const apply = process.argv.includes("--apply"); // --apply 才会写回数据库

  console.log(
    `运行模式: ${apply ? "apply (会写回数据库)" : "dry-run (仅打印)"}`
  );

  console.log("正在获取评论...");
  const result = execSync(
    `wrangler d1 execute ${dbName} --local --json --command="SELECT id, content FROM comments"`,
    { encoding: "utf-8", maxBuffer: 50 * 1024 * 1024 }
  );

  const data = JSON.parse(result);
  const comments = data[0]?.results || [];
  console.log(`共找到 ${comments.length} 条评论\\n`);

  let updated = 0;
  const unknownFiles = new Set();

  for (const comment of comments) {
    const original = comment.content;
    const newContent = replaceSmilies(original);
    if (newContent !== original) {
      // 显示差异预览
      console.log(`✎ 评论 ID: ${comment.id}`);
      console.log(`  原: ${String(original).substring(0, 120)}`);
      console.log(`  新: ${String(newContent).substring(0, 120)}\\n`);

      if (apply) {
        const safeContent = String(newContent).replace(/'/g, "''"); // SQL 单引号转义
        const updateSql = `UPDATE comments SET content = '${safeContent}' WHERE id = ${comment.id}`;
        try {
          // Use execFileSync to avoid shell quoting issues; pass SQL as a single arg
          execFileSync("wrangler", [
            "d1",
            "execute",
            dbName,
            "--local",
            "--command",
            updateSql
          ]);
          updated++;
        } catch (err) {
          console.error(`✗ 更新评论 ID ${comment.id} 失败:`, err.message);
        }
      } else {
        updated++;
      }
    } else {
      // 检查是否包含未知的表情文件（存在文件名但未映射）
      // 这里简单扫描一次，记录未在 emojiMap 中的文件名
      const mdMatches = original?.matchAll(mdRegex) || [];
      for (const m of mdMatches) {
        const fn = m[2];
        if (fn && !emojiMap[fn]) unknownFiles.add(fn);
      }
      const imgMatches = original?.matchAll(imgRegex) || [];
      for (const m of imgMatches) {
        const fn = m[2];
        if (fn && !emojiMap[fn]) unknownFiles.add(fn);
      }
    }
  }

  console.log(
    `\\n处理完成。共发现 ${updated} 条需替换的评论 (${apply ? "已写回数据库" : "dry-run，未写回"} )`
  );
  if (unknownFiles.size) {
    console.log(
      `检测到未在 emojiMap 中的文件 (${unknownFiles.size}):`,
      Array.from(unknownFiles).slice(0, 50)
    );
  }
}

// 仅当此模块被直接执行时才运行 main，避免在导入时触发 wrangler 调用
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
