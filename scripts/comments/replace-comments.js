#!/usr/bin/env node
// 简洁说明：在 comments.content 中做字面字符串替换（非正则）。
// 用法：node scripts/replace-comments-by.js <pattern> <replacement> [--context N] [--limit N] [--json] [--db name] [--commit]
// 示例：node scripts/replace-comments-by.js "/old.png" "/new.png" --limit 200
// 说明：默认为预览（dry-run），加 --commit 才会写回 D1（wrangler d1 execute 必需）。
import { execSync } from "child_process";
import { fileURLToPath } from "url";

function usage() {
  console.log(
    `Usage: node scripts/comments/replace-comments.js <pattern> <replacement> [--context 60] [--limit 1000] [--json] [--db name] [--commit]`
  );
}

function parseArgs(argv) {
  const args = {
    context: 60,
    limit: null,
    json: false,
    db: "blog-comments",
    commit: false
  };
  const rest = argv.slice(2);

  // 帮助或参数不足时退出
  if (rest.includes("-h") || rest.includes("--help")) {
    usage();
    process.exit(0);
  }

  if (rest.length < 2) {
    usage();
    process.exit(1);
  }

  args.pattern = rest[0];
  args.replacement = rest[1];

  for (let i = 2; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--context" && rest[i + 1]) {
      args.context = parseInt(rest[i + 1], 10);
      i++;
    } else if (a === "--limit" && rest[i + 1]) {
      args.limit = parseInt(rest[i + 1], 10);
      i++;
    } else if (a === "--json") {
      args.json = true;
    } else if (a === "--db" && rest[i + 1]) {
      args.db = rest[i + 1];
      i++;
    } else if (a === "--commit") {
      args.commit = true;
    } else if (a === "-h" || a === "--help") {
      usage();
      process.exit(0);
    } else {
      console.warn(`Unknown arg ${a}`);
    }
  }

  if (!args.pattern) {
    console.error("Empty pattern is not allowed for literal replacement.");
    process.exit(1);
  }

  return args;
}

function snippetAround(text, startIdx, endIdx, contextChars) {
  const from = Math.max(0, startIdx - contextChars);
  const to = Math.min(text.length, endIdx + contextChars);
  return text.substring(from, to);
}

function escapeSqlString(s) {
  // 转义单引号以构造 SQL 字面量（适用于 SQLite/D1）
  return s.replace(/'/g, "''");
}

async function main() {
  const args = parseArgs(process.argv);

  console.log(
    `Scanning comments.content for literal pattern "${args.pattern}" in D1 DB '${args.db}'...` +
      (args.commit ? " (commit mode)" : " (dry-run, no DB changes)")
  );

  // Prepare SQL-safe pattern for use inside instr(...)
  const patternForSql = escapeSqlString(args.pattern);

  // Use SQLite instr() for literal substring search to avoid LIKE/ESCAPE complexity
  const selectSql =
    `SELECT id, content FROM comments WHERE instr(content, '${patternForSql}') > 0` +
    (args.limit ? ` LIMIT ${args.limit}` : "");

  let result;
  try {
    const out = execSync(
      `wrangler d1 execute ${args.db} --local --json --command="${selectSql.replace(/"/g, '\\"')}"`,
      {
        encoding: "utf-8",
        maxBuffer: 50 * 1024 * 1024
      }
    );
    result = JSON.parse(out);
  } catch (err) {
    console.error(
      "Failed to execute wrangler d1 query. Make sure wrangler is installed and you can run `wrangler d1 execute` locally."
    );
    console.error(err.message);
    process.exit(1);
  }

  const comments = result[0]?.results || [];
  let scanned = 0;
  let changedCount = 0;
  const changes = [];

  for (const c of comments) {
    scanned++;
    const content = c.content || "";

    // 快速检查：若不包含目标字面串则跳过，避免不必要替换开销
    if (!content.includes(args.pattern)) {
      continue;
    }

    // 字面替换：优先使用 replaceAll，回退到 split/join
    let newContent;
    if (typeof String.prototype.replaceAll === "function") {
      newContent = content.replaceAll(args.pattern, args.replacement);
    } else {
      // 回退实现
      newContent = content.split(args.pattern).join(args.replacement);
    }

    if (newContent !== content) {
      changedCount++;

      // 取首个匹配位置用于上下文预览
      const idx = content.indexOf(args.pattern);
      const start = idx >= 0 ? idx : 0;
      const end =
        idx >= 0
          ? idx + args.pattern.length
          : Math.min(content.length, args.context);
      const oldSnip = snippetAround(content, start, end, args.context);
      const newSnip = snippetAround(newContent, start, end, args.context);

      changes.push({
        id: c.id,
        oldPreview: oldSnip.replace(/\n/g, "\\n").slice(0, 400),
        newPreview: newSnip.replace(/\n/g, "\\n").slice(0, 400)
      });

      if (args.commit) {
        // 构造安全的 SQL 字面量并写回
        const escaped = escapeSqlString(newContent);
        const updateSql = `UPDATE comments SET content='${escaped}' WHERE id=${c.id};`;
        try {
          execSync(
            `wrangler d1 execute ${args.db} --local --command="${updateSql.replace(/"/g, '\\"')}"`,
            {
              encoding: "utf-8",
              maxBuffer: 50 * 1024 * 1024
            }
          );
        } catch (err) {
          console.error(`Failed to update comment id=${c.id}:`, err.message);
          // 继续处理其他条目
        }
      }
    }
  }

  const summary = { scanned, changedCount };

  if (args.json) {
    console.log(JSON.stringify({ summary, changes }, null, 2));
    return;
  }

  console.log(
    `Scanned ${scanned} comments. ${changedCount} comments would be changed.`
  );
  if (!args.commit) {
    console.log("Run with --commit to apply these changes to the database.");
  }
  if (changes.length === 0) return;

  console.log("\n示例更改（每条最多显示 1 个预览）：\n");
  for (const s of changes.slice(0, 200)) {
    console.log(`-- 评论 ID: ${s.id}`);
    console.log(`   旧: ${s.oldPreview}`);
    console.log(`   新: ${s.newPreview}`);
    console.log("");
  }
}

// 仅直接执行时运行
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
