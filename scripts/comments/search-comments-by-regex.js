#!/usr/bin/env node
/**
 * 在 comments 表的 content 字段中按正则查找的脚本
 *
 * 使用示例：
 *   node scripts/search-comments-by-regex.js "icon_\\w+\\.gif" --flags i --context 40 --limit 200
 *   node scripts/search-comments-by-regex.js "<img\\s+[^>]*src=[\"'](/?assets/images/smilies/[^\"'>\s]+)[\"']" --flags gi --json
 *
 * 参数：
 *   1st arg: 正则模式（必需），注意在 zsh 下要用单引号或转义。示例："icon_\\w+\\.gif"
 *   --flags <flags>   : 正则标志，默认 "g"（会自动加上 g，如果未提供会被补上）
 *   --context <n>     : 在输出时展示匹配上下文字符数，默认 60
 *   --limit <n>       : 仅扫描前 n 条评论（默认不限）
 *   --json            : 以 JSON 输出结果（机器可读）
 *   --db <name>       : D1 数据库名（默认 "blog-comments")
 *
 * 说明：此脚本只是查询并打印匹配结果，不会写回数据库。
 */
import { execSync } from "child_process";
import { fileURLToPath } from "url";

function usage() {
  console.log(
    `Usage: node scripts/comments/search-comments-by-regex.js <pattern> [--flags i] [--context 60] [--limit 1000] [--json] [--db name]`
  );
}

function parseArgs(argv) {
  const args = {
    flags: "g",
    context: 60,
    limit: null,
    json: false,
    db: "blog-comments"
  };
  const rest = argv.slice(2);
  if (rest.length === 0) {
    usage();
    process.exit(1);
  }

  args.pattern = rest[0];
  for (let i = 1; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--flags" && rest[i + 1]) {
      args.flags = rest[i + 1];
      i++;
    } else if (a === "--context" && rest[i + 1]) {
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
    } else if (a === "-h" || a === "--help") {
      usage();
      process.exit(0);
    } else {
      console.warn(`Unknown arg ${a}`);
    }
  }

  // Ensure 'g' is present so we can find all matches per string when using matchAll
  if (!args.flags.includes("g")) args.flags += "g";

  return args;
}

function buildRegex(pattern, flags) {
  try {
    return new RegExp(pattern, flags);
  } catch (err) {
    console.error("Invalid regular expression:", err.message);
    process.exit(1);
  }
}

function snippetAround(text, startIdx, endIdx, contextChars) {
  const from = Math.max(0, startIdx - contextChars);
  const to = Math.min(text.length, endIdx + contextChars);
  return text.substring(from, to);
}

async function main() {
  const args = parseArgs(process.argv);
  const regex = buildRegex(args.pattern, args.flags);

  console.log(
    `Searching comments.content for pattern /${args.pattern}/${args.flags} in D1 DB '${args.db}'...`
  );

  // Build SQL
  const selectSql =
    `SELECT id, content FROM comments` +
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
  let matchedComments = 0;
  let totalMatches = 0;
  const samples = [];

  for (const c of comments) {
    scanned++;
    const content = c.content || "";

    // Use matchAll to get multiple matches
    const matches = [...content.matchAll(regex)];
    if (matches.length > 0) {
      matchedComments++;
      totalMatches += matches.length;

      const sample = {
        id: c.id,
        matches: []
      };

      for (const m of matches.slice(0, 20)) {
        // m.index may be undefined for lookbehind-less matches in some engines, but Node's V8 provides it
        const start = m.index ?? content.indexOf(m[0]);
        const end = start + m[0].length;
        const snip = snippetAround(content, start, end, args.context);
        // highlight the matched substring with markers
        const relStart = start - Math.max(0, start - args.context);
        const highlighted =
          snip.substring(0, relStart) +
          "" +
          m[0] +
          "" +
          snip.substring(relStart + m[0].length);
        sample.matches.push({
          match: m[0],
          index: start,
          context: highlighted
        });
      }

      samples.push(sample);
    }
  }

  const summary = {
    scanned,
    matchedComments,
    totalMatches,
    sampleCount: samples.length
  };

  if (args.json) {
    console.log(JSON.stringify({ summary, samples }, null, 2));
    return;
  }

  console.log(
    `Scanned ${scanned} comments. ${matchedComments} comments matched. Total matches: ${totalMatches}`
  );
  if (samples.length === 0) return;

  console.log("\n示例匹配（每条评论最多显示 20 个匹配）：\n");
  for (const s of samples.slice(0, 200)) {
    console.log(`-- 评论 ID: ${s.id} (${s.matches.length} matches)`);
    for (const m of s.matches) {
      console.log(`   匹配: ${m.match}`);
      console.log(
        `   上下文: ${m.context.replace(/\n/g, "\\n").slice(0, 400)}`
      );
    }
    console.log("");
  }
}

// Only run when executed directly
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
