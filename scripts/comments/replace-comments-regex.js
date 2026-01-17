#!/usr/bin/env node
// Regex-based replacement in comments.content for D1 (wrangler d1 execute --local)
// Supports an emoji mode to convert placeholders like [surprise] using scripts/emoji_map.json
// Usage examples:
//   node scripts/comments/replace-comments-regex.js "\\[surprise\\]" "😲" --flags g --limit 200
//   node scripts/comments/replace-comments-regex.js --emoji --limit 200
// Options: --context N, --limit N, --json, --db name, --commit, --flags <regex-flags>, --emoji
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

function usage() {
  console.log(
    `Usage: node scripts/replace-comments-regex.js <pattern> <replacement> [--flags gimsuy] [--context 60] [--limit 1000] [--json] [--db name] [--commit]\n       or: node scripts/replace-comments-regex.js --emoji [--context 60] [--limit 1000] [--json] [--db name] [--commit]`
  );
}

function parseArgs(argv) {
  const args = {
    context: 60,
    limit: null,
    json: false,
    db: "blog-comments",
    commit: false,
    flags: undefined,
    emoji: false
  };
  const rest = argv.slice(2);

  if (rest.includes("-h") || rest.includes("--help")) {
    usage();
    process.exit(0);
  }

  // If only --emoji provided, that's allowed
  if (rest.length === 0) {
    usage();
    process.exit(1);
  }

  // find flags
  for (let i = 0; i < rest.length; i++) {
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
    } else if (a === "--flags" && rest[i + 1]) {
      args.flags = rest[i + 1];
      i++;
    } else if (a === "--emoji") {
      args.emoji = true;
    }
  }

  // positional pattern & replacement (only when not emoji mode)
  const pos = rest.filter(
    (r) => !r.startsWith("--") && r !== "-h" && r !== "--help"
  );

  if (!args.emoji) {
    if (pos.length < 2) {
      console.error(
        "ERROR: pattern and replacement required unless --emoji is used."
      );
      usage();
      process.exit(1);
    }
    args.pattern = pos[0];
    args.replacement = pos[1];
  }

  return args;
}

function snippetAround(text, startIdx, endIdx, contextChars) {
  const from = Math.max(0, startIdx - contextChars);
  const to = Math.min(text.length, endIdx + contextChars);
  return text.substring(from, to);
}

function escapeSqlString(s) {
  return s.replace(/'/g, "''");
}

function loadEmojiMap() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const mapPath = path.join(__dirname, "../data/emoji_map.json");
  try {
    const raw = fs.readFileSync(mapPath, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    console.warn(
      `Failed to load emoji_map.json from ${mapPath}: ${err.message}`
    );
    return {};
  }
}

async function main() {
  const args = parseArgs(process.argv);

  console.log(
    `Scanning comments.content in D1 DB '${args.db}'...` +
      (args.commit ? " (commit mode)" : " (dry-run, no DB changes)")
  );

  const emojiMap = args.emoji ? loadEmojiMap() : null;

  // Build SELECT SQL. For regex we can't filter server-side, so we fetch rows (with optional LIMIT)
  const selectSql =
    `SELECT id, content FROM comments` +
    (args.limit ? ` LIMIT ${args.limit}` : "");

  let result;
  try {
    const out = execSync(
      `wrangler d1 execute ${args.db} --local --json --command="${selectSql.replace(/"/g, '\\"')}"`,
      { encoding: "utf-8", maxBuffer: 50 * 1024 * 1024 }
    );
    result = JSON.parse(out);
  } catch (err) {
    console.error(
      "Failed to execute wrangler d1 query. Make sure wrangler is installed and you can run `wrangler d1 execute` locally."
    );
    console.error(err.message);
    process.exit(1);
  }

  const rows = result[0]?.results || [];
  let scanned = 0;
  let changedCount = 0;
  const changes = [];

  let re;
  if (args.emoji) {
    // regex to find [name]
    // 只匹配明确被转义的（左右方括号都有 \）：/\\\[([^\\\]]+)\\\]/g
    // re = /\[([^\]]+)\]/g;
    re = /\\\[([^\\\]]+)\\\]/g;
  } else {
    try {
      re = new RegExp(args.pattern, args.flags);
    } catch (err) {
      console.error(`Invalid regular expression: ${err.message}`);
      process.exit(1);
    }
  }

  for (const r of rows) {
    scanned++;
    const content = r.content || "";

    // Quick check: if not emoji mode and pattern not present (fast path using RegExp.test)
    try {
      if (!re.test(content)) {
        // reset lastIndex for global regexes
        if (re.global) re.lastIndex = 0;
        continue;
      }
    } catch (err) {
      // In case of weird input, skip
      if (re.global) re.lastIndex = 0;
      continue;
    }

    // Replacement function for emoji mode or plain replacement
    let newContent;
    if (args.emoji) {
      newContent = content.replace(re, (match, name) => {
        if (Object.prototype.hasOwnProperty.call(emojiMap, name)) {
          return emojiMap[name];
        }
        return match; // leave unchanged if not found
      });
    } else {
      // use replacement string as-is (String.replace supports $1 etc.)
      newContent = content.replace(re, args.replacement);
    }

    // reset lastIndex for global regexes so future tests start at 0
    if (re.global) re.lastIndex = 0;

    if (newContent !== content) {
      changedCount++;

      // For preview, find first differing index
      let idx = 0;
      while (idx < content.length && content[idx] === newContent[idx]) idx++;
      const start = Math.max(0, idx - Math.floor(args.context / 2));
      const end = Math.min(content.length, idx + Math.floor(args.context / 2));
      const oldSnip = snippetAround(content, start, end, args.context);
      const newSnip = snippetAround(newContent, start, end, args.context);

      changes.push({
        id: r.id,
        oldPreview: oldSnip.replace(/\n/g, "\\n").slice(0, 400),
        newPreview: newSnip.replace(/\n/g, "\\n").slice(0, 400)
      });

      if (args.commit) {
        const escaped = escapeSqlString(newContent);
        const updateSql = `UPDATE comments SET content='${escaped}' WHERE id=${r.id};`;
        try {
          execSync(
            `wrangler d1 execute ${args.db} --local --command="${updateSql.replace(/"/g, '\\"')}"`,
            { encoding: "utf-8", maxBuffer: 50 * 1024 * 1024 }
          );
        } catch (err) {
          console.error(`Failed to update comment id=${r.id}: ${err.message}`);
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
  if (!args.commit)
    console.log("Run with --commit to apply these changes to the database.");

  if (changes.length === 0) return;

  console.log("\n示例更改（每条最多显示 1 个预览）：\n");
  for (const s of changes.slice(0, 200)) {
    console.log(`-- 评论 ID: ${s.id}`);
    console.log(`   旧: ${s.oldPreview}`);
    console.log(`   新: ${s.newPreview}`);
    console.log("");
  }
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
