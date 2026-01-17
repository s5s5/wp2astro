/**
 * 从 WordPress 数据库 SQL 导出文件中提取评论信息
 *
 * WordPress wp_comments 表结构 (默认顺序):
 * 0: comment_ID
 * 1: comment_post_ID
 * 2: comment_author
 * 3: comment_author_email
 * 4: comment_author_url
 * 5: comment_author_IP
 * 6: comment_date
 * 7: comment_date_gmt
 * 8: comment_content
 * 9: comment_karma
 * 10: comment_approved
 * 11: comment_agent
 * 12: comment_type
 * 13: comment_parent
 * 14: user_id
 *
 * 使用方法: node scripts/migration/extract-comment-agents-v3.js
 */

const fs = require('fs');
const path = require('path');

const SQL_FILE = path.join(__dirname, '../data/comments_data.sql');
const OUTPUT_JSON = path.join(__dirname, '../data/comment-agents-final.json');
const OUTPUT_CSV = path.join(__dirname, '../data/comment-agents-final.csv');
const OUTPUT_SQL = path.join(__dirname, '../data/comment-agents-update-final.sql');
const OUTPUT_VERIFY_CSV = path.join(__dirname, '../data/comment-verify.csv');

// 读取文件
console.log('📖 读取文件:', SQL_FILE);
const content = fs.readFileSync(SQL_FILE, 'utf8');
console.log('📊 文件大小:', (content.length / 1024 / 1024).toFixed(2), 'MB');

const results = [];

// 只处理 wp_comments 表的 INSERT 语句
const lines = content.split('\n');
console.log('📝 总行数:', lines.length);

for (const line of lines) {
  // 只处理 wp_comments 表
  if (!line.startsWith('INSERT INTO `wp_comments`')) {
    continue;
  }

  console.log('🔍 找到 wp_comments INSERT 语句');

  // 找到 VALUES 部分
  const valuesIndex = line.indexOf('VALUES');
  if (valuesIndex === -1) continue;

  const valuesStr = line.substring(valuesIndex + 6);

  // 解析每条记录
  let pos = 0;
  let recordCount = 0;

  while (pos < valuesStr.length) {
    // 找下一个 (
    while (pos < valuesStr.length && valuesStr[pos] !== '(') pos++;
    if (pos >= valuesStr.length) break;

    pos++; // 跳过 (

    // 解析这条记录的所有字段
    const fields = [];
    let currentField = '';
    let inString = false;

    while (pos < valuesStr.length) {
      const char = valuesStr[pos];
      const nextChar = pos + 1 < valuesStr.length ? valuesStr[pos + 1] : '';

      if (!inString) {
        if (char === "'") {
          inString = true;
          pos++;
          continue;
        } else if (char === ',') {
          fields.push(currentField.trim());
          currentField = '';
          pos++;
          continue;
        } else if (char === ')') {
          fields.push(currentField.trim());
          pos++;
          break;
        }
        currentField += char;
      } else {
        // 在字符串内
        if (char === '\\' && nextChar) {
          // 转义字符
          if (nextChar === "'") {
            currentField += "'";
          } else if (nextChar === "n") {
            currentField += "\n";
          } else if (nextChar === "r") {
            currentField += "\r";
          } else if (nextChar === "\\") {
            currentField += "\\";
          } else {
            currentField += nextChar;
          }
          pos += 2;
          continue;
        } else if (char === "'" && nextChar === "'") {
          // SQL 双引号转义
          currentField += "'";
          pos += 2;
          continue;
        } else if (char === "'") {
          // 字符串结束
          inString = false;
          pos++;
          continue;
        }
        currentField += char;
      }
      pos++;
    }

    recordCount++;

    // 提取 comment_id (索引0), comment_author (索引2), comment_author_email (索引3), comment_agent (索引11)
    if (fields.length >= 12) {
      const commentId = parseInt(fields[0], 10);
      const commentAuthor = fields[2] === 'NULL' ? null : fields[2];
      const commentEmail = fields[3] === 'NULL' ? null : fields[3];
      const commentAgent = fields[11] === 'NULL' ? null : fields[11];

      results.push({
        comment_id: commentId,
        comment_author: commentAuthor,
        comment_author_email: commentEmail,
        comment_agent: commentAgent
      });
    }
  }

  console.log(`📊 从此行解析了 ${recordCount} 条记录`);
}

console.log(`\n✅ 总共提取 ${results.length} 条评论的 User Agent 信息`);

// 保存结果
if (results.length > 0) {
  // JSON 格式
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(results, null, 2), 'utf8');
  console.log(`💾 已保存 JSON: ${OUTPUT_JSON}`);

  // CSV 格式 (只有 ID 和 Agent)
  const csv = 'comment_id,comment_agent\n' +
    results.map(r => `${r.comment_id},"${(r.comment_agent || '').replace(/"/g, '""')}"`).join('\n');
  fs.writeFileSync(OUTPUT_CSV, csv, 'utf8');
  console.log(`💾 已保存 CSV: ${OUTPUT_CSV}`);

  // 验证用 CSV (包含 ID, 用户名, 邮箱, Agent)
  const verifyCsv = 'comment_id,comment_author,comment_author_email,comment_agent\n' +
    results.map(r => `${r.comment_id},"${(r.comment_author || '').replace(/"/g, '""')}","${(r.comment_author_email || '').replace(/"/g, '""')}","${(r.comment_agent || '').replace(/"/g, '""')}"`).join('\n');
  fs.writeFileSync(OUTPUT_VERIFY_CSV, verifyCsv, 'utf8');
  console.log(`💾 已保存验证 CSV: ${OUTPUT_VERIFY_CSV}`);

  // 生成 UPDATE SQL 语句
  const updateSqls = results
    .filter(r => r.comment_agent)
    .map(r => `UPDATE comments SET user_agent = '${r.comment_agent.replace(/'/g, "''")}' WHERE legacy_id = ${r.comment_id};`)
    .join('\n');
  fs.writeFileSync(OUTPUT_SQL, updateSqls, 'utf8');
  console.log(`💾 已保存 SQL: ${OUTPUT_SQL}`);

  // 预览 (包含用户名和邮箱)
  console.log('\n📋 前 15 条记录预览:');
  results.slice(0, 15).forEach(r => {
    const agent = r.comment_agent || '(空)';
    console.log(`  ID: ${r.comment_id}`);
    console.log(`    作者: ${r.comment_author || '(空)'}`);
    console.log(`    邮箱: ${r.comment_author_email || '(空)'}`);
    console.log(`    Agent: ${agent.length > 50 ? agent.substring(0, 50) + '...' : agent}`);
    console.log('');
  });

  // 查找一些有浏览器 UA 的记录
  console.log('\n📋 有浏览器 User Agent 的记录示例:');
  const browserUAs = results.filter(r => r.comment_agent && r.comment_agent.includes('Mozilla'));
  browserUAs.slice(0, 3).forEach(r => {
    console.log(`  ID: ${r.comment_id}`);
    console.log(`    作者: ${r.comment_author || '(空)'}`);
    console.log(`    邮箱: ${r.comment_author_email || '(空)'}`);
    console.log(`    Agent: ${r.comment_agent}`);
    console.log('');
  });

  // 统计
  const withAgent = results.filter(r => r.comment_agent && r.comment_agent !== 'NULL').length;
  const withBrowserAgent = results.filter(r => r.comment_agent && r.comment_agent.includes('Mozilla')).length;
  const dengluAgent = results.filter(r => r.comment_agent === 'Denglu').length;

  console.log(`\n📊 统计:`);
  console.log(`   总评论数: ${results.length}`);
  console.log(`   有 User Agent: ${withAgent}`);
  console.log(`   Denglu 类型: ${dengluAgent}`);
  console.log(`   浏览器 UA: ${withBrowserAgent}`);
  console.log(`   无 User Agent: ${results.length - withAgent}`);
}
