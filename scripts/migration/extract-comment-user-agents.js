/**
 * 从 WordPress 数据库导出的 SQL 文件中提取评论 ID 和 User Agent
 *
 * 使用方法:
 * node scripts/migration/extract-comment-user-agents.js
 *
 * 输出:
 * - scripts/comment-user-agents.json (JSON 格式)
 * - scripts/comment-user-agents.csv (CSV 格式)
 */

const fs = require('fs');
const readline = require('readline');
const path = require('path');

const SQL_FILE = path.join(__dirname, '../../wordpress/db/s5s5_me_2026-01-12_03-30-02_mysql_data.sql');
const OUTPUT_JSON = path.join(__dirname, '../data/comment-user-agents.json');
const OUTPUT_CSV = path.join(__dirname, '../data/comment-user-agents.csv');

async function extractCommentUserAgents() {
  const results = [];

  const fileStream = fs.createReadStream(SQL_FILE, { encoding: 'utf8' });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let inCommentsTable = false;
  let buffer = '';
  let lineCount = 0;

  console.log('开始处理 SQL 文件...');

  for await (const line of rl) {
    lineCount++;

    if (lineCount % 10000 === 0) {
      console.log(`已处理 ${lineCount} 行...`);
    }

    // 检测是否进入 wp_comments 表的 INSERT 语句
    // WordPress 表名可能带前缀，如 wp_comments, s5s5_comments 等
    if (line.includes('INSERT INTO') && line.includes('comments')) {
      inCommentsTable = true;
      buffer = line;
      continue;
    }

    if (inCommentsTable) {
      buffer += line;

      // 检查语句是否结束
      if (line.trim().endsWith(';')) {
        // 解析 INSERT 语句
        const extracted = parseInsertStatement(buffer);
        results.push(...extracted);
        buffer = '';
        inCommentsTable = false;
      }
    }
  }

  console.log(`\n处理完成! 共找到 ${results.length} 条评论记录`);

  // 保存为 JSON
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(results, null, 2), 'utf8');
  console.log(`已保存到: ${OUTPUT_JSON}`);

  // 保存为 CSV
  const csvContent = 'comment_id,comment_agent\n' +
    results.map(r => `${r.comment_id},"${(r.comment_agent || '').replace(/"/g, '""')}"`).join('\n');
  fs.writeFileSync(OUTPUT_CSV, csvContent, 'utf8');
  console.log(`已保存到: ${OUTPUT_CSV}`);

  // 打印前几条记录作为预览
  console.log('\n前 5 条记录预览:');
  results.slice(0, 5).forEach(r => {
    console.log(`  ID: ${r.comment_id}, Agent: ${r.comment_agent?.substring(0, 50)}...`);
  });

  return results;
}

/**
 * 解析 INSERT 语句，提取 comment_ID 和 comment_agent
 * WordPress wp_comments 表结构:
 * comment_ID, comment_post_ID, comment_author, comment_author_email,
 * comment_author_url, comment_author_IP, comment_date, comment_date_gmt,
 * comment_content, comment_karma, comment_approved, comment_agent,
 * comment_type, comment_parent, user_id
 */
function parseInsertStatement(sql) {
  const results = [];

  // 获取列名（如果存在）
  let columns = null;
  const columnsMatch = sql.match(/INSERT INTO[^(]+\(([^)]+)\)/i);
  if (columnsMatch) {
    columns = columnsMatch[1].split(',').map(c => c.trim().replace(/`/g, ''));
  }

  // 匹配所有 VALUES 中的记录
  // 使用更健壮的方式解析值
  const valuesMatch = sql.match(/VALUES\s*(.+);?\s*$/is);
  if (!valuesMatch) return results;

  const valuesStr = valuesMatch[1];
  const records = extractRecords(valuesStr);

  for (const record of records) {
    const values = parseRecord(record);

    if (columns) {
      // 有列名定义，按列名查找
      const idIndex = columns.findIndex(c => c.toLowerCase() === 'comment_id');
      const agentIndex = columns.findIndex(c => c.toLowerCase() === 'comment_agent');

      if (idIndex !== -1 && agentIndex !== -1 && values[idIndex] && values[agentIndex] !== undefined) {
        results.push({
          comment_id: parseInt(values[idIndex], 10),
          comment_agent: values[agentIndex]
        });
      }
    } else {
      // 没有列名，使用默认顺序（WordPress 标准顺序）
      // comment_ID 是第1个，comment_agent 是第12个
      if (values.length >= 12) {
        results.push({
          comment_id: parseInt(values[0], 10),
          comment_agent: values[11]
        });
      }
    }
  }

  return results;
}

/**
 * 从 VALUES 部分提取每条记录
 */
function extractRecords(valuesStr) {
  const records = [];
  let current = '';
  let depth = 0;
  let inString = false;
  let stringChar = '';
  let i = 0;

  while (i < valuesStr.length) {
    const char = valuesStr[i];
    const prevChar = i > 0 ? valuesStr[i - 1] : '';

    if (!inString) {
      if (char === "'" || char === '"') {
        inString = true;
        stringChar = char;
        current += char;
      } else if (char === '(') {
        depth++;
        if (depth === 1) {
          current = '';
        } else {
          current += char;
        }
      } else if (char === ')') {
        depth--;
        if (depth === 0) {
          records.push(current);
          current = '';
        } else {
          current += char;
        }
      } else if (depth > 0) {
        current += char;
      }
    } else {
      current += char;
      // 检查字符串是否结束（考虑转义）
      if (char === stringChar && prevChar !== '\\') {
        // 检查是否是双引号转义 ''
        if (i + 1 < valuesStr.length && valuesStr[i + 1] === stringChar) {
          i++;
          current += valuesStr[i];
        } else {
          inString = false;
        }
      }
    }
    i++;
  }

  return records;
}

/**
 * 解析单条记录的字段值
 */
function parseRecord(record) {
  const values = [];
  let current = '';
  let inString = false;
  let stringChar = '';
  let i = 0;

  while (i < record.length) {
    const char = record[i];
    const prevChar = i > 0 ? record[i - 1] : '';

    if (!inString) {
      if (char === "'" || char === '"') {
        inString = true;
        stringChar = char;
      } else if (char === ',') {
        values.push(cleanValue(current.trim()));
        current = '';
        i++;
        continue;
      } else {
        current += char;
      }
    } else {
      if (char === stringChar && prevChar !== '\\') {
        // 检查是否是双引号转义
        if (i + 1 < record.length && record[i + 1] === stringChar) {
          current += char;
          i++;
          current += record[i];
        } else {
          inString = false;
        }
      } else if (char === '\\' && i + 1 < record.length) {
        // 跳过转义字符，保留被转义的内容
        i++;
        current += record[i];
      } else {
        current += char;
      }
    }
    i++;
  }

  values.push(cleanValue(current.trim()));
  return values;
}

/**
 * 清理字段值
 */
function cleanValue(val) {
  if (val === 'NULL' || val === 'null') return null;
  // 移除首尾引号
  if ((val.startsWith("'") && val.endsWith("'")) ||
      (val.startsWith('"') && val.endsWith('"'))) {
    return val.slice(1, -1);
  }
  return val;
}

// 运行
extractCommentUserAgents().catch(console.error);
